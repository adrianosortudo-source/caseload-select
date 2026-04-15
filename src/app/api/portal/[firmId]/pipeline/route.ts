/**
 * GET /api/portal/[firmId]/pipeline
 *
 * Tier 2 Pipeline view. Returns leads grouped by stage with card fields only.
 * No raw CPI scores, no AI rationale, no operator notes.
 *
 * Query params:
 *   practice_area — filter by case_type
 *   date_from     — ISO date string (default: start of current month)
 *   date_to       — ISO date string (default: now)
 *
 * Auth: portal session cookie.
 */

import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";

const PIPELINE_STAGES = [
  { key: "new_lead",               label: "New Inquiry"   },
  { key: "contacted",              label: "Contacted"     },
  { key: "qualified",              label: "Qualified"     },
  { key: "consultation_scheduled", label: "Consult Booked"},
  { key: "consultation_held",      label: "Consult Held"  },
  { key: "proposal_sent",          label: "Retainer Sent" },
  { key: "client_won",             label: "Retained"      },
  { key: "no_show",                label: "No Show"       },
  { key: "client_lost",            label: "Closed-Lost"   },
];

function obfuscateName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return `${first} ${lastInitial}.`;
}

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await ctx.params;

  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const practiceArea = url.searchParams.get("practice_area");
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dateFrom = url.searchParams.get("date_from") ?? defaultFrom;
  const dateTo = url.searchParams.get("date_to") ?? now.toISOString();

  let query = supabase
    .from("leads")
    .select("id, name, case_type, stage, band, priority_band, stage_changed_at, created_at")
    .eq("law_firm_id", firmId)
    .gte("created_at", dateFrom)
    .lte("created_at", dateTo)
    .order("created_at", { ascending: false });

  if (practiceArea) {
    query = query.eq("case_type", practiceArea);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads = data ?? [];

  // Group by stage, strip PII beyond first name + last initial
  const columns = PIPELINE_STAGES.map(({ key, label }) => ({
    stage: key,
    label,
    cards: leads
      .filter(l => l.stage === key)
      .map(l => ({
        id: l.id,
        name: obfuscateName(l.name as string ?? "—"),
        practice_area: l.case_type ?? null,
        band: (l.priority_band ?? l.band) as string | null,
        days_in_stage: daysSince(l.stage_changed_at as string | null),
      })),
  }));

  return NextResponse.json({ columns });
}
