import { Link } from "wouter";
import { ArrowRight, BadgeCheck, Clock3, ShieldCheck, Store, UserRound, UsersRound } from "lucide-react";
import { trpc } from "@/lib/trpc";

const roleLabels = {
  customer: "Customer",
  seller: "Approved seller",
  staff: "Staff",
  admin: "Administrator",
} as const;

function LoadingPanel({ label = "Confirming your secure session…" }: { label?: string }) {
  return <main><section className="portal-shell container-wide"><div className="portal-card portal-loading"><span className="eyebrow">NaijaKoblas Account</span><h1>{label}</h1></div></section></main>;
}

function AccessDenied({ title, copy, actionHref = "/login", actionLabel = "Sign in securely" }: { title: string; copy: string; actionHref?: string; actionLabel?: string }) {
  return <main><section className="portal-shell container-wide"><div className="portal-card portal-empty"><span className="eyebrow">Protected area</span><h1>{title}</h1><p>{copy}</p><Link href={actionHref} className="button button--dark">{actionLabel} <ArrowRight size={17} /></Link></div></section></main>;
}

export function AccountPage() {
  const account = trpc.account.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { window.location.href = "/"; } });

  if (account.isLoading) return <LoadingPanel />;
  if (!account.data) return <AccessDenied title="Sign in required" copy="Please sign in to view your NaijaKoblas account." />;

  const { user, sellerApplication } = account.data;
  const portal = user.role === "seller" ? ["Seller dashboard", "/seller"] : user.role === "staff" ? ["Staff portal", "/staff"] : user.role === "admin" ? ["Admin portal", "/admin"] : null;
  const applicationStatus = sellerApplication?.status;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Your NaijaKoblas space</span><h1>Welcome{user.name ? `, ${user.name}` : " back"}.</h1><p>Manage your customer account and marketplace access from one secure sign-in.</p></div><span className={`role-badge role-badge--${user.role}`}>{roleLabels[user.role]}</span></div>
    <div className="portal-grid">
      <article className="portal-card account-summary"><UserRound size={22} /><span>Signed in as</span><strong>{user.email ?? user.name ?? "NaijaKoblas customer"}</strong><small>Authenticated through secure account sign-in.</small><button className="text-button" disabled={logout.isPending} onClick={() => logout.mutate()}>Sign out</button></article>
      <article className="portal-card"><BadgeCheck size={22} /><span>Seller status</span>{applicationStatus ? <><strong className={`status-label status-label--${applicationStatus}`}>{applicationStatus}</strong><p>{applicationStatus === "pending" ? "Your application is with the partnerships team." : applicationStatus === "approved" ? "Your seller access is active." : applicationStatus === "rejected" ? "Your application needs a further conversation with our team." : "Your seller access is currently paused."}</p></> : <><strong>Not applied</strong><p>Share your craft and apply to sell with NaijaKoblas.</p><Link href="/vendor#apply" className="text-link">Start a seller application <ArrowRight size={15} /></Link></>}</article>
      <article className="portal-card"><Store size={22} /><span>Marketplace</span><strong>Shopping access is ready</strong><p>Browse verified collections and return here as new account services become available.</p><Link href="/products" className="text-link">Shop the collection <ArrowRight size={15} /></Link></article>
    </div>
    {portal && <div className="portal-callout"><ShieldCheck size={20} /><div><strong>{portal[0]} available</strong><span>Your current account role has access to a protected workspace.</span></div><Link href={portal[1]} className="button button--dark">Open portal <ArrowRight size={16} /></Link></div>}
  </section></main>;
}

export function SellerDashboardPage() {
  const seller = trpc.seller.dashboard.useQuery();
  if (seller.isLoading) return <LoadingPanel label="Loading your seller workspace…" />;
  if (!seller.data) return <AccessDenied title="Seller approval required" copy="This workspace becomes available after your seller application has been approved." actionHref="/account" actionLabel="Go to my account" />;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Seller workspace</span><h1>{seller.data.application?.businessName ?? "Your craft business"}</h1><p>Your seller foundation is active. Product management, fulfilment and payouts will plug into this trusted account next.</p></div><span className="role-badge role-badge--seller">Approved seller</span></div><div className="portal-grid"><article className="portal-card"><Store size={22} /><span>Verification</span><strong>Approved</strong><p>Your marketplace access is tied to the reviewed seller application—not to a browser-selected role.</p></article><article className="portal-card"><Clock3 size={22} /><span>Next capability</span><strong>Product listings</strong><p>Seller-owned product records and inventory are the next backend module.</p></article><article className="portal-card"><UsersRound size={22} /><span>Account</span><strong>{seller.data.user.email ?? seller.data.user.name ?? "Seller"}</strong><Link href="/account" className="text-link">View account <ArrowRight size={15} /></Link></article></div></section></main>;
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
  const setStaff = trpc.admin.setStaffAccess.useMutation({ onSuccess: () => users.refetch() });
  if (users.isLoading) return <LoadingPanel label="Loading administration…" />;
  if (users.error) return <AccessDenied title="Administrator access required" copy="This workspace is limited to the application administrator." actionHref="/account" actionLabel="Go to my account" />;

  return <main><section className="portal-shell container-wide"><div className="portal-header"><div><span className="eyebrow">Access administration</span><h1>Account roles</h1><p>Staff access is granted from this server-protected workspace and recorded in the account audit trail.</p></div><span className="role-badge role-badge--admin">Administrator</span></div><div className="portal-list">{users.data?.map(user => <article className="portal-row portal-row--user" key={user.id}><div><h2>{user.name ?? "Unnamed account"}</h2><p>{user.email ?? "No email supplied"}</p></div><div className="portal-row-actions"><span className={`role-badge role-badge--${user.role}`}>{roleLabels[user.role]}</span>{user.role === "staff" ? <button className="button button--outline" disabled={setStaff.isPending} onClick={() => setStaff.mutate({ userId: user.id, grant: false })}>Remove staff access</button> : user.role !== "admin" ? <button className="button button--dark" disabled={setStaff.isPending} onClick={() => setStaff.mutate({ userId: user.id, grant: true })}>Grant staff access</button> : null}</div></article>)}</div>{setStaff.error && <p className="portal-error">{setStaff.error.message}</p>}</section></main>;
}
