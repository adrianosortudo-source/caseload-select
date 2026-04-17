/**
 * /portal/[firmId]/phases — Tier 3 FACT Phase View
 *
 * Four phase cards in a 2x2 grid.
 * Filter (F): band distribution + SLA gauge — live data.
 * Authority (A): Clio Manage integration — live if connected, connect prompt if not.
 * Capture (C) / Target (T): placeholders until BrightLocal / GA4 / Google Ads are live.
 *
 * Auth verified by parent layout.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";
import { isClioConnected, getClioMatters } from "@/lib/clio";
import FilterCard from "./FilterCard";
import ClioCard from "./ClioCard";
import PlaceholderCard from "./PlaceholderCard";

export const dynamic = "force-dynamic";

export default async function PhasesPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = now.toLocaleString("en-CA", { month: "long", year: "numeric" });

  // Fetch Filter data + Clio status in parallel
  const [sessionsMonth, leadsWithResponse, clioConnected] = await Promise.all([
    supabase
      .from("intake_sessions")
      .select("band")
      .eq("firm_id", firmId)
      .gte("created_at", monthStart),

    supabase
      .from("leads")
      .select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart)
      .not("first_contact_at", "is", null),

    isClioConnected(firmId),
  ]);

  const sessions = sessionsMonth.data ?? [];
  const responseLeads = leadsWithResponse.data ?? [];

  // Band distribution
  const bandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of sessions) {
    const b = s.band as string;
    if (b && b in bandDist) bandDist[b]++;
  }

  // SLA compliance
  let slaCompliance = 0;
  if (responseLeads.length > 0) {
    const withinSLA = responseLeads.filter(l => {
      const ms = new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime();
      return ms >= 0 && ms / 1000 < 60;
    }).length;
    slaCompliance = Math.round((withinSLA / responseLeads.length) * 100);
  }

  // Fetch Clio matters only if connected (non-fatal — card degrades gracefully on error)
  const clioMatters = clioConnected
    ? await getClioMatters(firmId, 5).catch(() => [])
    : [];

  // Count open matters for the summary stat
  const openMatterCount = clioMatters.filter(m => m.status?.toLowerCase() === "open").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">FACT Phases</h1>
        <p className="text-sm text-black/40 mt-1">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FilterCard
          bandDist={bandDist}
          total={sessions.length}
          bandECount={bandDist.E ?? 0}
          slaCompliance={slaCompliance}
          slaHasSamples={responseLeads.length > 0}
        />
        <ClioCard
          connected={clioConnected}
          firmId={firmId}
          matters={clioMatters}
          matterCount={clioConnected ? openMatterCount : null}
        />
        <PlaceholderCard phase="Capture" />
        <PlaceholderCard phase="Target" />
      </div>
    </div>
  );
}
