import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Clock3,
  ExternalLink,
  Filter,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  Truck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 25;
const HISTORY_LIMIT = 25;
const fulfillmentNext = {
  unfulfilled: "processing",
  processing: "shipped",
  shipped: "fulfilled",
} as const;

type FulfillmentStatus = keyof typeof fulfillmentNext | "fulfilled";
type AdminOrderStatus = "pending_payment" | "paid" | "partially_fulfilled" | "payment_failed" | "cancelled" | "fulfilled";
type AdminPaymentStatus = "pending" | "succeeded" | "failed";
type AdminAccountRole = "customer" | "seller" | "staff" | "admin";

type SalesPoint = {
  date: string;
  revenueKobo: number;
  orderCount: number;
};

function formatMoney(kobo: number, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format((Number.isFinite(kobo) ? kobo : 0) / 100);
}

function formatDate(value: unknown, withTime = true) {
  if (!value) return "—";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function formatDay(value: string) {
  const date = new Date(`${value}T00:00:00+01:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(date);
}

function readableStatus(value: string) {
  return value.replaceAll("_", " ");
}

function statusClass(value: string) {
  return `status-label status-label--${value}`;
}

function PageHeader({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading admin-ops-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button className="button button--outline" type="button" onClick={onClick} disabled={loading}>
      <RefreshCw size={15} aria-hidden="true" /> {loading ? "Refreshing…" : "Refresh"}
    </button>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="portal-card portal-loading admin-ops-state" role="status">{label}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="portal-card portal-empty admin-ops-state" role="alert">
      <AlertCircle size={24} aria-hidden="true" />
      <h3>Could not load this view</h3>
      <p>{message}</p>
      {onRetry && <button className="button button--outline" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

function EmptyState({ title, copy, icon: Icon = ClipboardList }: { title: string; copy: string; icon?: typeof ClipboardList }) {
  return (
    <div className="portal-card portal-empty admin-ops-state">
      <Icon size={24} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

function Pagination({
  offset,
  limit,
  total,
  hasMore,
  loading,
  onPrevious,
  onNext,
}: {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  return (
    <div className="portal-row-actions admin-ops-pagination" aria-label="Pagination">
      <span aria-live="polite">{total ? `${first}–${last} of ${total}` : "0 results"}</span>
      <button className="button button--outline" type="button" onClick={onPrevious} disabled={offset === 0 || loading}>
        <ChevronLeft size={15} aria-hidden="true" /> Previous
      </button>
      <button className="button button--outline" type="button" onClick={onNext} disabled={!hasMore || loading}>
        Next <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function SalesChart({ sales, labelledBy }: { sales: SalesPoint[]; labelledBy: string }) {
  const hasSales = sales.some(point => point.revenueKobo > 0 || point.orderCount > 0);
  if (!hasSales) {
    return <EmptyState title="No verified sales in the last 30 days" copy="The server returned a complete 30-day series, but no verified paid sales are recorded for this period." icon={BarChart3} />;
  }
  return (
    <div className="admin-ops-chart" role="img" aria-labelledby={labelledBy}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={sales} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="adminSalesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--terracotta, #b85c38)" stopOpacity={0.42} />
              <stop offset="100%" stopColor="var(--terracotta, #b85c38)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="date" tickFormatter={formatDay} minTickGap={24} tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={value => `₦${Math.round(Number(value) / 100).toLocaleString("en-NG")}`} tick={{ fontSize: 12 }} width={70} />
          <Tooltip
            labelFormatter={value => formatDay(String(value))}
            formatter={(value, name) => [
              name === "revenueKobo" ? formatMoney(Number(value)) : `${Number(value)} orders`,
              name === "revenueKobo" ? "Verified revenue" : "Orders",
            ]}
          />
          <Area type="monotone" dataKey="revenueKobo" stroke="var(--terracotta, #b85c38)" fill="url(#adminSalesFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      <p className="admin-ops-chart-note">Revenue is based only on server-verified successful payments matched to paid orders.</p>
    </div>
  );
}

function SalesTable({ sales }: { sales: SalesPoint[] }) {
  return (
    <details className="admin-ops-data-details">
      <summary>View the actual daily series</summary>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="sr-only">Daily verified sales for the last 30 days</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Verified revenue</th><th scope="col">Orders</th></tr></thead>
          <tbody>{sales.map(point => <tr key={point.date}><td>{formatDay(point.date)}</td><td>{formatMoney(point.revenueKobo)}</td><td>{point.orderCount}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof ShoppingBag }) {
  return (
    <article className="portal-card admin-ops-stat-card">
      <div className="admin-ops-stat-icon"><Icon size={18} aria-hidden="true" /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function AdminOverviewPage() {
  const overview = trpc.admin.operations.overview.useQuery(undefined, { retry: false });
  if (overview.isLoading) return <LoadingState label="Loading the operations overview…" />;
  if (overview.error || !overview.data) return <ErrorState message={overview.error?.message ?? "The operations overview returned no data."} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  return (
    <section className="admin-workspace-section admin-ops-page">
      <PageHeader
        eyebrow="Operations overview"
        title="A clear view of marketplace health"
        copy="Verified revenue, order flow, product availability and recent activity from the protected operations API."
        action={<RefreshButton onClick={() => void overview.refetch()} loading={overview.isFetching} />}
      />
      <div className="portal-grid admin-ops-stat-grid">
        <StatCard label="Products" value={data.totalProducts} detail={`${data.lowStockProducts} at or below low-stock threshold`} icon={Boxes} />
        <StatCard label="Orders" value={data.totalOrders} detail={`${data.pendingOrders} awaiting payment`} icon={ShoppingBag} />
        <StatCard label="Verified revenue" value={formatMoney(data.revenueKobo)} detail="Matched, successful NGN payments" icon={CheckCircle2} />
        <StatCard label="Fulfilled orders" value={data.completedOrders} detail={`${data.totalCustomers} customer accounts`} icon={PackageCheck} />
      </div>
      <section className="portal-section admin-ops-section">
        <PageHeader eyebrow="Actual daily series" title="Verified sales · last 30 days" copy="Daily figures are supplied by the backend; no estimates or client-side aggregation are added." />
        <SalesChart sales={data.salesLast30Days} labelledBy="overview-sales-title" />
        <span id="overview-sales-title" className="sr-only">Verified revenue and order count for the last 30 days</span>
        <SalesTable sales={data.salesLast30Days} />
      </section>
      <div className="admin-ops-two-column">
        <section className="portal-section admin-ops-section">
          <PageHeader eyebrow="Latest orders" title="Recent order activity" copy="The five most recent orders returned by the server." />
          {data.recentOrders.length ? <div className="portal-list">{data.recentOrders.map(order => <article className="portal-row" key={order.id}>
            <div><span className={statusClass(order.status)}>{readableStatus(order.status)}</span><h3>{order.reference}</h3><p>{order.customerName || order.customerEmail || "Customer unavailable"} · {formatDate(order.createdAt)}</p><small>{order.paymentStatus ? `Payment ${readableStatus(order.paymentStatus)}` : "Payment status unavailable"}</small></div>
            <strong>{formatMoney(order.totalKobo, order.currency)}</strong>
          </article>)}</div> : <EmptyState title="No orders yet" copy="Recent orders will appear here once the server has recorded them." icon={ShoppingBag} />}
        </section>
        <section className="portal-section admin-ops-section">
          <PageHeader eyebrow="Latest products" title="Recently added products" copy="The five most recently created product records." />
          {data.recentProducts.length ? <div className="portal-list">{data.recentProducts.map(product => <article className="portal-row" key={product.id}>
            <div><span className={statusClass(product.status)}>{readableStatus(product.status)}</span><h3>{product.name}</h3><p>{product.category} · {formatMoney(product.priceKobo)}</p><small>{product.inventoryCount} in stock · added {formatDate(product.createdAt, false)}</small></div>
            <span className={product.inventoryCount <= 5 ? "admin-ops-warning" : "admin-muted"}>{product.inventoryCount <= 5 ? "Low stock" : "In stock"}</span>
          </article>)}</div> : <EmptyState title="No products yet" copy="New product records will appear here after they are created." icon={Boxes} />}
        </section>
      </div>
    </section>
  );
}

export function AdminAnalyticsPage() {
  const overview = trpc.admin.operations.overview.useQuery(undefined, { retry: false });
  if (overview.isLoading) return <LoadingState label="Loading analytics…" />;
  if (overview.error || !overview.data) return <ErrorState message={overview.error?.message ?? "Analytics returned no data."} onRetry={() => void overview.refetch()} />;
  const sales = overview.data.salesLast30Days;
  const totalOrders = sales.reduce((sum, point) => sum + point.orderCount, 0);
  const totalRevenue = sales.reduce((sum, point) => sum + point.revenueKobo, 0);
  return (
    <section className="admin-workspace-section admin-ops-page">
      <PageHeader eyebrow="Analytics" title="Verified sales, without guesswork" copy="This view reuses the operations API's actual 30-day daily series and does not infer conversion or future performance." action={<RefreshButton onClick={() => void overview.refetch()} loading={overview.isFetching} />} />
      <div className="portal-grid admin-ops-stat-grid">
        <StatCard label="30-day revenue" value={formatMoney(totalRevenue)} detail="Sum of returned daily verified revenue" icon={BarChart3} />
        <StatCard label="30-day orders" value={totalOrders} detail="Unique paid orders in the daily series" icon={ShoppingBag} />
        <StatCard label="Average per order" value={totalOrders ? formatMoney(totalRevenue / totalOrders) : "—"} detail={totalOrders ? "Simple actual-period average" : "No paid orders in period"} icon={CheckCircle2} />
      </div>
      <section className="portal-section admin-ops-section">
        <PageHeader eyebrow="30-day source data" title="Daily verified revenue" copy="Hover or expand the table for accessible day-by-day values." />
        <SalesChart sales={sales} labelledBy="analytics-sales-title" />
        <span id="analytics-sales-title" className="sr-only">Analytics chart of verified revenue and order count for the last 30 days</span>
        <SalesTable sales={sales} />
      </section>
    </section>
  );
}

function OrdersToolbar({ search, setSearch, status, setStatus, paymentStatus, setPaymentStatus }: {
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  paymentStatus: string;
  setPaymentStatus: (value: string) => void;
}) {
  return <div className="admin-filter-bar admin-ops-filter-bar">
    <label><span><Search size={14} aria-hidden="true" /> Search orders</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Reference, name or email" aria-label="Search orders by reference, name or email" /></label>
    <label><span><Filter size={14} aria-hidden="true" /> Order status</span><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by order status"><option value="">All statuses</option><option value="pending_payment">Pending payment</option><option value="paid">Paid</option><option value="partially_fulfilled">Partially fulfilled</option><option value="fulfilled">Fulfilled</option><option value="payment_failed">Payment failed</option><option value="cancelled">Cancelled</option></select></label>
    <label><span>Payment status</span><select value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)} aria-label="Filter by payment status"><option value="">All payments</option><option value="pending">Pending</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select></label>
  </div>;
}

function OrderDetail({ reference, onClose, onChanged }: { reference: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const detail = trpc.admin.operations.orders.detail.useQuery({ reference }, { retry: false });
  const update = trpc.admin.operations.updateOrderItemFulfillment.useMutation();
  const [notice, setNotice] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<number, { carrier: string; trackingNumber: string }>>({});
  if (detail.isLoading) return <div className="admin-ops-detail"><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to orders</button><LoadingState label="Loading order detail…" /></div>;
  if (detail.error || !detail.data) return <div className="admin-ops-detail"><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to orders</button><ErrorState message={detail.error?.message ?? "Order detail returned no data."} onRetry={() => void detail.refetch()} /></div>;
  const { order, customer, payment, items } = detail.data;
  const paid = payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(order.status);
  const valuesFor = (itemId: number, carrier: string | null, trackingNumber: string | null) => formValues[itemId] ?? { carrier: carrier ?? "", trackingNumber: trackingNumber ?? "" };
  const submitFulfillment = (event: FormEvent<HTMLFormElement>, itemId: number, status: Exclude<FulfillmentStatus, "fulfilled"> | "fulfilled") => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update.mutate({ orderItemId: itemId, status, carrier: String(data.get("carrier") ?? "").trim() || undefined, trackingNumber: String(data.get("trackingNumber") ?? "").trim() || undefined }, {
      onSuccess: async () => { setNotice("Fulfillment updated."); await detail.refetch(); await onChanged(); },
    });
  };
  return <div className="admin-ops-detail">
    <div className="section-heading"><div><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to orders</button><span className="eyebrow">Order detail</span><h2>{order.reference}</h2><p>Created {formatDate(order.createdAt)} · <span className={statusClass(order.status)}>{readableStatus(order.status)}</span></p></div></div>
    <div className="admin-ops-detail-grid">
      <section className="portal-card"><h3>Customer</h3><p><strong>{customer.user.name ?? "Name unavailable"}</strong><br />{customer.user.email ?? "Email unavailable"}</p><small>Customer account #{customer.user.id}</small>{customer.profile && <p>{customer.profile.phone}<br />{customer.profile.address}, {customer.profile.city}</p>}</section>
      <section className="portal-card"><h3>Payment and amounts</h3><p>Payment <span className={statusClass(payment.status)}>{readableStatus(payment.status)}</span></p><dl className="admin-ops-definition-list"><div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalKobo, order.currency)}</dd></div><div><dt>Shipping</dt><dd>{formatMoney(order.shippingKobo, order.currency)}</dd></div><div><dt>Total</dt><dd><strong>{formatMoney(order.totalKobo, order.currency)}</strong></dd></div></dl><small>Verified {payment.verifiedAt ? formatDate(payment.verifiedAt) : "date unavailable"}</small></section>
    </div>
    <section className="portal-section admin-ops-section"><PageHeader eyebrow="Order lines" title="Fulfillment" copy={paid ? "Paid orders may move one line at a time through processing, shipped and fulfilled. No payment or order edits are available here." : "Fulfillment is available only after a successful payment on a paid order."} />
      {items.length ? <div className="portal-list">{items.map(item => { const next = fulfillmentNext[item.fulfillmentStatus as keyof typeof fulfillmentNext]; const values = valuesFor(item.id, item.carrier, item.trackingNumber); return <article className="portal-row admin-ops-order-item" key={item.id}>
        <div><span className={statusClass(item.fulfillmentStatus)}>{readableStatus(item.fulfillmentStatus)}</span><h3>{item.nameSnapshot} × {item.quantity}</h3><p>{item.size} · {formatMoney(item.lineTotalKobo, order.currency)} · {item.makerSnapshot}</p>{item.trackingNumber && <small>{item.carrier ?? "Carrier"}: {item.trackingNumber}</small>}</div>
        {paid && next ? <form className="admin-ops-fulfillment-form" onSubmit={event => submitFulfillment(event, item.id, next)}><label><span>Carrier</span><input name="carrier" value={values.carrier} onChange={event => setFormValues(current => ({ ...current, [item.id]: { ...values, carrier: event.target.value } }))} placeholder="Optional" maxLength={100} /></label><label><span>Tracking number</span><input name="trackingNumber" value={values.trackingNumber} onChange={event => setFormValues(current => ({ ...current, [item.id]: { ...values, trackingNumber: event.target.value } }))} placeholder="Optional" maxLength={120} /></label><button className="button button--dark" type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : next === "processing" ? "Start processing" : next === "shipped" ? "Mark as shipped" : "Mark fulfilled"}</button></form> : <span className="admin-muted">{paid ? "Fulfilled" : "Not available"}</span>}
      </article>; })}</div> : <EmptyState title="No order lines" copy="The server returned no items for this order." icon={PackageCheck} />}
      {update.error && <p className="portal-error" role="alert">{update.error.message}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    </section>
  </div>;
}

export function AdminOrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedReference, setSelectedReference] = useState<string | null>(null);
  const orders = trpc.admin.operations.orders.list.useQuery({ search: search.trim() || undefined, status: status ? status as AdminOrderStatus : undefined, paymentStatus: paymentStatus ? paymentStatus as AdminPaymentStatus : undefined, offset, limit: PAGE_SIZE }, { retry: false });
  if (selectedReference) return <OrderDetail reference={selectedReference} onClose={() => setSelectedReference(null)} onChanged={async () => { await orders.refetch(); }} />;
  return <section className="admin-workspace-section admin-ops-page">
    <PageHeader eyebrow="Order operations" title="Orders" copy="Search and inspect customer orders. Payment links, refunds, cancellations and payment edits are intentionally not exposed." action={<RefreshButton onClick={() => void orders.refetch()} loading={orders.isFetching} />} />
    <OrdersToolbar search={search} setSearch={value => { setSearch(value); setOffset(0); }} status={status} setStatus={value => { setStatus(value); setOffset(0); }} paymentStatus={paymentStatus} setPaymentStatus={value => { setPaymentStatus(value); setOffset(0); }} />
    {orders.isLoading ? <LoadingState label="Loading orders…" /> : orders.error ? <ErrorState message={orders.error.message} onRetry={() => void orders.refetch()} /> : orders.data?.items.length ? <><div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Admin order list</caption><thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Payment</th><th scope="col">Total</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{orders.data.items.map(order => <tr key={order.id}><td><strong>{order.reference}</strong><small>Updated {formatDate(order.updatedAt)}</small></td><td>{order.customer.name ?? "Name unavailable"}<small>{order.customer.email ?? "Email unavailable"}</small></td><td><span className={statusClass(order.status)}>{readableStatus(order.status)}</span></td><td><span className={statusClass(order.paymentStatus)}>{readableStatus(order.paymentStatus)}</span>{order.paymentVerifiedAt && <small>{formatDate(order.paymentVerifiedAt, false)}</small>}</td><td>{formatMoney(order.totalKobo, order.currency)}</td><td>{formatDate(order.createdAt)}</td><td><button className="button button--outline" type="button" onClick={() => setSelectedReference(order.reference)}>View <ArrowRight size={15} aria-hidden="true" /></button></td></tr>)}</tbody></table></div><Pagination offset={orders.data.offset} limit={orders.data.limit} total={orders.data.total} hasMore={orders.data.hasMore} loading={orders.isFetching} onPrevious={() => setOffset(value => Math.max(0, value - PAGE_SIZE))} onNext={() => setOffset(value => value + PAGE_SIZE)} /></> : <EmptyState title="No orders match these filters" copy="Try a different search or remove one of the status filters." icon={ShoppingBag} />}
  </section>;
}

function CustomerDetail({ userId, onClose }: { userId: number; onClose: () => void }) {
  const detail = trpc.admin.operations.customers.detail.useQuery({ userId, orderLimit: HISTORY_LIMIT }, { retry: false });
  if (detail.isLoading) return <div className="admin-ops-detail"><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to customers</button><LoadingState label="Loading customer detail…" /></div>;
  if (detail.error || !detail.data) return <div className="admin-ops-detail"><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to customers</button><ErrorState message={detail.error?.message ?? "Customer detail returned no data."} onRetry={() => void detail.refetch()} /></div>;
  const { user, profile, orders } = detail.data;
  return <div className="admin-ops-detail">
    <div className="section-heading"><div><button className="text-button" type="button" onClick={onClose}><ArrowLeft size={15} /> Back to customers</button><span className="eyebrow">Customer detail</span><h2>{user.name ?? "Unnamed customer"}</h2><p>Account #{user.id} · <span className={`role-badge role-badge--${user.role}`}>{user.role}</span></p></div></div>
    <div className="admin-ops-detail-grid"><section className="portal-card"><h3>Account</h3><p><strong>{user.email ?? "Email unavailable"}</strong><br />Joined {formatDate(user.createdAt, false)}<br />Last signed in {formatDate(user.lastSignedIn)}</p></section><section className="portal-card"><h3>Profile and contact</h3>{profile ? <p>{profile.firstName} {profile.lastName}<br />{profile.email}<br />{profile.phone}<br />{profile.address}, {profile.city}</p> : <p>There is no saved customer profile for this account.</p>}</section></div>
    <section className="portal-section admin-ops-section"><PageHeader eyebrow="Bounded history" title="Verified paid orders" copy={`Showing up to ${orders.limit} orders. History is restricted by the server and hasMore is shown honestly.`} />{orders.items.length ? <div className="portal-list">{orders.items.map(order => <article className="portal-row" key={order.id}><div><span className={statusClass(order.status)}>{readableStatus(order.status)}</span><h3>{order.reference}</h3><p>{formatDate(order.createdAt, false)} · Payment {readableStatus(order.paymentStatus)}</p></div><strong>{formatMoney(order.totalKobo, order.currency)}</strong></article>)}</div> : <EmptyState title="No verified paid orders" copy="This account has no paid order history returned by the server." icon={ShoppingBag} />}<p className="admin-ops-history-note" role="status">History limit: {orders.limit}. More available: {orders.hasMore ? "yes" : "no"}.</p></section>
  </div>;
}

export function AdminCustomersPage() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const customers = trpc.admin.operations.customers.list.useQuery({ search: search.trim() || undefined, role: role ? role as AdminAccountRole : undefined, offset, limit: PAGE_SIZE }, { retry: false });
  if (selectedUserId !== null) return <CustomerDetail userId={selectedUserId} onClose={() => setSelectedUserId(null)} />;
  return <section className="admin-workspace-section admin-ops-page">
    <PageHeader eyebrow="Customer operations" title="Customers" copy="Search customer accounts and review verified spend and bounded paid-order history. This page does not edit customer records." action={<RefreshButton onClick={() => void customers.refetch()} loading={customers.isFetching} />} />
    <div className="admin-filter-bar admin-ops-filter-bar"><label><span><Search size={14} aria-hidden="true" /> Search customers</span><input value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Name or email" aria-label="Search customers by name or email" /></label><label><span>Role</span><select value={role} onChange={event => { setRole(event.target.value); setOffset(0); }} aria-label="Filter customers by role"><option value="">All roles</option><option value="customer">Customer</option><option value="seller">Seller</option><option value="staff">Staff</option><option value="admin">Administrator</option></select></label></div>
    {customers.isLoading ? <LoadingState label="Loading customers…" /> : customers.error ? <ErrorState message={customers.error.message} onRetry={() => void customers.refetch()} /> : customers.data?.items.length ? <><div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">Admin customer list</caption><thead><tr><th scope="col">Customer</th><th scope="col">Role</th><th scope="col">Verified orders</th><th scope="col">Verified spend</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{customers.data.items.map(customer => <tr key={customer.id}><td><strong>{customer.name ?? "Unnamed account"}</strong><small>{customer.email ?? "Email unavailable"}</small></td><td><span className={`role-badge role-badge--${customer.role}`}>{customer.role}</span></td><td>{customer.orderCount}</td><td>{formatMoney(customer.spendKobo)}</td><td>{formatDate(customer.createdAt, false)}</td><td><button className="button button--outline" type="button" onClick={() => setSelectedUserId(customer.id)}>View <ArrowRight size={15} aria-hidden="true" /></button></td></tr>)}</tbody></table></div><Pagination offset={customers.data.offset} limit={customers.data.limit} total={customers.data.total} hasMore={customers.data.hasMore} loading={customers.isFetching} onPrevious={() => setOffset(value => Math.max(0, value - PAGE_SIZE))} onNext={() => setOffset(value => value + PAGE_SIZE)} /></> : <EmptyState title="No customers match these filters" copy="Try a different search or role filter." icon={UsersRound} />}
  </section>;
}

export function AdminCategoriesPage() {
  const categories = trpc.admin.operations.categories.useQuery(undefined, { retry: false });
  return <section className="admin-workspace-section admin-ops-page"><PageHeader eyebrow="Catalog taxonomy" title="Categories" copy="Stored product categories and their current product counts. Categories are free text, so no unsupported CRUD controls are shown." action={<RefreshButton onClick={() => void categories.refetch()} loading={categories.isFetching} />} />
    {categories.isLoading ? <LoadingState label="Loading categories…" /> : categories.error ? <ErrorState message={categories.error.message} onRetry={() => void categories.refetch()} /> : categories.data?.length ? <div className="admin-ops-category-grid">{categories.data.map(category => <article className="portal-card admin-ops-category-card" key={category.category}><div><Boxes size={18} aria-hidden="true" /><h3>{category.category}</h3><p>{category.productCount} {category.productCount === 1 ? "product" : "products"}</p></div><Link className="text-link" href={`/admin/catalog?category=${encodeURIComponent(category.category)}`}>View products <ExternalLink size={14} aria-hidden="true" /></Link></article>)}</div> : <EmptyState title="No categories stored" copy="Categories will appear when products with a category are present." icon={Boxes} />}
  </section>;
}

function ReadinessBadge({ value }: { value: boolean }) {
  return <span className={value ? "status-label status-label--approved" : "status-label status-label--pending"}>{value ? "Configured" : "Not configured"}</span>;
}

export function AdminSettingsPage() {
  const providers = trpc.admin.operations.providers.useQuery(undefined, { retry: false });
  const settings = trpc.admin.operations.settings.useQuery(undefined, { retry: false });
  const loading = providers.isLoading || settings.isLoading;
  const error = providers.error ?? settings.error;
  const refresh = () => { void providers.refetch(); void settings.refetch(); };
  if (loading) return <LoadingState label="Loading provider readiness…" />;
  if (error || !providers.data || !settings.data) return <ErrorState message={error?.message ?? "Provider readiness returned no data."} onRetry={refresh} />;
  const providerData = providers.data;
  const settingsData = settings.data;
  return <section className="admin-workspace-section admin-ops-page"><PageHeader eyebrow="Configuration visibility" title="Settings and providers" copy="Only sanitized readiness booleans and server-declared supported operations are shown. Secret values are never sent to this page." action={<RefreshButton onClick={refresh} loading={providers.isFetching || settings.isFetching} />} />
    <div className="portal-grid admin-ops-stat-grid"><StatCard label="Production" value={settingsData.settings.production ? "Yes" : "No"} detail="Server environment flag" icon={Settings2} /><StatCard label="Database" value={settingsData.settings.databaseConfigured ? "Ready" : "Not ready"} detail="Database configuration readiness" icon={CheckCircle2} /></div>
    <div className="admin-ops-two-column"><section className="portal-section admin-ops-section"><PageHeader eyebrow="Payment provider" title="Paystack" copy="Readiness only. Supported operations are provider verification, reconciliation and hosted checkout; this page does not initiate live payments." /><div className="portal-card admin-ops-provider-card"><div><h3>Configuration</h3><ReadinessBadge value={providerData.providers.paystack.configured} /></div><ul>{providerData.providers.paystack.supportedOperations.map(operation => <li key={operation}>{readableStatus(operation)}</li>)}</ul></div></section><section className="portal-section admin-ops-section"><PageHeader eyebrow="Media provider" title="Cloudinary" copy="Readiness for product image upload only; no credentials or provider values are rendered." /><div className="portal-card admin-ops-provider-card"><div><h3>Configuration</h3><ReadinessBadge value={providerData.providers.cloudinary.configured} /></div><ul>{providerData.providers.cloudinary.supportedOperations.map(operation => <li key={operation}>{readableStatus(operation)}</li>)}</ul></div></section></div>
    <p className="admin-ops-security-note"><Settings2 size={16} aria-hidden="true" /> Secrets, payment links, provider references and credentials remain server-owned.</p>
  </section>;
}
