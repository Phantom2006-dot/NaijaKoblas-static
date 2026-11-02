import { useState } from "react";
import { ArrowRight, ImagePlus, PackagePlus } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { ProductImageUploader } from "@/components/store/ProductImageUploader";

export function StaffProductIntakePanel() {
  const sellers = trpc.staff.activeSellers.useQuery(undefined, { retry: false });
  const createDraft = trpc.staff.createProductForSeller.useMutation();
  const [createdDraft, setCreatedDraft] = useState<{ productId: string; name: string; sellerName: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const sellerUserId = Number(data.get("sellerUserId"));
    const seller = sellers.data?.find(item => item.userId === sellerUserId);
    if (!seller) return;
    const product = {
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      category: String(data.get("category") ?? "Accessories").trim(),
      priceNaira: Number(data.get("priceNaira")),
      sizes: String(data.get("sizes") ?? "").split(",").map(value => value.trim()).filter(Boolean),
      inventoryCount: Number(data.get("inventoryCount")),
    };
    createDraft.mutate({ sellerUserId, product }, {
      onSuccess: created => {
        setCreatedDraft({ productId: created.id, name: created.name, sellerName: seller.displayName });
        setNotice("Draft created for the selected seller. Add photos below; the seller must review and publish it.");
        form.reset();
      },
    });
  };

  return <section className="portal-shell container-wide staff-product-intake">
    <div className="portal-section">
      <div className="section-heading"><div><span className="eyebrow">Staff product intake</span><h2>Create listings for sellers</h2><p>Staff and administrators can prepare drafts for approved, active stores. Sellers retain publishing control.</p></div><PackagePlus size={24} /></div>
      {sellers.isLoading ? <p>Loading active seller accounts…</p> : sellers.error ? <p className="portal-error">The active seller list is temporarily unavailable. Staff access was not changed.</p> : !sellers.data?.length ? <div className="portal-card portal-empty"><ImagePlus size={22} /><h3>No eligible seller stores</h3><p>Only active seller accounts with an active store can receive staff-created drafts.</p></div> : <form className="portal-card staff-product-form" onSubmit={submit}>
        <label className="form-field"><span>ACTIVE SELLER ACCOUNT</span><select name="sellerUserId" required defaultValue=""><option value="" disabled>Select a seller</option>{sellers.data.map(seller => <option key={seller.userId} value={seller.userId}>{seller.displayName} — {seller.businessName} ({seller.city})</option>)}</select></label>
        <div className="form-grid"><label className="form-field"><span>PRODUCT NAME</span><input name="name" minLength={2} maxLength={180} required /></label><label className="form-field"><span>CATEGORY</span><input name="category" defaultValue="Accessories" maxLength={80} required /></label><label className="form-field"><span>PRICE (NGN)</span><input name="priceNaira" type="number" min="1" max="21000000" step="1" required /></label><label className="form-field"><span>AVAILABLE STOCK</span><input name="inventoryCount" type="number" min="0" max="1000000" step="1" required /></label><label className="form-field form-field--wide"><span>DESCRIPTION</span><textarea name="description" minLength={20} maxLength={5000} rows={3} required /></label><label className="form-field form-field--wide"><span>SIZES / STYLES (COMMA-SEPARATED)</span><input name="sizes" placeholder="One Size, M, L" required /></label></div>
        <button type="submit" className="button button--dark" disabled={createDraft.isPending}>{createDraft.isPending ? "Creating draft…" : "Create seller draft"}<ArrowRight size={16} /></button>
        {createDraft.error && <p className="portal-error" role="alert">{createDraft.error.message}</p>}
      </form>}

      {createdDraft && <article className="portal-card staff-created-draft"><span className="eyebrow">Draft for {createdDraft.sellerName}</span><h3>{createdDraft.name}</h3><p>The listing is private until the seller reviews and publishes it from their workspace.</p><ProductImageUploader productId={createdDraft.productId} initialImages={[]} onUploaded={() => setNotice("Product photos uploaded. The seller can review the draft in their seller workspace.")} /></article>}
      {notice && <p className="form-success">{notice} <Link className="text-link" href="/staff">Back to seller oversight <ArrowRight size={14} /></Link></p>}
    </div>
  </section>;
}
