/**
 * /demo/portal/pipeline  -  Live demo pipeline kanban.
 * No auth. Uses Hartwell Law PC demo firm.
 */

import { redirect } from "next/navigation";
import { getDemoFirmId } from "@/lib/demo-firm";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import PipelineBoard from "@/app/portal/[firmId]/pipeline/PipelineBoard";
import FunnelBar from "@/app/portal/[firmId]/pipeline/FunnelBar";

export const dynamic = "force-dynamic";

const PIPELINE_STAGES = [
  { key: "new_lead",               label: "New Inquiry"    },
  { key: "contacted",              label: "Contacted"      },
  { key: "qualified",              label: "Qualified"      },
  { key: "consultation_scheduled", label: "Consult Booked" },
  { key: "consultation_held",      label: "Consult Held"   },
  { key: "proposal_sent",          label: "Retainer Sent"  },
  { key: "client_won",             label: "Retained"       },
  { key: "no_show",                label: "No Show"        },
  { key: "client_lost",            label: "Closed-Lost"    },
];

const FUNNEL_STAGE_KEYS = [
  "new_lead", "contacted", "qualified",
  "consultation_scheduled", "consultation_held",
  "proposal_sent", "client_won",
];

function obfuscateName(fullName: string): string {
  const parts = (fullName ?? "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase() ?? ""}.`;
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function DemoPortalPipeline() {
  const firmId = await getDemoFirmId();
  if (!firmId) redirect("/demo");

  const now = new Date();
  const dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data } = await supabase
    .from("leads")
    .select("id, name, case_type, stage, band, priority_band, stage_changed_at, created_at")
    .eq("law_firm_id", firmId)
    .gte("created_at", dateFrom)
    .order("created_at", { ascending: false });

  const leads = data ?? [];

  // Funnel counts
  const funnelCounts: Record<string, number> = {};
  for (const key of FUNNEL_STAGE_KEYS) {
    funnelCounts[key] = leads.filter(l => l.stage === key).length;
  }
  funnelCounts["new_lead"] = leads.filter(
    l => !["client_lost", "no_show"].includes(l.stage as string)
  ).length;

  const columns = PIPELINE_STAGES.map(({ key, label }) => ({
    stage: key,
    label,
    cards: leads
      .filter(l => l.stage === key)
      .map(l => ({
        id: l.id as string,
        name: obfuscateName((l.name as string) ?? ""),
        practice_area: (l.case_type as string | null) ?? null,
        band: ((l.priority_band ?? l.band) as string | null) ?? null,
        days_in_stage: daysSince(l.stage_changed_at as string | null),
        href: `/demo/portal/leads/${l.id as string}`,
      })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Pipeline</h1>
        <p className="text-sm text-black/40 mt-1">
          {leads.length} lead{leads.length !== 1 ? "s" : ""} · This month · Read-only
        </p>
      </div>

      <FunnelBar counts={funnelCounts} />
      <PipelineBoard columns={columns} />
    </div>
  );
}
