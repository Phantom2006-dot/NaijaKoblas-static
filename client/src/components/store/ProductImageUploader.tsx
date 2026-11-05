import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LoaderCircle, Upload } from "lucide-react";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES_PER_LISTING,
  MAX_PRODUCT_IMAGES_PER_REQUEST,
  MAX_PRODUCT_UPLOAD_REQUEST_BYTES,
} from "@shared/const";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { trpc } from "@/lib/trpc";

export type ProductGalleryImage = {
  id: number;
  url: string;
  caption: string | null;
  displayOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  format: string;
};

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const acceptedLabel = "JPEG, PNG or WebP";

export function ProductImageUploader({
  productId,
  initialImages,
  canSetPrimary = false,
  onUploaded,
  onSetPrimary,
  onRemove,
}: {
  productId: string;
  initialImages: ProductGalleryImage[];
  canSetPrimary?: boolean;
  onUploaded?: () => void;
  onSetPrimary?: (image: ProductGalleryImage) => void | Promise<void>;
  onRemove?: (image: ProductGalleryImage) => void | Promise<void>;
}) {
  const runtime = useAuthRuntime();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initialImages);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      setImages(current => {
        const unchanged =
          current.length === initialImages.length &&
          current.every((image, index) => {
            const next = initialImages[index];
            return (
              next &&
              image.id === next.id &&
              image.url === next.url &&
              image.isPrimary === next.isPrimary &&
              image.displayOrder === next.displayOrder &&
              image.format === next.format &&
              image.caption === next.caption
            );
          });
        return unchanged ? current : initialImages;
      }),
    [initialImages]
  );
  const setPrimary = trpc.seller.setPrimaryImage.useMutation({
    onSuccess: image => {
      setImages(current =>
        current.map(item => ({ ...item, isPrimary: item.id === image.id }))
      );
      setMessage("Primary product photo updated.");
      onUploaded?.();
    },
  });

  const chooseFiles = (selected: FileList | File[] | null) => {
    setError(null);
    setMessage(null);
    if (!selected) return;
    const next = Array.from(selected);
    const remaining = Math.max(
      0,
      MAX_PRODUCT_IMAGES_PER_LISTING - images.length
    );
    if (next.length === 0) return;
    if (
      next.length > remaining ||
      next.length > MAX_PRODUCT_IMAGES_PER_REQUEST
    ) {
      setFiles([]);
      setError(
        `Choose up to ${Math.min(remaining, MAX_PRODUCT_IMAGES_PER_REQUEST)} more photo${Math.min(remaining, MAX_PRODUCT_IMAGES_PER_REQUEST) === 1 ? "" : "s"}.`
      );
      return;
    }
    const invalid = next.find(
      file =>
        !ACCEPTED_TYPES.has(file.type) || file.size > MAX_PRODUCT_IMAGE_BYTES
    );
    if (invalid) {
      setFiles([]);
      setError(`Use ${acceptedLabel} photos, 8 MB or smaller each.`);
      return;
    }
    if (
      next.reduce((total, file) => total + file.size, 0) >
      MAX_PRODUCT_UPLOAD_REQUEST_BYTES
    ) {
      setFiles([]);
      setError(
        "The combined photo size must not exceed 32 MB per upload batch."
      );
      return;
    }
    setFiles(next);
  };

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const token = await runtime.getToken?.();
      if (!token)
        throw new Error(
          "Your secure session is not ready. Sign in again and retry."
        );
      const body = new FormData();
      files.forEach(file => body.append("images", file));
      const apiBase =
        import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
      const response = await fetch(
        `${apiBase}/api/uploads/products/${encodeURIComponent(productId)}/images`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body,
        }
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Product photos could not be uploaded.";
        throw new Error(detail);
      }
      if (
        !payload ||
        typeof payload !== "object" ||
        !("images" in payload) ||
        !Array.isArray(payload.images)
      ) {
        throw new Error(
          "The upload completed without a valid image response. Refresh the listing before retrying."
        );
      }
      const returned = payload.images as ProductGalleryImage[];
      setImages(current =>
        [...current, ...returned].sort(
          (a, b) => a.displayOrder - b.displayOrder
        )
      );
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      setMessage(
        `${returned.length} product photo${returned.length === 1 ? "" : "s"} uploaded securely.`
      );
      onUploaded?.();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Product photos could not be uploaded."
      );
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => inputRef.current?.click();
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFiles(event.dataTransfer.files);
  };

  return (
    <div className="product-image-uploader">
      <div className="product-upload-heading">
        <div>
          <strong>
            {images.length
              ? `${images.length} of ${MAX_PRODUCT_IMAGES_PER_LISTING} photos added`
              : "Add your first product photo"}
          </strong>
          <small>
            Clear product photos help customers buy with confidence.
          </small>
        </div>
        {images.some(image => image.isPrimary) && (
          <span className="product-upload-ready">
            <Check size={13} /> Primary selected
          </span>
        )}
      </div>
      {images.length > 0 && (
        <div
          className="product-image-gallery"
          aria-label="Product photo gallery"
        >
          {images.map(image => (
            <figure
              key={image.id}
              className={image.isPrimary ? "is-primary" : ""}
            >
              <img
                src={image.url}
                alt={image.caption ?? "Product photo"}
                loading="lazy"
              />
              <figcaption>
                {image.isPrimary ? "Primary photo" : image.format.toUpperCase()}
              </figcaption>
              {canSetPrimary && !image.isPrimary && (
                <button
                  type="button"
                  className="text-button"
                  disabled={setPrimary.isPending}
                  onClick={() => {
                    if (onSetPrimary) void onSetPrimary(image);
                    else setPrimary.mutate({ productId, imageId: image.id });
                  }}
                >
                  Make primary
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void onRemove(image)}
                >
                  Remove photo
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
      {images.length < MAX_PRODUCT_IMAGES_PER_LISTING && (
        <>
          <div
            className={`product-dropzone ${dragging ? "is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            onClick={openPicker}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker();
              }
            }}
            onDragEnter={event => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <ImagePlus size={23} />
            <strong>Drag photos here or choose from your device</strong>
            <span>{acceptedLabel} · up to 8 MB each · up to 4 per batch</span>
            <span className="button button--outline">Choose photos</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={event => chooseFiles(event.target.files)}
              aria-label="Choose product photos"
            />
          </div>
          {files.length > 0 && (
            <div className="product-upload-selection">
              <ImagePlus size={15} />
              <div>
                <strong>
                  {files.length} photo{files.length === 1 ? "" : "s"} ready
                </strong>
                <span>
                  {files.map(file => file.name).join(" · ")} ·{" "}
                  {(
                    files.reduce((sum, file) => sum + file.size, 0) /
                    (1024 * 1024)
                  ).toFixed(1)}{" "}
                  MB
                </span>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setFiles([]);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Clear
              </button>
            </div>
          )}
          <button
            type="button"
            className="button button--dark product-upload-submit"
            onClick={() => void upload()}
            disabled={busy || files.length === 0 || runtime.status !== "ready"}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            {busy ? "Uploading securely…" : "Upload selected photos"}
          </button>
        </>
      )}
      {images.length >= MAX_PRODUCT_IMAGES_PER_LISTING && (
        <p className="product-upload-limit">
          You have reached the 10-photo limit for this listing.
        </p>
      )}
      {message && (
        <p className="form-success">
          <Check size={15} />
          {message}
        </p>
      )}
      {(error || setPrimary.error) && (
        <p className="portal-error" role="alert">
          {error ?? setPrimary.error?.message}
        </p>
      )}
    </div>
  );
}
