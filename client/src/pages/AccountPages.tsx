import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BadgeCheck, Clock3, PackageCheck, ShieldCheck, Store, UserRound, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { money } from "@/store";
import { useAuthRuntime } from "@/_core/auth-runtime";

const roleLabels = {
  customer: "Customer",
  seller: "Approved seller",
  staff: "Staff",
  admin: "Administrator",
} as const;

function safePaystackCheckoutUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.paystack.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function LoadingPanel({ label = "Confirming your secure session…" }: { label?: string }) {
  return <main><section className="portal-shell container-wide"><div className="portal-card portal-loading"><span className="eyebrow">NaijaKoblas Account</span><h1>{label}</h1></div></section></main>;
}

function AccessDenied({ title, copy, actionHref = "/login", actionLabel = "Sign in securely" }: { title: string; copy: string; actionHref?: string; actionLabel?: string }) {
  return <main><section className="portal-shell container-wide"><div className="portal-card portal-empty"><span className="eyebrow">Protected area</span><h1>{title}</h1><p>{copy}</p><Link href={actionHref} className="button button--dark">{actionLabel} <ArrowRight size={17} /></Link></div></section></main>;
}

function ClerkSignOutButton() {
  const { signOut } = useAuthRuntime();
  return <button className="text-button" disabled={!signOut} onClick={() => { if (signOut) void signOut(); }}>Sign out</button>;
}

export function AccountPage() {
  const account = trpc.account.me.useQuery();
  const orders = trpc.orders.mine.useQuery(undefined, { enabled: Boolean(account.data), retry: false });

  if (account.isLoading) return <LoadingPanel />;
  if (!account.data) return <AccessDenied title="Sign in required" copy="Please sign in to view your NaijaKoblas account." />;

  const { user, sellerApplication, profile } = account.data;
  const portal = user.role === "seller" ? ["Seller dashboard", "/seller"] : user.role === "staff" ? ["Staff portal", "/staff"] : user.role === "admin" ? ["Admin portal", "/admin"] : null;
  const applicationStatus = sellerApplication?.status;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Your NaijaKoblas space</span><h1>Welcome{user.name ? `, ${user.name}` : " back"}.</h1><p>Manage your customer account and marketplace access from one secure sign-in.</p></div><span className={`role-badge role-badge--${user.role}`}>{roleLabels[user.role]}</span></div>
    <div className="portal-grid">
      <article className="portal-card account-summary"><UserRound size={22} /><span>Signed in as</span><strong>{user.email ?? user.name ?? "NaijaKoblas customer"}</strong><small>Authenticated through Clerk.</small><ClerkSignOutButton /></article>
      <article className="portal-card"><BadgeCheck size={22} /><span>Seller status</span>{applicationStatus ? <><strong className={`status-label status-label--${applicationStatus}`}>{applicationStatus}</strong><p>{applicationStatus === "pending" ? "Your application is with the partnerships team." : applicationStatus === "approved" ? "Your seller access is active." : applicationStatus === "rejected" ? "Your application needs a further conversation with our team." : "Your seller access is currently paused."}</p></> : <><strong>Not applied</strong><p>Share your craft and apply to sell with NaijaKoblas.</p><Link href="/vendor#apply" className="text-link">Start a seller application <ArrowRight size={15} /></Link></>}</article>
      <article className="portal-card"><Store size={22} /><span>Marketplace</span><strong>Shopping access is ready</strong><p>{profile ? `Default delivery address: ${profile.city}.` : "Add your delivery details at checkout; they will be saved to this account."}</p><Link href="/products" className="text-link">Shop the live collection <ArrowRight size={15} /></Link></article>
    </div>
    {portal && <div className="portal-callout"><ShieldCheck size={20} /><div><strong>{portal[0]} available</strong><span>Your current account role has access to a protected workspace.</span></div><Link href={portal[1]} className="button button--dark">Open portal <ArrowRight size={16} /></Link></div>}
    {applicationStatus === "suspended" && <div className="portal-callout"><ShieldCheck size={20} /><div><strong>Existing paid orders still need fulfilment</strong><span>Seller tools are paused, but you can access and complete orders customers paid for before suspension.</span></div><Link href="/seller-fulfillment" className="button button--dark">Open fulfilment-only access <ArrowRight size={16} /></Link></div>}
    <section className="portal-section"><div className="section-heading"><div><span className="eyebrow">Customer orders</span><h2>Order history</h2></div></div>{orders.isLoading ? <p>Loading your private order history…</p> : orders.error ? <p className="portal-error">Order history is temporarily unavailable.</p> : orders.data?.length ? <div className="portal-list">{orders.data.map(order => <article className="portal-row" key={order.id}><div><span className={`status-label status-label--${order.status}`}>{order.status.replaceAll("_", " ")}</span><h2>{order.reference}</h2><p>{order.items.reduce((sum, item) => sum + item.quantity, 0)} items · {new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(order.createdAt))}</p><small>{order.items.map(item => `${item.nameSnapshot} × ${item.quantity}`).join(" · ")}</small>{order.paymentStatus === "pending" && (safePaystackCheckoutUrl(order.checkoutUrl) ? <a className="text-link" href={safePaystackCheckoutUrl(order.checkoutUrl) ?? undefined} rel="noreferrer">Continue payment <ArrowRight size={15} /></a> : <p className="payment-provider-note">Payment setup is still pending. Do not place another order; contact support if this persists.</p>)}</div><strong>{money(order.totalKobo / 100)}</strong></article>)}</div> : <div className="portal-card portal-empty"><PackageCheck size={24} /><h3>No orders yet</h3><p>Once a payment is verified, your order and seller fulfilment updates will appear here.</p><Link href="/products" className="button button--dark">Browse the collection <ArrowRight size={16} /></Link></div>}</section>
  </section></main>;
}

