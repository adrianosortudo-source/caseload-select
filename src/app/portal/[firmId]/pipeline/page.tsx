/**
 * /portal/[firmId]/pipeline — Tier 2 Pipeline View
 *
 * Read-only kanban board. Nine stage columns. Filterable by practice area
 * and date range. No drag-drop, no mutations, no raw CPI scores.
 *
 * Auth verified by parent layout.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";
import PipelineBoard from "./PipelineBoard";

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

function obfuscateName(fullName: string): string {
  const parts = (fullName ?? "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return `${first} ${lastInitial}.`;
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ practice_area?: string; date_from?: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;
  const { practice_area: paFilter, date_from } = await searchParams;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dateFrom = date_from ?? defaultFrom;

  // Load firm practice areas for filter dropdown
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("practice_areas")
    .eq("id", firmId)
    .single();

  const practiceAreas = (firm?.practice_areas as Array<{ id: string; label: string }>) ?? [];

  // Load leads — card fields only, no PII beyond name
  let query = supabase
    .from("leads")
    .select("id, name, case_type, stage, band, priority_band, stage_changed_at, created_at")
    .eq("law_firm_id", firmId)
    .gte("created_at", dateFrom)
    .order("created_at", { ascending: false });

  if (paFilter) {
    query = query.eq("case_type", paFilter);
  }

  const { data } = await query;
  const leads = data ?? [];

  // Group into columns (strip PII, no numeric CPI)
  const columns = PIPELINE_STAGES.map(({ key, label }) => ({
    stage: key,
    label,
    cards: leads
      .filter(l => l.stage === key)
      .map(l => ({
        id: l.id as string,
        name: obfuscateName(l.name as string ?? ""),
        practice_area: (l.case_type as string | null) ?? null,
        band: ((l.priority_band ?? l.band) as string | null) ?? null,
        days_in_stage: daysSince(l.stage_changed_at as string | null),
      })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Pipeline</h1>
        <p className="text-sm text-black/40 mt-1">
          {leads.length} lead{leads.length !== 1 ? "s" : ""} · Read-only view
        </p>
      </div>

      {/* Filter bar */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-black/50 font-medium uppercase tracking-wide">Practice Area</label>
          <select
            name="practice_area"
            defaultValue={paFilter ?? ""}
            className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/20"
          >
            <option value="">All areas</option>
            {practiceAreas.map((pa) => (
              <option key={pa.id} value={pa.label}>{pa.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-black/50 font-medium uppercase tracking-wide">From</label>
          <input
            type="date"
            name="date_from"
            defaultValue={dateFrom.slice(0, 10)}
            className="border border-black/10 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/20"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-navy text-white hover:bg-navy/90 transition"
        >
          Apply
        </button>
        {(paFilter || date_from) && (
          <a
            href={`/portal/${firmId}/pipeline`}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-black/5 text-black/60 hover:bg-black/8 transition"
          >
            Clear
          </a>
        )}
      </form>

      <PipelineBoard columns={columns} />
    </div>
  );
}
