/**
 * /portal/[firmId]/publish-kit
 *
 * Publish Kit period index. Operator-only: lists this firm's content weeks
 * and links to each week's kit. A lawyer session gets notFound() rather than
 * a redirect, so the route's existence is not disclosed to a non-operator
 * viewer.
 *
 * The kit itself (all copy, assets, and provenance for one week) lives at
 * /portal/[firmId]/publish-kit/[periodId]; see that page and
 * @/lib/publish-kit-pure for the view model it renders.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getContentPlan } from "@/lib/deliverables";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtRange(s: string, e: string): string {
  const ds = new Date(`${s}T00:00:00`);
  const de = new Date(`${e}T00:00:00`);
  if (Number.isNaN(ds.getTime()) || Number.isNaN(de.getTime())) return `${s} to ${e}`;
  const mS = ds.toLocaleString("en-CA", { month: "long" });
  const mE = de.toLocaleString("en-CA", { month: "long" });
  const yS = ds.getFullYear();
  const yE = de.getFullYear();
  if (yS === yE && mS === mE) return `${ds.getDate()} to ${de.getDate()} ${mE} ${yE}`;
  if (yS === yE) return `${ds.getDate()} ${mS} to ${de.getDate()} ${mE} ${yE}`;
  return `${ds.getDate()} ${mS} ${yS} to ${de.getDate()} ${mE} ${yE}`;
}

export default async function PublishKitIndexPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const session = await getPortalSession();
  if (!session) redirect("/portal/login");
  if (session.role !== "operator") notFound();

  const plan = await getContentPlan(firmId);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-black/40">
          Operator only
        </p>
        <h1 className="text-xl font-bold text-navy mt-1">Publish Kit</h1>
        <p className="mt-1 text-sm text-black/60 max-w-2xl">
          Copy-ready text, downloadable assets, and provenance for one content week at a
          time. Approvals and comments stay on the deliverable pages; nothing here signs
          anything off.
        </p>
      </div>

      {plan.periods.length === 0 ? (
        <div className="bg-white border border-border-brand p-6 text-sm text-black/55">
          No content weeks yet.
        </div>
      ) : (
        <ul className="bg-white border border-border-brand divide-y divide-border-brand">
          {plan.periods.map((period) => (
            <li key={period.id}>
              <Link
                href={`/portal/${firmId}/publish-kit/${period.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-parchment-2 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">
                    {fmtRange(period.starts_on, period.ends_on)}
                  </p>
                  {period.theme && (
                    <p className="text-sm font-semibold text-navy mt-0.5 truncate">
                      {period.theme}
                    </p>
                  )}
                </div>
                <span className="flex-none text-black/30 text-sm">Open kit &rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