export function SellerDashboardPage() {
  const seller = trpc.seller.dashboard.useQuery();
  const createProduct = trpc.seller.createProduct.useMutation({ onSuccess: () => { void seller.refetch(); } });
  const updateProduct = trpc.seller.updateProduct.useMutation({ onSuccess: () => { void seller.refetch(); } });
  const updateFulfillment = trpc.seller.updateOrderItemFulfillment.useMutation({ onSuccess: () => { void seller.refetch(); } });
  const [notice, setNotice] = useState<string | null>(null);
  if (seller.isLoading) return <LoadingPanel label="Loading your seller workspace…" />;
  if (seller.error) return seller.error.data?.code === "FORBIDDEN" ? <AccessDenied title="Seller approval required" copy="This workspace becomes available after your seller application has been approved." actionHref="/account" actionLabel="Go to my account" /> : <AccessDenied title="Seller workspace unavailable" copy="We could not load your seller data. Please retry after the database service is available." actionHref="/account" actionLabel="Go to my account" />;
  if (!seller.data) return <AccessDenied title="Seller approval required" copy="This workspace becomes available after your seller application has been approved." actionHref="/account" actionLabel="Go to my account" />;

  const submitProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const sizes = String(data.get("sizes") ?? "").split(",").map(size => size.trim()).filter(Boolean);
    createProduct.mutate({
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      category: String(data.get("category") ?? "Accessories").trim(),
      priceNaira: Number(data.get("priceNaira")),
      imageUrl: String(data.get("imageUrl") ?? "").trim() || undefined,
      sizes,
      inventoryCount: Number(data.get("inventoryCount")),
    }, { onSuccess: () => { form.reset(); setNotice("Draft listing created. Publish it when details and stock are ready."); } });
  };

  const submitStockEdit = (event: React.FormEvent<HTMLFormElement>, productId: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateProduct.mutate({
      productId,
      changes: {
        priceNaira: Number(data.get("priceNaira")),
        inventoryCount: Number(data.get("inventoryCount")),
      },
    }, { onSuccess: () => setNotice("Listing price and stock saved.") });
  };

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Seller workspace</span><h1>{seller.data.application?.businessName ?? seller.data.store?.displayName ?? "Your craft business"}</h1><p>Manage seller-owned products, stock and order-line fulfilment. Payments currently settle to the marketplace Paystack account; vendor payouts are not enabled.</p></div><span className="role-badge role-badge--seller">Approved seller</span></div>
    <div className="portal-grid"><article className="portal-card"><Store size={22} /><span>Store status</span><strong>{seller.data.store?.isActive ? "Active" : "Not active"}</strong><p>{seller.data.store?.isActive ? "Published products can appear in the public catalog." : "Contact partnerships to activate your store."}</p></article><article className="portal-card"><PackageCheck size={22} /><span>Products</span><strong>{seller.data.products.length}</strong><p>Draft listings stay private until published.</p></article><article className="portal-card"><UsersRound size={22} /><span>Account</span><strong>{seller.data.user.email ?? seller.data.user.name ?? "Seller"}</strong><Link href="/account" className="text-link">View account <ArrowRight size={15} /></Link></article></div>
    <section className="portal-section"><div className="section-heading"><div><span className="eyebrow">Seller-owned catalog</span><h2>Products and inventory</h2></div></div><form className="portal-card seller-product-form" onSubmit={submitProduct}><h3>Create a draft listing</h3><div className="form-grid"><label className="form-field"><span>PRODUCT NAME</span><input name="name" minLength={2} maxLength={180} required /></label><label className="form-field"><span>CATEGORY</span><input name="category" defaultValue="Accessories" required /></label><label className="form-field"><span>PRICE (NGN)</span><input name="priceNaira" type="number" min="1" max="21000000" step="1" required /></label><label className="form-field"><span>AVAILABLE STOCK</span><input name="inventoryCount" type="number" min="0" max="1000000" step="1" required /></label><label className="form-field form-field--wide"><span>DESCRIPTION</span><textarea name="description" minLength={20} maxLength={5000} rows={3} required /></label><label className="form-field form-field--wide"><span>IMAGE URL (HTTPS)</span><input name="imageUrl" type="url" placeholder="https://…" /></label><label className="form-field form-field--wide"><span>SIZES / STYLES (comma-separated)</span><input name="sizes" placeholder="One Size, M, L" required /></label></div><button className="button button--dark" type="submit" disabled={createProduct.isPending}>{createProduct.isPending ? "Saving…" : "Create draft listing"}<ArrowRight size={16} /></button>{createProduct.error && <p className="portal-error">{createProduct.error.message}</p>}</form>
      {seller.data.products.length ? <div className="portal-list">{seller.data.products.map(product => <article className="portal-row seller-product-row" key={product.id}><div><span className={`status-label status-label--${product.status}`}>{product.status}</span><h3>{product.name}</h3><p>{product.category} · {money(product.priceKobo / 100)} · {product.sizes.join(", ")}</p><form className="seller-stock-form" onSubmit={event => submitStockEdit(event, product.id)}><label>Price ₦ <input aria-label={`${product.name} price`} name="priceNaira" type="number" min="1" max="21000000" defaultValue={product.priceKobo / 100} required /></label><label>Stock <input aria-label={`${product.name} stock`} name="inventoryCount" type="number" min="0" max="1000000" defaultValue={product.inventoryCount} required /></label><button className="button button--outline" type="submit" disabled={updateProduct.isPending}>Save</button></form></div><div className="portal-row-actions"><span>{product.inventoryCount} in stock</span>{product.status === "published" ? <button className="button button--outline" disabled={updateProduct.isPending} onClick={() => updateProduct.mutate({ productId: product.id, changes: { status: "archived" } })}>Archive</button> : <button className="button button--dark" disabled={updateProduct.isPending || !product.inventoryCount || !seller.data.store?.isActive} onClick={() => updateProduct.mutate({ productId: product.id, changes: { status: "published" } })}>Publish</button>}</div></article>)}</div> : <div className="portal-card portal-empty"><PackageCheck size={24} /><h3>No listings yet</h3><p>Create your first draft above, then publish it to the public catalog.</p></div>}
    </section>
    <section className="portal-section"><div className="section-heading"><div><span className="eyebrow">Paid orders only</span><h2>Order fulfilment</h2></div></div>{seller.data.orders.length ? <div className="portal-list">{seller.data.orders.map(({ order, item }) => {
      const next = item.fulfillmentStatus === "unfulfilled" ? "processing" : item.fulfillmentStatus === "processing" ? "shipped" : item.fulfillmentStatus === "shipped" ? "fulfilled" : null;
      const label = next === "processing" ? "Start processing" : next === "shipped" ? "Mark as shipped" : next === "fulfilled" ? "Mark delivered" : "Fulfilled";
      return <article className="portal-row seller-order-row" key={item.id}><div><span className={`status-label status-label--${item.fulfillmentStatus}`}>{item.fulfillmentStatus.replaceAll("_", " ")}</span><h3>{item.nameSnapshot} × {item.quantity}</h3><p>Order {order.reference} · {item.size} · {order.deliveryMethod} · {money(item.lineTotalKobo / 100)}</p><p>Ship to {order.firstName} {order.lastName}, {order.address}, {order.city} · <a href={`tel:${order.phone}`}>{order.phone}</a></p>{item.trackingNumber && <small>{item.carrier ?? "Carrier"}: {item.trackingNumber}</small>}</div><div className="portal-row-actions">{next && <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); updateFulfillment.mutate({ orderItemId: item.id, status: next, carrier: String(data.get("carrier") ?? "").trim() || undefined, trackingNumber: String(data.get("trackingNumber") ?? "").trim() || undefined }); }}><input name="carrier" aria-label="Carrier" placeholder="Carrier (optional)" defaultValue={item.carrier ?? ""} /><input name="trackingNumber" aria-label="Tracking number" placeholder="Tracking number" defaultValue={item.trackingNumber ?? ""} /><button className="button button--dark" type="submit" disabled={updateFulfillment.isPending}>{label}</button></form>}</div></article>;
    })}</div> : <div className="portal-card portal-empty"><Clock3 size={24} /><h3>No paid orders assigned</h3><p>Order lines belonging to your store appear here after customer payment is verified.</p></div>}</section>
    {(notice || createProduct.error || updateProduct.error || updateFulfillment.error) && <p className={createProduct.error || updateProduct.error || updateFulfillment.error ? "portal-error" : "form-success"}>{createProduct.error?.message ?? updateProduct.error?.message ?? updateFulfillment.error?.message ?? notice}</p>}
  </section></main>;
}

