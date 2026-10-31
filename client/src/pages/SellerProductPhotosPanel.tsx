import { ImagePlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ProductImageUploader } from "@/components/store/ProductImageUploader";

export function SellerProductPhotosPanel() {
  const seller = trpc.seller.dashboard.useQuery(undefined, { retry: false });
  if (seller.isLoading) return <section className="portal-shell container-wide seller-photo-panel"><p>Loading your product galleries…</p></section>;
  if (seller.error || !seller.data) return null;
  return <section className="portal-shell container-wide seller-photo-panel">
    <div className="portal-section">
      <div className="section-heading"><div><span className="eyebrow">Seller-owned media</span><h2>Product photos</h2><p>Upload up to 10 JPEG, PNG or WebP images per listing. You control which image is primary.</p></div><ImagePlus size={24} /></div>
      {seller.data.products.length ? <div className="portal-list seller-photo-list">{seller.data.products.map(product => <article className="portal-row seller-photo-row" key={product.id}>
        <div className="seller-photo-heading"><span className={`status-label status-label--${product.status}`}>{product.status}</span><h3>{product.name}</h3><p>{product.category} · {product.sizes.join(", ")}</p></div>
        <ProductImageUploader productId={product.id} initialImages={product.images ?? []} canSetPrimary onUploaded={() => { void seller.refetch(); }} />
      </article>)}</div> : <div className="portal-card portal-empty"><ImagePlus size={24} /><h3>Create a product first</h3><p>Draft listings you create in the seller workspace will be ready for photo uploads here.</p></div>}
    </div>
  </section>;
}
