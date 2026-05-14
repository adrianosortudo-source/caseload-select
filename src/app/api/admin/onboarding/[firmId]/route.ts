/**
 * GET /api/admin/onboarding/[firmId]
 *
 * Returns a structured onboarding checklist for a single intake_firms record.
 * Adriano runs this during firm setup to confirm every required integration
 * is configured before going live.
 *
 * Auth: Bearer CRON_SECRET (operator only)
 *
 * Checklist items:
 *   1. practice_areas       -  At least one practice area configured
 *   2. geo_config           -  Geographic boundaries set
 *   3. branding             -  Firm name + primary color in branding object
 *   4. ghl_webhook          -  GHL webhook URL present (lead routing to CRM)
 *   5. clio_connected       -  Clio OAuth tokens saved (matter creation)
 *   6. first_session        -  At least one intake session received (widget live)
 *   7. custom_domain        -  Custom domain configured (optional  -  shows warning, not error)
 *   8. scoring_weights      -  Custom scoring weights configured (optional)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { DEFAULT_QUESTION_MODULES } from "@/lib/default-question-modules";
import type { PracticeArea } from "@/lib/screen-prompt";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

interface ChecklistItem {
  key: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  required: boolean;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { firmId } = await params;

  const [firmRes, sessionRes, conflictRes] = await Promise.all([
    supabase
      .from("intake_firms")
      .select("id, firm_name, practice_areas, geo_config, branding, ghl_webhook_url, clio_config, scoring_weights, custom_domain")
      .eq("id", firmId)
      .single(),
    supabase
      .from("intake_sessions")
      .select("id")
      .eq("firm_id", firmId)
      .limit(1),
    // Check conflict register  -  need a law_firm_clients link; use intake firm name to find it
    supabase
      .from("conflict_register")
      .select("id", { count: "exact", head: true })
      .eq("law_firm_id", firmId)
      .limit(1),
  ]);

  if (firmRes.error || !firmRes.data) {
    return NextResponse.json({ error: "Firm not found" }, { status: 404 });
  }

  const firm = firmRes.data;
  const hasSession = (sessionRes.data?.length ?? 0) > 0;
  const hasConflictRegister = (conflictRes.count ?? 0) > 0;

  const practiceAreas = firm.practice_areas as string[] | null;
  const branding = firm.branding as Record<string, unknown> | null;
  const geoConfig = firm.geo_config as Record<string, unknown> | null;
  const clioConfig = firm.clio_config as Record<string, unknown> | null;
  const scoringWeights = firm.scoring_weights as Record<string, unknown> | null;

  const checklist: ChecklistItem[] = [
    {
      key: "practice_areas",
      label: "Practice areas configured",
      status: practiceAreas && practiceAreas.length > 0 ? "pass" : "fail",
      detail: practiceAreas?.length
        ? `${practiceAreas.length} area(s): ${practiceAreas.join(", ")}`
        : "No practice areas set: GPT screening will use generic prompts",
      required: true,
    },
    {
      key: "geo_config",
      label: "Geographic boundaries set",
      status: geoConfig && Object.keys(geoConfig).length > 0 ? "pass" : "fail",
      detail: geoConfig
        ? `Config present: ${JSON.stringify(geoConfig).slice(0, 80)}`
        : "No geo config: out-of-area leads will not be filtered",
      required: true,
    },
    {
      key: "branding",
      label: "Firm branding configured",
      status:
        branding && branding.name && branding.primary_color ? "pass" : "fail",
      detail: branding?.name
        ? `Name: ${branding.name}${branding.primary_color ? ` · Color: ${branding.primary_color}` : " (no primary color)"}`
        : "Branding not set: portal and widget will show placeholder identity",
      required: true,
    },
    {
      key: "ghl_webhook",
      label: "GHL webhook URL configured",
      status: firm.ghl_webhook_url ? "pass" : "fail",
      detail: firm.ghl_webhook_url
        ? `Webhook set (${firm.ghl_webhook_url.slice(0, 40)}...)`
        : "No GHL webhook: Band A/B leads will not route to CRM automatically",
      required: true,
    },
    {
      key: "clio_connected",
      label: "Clio OAuth connected",
      status: clioConfig?.access_token ? "pass" : "warn",
      detail: clioConfig?.access_token
        ? `Connected${clioConfig.expires_at ? ` · Token expires: ${new Date(clioConfig.expires_at as string).toLocaleDateString("en-CA")}` : ""}`
        : "Clio not connected: matter creation on client_won will be skipped",
      required: false,
    },
    {
      key: "first_session",
      label: "Widget live (first session received)",
      status: hasSession ? "pass" : "warn",
      detail: hasSession
        ? "At least one intake session recorded"
        : "No sessions yet: confirm widget is embedded on firm website",
      required: false,
    },
    {
      key: "custom_domain",
      label: "Custom domain configured",
      status: firm.custom_domain ? "pass" : "warn",
      detail: firm.custom_domain
        ? `Domain: ${firm.custom_domain}`
        : "No custom domain: widget served from caseloadselect.ca/widget/[id]",
      required: false,
    },
    {
      key: "scoring_weights",
      label: "Custom scoring weights configured",
      status: scoringWeights && Object.keys(scoringWeights).length > 0 ? "pass" : "warn",
      detail: scoringWeights
        ? "Custom weights active"
        : "Using default CPI weights: acceptable for most firms",
      required: false,
    },
    {
      key: "conflict_register",
      label: "Conflict register loaded",
      status: hasConflictRegister ? "pass" : "warn",
      detail: hasConflictRegister
        ? "Register populated (CSV import or client_won entries)"
        : "Empty register: conflict checks will only match against Clio (if connected). Load CSV on onboarding.",
      required: false,
    },
  ];

  const required = checklist.filter((c) => c.required);
  const passCount = required.filter((c) => c.status === "pass").length;
  const readyToLaunch = required.every((c) => c.status === "pass");

  return NextResponse.json({
    firm_id: firmId,
    firm_name: firm.firm_name,
    ready_to_launch: readyToLaunch,
    required_passed: passCount,
    required_total: required.length,
    checklist,
    evaluated_at: new Date().toISOString(),
  });
}

/**
 * POST /api/admin/onboarding/[firmId]
 *
 * Seeds question_sets from DEFAULT_QUESTION_MODULES for the firm's configured practice areas.
 * Only adds modules that don't already exist (non-destructive). Existing custom question sets
 * are preserved.
 *
 * Body (optional): { "areas": ["emp", "fam", ...] }  -  limits seeding to specific area IDs.
 *                  If omitted, seeds all areas matching the firm's configured practice_areas.
 *                  Pass { "areas": "all" } to seed all 35 default modules regardless of config.
 *
 * Auth: Bearer CRON_SECRET (operator only)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { firmId } = await params;

  const body = await req.json().catch(() => ({})) as { areas?: string[] | "all" };

  const { data: firm, error: firmError } = await supabase
    .from("intake_firms")
    .select("id, practice_areas, question_sets")
    .eq("id", firmId)
    .single();

  if (firmError || !firm) {
    return NextResponse.json({ error: "Firm not found" }, { status: 404 });
  }

  const existingQuestionSets = (firm.question_sets ?? {}) as Record<string, unknown>;

  // Determine which area IDs to seed
  let targetIds: string[];
  if (body.areas === "all") {
    targetIds = Object.keys(DEFAULT_QUESTION_MODULES);
  } else if (Array.isArray(body.areas) && body.areas.length > 0) {
    targetIds = body.areas;
  } else {
    // Default: use the firm's configured practice areas
    const practiceAreas = (firm.practice_areas ?? []) as PracticeArea[];
    targetIds = practiceAreas
      .filter(a => a.classification !== "out_of_scope")
      .map(a => a.id);
  }

  // Seed only areas that exist in DEFAULT_QUESTION_MODULES and aren't already configured
  const toSeed: Record<string, unknown> = {};
  const skipped: string[] = [];
  const missing: string[] = [];

  for (const id of targetIds) {
    if (existingQuestionSets[id] !== undefined) {
      skipped.push(id);
    } else if (DEFAULT_QUESTION_MODULES[id]) {
      toSeed[id] = DEFAULT_QUESTION_MODULES[id];
    } else {
      missing.push(id);
    }
  }

  if (Object.keys(toSeed).length === 0) {
    return NextResponse.json({
      firm_id: firmId,
      seeded: 0,
      seeded_areas: [],
      skipped_areas: skipped,
      missing_areas: missing,
      message: "No new question sets to seed: all target areas already configured or not in defaults",
    });
  }

  const merged = { ...existingQuestionSets, ...toSeed };

  const { error: updateError } = await supabase
    .from("intake_firms")
    .update({ question_sets: merged })
    .eq("id", firmId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    firm_id: firmId,
    seeded: Object.keys(toSeed).length,
    seeded_areas: Object.keys(toSeed),
    skipped_areas: skipped,
    missing_areas: missing,
  });
}