export function SuspendedSellerFulfillmentPage() {
  const orders = trpc.seller.fulfillmentOrders.useQuery();
  const update = trpc.seller.updateOrderItemFulfillment.useMutation({ onSuccess: () => { void orders.refetch(); } });
  if (orders.isLoading) return <LoadingPanel label="Loading existing paid orders…" />;
  if (orders.error) return <AccessDenied title="Fulfilment access unavailable" copy="This restricted workspace is available only to sellers with existing approved or suspended applications. Contact support if you need help with an already-paid order." actionHref="/account" actionLabel="Return to my account" />;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Limited seller access</span><h1>Outstanding order fulfilment</h1><p>Seller product and store controls remain paused. This page only shows paid order lines assigned to your seller account.</p></div><span className="role-badge role-badge--seller">Fulfilment only</span></div>
    {orders.data?.length ? <div className="portal-list">{orders.data.map(({ order, item }) => {
      const next = item.fulfillmentStatus === "unfulfilled" ? "processing" : item.fulfillmentStatus === "processing" ? "shipped" : item.fulfillmentStatus === "shipped" ? "fulfilled" : null;
      const label = next === "processing" ? "Start processing" : next === "shipped" ? "Mark as shipped" : next === "fulfilled" ? "Mark delivered" : "Fulfilled";
      return <article className="portal-row seller-order-row" key={item.id}><div><span className={`status-label status-label--${item.fulfillmentStatus}`}>{item.fulfillmentStatus.replaceAll("_", " ")}</span><h2>{item.nameSnapshot} × {item.quantity}</h2><p>Order {order.reference} · {item.size} · {order.deliveryMethod} · {money(item.lineTotalKobo / 100)}</p><p>Ship to {order.firstName} {order.lastName}, {order.address}, {order.city} · <a href={`tel:${order.phone}`}>{order.phone}</a></p>{item.trackingNumber && <small>{item.carrier ?? "Carrier"}: {item.trackingNumber}</small>}</div><div className="portal-row-actions">{next && <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); update.mutate({ orderItemId: item.id, status: next, carrier: String(data.get("carrier") ?? "").trim() || undefined, trackingNumber: String(data.get("trackingNumber") ?? "").trim() || undefined }); }}><input name="carrier" aria-label="Carrier" placeholder="Carrier (optional)" defaultValue={item.carrier ?? ""} /><input name="trackingNumber" aria-label="Tracking number" placeholder="Tracking number" defaultValue={item.trackingNumber ?? ""} /><button className="button button--dark" type="submit" disabled={update.isPending}>{label}</button></form>}</div></article>;
    })}</div> : <div className="portal-card portal-empty"><PackageCheck size={24} /><h2>No outstanding paid orders</h2><p>There are currently no paid order lines requiring action from your seller account.</p></div>}
    {update.error && <p className="portal-error">{update.error.message}</p>}<Link href="/account" className="text-link">Return to my account <ArrowRight size={15} /></Link>
  </section></main>;
}

