import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import type { AccountRole, SellerApplicationStatus } from "../../../../drizzle/schema";

export function BecomeSellerButton({
  role,
  applicationStatus,
}: {
  role: AccountRole;
  applicationStatus: SellerApplicationStatus | null;
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const activation = trpc.account.becomeSeller.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.account.me.invalidate(), utils.auth.me.invalidate()]);
      await utils.seller.dashboard.invalidate();
      navigate("/seller");
    },
  });

  if (applicationStatus === "rejected" || applicationStatus === "suspended") {
    return <p className="portal-error" role="status">
      {applicationStatus === "suspended"
        ? "Seller access is paused. Contact NaijaKoblas support to request reinstatement."
        : "Seller access was previously declined. Contact NaijaKoblas support if you believe this is an error."}
    </p>;
  }
  if (role === "seller" && applicationStatus === "approved") {
    return <Link href="/seller" className="button button--dark">Open seller workspace <ArrowRight size={17} /></Link>;
  }
  if (role === "seller" && applicationStatus === null) {
    return <p className="portal-error" role="status">The seller account record is incomplete. Contact NaijaKoblas support before continuing.</p>;
  }
  if (role !== "customer" && !(role === "seller" && applicationStatus === "pending")) {
    return <p className="portal-note">Administrator and staff roles cannot be changed through seller self-service.</p>;
  }

  return <div className="seller-activation-action">
    <button className="button button--dark" type="button" disabled={activation.isPending} onClick={() => activation.mutate()}>
      {activation.isPending ? "Activating seller access…" : "Become a seller"}<ArrowRight size={17} />
    </button>
    <small>{applicationStatus === "pending"
      ? "This activates your seller workspace now and replaces the pending review step. No additional details are needed."
      : "Seller access activates immediately. Your store profile and product details are optional and can be added later."}</small>
    {activation.error && <p className="portal-error" role="alert">{activation.error.message}</p>}
  </div>;
}
