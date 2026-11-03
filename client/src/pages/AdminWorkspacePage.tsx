import { Activity, Boxes, ClipboardList, LayoutDashboard, RefreshCw, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { money } from "@/store";
import { AdminDashboardPage } from "./AccountPages";

const sections = [
  ["Overview", "/admin", LayoutDashboard],
  ["Catalog", "/admin/catalog", Boxes],
  ["Audit log", "/admin/audit", Activity],
] as const;

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AdminSectionShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <div className="admin-workspace"><div className="admin-workspace-inner"><header className="admin-workspace-header"><div><span className="eyebrow">NaijaKoblas · Private operations</span><h1>Operations workspace</h1><p>Catalog visibility, marketplace activity and seller operations in one protected view.</p></div><span className="role-badge role-badge--admin"><ShieldCheck size={14} /> Administrator</span></header><nav className="admin-workspace-nav" aria-label="Administration sections">{sections.map(([label, href, Icon]) => <Link key={href} href={href} className={location === href || (href !== "/admin" && location.startsWith(href)) ? "active" : ""}><Icon size={16} />{label}</Link>)}</nav>{children}</div></div>;
}

function AdminEmpty({ title, copy }: { title: string; copy: string }) {
  return <div className="portal-card portal-empty"><ClipboardList size={24} /><h2>{title}</h2><p>{copy}</p></div>;
}

export function AdminWorkspacePage() {
  const [location] = useLocation();
  const section = location.startsWith("/admin/catalog") ? "catalog" : location.startsWith("/admin/audit") ? "audit" : "overview";
  return <AdminSectionShell>{section === "catalog" ? <AdminCatalogPage /> : section === "audit" ? <AdminAuditPage /> : <AdminDashboardPage />}</AdminSectionShell>;
}

function AdminCatalogPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "published" | "archived">("all");
  const products = trpc.admin.products.useQuery({ search: search || undefined, status: status === "all" ? undefined : status, limit: 50 }, { retry: false });
  return <section className="admin-workspace-section"><div className="section-heading"><div><span className="eyebrow">Catalog ledger</span><h2>Every product taken into the site</h2><p>Draft, published, archived and out-of-stock records remain visible to administrators.</p></div><button className="button button--outline" type="button" onClick={() => void products.refetch()} disabled={products.isFetching}><RefreshCw size={15} /> Refresh</button></div><div className="admin-filter-bar"><label>Search products<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Product name" /></label><label>Status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>{products.isLoading ? <p className="portal-loading-copy">Loading the catalog ledger…</p> : products.error ? <p className="portal-error">Catalog data is temporarily unavailable.</p> : products.data?.items.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Seller / store</th><th>Status</th><th>Stock</th><th>Media</th><th>Updated</th></tr></thead><tbody>{products.data.items.map(product => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.id} · {product.category}</small><span>{money(product.priceKobo / 100)}</span></td><td><strong>{product.storeName ?? "Store unavailable"}</strong><small>{product.sellerName ?? product.sellerEmail ?? "Seller account"}{product.storeCity ? ` · ${product.storeCity}` : ""}</small><span className={product.storeActive === false ? "admin-muted admin-danger" : "admin-muted"}>{product.storeActive === false ? "Store inactive" : "Store active"}</span></td><td><span className={`status-label status-label--${product.status}`}>{product.status}</span></td><td><strong>{product.inventoryCount}</strong><small>{product.inventoryCount > 0 ? "available" : "out of stock"}</small></td><td><strong>{product.imageCount}</strong><small>{product.primaryImageCount ? "primary selected" : "no primary"}</small></td><td>{formatDate(product.updatedAt)}<small>Created {formatDate(product.createdAt)}</small></td></tr>)}</tbody></table></div> : <AdminEmpty title="No products match these filters" copy="As sellers create listings, every record will appear here regardless of publication status." />}</section>;
}

function AdminAuditPage() {
  const audit = trpc.admin.audit.useQuery({ limit: 75 }, { retry: false });
  return <section className="admin-workspace-section"><div className="section-heading"><div><span className="eyebrow">Append-only activity</span><h2>Audit log</h2><p>Protected business events recorded by the server, with actor and target references where available.</p></div><button className="button button--outline" type="button" onClick={() => void audit.refetch()} disabled={audit.isFetching}><RefreshCw size={15} /> Refresh</button></div>{audit.isLoading ? <p className="portal-loading-copy">Loading audit events…</p> : audit.error ? <p className="portal-error">Audit events are temporarily unavailable.</p> : audit.data?.items.length ? <div className="admin-audit-list">{audit.data.items.map(event => <article className="admin-audit-row" key={event.id}><div className="admin-audit-marker"><Activity size={15} /></div><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.actorName ?? event.actorEmail ?? (event.actorUserId ? `Account #${event.actorUserId}` : "System event")} {event.targetUserId ? `· target account #${event.targetUserId}` : ""}</p><small>{formatDate(event.createdAt)} · Event #{event.id}</small></div><details><summary>Metadata</summary><pre>{JSON.stringify(event.metadata ?? {}, null, 2)}</pre></details></article>)}</div> : <AdminEmpty title="No audit events yet" copy="Seller activation, role changes, product intake, checkout and payment events will appear here as the marketplace operates." />}</section>;
}