export function StaffDashboardPage() {
  const applications = trpc.staff.sellerApplications.useQuery();
  const review = trpc.staff.reviewSellerApplication.useMutation({ onSuccess: () => applications.refetch() });
  if (applications.isLoading) return <LoadingPanel label="Loading seller applications…" />;
  if (applications.error) return <AccessDenied title="Staff access required" copy="This review workspace is available only to trusted staff and administrators." actionHref="/account" actionLabel="Go to my account" />;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Partnerships review</span><h1>Seller applications</h1><p>Review verified seller information and make one auditable approval decision at a time. Approved sellers can also be safely suspended or re-approved.</p></div><span className="role-badge role-badge--staff">Staff portal</span></div><div className="portal-list">{applications.data?.length ? applications.data.map(({ application, applicant }) => <article className="portal-row" key={application.id}><div><span className={`status-label status-label--${application.status}`}>{application.status}</span><h2>{application.businessName}</h2><p>{application.legalName} · {application.city} · {application.craftSummary}</p><small>{applicant.email ?? application.email}</small></div><div className="portal-row-actions">{application.status === "pending" && <><button className="button button--dark" disabled={review.isPending} onClick={() => review.mutate({ applicationId: application.id, status: "approved", reviewNote: "Approved from the staff portal." })}>Approve</button><button className="button button--outline" disabled={review.isPending} onClick={() => review.mutate({ applicationId: application.id, status: "rejected", reviewNote: "Please contact partnerships for next steps." })}>Decline</button></>}{application.status === "approved" && <button className="button button--outline" disabled={review.isPending} onClick={() => review.mutate({ applicationId: application.id, status: "suspended", reviewNote: "Seller access paused by the staff portal." })}>Suspend</button>}{application.status === "suspended" && <button className="button button--dark" disabled={review.isPending} onClick={() => review.mutate({ applicationId: application.id, status: "approved", reviewNote: "Seller access restored by the staff portal." })}>Re-approve</button>}</div></article>) : <div className="portal-card portal-empty"><BadgeCheck size={24} /><h2>No seller applications</h2><p>New seller applications will appear here for review.</p></div>}</div>{review.error && <p className="portal-error">{review.error.message}</p>}</section></main>;
}

