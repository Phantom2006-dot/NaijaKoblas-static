import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { Link } from "wouter";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { trpc } from "@/lib/trpc";

export function NotificationBell() {
  const runtime = useAuthRuntime();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const ready = runtime.status === "ready" && runtime.isLoaded && runtime.isSignedIn;
  const inbox = trpc.notifications.mine.useQuery(undefined, {
    enabled: ready,
    retry: false,
    refetchInterval: ready ? 45_000 : false,
    refetchOnWindowFocus: true,
  });
  const utils = trpc.useUtils();
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => { void utils.notifications.mine.invalidate(); } });
  const markAll = trpc.notifications.markAllRead.useMutation({ onSuccess: () => { void utils.notifications.mine.invalidate(); } });

  useEffect(() => {
    if (!ready || !open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, ready]);

  if (!ready) return null;
  const unreadCount = inbox.data?.unreadCount ?? 0;
  const closePanel = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return <div className="notification-bell-wrap">
    <button ref={triggerRef} className="icon-button notification-bell-button" type="button" aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"} aria-expanded={open} aria-controls={open ? "marketplace-notification-panel" : undefined} onClick={() => setOpen(value => !value)}>
      <Bell size={18} />{unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>}
    </button>
    {open && <section ref={panelRef} tabIndex={-1} id="marketplace-notification-panel" className="notification-panel" role="region" aria-label="Your marketplace notifications">
      <header><div><span className="eyebrow">Your inbox</span><strong>Notifications</strong></div>
        <div className="notification-panel-actions">
          {unreadCount > 0 && <button type="button" className="text-button" disabled={markAll.isPending} onClick={() => markAll.mutate()}>Mark all read <CheckCheck size={14} /></button>}
          <button type="button" className="icon-button" aria-label="Close notifications" onClick={closePanel}><X size={15} /></button>
        </div>
      </header>
      {inbox.isLoading ? <p className="notification-empty" role="status">Loading your inbox…</p> : inbox.error ? <p className="notification-empty" role="status">Notifications are temporarily unavailable.</p> : inbox.data?.items.length ? <div className="notification-list">
        {inbox.data.items.map(item => <Link key={item.id} href={item.href} className={`notification-item ${item.readAt ? "is-read" : "is-unread"}`} aria-label={`${item.readAt ? "Read" : "Unread"}: ${item.title}. ${item.message}`} onClick={() => {
          setOpen(false);
          if (!item.readAt) markRead.mutate({ notificationId: item.id });
        }}>
          <span className="notification-item-dot" aria-hidden="true" />
          <span className="notification-item-copy"><strong>{item.title}</strong><span>{item.message}</span><small>{new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span>
        </Link>)}
      </div> : <p className="notification-empty">No marketplace updates yet.</p>}
    </section>}
  </div>;
}
