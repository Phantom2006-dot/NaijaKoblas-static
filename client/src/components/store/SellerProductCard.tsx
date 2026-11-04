import { ArrowRight, Check, ImagePlus, PackageCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { money } from "@/store";
import { ProductImageUploader, type ProductGalleryImage } from "./ProductImageUploader";

type SellerProduct = {
  id: string;
  name: string;
  category: string;
  priceKobo: number;
  inventoryCount: number;
  sizes: string[];
  status: "draft" | "published" | "archived";
  images?: ProductGalleryImage[];
};

export function SellerProductCard({
  product,
  storeActive,
  onChanged,
}: {
  product: SellerProduct;
  storeActive: boolean;
  onChanged: (message?: string) => void;
}) {
  const updateProduct = trpc.seller.updateProduct.useMutation({
    onSuccess: (_product, input) => onChanged(input.changes.status === "published" ? "Listing published successfully." : "Listing updated."),
  });
  const hasPrimaryPhoto = Boolean(product.images?.some(image => image.isPrimary));
  const canPublish = storeActive && product.inventoryCount > 0 && hasPrimaryPhoto;
  const missingRequirements = [
    !hasPrimaryPhoto ? "Add and select a primary photo" : null,
    product.inventoryCount < 1 ? "Add available stock" : null,
    !storeActive ? "Contact support about your inactive store" : null,
  ].filter(Boolean) as string[];

  const submitStockEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateProduct.mutate({
      productId: product.id,
      changes: {
        priceNaira: Number(data.get("priceNaira")),
        inventoryCount: Number(data.get("inventoryCount")),
      },
    });
  };

  return <article className="seller-product-card">
    <div className="seller-product-card-head">
      <div>
        <span className={`status-label status-label--${product.status}`}>{product.status}</span>
        <h3>{product.name}</h3>
        <p>{product.category} · {product.sizes.join(", ")}</p>
      </div>
      <span className="seller-product-card-price">{money(product.priceKobo / 100)}</span>
    </div>
    <div className="seller-product-card-body">
      <div className="seller-product-card-details">
        <div className="seller-product-step"><span>1</span><div><strong>Set price and stock</strong><small>Customers can only buy what you have available.</small></div></div>
        <form className="seller-stock-form" onSubmit={submitStockEdit}>
          <label>Price in ₦ <input aria-label={`${product.name} price`} name="priceNaira" type="number" min="1" max="21000000" step="1" defaultValue={product.priceKobo / 100} required /></label>
          <label>Available stock <input aria-label={`${product.name} stock`} name="inventoryCount" type="number" min="0" max="1000000" step="1" defaultValue={product.inventoryCount} required /></label>
          <button className="button button--outline" type="submit" disabled={updateProduct.isPending}>Save changes</button>
        </form>
        <div className="seller-product-step"><span>2</span><div><strong>Add product photos</strong><small>Use clear JPEG, PNG or WebP photos. Your first primary photo represents the listing.</small></div></div>
        <ProductImageUploader productId={product.id} initialImages={product.images ?? []} canSetPrimary onUploaded={() => onChanged()} />
      </div>
      <aside className={`seller-publish-checklist ${canPublish ? "is-ready" : ""}`} aria-live="polite">
        {canPublish ? <><Check size={22} /><strong>Ready to publish</strong><p>Your listing has a primary photo, available stock and an active store.</p></> : <><PackageCheck size={22} /><strong>Almost ready</strong><p>Complete these steps before publishing:</p><ul>{missingRequirements.map(item => <li key={item}>{item}</li>)}</ul></>}
        {product.status === "published" ? <button className="button button--outline" disabled={updateProduct.isPending} onClick={() => updateProduct.mutate({ productId: product.id, changes: { status: "archived" } })}>Archive listing</button> : <button className="button button--dark" disabled={updateProduct.isPending || !canPublish} onClick={() => updateProduct.mutate({ productId: product.id, changes: { status: "published" } })}>{updateProduct.isPending ? "Saving…" : "Publish listing"}<ArrowRight size={16} /></button>}
      </aside>
    </div>
    {updateProduct.error && <p className="portal-error" role="alert">{updateProduct.error.message}</p>}
  </article>;
}