export function AdminDashboardPage() {
  const users = trpc.admin.users.useQuery();
  const [paymentCursors, setPaymentCursors] = useState<Array<number | undefined>>([undefined]);
  const paymentCursor = paymentCursors[paymentCursors.length - 1];
  const payments = trpc.admin.pendingPayments.useQuery({ afterId: paymentCursor });
  const [notice, setNotice] = useState<string | null>(null);
  const setStaff = trpc.admin.setStaffAccess.useMutation({ onSuccess: () => users.refetch() });
  const reconcile = trpc.admin.reconcilePayment.useMutation({ onSuccess: result => {
    setNotice(`Order ${result.orderReference}: provider status is ${result.status}.`);
    void payments.refetch();
  } });
  if (users.isLoading) return <LoadingPanel label="Loading administration…" />;
  if (users.error) return <AccessDenied title="Administrator access required" copy="This workspace is limited to the application administrator." actionHref="/account" actionLabel="Go to my account" />;

  return <main><section className="portal-shell container-wide">
    <div className="portal-header"><div><span className="eyebrow">Access administration</span><h1>Account roles</h1><p>Staff access is granted from this server-protected workspace and recorded in the account audit trail.</p></div><span className="role-badge role-badge--admin">Administrator</span></div>
    <section className="portal-section"><div className="section-heading"><div><span className="eyebrow">Payment operations</span><h2>Pending payment reconciliation</h2></div></div><p>Check Paystack directly before changing a pending order. Stock is released only when Paystack confirms a failed, abandoned or reversed transaction; pending and mismatched payments remain unchanged.</p>
      {payments.isLoading ? <p>Loading pending transactions…</p> : payments.error ? <p className="portal-error">Pending payment queue is temporarily unavailable.</p> : payments.data?.items.length ? <div className="portal-list">{payments.data.items.map(payment => <article className="portal-row" key={payment.reference}><div><span className="status-label status-label--pending">pending payment</span><h3>Order {payment.orderReference}</h3><p>{payment.reference} · {money(payment.amountKobo / 100)} · {new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payment.createdAt))}</p></div><div className="portal-row-actions"><button className="button button--dark" disabled={reconcile.isPending} onClick={() => reconcile.mutate({ reference: payment.reference })}>{reconcile.isPending ? "Checking…" : "Verify with Paystack"}</button></div></article>)}</div> : <div className="portal-card portal-empty"><PackageCheck size={24} /><h3>No pending payments</h3><p>Payments needing provider verification will appear here.</p></div>}
      {((paymentCursors.length > 1) || payments.data?.nextCursor) && <div className="portal-row-actions"><button className="button button--outline" disabled={paymentCursors.length <= 1 || payments.isFetching} onClick={() => setPaymentCursors(current => current.length > 1 ? current.slice(0, -1) : current)}>Previous</button><span>Page {paymentCursors.length}</span><button className="button button--outline" disabled={!payments.data?.nextCursor || payments.isFetching} onClick={() => { const next = payments.data?.nextCursor; if (next) setPaymentCursors(current => [...current, next]); }}>Next</button></div>}
      {(notice || reconcile.error) && <p className={reconcile.error ? "portal-error" : "form-success"}>{reconcile.error?.message ?? notice}</p>}
    </section>
    <section className="portal-section"><div className="section-heading"><div><span className="eyebrow">Access administration</span><h2>Account roles</h2></div></div><div className="portal-list">{users.data?.map(user => <article className="portal-row portal-row--user" key={user.id}><div><h3>{user.name ?? "Unnamed account"}</h3><p>{user.email ?? "No email supplied"}</p></div><div className="portal-row-actions"><span className={`role-badge role-badge--${user.role}`}>{roleLabels[user.role]}</span>{user.role === "staff" ? <button className="button button--outline" disabled={setStaff.isPending} onClick={() => setStaff.mutate({ userId: user.id, grant: false })}>Remove staff access</button> : user.role !== "admin" ? <button className="button button--dark" disabled={setStaff.isPending} onClick={() => setStaff.mutate({ userId: user.id, grant: true })}>Grant staff access</button> : null}</div></article>)}</div>{setStaff.error && <p className="portal-error">{setStaff.error.message}</p>}</section>
  </section></main>;
}
