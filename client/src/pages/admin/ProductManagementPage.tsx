import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Edit3,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  ProductImageUploader,
  type ProductGalleryImage,
} from "@/components/store/ProductImageUploader";
import { money } from "@/store";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 40;
const LOW_STOCK_COPY = "Low stock (1–5)";
const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
});

type ProductStatus = "draft" | "published" | "archived";
type StockFilter = "all" | "in_stock" | "out_of_stock" | "low_stock";
type SortField = "name" | "price" | "date";
type SortDirection = "asc" | "desc";

type ProductImage = ProductGalleryImage & {
  publicId?: string | null;
  assetId?: string | null;
  createdAt?: string | Date;
};

type ProductDraftFields = {
  name: string;
  description: string;
  category: string;
  priceNaira: string;
  sizes: string;
  inventoryCount: string;
};

type EditFields = ProductDraftFields & { status: ProductStatus };

const emptyDraft: ProductDraftFields = {
  name: "",
  description: "",
  category: "",
  priceNaira: "",
  sizes: "",
  inventoryCount: "0",
};

function formatDate(value: string | Date) {
  return dateFormatter.format(new Date(value));
}

function parseSizes(value: string) {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function productError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isConflict(error: unknown) {
  return typeof error === "object" && error !== null && "data" in error
    ? (error as { data?: { code?: string } }).data?.code === "CONFLICT"
    : error instanceof Error && /changed|refresh|conflict/i.test(error.message);
}

function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span className={`status-label status-label--${status}`}>{status}</span>
  );
}

function Notice({
  message,
  error,
}: {
  message: string | null;
  error: string | null;
}) {
  if (error)
    return (
      <p className="admin-products-error" role="alert">
        <AlertTriangle size={16} /> {error}
      </p>
    );
  if (message)
    return (
      <p className="admin-products-success" role="status">
        <Check size={16} /> {message}
      </p>
    );
  return null;
}

