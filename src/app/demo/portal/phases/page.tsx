/**
 * /demo/portal/phases  -  ACTS phases for the Hartwell Law demo firm.
 * No auth. Uses live demo intake data. Renamed from FACT in April 2026.
 */

import { redirect } from "next/navigation";
import { getDemoFirmId } from "@/lib/demo-firm";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import ScreenCard from "@/app/portal/[firmId]/phases/ScreenCard";
import PlaceholderCard from "@/app/portal/[firmId]/phases/PlaceholderCard";

export const dynamic = "force-dynamic";

export default async function DemoPortalPhases() {
  const firmId = await getDemoFirmId();
  if (!firmId) redirect("/demo");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = now.toLocaleString("en-CA", { month: "long", year: "numeric" });

  const [sessionsMonth, leadsWithResponse] = await Promise.all([
    supabase.from("intake_sessions").select("band")
      .eq("firm_id", firmId).gte("created_at", monthStart),

    supabase.from("leads").select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart)
      .not("first_contact_at", "is", null),
  ]);

  const sessions      = sessionsMonth.data ?? [];
  const responseLeads = leadsWithResponse.data ?? [];

  const bandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of sessions) {
    const b = s.band as string;
    if (b && b in bandDist) bandDist[b]++;
  }

  let slaCompliance = 0;
  if (responseLeads.length > 0) {
    const withinSLA = responseLeads.filter(l => {
      const ms = new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime();
      return ms >= 0 && ms / 1000 < 60;
    }).length;
    slaCompliance = Math.round((withinSLA / responseLeads.length) * 100);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">ACTS Phases</h1>
        <p className="text-sm text-black/40 mt-1">{monthLabel} · Live demo data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PlaceholderCard phase="Authority" />
        <PlaceholderCard phase="Capture" />
        <PlaceholderCard phase="Target" />
        <ScreenCard
          bandDist={bandDist}
          total={sessions.length}
          bandECount={bandDist.E ?? 0}
          slaCompliance={slaCompliance}
          slaHasSamples={responseLeads.length > 0}
        />
      </div>
    </div>
  );
}
