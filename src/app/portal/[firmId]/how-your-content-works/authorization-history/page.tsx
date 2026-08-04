/**
 * /portal/[firmId]/how-your-content-works/authorization-history
 *
 * Read-only, full history of standing publishing authorization
 * enable/disable events for this firm -- the append-only log itself,
 * newest first. Same auth as the parent page.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { listStandingAuthorizationHistory } from "@/lib/standing-publishing-authorization";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StandingAuthorizationHistoryPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }

  const events = await listStandingAuthorizationHistory(firmId);

  return (
    <div className="space-y-4">
      <Link
        href={`/portal/${firmId}/how-your-content-works`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-navy hover:underline"
      >
        <span aria-hidden>&larr;</span> Back
      </Link>
      <h1 className="text-lg font-bold text-navy">Standing publishing authorization history</h1>
      {events.length === 0 ? (
        <p className="text-sm text-black/55">No authorization events recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="bg-white border border-border-brand p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    e.event === "enabled" ? "text-green-pass" : "text-black/60"
                  }`}
                >
                  {e.event === "enabled" ? "Turned on" : "Turned off"}
                </span>
                <span className="text-xs text-black/45">{new Date(e.effective_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-black/75">
                By {e.actor_name} ({e.actor_email})
              </p>
              {e.event === "enabled" && e.authorization_text && (
                <p className="mt-2 text-[13px] text-black/60 leading-relaxed bg-parchment p-2 border border-border-brand">
                  {e.authorization_text}
                </p>
              )}
              {e.reason && <p className="mt-1 text-[13px] text-black/55">Note: {e.reason}</p>}
              {e.event === "enabled" && (
                <p className="mt-1 text-[11px] text-black/40">
                  Policy {e.policy_version} &middot; Scope {e.scope} &middot; Notify:{" "}
                  {e.notification_preference === "per_publication" ? "every publication" : "weekly digest"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
