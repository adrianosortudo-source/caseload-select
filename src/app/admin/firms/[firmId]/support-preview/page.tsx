/**
 * /admin/firms/[firmId]/support-preview
 *
 * Operator Support Preview entry point (DR-084 completion). The operator
 * stays the acting identity at all times; this page only lets them choose
 * exactly one audience before stepping into the firm's real portal,
 * read-only. Enters via the existing /api/portal/[firmId]/preview/enter
 * route -- no parallel preview system.
 */

import { notFound, redirect } from "next/navigation";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MatterRow {
  id: string;
  primary_name: string | null;
  matter_stage: string;
  created_at: string;
}

export default async function SupportPreviewSelectorPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal/login?error=missing");

  const { firmId } = await params;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("id, name")
    .eq("id", firmId)
    .maybeSingle();
  if (!firm) notFound();

  const firmName = (firm.name as string | null) ?? "(unknown firm)";

  const { data: matterRows } = await supabase
    .from("client_matters")
    .select("id, primary_name, matter_stage, created_at")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: false })
    .limit(50);
  const matters = (matterRows ?? []) as MatterRow[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Open client portal in support preview</h1>
        <p className="mt-1 text-sm text-black/60">
          {firmName}: you stay signed in as the CaseLoad Select operator. The portal renders exactly
          as the selected audience sees it, read-only. Choose exactly one audience.
        </p>
      </div>

      <section className="bg-white border border-border-brand p-5 space-y-3">
        <h2 className="text-sm font-bold text-navy uppercase tracking-wider">Lawyer decision-maker preview</h2>
        <p className="text-sm text-black/60">
          See the firm&apos;s lawyer portal exactly as {firmName}&apos;s decision-maker sees it, including
          the standing publishing authorization screen.
        </p>
        <a
          href={`/api/portal/${firmId}/preview/enter?target=lawyer`}
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
        >
          Enter as Lawyer decision-maker
        </a>
      </section>

      <section className="bg-white border border-border-brand p-5 space-y-3">
        <h2 className="text-sm font-bold text-navy uppercase tracking-wider">Client viewer preview</h2>
        <p className="text-sm text-black/60">
          Client sessions are scoped to one matter. Choose which matter to preview as the client.
        </p>
        {matters.length === 0 ? (
          <p className="text-sm text-black/50">
            No client matters exist for this firm yet. Client viewer preview needs at least one matter.
          </p>
        ) : (
          <ul className="divide-y divide-border-brand border border-border-brand">
            {matters.map((matter) => (
              <li key={matter.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-navy">
                  {matter.primary_name ?? "(unnamed matter)"}
                  <span className="ml-2 text-xs uppercase tracking-wider text-black/40">
                    {matter.matter_stage}
                  </span>
                </span>
                <a
                  href={`/api/portal/${firmId}/preview/enter?target=client&matterId=${matter.id}`}
                  className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors whitespace-nowrap"
                >
                  Enter as Client viewer
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