function SellerDraftPanel({
  onCreated,
}: {
  onCreated: (productId: string) => void;
}) {
  const sellers = trpc.staff.activeSellers.useQuery(undefined, {
    retry: false,
  });
  const create = trpc.admin.productManagement.create.useMutation();
  const [fields, setFields] = useState<ProductDraftFields>(emptyDraft);
  const [sellerUserId, setSellerUserId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateField = (name: keyof ProductDraftFields, value: string) =>
    setFields(current => ({ ...current, [name]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const seller = sellers.data?.find(
      item => item.userId === Number(sellerUserId)
    );
    if (!seller) {
      setError("Choose an approved seller with an active store.");
      return;
    }
    create.mutate(
      {
        sellerUserId: seller.userId,
        product: {
          name: fields.name.trim(),
          description: fields.description.trim(),
          category: fields.category.trim(),
          priceNaira: Number(fields.priceNaira),
          sizes: parseSizes(fields.sizes),
          inventoryCount: Number(fields.inventoryCount),
        },
      },
      {
        onSuccess: product => {
          setMessage(
            `Draft created for ${seller.displayName}. The seller must review and publish it.`
          );
          setFields(emptyDraft);
          setSellerUserId("");
          onCreated(product.id);
        },
        onError: mutationError =>
          setError(
            productError(
              mutationError,
              "The seller draft could not be created."
            )
          ),
      }
    );
  };

  return (
    <section
      className="admin-products-create-panel"
      aria-labelledby="admin-products-create-title"
    >
      <div className="admin-products-panel-heading">
        <div>
          <span className="eyebrow">Seller draft intake</span>
          <h2 id="admin-products-create-title">
            Prepare a listing for an eligible seller
          </h2>
          <p>
            Creation is always a private draft. The seller retains the
            server-enforced publication boundary.
          </p>
        </div>
        <PackagePlus size={24} />
      </div>
      {sellers.isLoading ? (
        <p className="admin-products-loading-copy">
          Loading eligible seller accounts…
        </p>
      ) : sellers.error ? (
        <p className="admin-products-error" role="alert">
          Active seller accounts are temporarily unavailable.
        </p>
      ) : !sellers.data?.length ? (
        <p className="admin-products-empty-copy">
          No approved seller with an active store is eligible for a new draft.
        </p>
      ) : (
        <form className="admin-products-form" onSubmit={submit}>
          <label>
            <span>Seller owner</span>
            <select
              value={sellerUserId}
              onChange={event => setSellerUserId(event.target.value)}
              required
            >
              <option value="">Select an active seller</option>
              {sellers.data.map(seller => (
                <option key={seller.userId} value={seller.userId}>
                  {seller.displayName} — {seller.businessName} ({seller.city})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input
              value={fields.name}
              onChange={event => updateField("name", event.target.value)}
              minLength={2}
              maxLength={180}
              required
            />
          </label>
          <label>
            <span>Category</span>
            <input
              value={fields.category}
              onChange={event => updateField("category", event.target.value)}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <label>
            <span>Price (NGN)</span>
            <input
              value={fields.priceNaira}
              onChange={event => updateField("priceNaira", event.target.value)}
              type="number"
              min="0.01"
              max="21474836.47"
              step="0.01"
              inputMode="decimal"
              required
            />
          </label>
          <label>
            <span>Inventory</span>
            <input
              value={fields.inventoryCount}
              onChange={event =>
                updateField("inventoryCount", event.target.value)
              }
              type="number"
              min="0"
              max="1000000"
              step="1"
              required
            />
          </label>
          <label className="admin-products-field-wide">
            <span>Description</span>
            <textarea
              value={fields.description}
              onChange={event => updateField("description", event.target.value)}
              minLength={20}
              maxLength={5000}
              rows={3}
              required
            />
          </label>
          <label className="admin-products-field-wide">
            <span>Sizes / styles</span>
            <input
              value={fields.sizes}
              onChange={event => updateField("sizes", event.target.value)}
              placeholder="One Size, M, L"
              required
            />
          </label>
          <div className="admin-products-form-actions">
            <button
              className="button button--dark"
              type="submit"
              disabled={create.isPending}
            >
              {create.isPending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <PackagePlus size={16} />
              )}
              {create.isPending ? "Creating draft…" : "Create seller draft"}
            </button>
          </div>
        </form>
      )}
      <Notice message={message} error={error} />
    </section>
  );
}

function ProductEditForm({
  detail,
  onSaved,
  onCancel,
  onConflict,
}: {
  detail: any;
  onSaved: (message: string) => void;
  onCancel: () => void;
  onConflict: () => void;
}) {
  const [fields, setFields] = useState<EditFields>(() => ({
    name: detail.name,
    description: detail.description,
    category: detail.category,
    priceNaira: String(detail.priceNaira),
    sizes: detail.sizes.join(", "),
    inventoryCount: String(detail.inventoryCount),
    status: detail.status,
  }));
  const [error, setError] = useState<string | null>(null);
  const update = trpc.admin.productManagement.update.useMutation();
  const setField = (name: keyof EditFields, value: string) =>
    setFields(current => ({ ...current, [name]: value }));

  useEffect(() => {
    setFields({
      name: detail.name,
      description: detail.description,
      category: detail.category,
      priceNaira: String(detail.priceNaira),
      sizes: detail.sizes.join(", "),
      inventoryCount: String(detail.inventoryCount),
      status: detail.status,
    });
    setError(null);
  }, [detail]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    update.mutate(
      {
        productId: detail.id,
        expectedUpdatedAt: detail.updatedAt,
        changes: {
          name: fields.name.trim(),
          description: fields.description.trim(),
          category: fields.category.trim(),
          priceNaira: Number(fields.priceNaira),
          sizes: parseSizes(fields.sizes),
          inventoryCount: Number(fields.inventoryCount),
          status: fields.status,
        },
      },
      {
        onSuccess: () => onSaved("Product details saved."),
        onError: mutationError => {
          setError(
            productError(mutationError, "Product details could not be saved.")
          );
          if (isConflict(mutationError)) onConflict();
        },
      }
    );
  };

  return (
    <form className="admin-products-edit-form" onSubmit={submit}>
      <div className="admin-products-form-heading">
        <div>
          <span className="eyebrow">Editing listing</span>
          <h2>{detail.name}</h2>
          <p>
            Fresh detail snapshot: {formatDate(detail.updatedAt)}. Saving uses
            this timestamp to protect against stale edits.
          </p>
        </div>
        <button
          type="button"
          className="admin-products-icon-button"
          onClick={onCancel}
          aria-label="Close product editor"
        >
          <X size={18} />
        </button>
      </div>
      <div className="admin-products-form-grid">
        <label>
          <span>Name</span>
          <input
            value={fields.name}
            onChange={event => setField("name", event.target.value)}
            minLength={2}
            maxLength={180}
            required
          />
        </label>
        <label>
          <span>Category</span>
          <input
            value={fields.category}
            onChange={event => setField("category", event.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
        </label>
        <label>
          <span>Price (NGN)</span>
          <input
            value={fields.priceNaira}
            onChange={event => setField("priceNaira", event.target.value)}
            type="number"
            min="0.01"
            max="21474836.47"
            step="0.01"
            inputMode="decimal"
            required
          />
        </label>
        <label>
          <span>Inventory</span>
          <input
            value={fields.inventoryCount}
            onChange={event => setField("inventoryCount", event.target.value)}
            type="number"
            min="0"
            max="1000000"
            step="1"
            required
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={fields.status}
            onChange={event => setField("status", event.target.value)}
          >
            <option value="draft">Draft</option>
            {detail.status === "published" && (
              <option value="published">Published</option>
            )}
            <option value="archived">Archived</option>
          </select>
          <small>
            {detail.status === "draft"
              ? "A draft cannot be published by an administrator; the seller must review it."
              : "Archive is available without changing seller ownership."}
          </small>
        </label>
        <label>
          <span>Sizes / styles</span>
          <input
            value={fields.sizes}
            onChange={event => setField("sizes", event.target.value)}
            required
          />
        </label>
        <label className="admin-products-field-wide">
          <span>Description</span>
          <textarea
            value={fields.description}
            onChange={event => setField("description", event.target.value)}
            minLength={20}
            maxLength={5000}
            rows={4}
            required
          />
        </label>
      </div>
      {error && (
        <p className="admin-products-error" role="alert">
          <AlertTriangle size={16} /> {error}{" "}
          {isConflict({ message: error }) && (
            <button type="button" className="text-button" onClick={onConflict}>
              Refresh detail
            </button>
          )}
        </p>
      )}
      <div className="admin-products-form-actions">
        <button
          type="button"
          className="button button--outline"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button button--dark"
          disabled={update.isPending}
        >
          {update.isPending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function AdminMediaMetadata({
  productId,
  images,
  onChanged,
}: {
  productId: string;
  images: ProductImage[];
  onChanged: (message: string) => void;
}) {
  const editImage = trpc.admin.productManagement.editImage.useMutation();
  const [drafts, setDrafts] = useState<
    Record<number, { caption: string; displayOrder: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const valueFor = (image: ProductImage) =>
    drafts[image.id] ?? {
      caption: image.caption ?? "",
      displayOrder: String(image.displayOrder),
    };
  const save = (image: ProductImage) => {
    const draft = valueFor(image);
    setError(null);
    editImage.mutate(
      {
        productId,
        imageId: image.id,
        caption: draft.caption.trim() || null,
        displayOrder: Number(draft.displayOrder),
      },
      {
        onSuccess: () => onChanged("Image metadata saved."),
        onError: mutationError =>
          setError(
            productError(mutationError, "Image metadata could not be saved.")
          ),
      }
    );
  };
  if (!images.length)
    return (
      <p className="admin-products-empty-copy">
        No media metadata to edit. Upload a photo above to begin.
      </p>
    );
  return (
    <div className="admin-products-media-metadata">
      <div className="admin-products-subheading">
        <h3>Image metadata</h3>
        <span>Captions and gallery order are admin-editable.</span>
      </div>
      {images.map(image => {
        const draft = valueFor(image);
        return (
          <div className="admin-products-media-row" key={image.id}>
            <img src={image.url} alt={image.caption ?? "Product preview"} />
            <label>
              <span>Caption</span>
              <input
                value={draft.caption}
                maxLength={240}
                onChange={event =>
                  setDrafts(current => ({
                    ...current,
                    [image.id]: { ...draft, caption: event.target.value },
                  }))
                }
              />
            </label>
            <label>
              <span>Order</span>
              <input
                value={draft.displayOrder}
                type="number"
                min="0"
                max="9"
                step="1"
                onChange={event =>
                  setDrafts(current => ({
                    ...current,
                    [image.id]: { ...draft, displayOrder: event.target.value },
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="button button--outline"
              onClick={() => save(image)}
              disabled={editImage.isPending}
            >
              <Save size={14} /> Save
            </button>
          </div>
        );
      })}
      {error && (
        <p className="admin-products-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AdminProductManagementPage() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get("category") ?? "");
  const [status, setStatus] = useState<"all" | ProductStatus>("all");
  const [stock, setStock] = useState<StockFilter>("all");
  const [sort, setSort] = useState<SortField>("date");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanupWarning, setCleanupWarning] = useState<string | null>(null);

  const listInput = {
    search: search.trim() || undefined,
    category: category || undefined,
    status: status === "all" ? undefined : status,
    stock,
    sort,
    direction,
    offset,
    limit: PAGE_SIZE,
  };
  const products = trpc.admin.productManagement.list.useQuery(listInput, {
    retry: false,
  });
  const categories = trpc.admin.productManagement.categories.useQuery(
    undefined,
    { retry: false }
  );
  const detail = trpc.admin.productManagement.detail.useQuery(
    { productId: selectedId ?? "" },
    { enabled: Boolean(selectedId), retry: false }
  );

  useEffect(() => {
    const first = products.data?.items[0];
    if (selectedId && products.data?.items.some(item => item.id === selectedId))
      return;
    if (first) setSelectedId(first.id);
    else if (products.data && !products.data.items.length) setSelectedId(null);
  }, [products.data, selectedId]);

  const refreshAll = () => {
    setNotice(null);
    setError(null);
    void products.refetch();
    if (selectedId) void detail.refetch();
  };
  const invalidateCatalog = () => void utils.catalog.list.invalidate();
  const afterProductChange = (message: string) => {
    setNotice(message);
    setError(null);
    void products.refetch();
    void detail.refetch();
    invalidateCatalog();
  };
  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setStatus("all");
    setStock("all");
    setOffset(0);
  };

  const setPrimary = trpc.admin.productManagement.setPrimaryImage.useMutation();
  const removeImage = trpc.admin.productManagement.removeImage.useMutation();
  const removeProduct = trpc.admin.productManagement.delete.useMutation();
  const handleSetPrimary = (image: ProductGalleryImage) => {
    if (!selectedId) return;
    setPrimary.mutate(
      { productId: selectedId, imageId: image.id },
      {
        onSuccess: () => afterProductChange("Primary product photo updated."),
        onError: mutationError =>
          setError(
            productError(
              mutationError,
              "The primary photo could not be updated."
            )
          ),
      }
    );
  };
  const handleRemoveImage = (image: ProductGalleryImage) => {
    if (
      !selectedId ||
      !window.confirm(
        "Remove this product photo? This removes its metadata from the listing."
      )
    )
      return;
    removeImage.mutate(
      { productId: selectedId, imageId: image.id, confirm: true },
      {
        onSuccess: result => {
          if (result.cleanupPending)
            setCleanupWarning(
              "The image record was removed, but Cloudinary orphan asset cleanup is pending. This action does not confirm provider asset deletion."
            );
          afterProductChange("Product photo removed.");
        },
        onError: mutationError =>
          setError(
            productError(
              mutationError,
              "The product photo could not be removed."
            )
          ),
      }
    );
  };
  const handleDelete = () => {
    if (!detail.data) return;
    const confirmationName = window.prompt(
      `Type the exact product name to delete:\n\n${detail.data.name}`
    );
    if (confirmationName === null) return;
    setError(null);
    removeProduct.mutate(
      { productId: detail.data.id, confirmationName },
      {
        onSuccess: result => {
          if (result.cleanupPending)
            setCleanupWarning(
              "The product was deleted, but Cloudinary orphan asset cleanup is pending. This action does not confirm provider asset deletion."
            );
          setSelectedId(null);
          setEditing(false);
          setNotice("Product deleted.");
          void products.refetch();
          invalidateCatalog();
        },
        onError: mutationError =>
          setError(
            productError(
              mutationError,
              "The product could not be deleted. Products with order history must be archived instead."
            )
          ),
      }
    );
  };

  const selectedProduct = useMemo(
    () => products.data?.items.find(item => item.id === selectedId),
    [products.data, selectedId]
  );
  const hasPrevious = offset > 0;
  const hasNext = Boolean(products.data?.hasMore);

  return (
    <main className="admin-products-page">
      <header className="admin-products-header">
        <div>
          <span className="eyebrow">Admin catalog operations</span>
          <h1>Product management</h1>
          <p>
            Review seller-owned listings, inventory, media and store readiness
            without crossing the seller publication boundary.
          </p>
        </div>
        <div className="admin-products-header-actions">
          <span className="role-badge role-badge--admin">
            <ShieldCheck size={14} /> Administrator
          </span>
          <button
            type="button"
            className="button button--outline"
            onClick={refreshAll}
            disabled={products.isFetching || detail.isFetching}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </header>
      <Notice message={notice} error={error} />
      {cleanupWarning && (
        <p className="admin-products-cleanup-warning" role="status">
          <AlertTriangle size={16} />
          <span>
            <strong>Cleanup pending:</strong> {cleanupWarning}
          </span>
          <button
            type="button"
            className="admin-products-dismiss"
            onClick={() => setCleanupWarning(null)}
            aria-label="Dismiss cleanup warning"
          >
            <X size={15} />
          </button>
        </p>
      )}
      <SellerDraftPanel
        onCreated={productId => {
          setSelectedId(productId);
          setOffset(0);
          void products.refetch();
        }}
      />
      <section
        className="admin-products-catalog-panel"
        aria-labelledby="admin-products-catalog-title"
      >
        <div className="admin-products-panel-heading">
          <div>
            <span className="eyebrow">Catalog ledger</span>
            <h2 id="admin-products-catalog-title">Listings and stock</h2>
            <p>
              {products.data
                ? `${products.data.total} matching product${products.data.total === 1 ? "" : "s"}`
                : "Actual product, seller, store and media data"}
            </p>
          </div>
          <ClipboardList size={24} />
        </div>
        <div className="admin-products-filters">
          <label>
            <span>Search</span>
            <input
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              placeholder="Name or category"
            />
          </label>
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={event => {
                setCategory(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">All categories</option>
              {categories.data?.map(item => (
                <option key={item.category} value={item.category}>
                  {item.category} ({item.productCount})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={status}
              onChange={event => {
                setStatus(event.target.value as typeof status);
                setOffset(0);
              }}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            <span>Availability</span>
            <select
              value={stock}
              onChange={event => {
                setStock(event.target.value as StockFilter);
                setOffset(0);
              }}
            >
              <option value="all">All stock</option>
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="low_stock">{LOW_STOCK_COPY}</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select
              value={sort}
              onChange={event => {
                setSort(event.target.value as SortField);
                setOffset(0);
              }}
            >
              <option value="date">Date created</option>
              <option value="name">Name</option>
              <option value="price">Price</option>
            </select>
          </label>
          <button
            type="button"
            className="admin-products-sort-button"
            onClick={() =>
              setDirection(current => (current === "asc" ? "desc" : "asc"))
            }
            aria-label={`Sort ${direction === "asc" ? "descending" : "ascending"}`}
          >
            <span>Direction</span>
            {direction === "asc" ? (
              <ArrowUp size={16} />
            ) : (
              <ArrowDown size={16} />
            )}{" "}
            {direction === "asc" ? "Ascending" : "Descending"}
          </button>
          <button
            type="button"
            className="text-button admin-products-clear-button"
            onClick={resetFilters}
          >
            Clear filters
          </button>
        </div>
        {products.isLoading ? (
          <p className="admin-products-loading-copy">
            Loading product records…
          </p>
        ) : products.error ? (
          <div className="admin-products-state">
            <AlertTriangle size={22} />
            <h3>Catalog data unavailable</h3>
            <p>{products.error.message}</p>
            <button
              type="button"
              className="button button--outline"
              onClick={() => void products.refetch()}
            >
              Try again
            </button>
          </div>
        ) : !products.data?.items.length ? (
          <div className="admin-products-state">
            <ClipboardList size={22} />
            <h3>No products match these filters</h3>
            <p>Reset the filters or wait for seller listings to appear.</p>
            <button
              type="button"
              className="button button--outline"
              onClick={resetFilters}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="admin-products-table-wrap">
            <table className="admin-products-table">
              <caption className="admin-products-sr-only">
                Product records
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Seller / store</th>
                  <th scope="col">Status</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Media</th>
                  <th scope="col">Created / updated</th>
                  <th scope="col">
                    <span className="admin-products-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map(product => (
                  <tr
                    key={product.id}
                    className={selectedId === product.id ? "is-selected" : ""}
                    onClick={() => {
                      setSelectedId(product.id);
                      setEditing(false);
                      setError(null);
                    }}
                  >
                    <td>
                      <div className="admin-products-product-cell">
                        <div className="admin-products-thumbnail">
                          {product.imageUrl ? (
                            <img src={product.imageUrl} alt="" />
                          ) : (
                            <PackagePlus size={17} />
                          )}
                        </div>
                        <div>
                          <strong>{product.name}</strong>
                          <small>
                            {product.category} · {money(product.priceNaira)}
                          </small>
                          <small>{product.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>
                        {product.store?.displayName ?? "Store unavailable"}
                      </strong>
                      <small>
                        {product.seller.name ?? product.seller.email}
                      </small>
                      <small
                        className={
                          product.store?.isActive === false
                            ? "admin-products-danger"
                            : ""
                        }
                      >
                        {product.store?.city ?? "No city"} ·{" "}
                        {product.store?.isActive === false
                          ? "Store inactive"
                          : "Store active"}
                      </small>
                    </td>
                    <td>
                      <StatusBadge status={product.status} />
                    </td>
                    <td>
                      <strong>{product.inventoryCount}</strong>
                      <small>
                        {product.inventoryCount === 0
                          ? "Out of stock"
                          : product.inventoryCount <= 5
                            ? LOW_STOCK_COPY
                            : "Available"}
                      </small>
                    </td>
                    <td>
                      <strong>{product.imageCount}</strong>
                      <small>
                        {product.primaryImageCount
                          ? "Primary selected"
                          : "No primary"}
                      </small>
                    </td>
                    <td>
                      <small>
                        {shortDateFormatter.format(new Date(product.createdAt))}
                      </small>
                      <small>{formatDate(product.updatedAt)}</small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--outline admin-products-row-button"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedId(product.id);
                          setEditing(true);
                        }}
                      >
                        Edit <Edit3 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="admin-products-pagination">
          <span>
            {products.data
              ? `Showing ${products.data.offset + 1}–${products.data.offset + products.data.items.length} of ${products.data.total}`
              : ""}
          </span>
          <div>
            <button
              type="button"
              className="button button--outline"
              disabled={!hasPrevious || products.isFetching}
              onClick={() =>
                setOffset(current => Math.max(0, current - PAGE_SIZE))
              }
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              type="button"
              className="button button--outline"
              disabled={!hasNext || products.isFetching}
              onClick={() => setOffset(current => current + PAGE_SIZE)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
      {selectedId && (
        <section
          className="admin-products-detail-panel"
          aria-labelledby="admin-products-detail-title"
        >
          {detail.isLoading ? (
            <p className="admin-products-loading-copy">
              Loading fresh product detail…
            </p>
          ) : detail.error ? (
            <div className="admin-products-state">
              <AlertTriangle size={22} />
              <h3>Product detail unavailable</h3>
              <p>{detail.error.message}</p>
              <button
                type="button"
                className="button button--outline"
                onClick={() => void detail.refetch()}
              >
                Refresh detail
              </button>
            </div>
          ) : detail.data ? (
            <>
              {!editing ? (
                <div className="admin-products-detail-summary">
                  <div>
                    <span className="eyebrow">Selected listing</span>
                    <h2 id="admin-products-detail-title">{detail.data.name}</h2>
                    <p>{detail.data.description}</p>
                    <div className="admin-products-detail-facts">
                      <StatusBadge status={detail.data.status} />
                      <span>{detail.data.category}</span>
                      <strong>{money(detail.data.priceNaira)}</strong>
                      <span>{detail.data.inventoryCount} available</span>
                    </div>
                    <p className="admin-products-owner">
                      <strong>Seller owner:</strong>{" "}
                      {detail.data.seller.name ?? detail.data.seller.email} ·{" "}
                      {detail.data.store?.displayName ?? "Store unavailable"} ·{" "}
                      {detail.data.store?.city ?? "No city"}
                    </p>
                  </div>
                  <div className="admin-products-detail-actions">
                    <button
                      type="button"
                      className="button button--dark"
                      onClick={() => {
                        setEditing(true);
                        setNotice(null);
                      }}
                    >
                      <Edit3 size={15} /> Edit
                    </button>
                    <button
                      type="button"
                      className="button button--outline"
                      onClick={handleDelete}
                      disabled={removeProduct.isPending}
                    >
                      <Trash2 size={15} />
                      {removeProduct.isPending ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <ProductEditForm
                  detail={detail.data}
                  onCancel={() => setEditing(false)}
                  onSaved={message => {
                    setEditing(false);
                    afterProductChange(message);
                  }}
                  onConflict={() => {
                    setEditing(false);
                    setError(
                      "This product changed before the edit could be saved. Detail refreshed; review the current values before trying again."
                    );
                    void detail.refetch();
                  }}
                />
              )}
              <div className="admin-products-media-panel">
                <div className="admin-products-subheading">
                  <div>
                    <h3>Gallery</h3>
                    <span>
                      Seller-owned media · {detail.data.images.length} of 10
                      images
                    </span>
                  </div>
                  {detail.data.images.some(
                    (image: ProductImage) => image.isPrimary
                  ) && (
                    <span className="admin-products-ready">
                      <Check size={14} /> Primary selected
                    </span>
                  )}
                </div>
                <ProductImageUploader
                  productId={detail.data.id}
                  initialImages={detail.data.images}
                  canSetPrimary
                  onUploaded={() => {
                    void detail.refetch();
                    void products.refetch();
                    invalidateCatalog();
                  }}
                  onSetPrimary={handleSetPrimary}
                  onRemove={handleRemoveImage}
                />
                <AdminMediaMetadata
                  productId={detail.data.id}
                  images={detail.data.images}
                  onChanged={message => {
                    afterProductChange(message);
                  }}
                />
              </div>
              <div className="admin-products-audit-panel">
                <div className="admin-products-subheading">
                  <div>
                    <h3>Recent detail audit</h3>
                    <span>Bounded to the latest five product events.</span>
                  </div>
                  <Archive size={18} />
                </div>
                {detail.data.history.slice(0, 5).length ? (
                  <ol>
                    {detail.data.history.slice(0, 5).map((event: any) => (
                      <li key={event.id}>
                        <strong>{event.eventType.replaceAll("_", " ")}</strong>
                        <span>
                          {event.actor?.name ??
                            event.actor?.email ??
                            "Administrator"}{" "}
                          · {formatDate(event.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="admin-products-empty-copy">
                    No audit events recorded for this listing yet.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </section>
      )}
    </main>
  );
}
