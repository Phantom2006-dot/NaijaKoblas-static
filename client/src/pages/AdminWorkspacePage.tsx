import { lazy, Suspense, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  CreditCard,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Tags,
  UsersRound,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

const AdminProductManagementPage = lazy(() => import("./admin/ProductManagementPage").then(module => ({ default: module.AdminProductManagementPage })));
const AdminOverviewPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminOverviewPage })));
const AdminOrdersPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminOrdersPage })));
const AdminCustomersPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminCustomersPage })));
const AdminCategoriesPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminCategoriesPage })));
const AdminAnalyticsPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminAnalyticsPage })));
const AdminSettingsPage = lazy(() => import("./admin/OperationsPages").then(module => ({ default: module.AdminSettingsPage })));
const AdminDashboardPage = lazy(() => import("./AccountPages").then(module => ({ default: module.AdminDashboardPage })));

const sections = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Products", href: "/admin/products", icon: Boxes },
  { label: "Orders", href: "/admin/orders", icon: CreditCard },
  { label: "Customers", href: "/admin/customers", icon: UsersRound },
  { label: "Categories", href: "/admin/categories", icon: Tags },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  { label: "Settings", href: "/admin/settings", icon: Settings },
  { label: "Audit log", href: "/admin/audit", icon: Activity },
  { label: "Access & payments", href: "/admin/operations", icon: ShieldCheck },
] as const;

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AdminSectionShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const account = trpc.auth.me.useQuery(undefined, { retry: false });
  const active = sections.find(item => location === item.href
    || (item.href === "/admin/products" && (location.startsWith("/admin/catalog") || location.startsWith("/admin/products")))) ?? sections[0]!;
  const initials = (account.data?.name ?? account.data?.email ?? "Admin").trim().slice(0, 2).toUpperCase();

  return <div className="admin-workspace">
    <div className="admin-workspace-frame">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-sidebar-brand" aria-label="NaijaKoblas admin overview">
          <span className="admin-sidebar-monogram" aria-hidden="true">NK</span>
          <span><strong>NAIJA KOBLAS</strong><small>ADMIN CONSOLE</small></span>
        </Link>
        <span className="admin-sidebar-label">WORKSPACE</span>
        <nav className="admin-workspace-nav" aria-label="Administration sections">
          {sections.map(({ label, href, icon: Icon }) => {
            const selected = location === href || (href === "/admin/products" && (location.startsWith("/admin/catalog") || location.startsWith("/admin/products")));
            return <Link key={href} href={href} className={selected ? "active" : ""} aria-current={selected ? "page" : undefined}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
            </Link>;
          })}
        </nav>
        <div className="admin-sidebar-bottom">
          <Link href="/" className="admin-sidebar-storefront">View storefront <span aria-hidden="true">↗</span></Link>
          <small>Protected marketplace operations</small>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title"><span>PRIVATE OPERATIONS</span><h1>{active.label}</h1></div>
          <div className="admin-topbar-profile" aria-label="Signed-in administrator">
            <span className="admin-avatar" aria-hidden="true">{initials}</span>
            <span><strong>{account.data?.name ?? "Administrator"}</strong><small>{account.data?.email ?? "Verified admin account"}</small></span>
          </div>
        </header>
        <div className="admin-page-content">
          <Suspense fallback={<div className="admin-section-loading" role="status">Loading secure workspace…</div>}>{children}</Suspense>
        </div>
      </div>
    </div>
  </div>;
}

function AdminEmpty({ title, copy }: { title: string; copy: string }) {
  return <div className="portal-card portal-empty"><Activity size={24} /><h2>{title}</h2><p>{copy}</p></div>;
}

function AdminAuditPage() {
  const audit = trpc.admin.audit.useQuery({ limit: 75 }, { retry: false });
  return <section className="admin-workspace-section"><div className="section-heading"><div><span className="eyebrow">Append-only activity</span><h2>Audit log</h2><p>Protected business events recorded by the server, with actor and target references where available.</p></div><button className="button button--outline" type="button" onClick={() => void audit.refetch()} disabled={audit.isFetching}>Refresh</button></div>{audit.isLoading ? <p className="portal-loading-copy">Loading audit events…</p> : audit.error ? <p className="portal-error">Audit events are temporarily unavailable.</p> : audit.data?.items.length ? <div className="admin-audit-list">{audit.data.items.map(event => <article className="admin-audit-row" key={event.id}><div className="admin-audit-marker"><Activity size={15} /></div><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.actorName ?? event.actorEmail ?? (event.actorUserId ? `Account #${event.actorUserId}` : "System event")} {event.targetUserId ? `· target account #${event.targetUserId}` : ""}</p><small>{formatDate(event.createdAt)} · Event #{event.id}</small></div><details><summary>Metadata</summary><pre>{JSON.stringify(event.metadata ?? {}, null, 2)}</pre></details></article>)}</div> : <AdminEmpty title="No audit events yet" copy="Marketplace actions will appear here as the service records them." />}</section>;
}

export function AdminWorkspacePage() {
  const [location] = useLocation();
  const path = location.split("?")[0];
  let section: ReactNode;
  if (path === "/admin/products" || path === "/admin/catalog") section = <AdminProductManagementPage />;
  else if (path === "/admin/orders") section = <AdminOrdersPage />;
  else if (path === "/admin/customers") section = <AdminCustomersPage />;
  else if (path === "/admin/categories") section = <AdminCategoriesPage />;
  else if (path === "/admin/analytics") section = <AdminAnalyticsPage />;
  else if (path === "/admin/settings") section = <AdminSettingsPage />;
  else if (path === "/admin/audit") section = <AdminAuditPage />;
  else if (path === "/admin/operations") section = <AdminDashboardPage />;
  else section = <AdminOverviewPage />;
  return <AdminSectionShell>{section}</AdminSectionShell>;
}
