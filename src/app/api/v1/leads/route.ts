/**
 * POST /api/v1/leads?token=<api_token>
 *
 * External lead-capture endpoint. Accepts a finalized CaseLoad Screen
 * session payload or a third-party intake payload and writes it into
 * the leads table under the authenticated firm.
 *
 * Authentication:
 *   Bearer token OR ?token= query param matched against law_firms.api_token.
 *   Token must belong to an active firm (is_active = true).
 *
 * Use cases:
 *   1. GHL webhook → push a contact into CaseLoad Screen after a form fill
 *   2. Third-party intake (Clio Grow, Lawmatics) → normalise and ingest
 *   3. Internal inter-service calls from screen/route.ts finalize path
 *
 * GET /api/v1/leads?token=<api_token>&since=<ISO>&limit=<n>
 *
 *   Returns leads created for the token's firm since the given timestamp.
 *   Default limit: 50. Max: 200.
 *   Useful for polling integrations that cannot receive webhooks.
 *
 * Response shape:
 *   POST success → 201 { lead_id, cpi_score, band, practice_area }
 *   GET  success → 200 { leads: [...], count: n }
 *   Error        → 4xx { error: "message" }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { computeScore } from "@/lib/scoring";
import { estimateCaseValue } from "@/lib/case-value";
import { computeSabsUrgency, computeDismissalBardal } from "@/lib/interaction-scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Token auth helper
// ─────────────────────────────────────────────────────────────────────────────

async function resolveFirm(req: Request): Promise<{ firmId: string; firmName: string } | null> {
  const url = new URL(req.url);
  let token = url.searchParams.get("token");

  if (!token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth.startsWith("Bearer ")) token = auth.slice(7).trim();
  }

  if (!token) return null;

  const { data: firm } = await supabase
    .from("law_firms")
    .select("id, name, is_active")
    .eq("api_token", token)
    .maybeSingle();

  if (!firm || !firm.is_active) return null;
  return { firmId: firm.id as string, firmName: firm.name as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST  -  ingest a lead
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const firm = await resolveFirm(req);
  if (!firm) {
    return NextResponse.json({ error: "Invalid or missing API token." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Normalise incoming fields to the leads table schema
  const name          = String(body.name ?? "").trim() || null;
  const email         = String(body.email ?? "").trim().toLowerCase() || null;
  const phone         = String(body.phone ?? body.phone_number ?? "").trim() || null;
  const practiceArea  = String(body.practice_area ?? body.case_type ?? "").trim() || null;
  const situation     = String(body.situation ?? body.description ?? body.message ?? "").trim() || null;
  const location      = String(body.location ?? body.city ?? "").trim() || null;
  const source        = String(body.source ?? "api").trim();
  const language      = String(body.language ?? "EN").toUpperCase();

  // Slot answers from structured intake (optional)
  const slotAnswers = (body.slot_answers ?? {}) as Record<string, string>;
  const cpiScore    = typeof body.cpi_score === "number" ? body.cpi_score : null;
  const cpiBand     = typeof body.band === "string" ? body.band : null;

  // Require at minimum: name or email or phone
  if (!name && !email && !phone) {
    return NextResponse.json(
      { error: "At least one of name, email, or phone is required." },
      { status: 422 },
    );
  }

  // Compute scoring if not provided
  const s = computeScore({
    email,
    phone,
    location,
    description: situation,
    timeline:    null,
    case_type:   practiceArea as never,
    estimated_value: typeof body.estimated_value === "number" ? body.estimated_value : 0,
    urgency:     null,
    source:      source as never,
    referral:    body.referral === true,
    multi_practice: false,
    value_tier:  null,
    complexity_indicators: null,
    prior_experience: null,
  });

  const resolvedCpi  = cpiScore ?? s.priority_index;
  const resolvedBand = cpiBand  ?? s.priority_band;

  // Case value estimate
  const caseValue = practiceArea
    ? estimateCaseValue(practiceArea, resolvedCpi, slotAnswers)
    : null;

  // Interaction scoring  -  run for supported PA families
  const lpa = (practiceArea ?? "").toLowerCase();
  let interactionScoring: Record<string, unknown> | null = null;
  if (lpa.startsWith("pi")) {
    const sabsResult = computeSabsUrgency(slotAnswers);
    interactionScoring = { type: "sabs_urgency", ...sabsResult };
  } else if (lpa.startsWith("emp")) {
    const bardalResult = computeDismissalBardal(slotAnswers);
    interactionScoring = { type: "bardal", ...bardalResult };
  }

  // Persist
  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      name,
      email,
      phone,
      case_type:         practiceArea,
      description:       situation,
      location,
      city:              location,
      source,
      language,
      law_firm_id:       firm.firmId,
      stage:             "new_lead",
      lead_state:        "new",
      // Scores
      cpi_score:         resolvedCpi,
      score:             resolvedCpi,
      band:              resolvedBand,
      priority_band:     resolvedBand,
      priority_index:    resolvedCpi,
      fit_score:         s.fit_score,
      value_score:       s.value_score,
      geo_score:         s.geo_score,
      contactability_score: s.contactability_score,
      legitimacy_score:  s.legitimacy_score,
      complexity_score:  s.complexity_score,
      urgency_score:     s.urgency_score,
      strategic_score:   s.strategic_score,
      fee_score:         s.fee_score,
      // Extended
      slot_answers:      Object.keys(slotAnswers).length > 0 ? slotAnswers : null,
      case_value_bucket: caseValue ? caseValue.label : null,
      interaction_scoring: interactionScoring,
      ingested_via:      "api_v1",
      // Explainability (v2.2)  -  mirrors the form path in src/app/api/leads.
      // Confidence and missing_fields drive the incomplete-intake nudge;
      // the explanation is a plain-English summary retained for the admin UI.
      cpi_confidence:     s.confidence,
      cpi_explanation:    s.explanation,
      cpi_missing_fields: s.missing_fields,
      // Source-aware scoring snapshot (mirrors src/app/api/leads/route.ts).
      // Tags the row as v2.1_form and stores the full breakdown in JSONB so
      // buildScoreRationaleInput() in score-components.ts can read the correct
      // engine layout for the admin and portal lead detail pages.
      scoring_model: "v2.1_form",
      score_components: {
        fit_score:            s.fit_score,
        value_score:          s.value_score,
        geo_score:            s.geo_score,
        contactability_score: s.contactability_score,
        legitimacy_score:     s.legitimacy_score,
        complexity_score:     s.complexity_score,
        urgency_score:        s.urgency_score,
        strategic_score:      s.strategic_score,
        fee_score:            s.fee_score,
        priority_index:       s.priority_index,
        priority_band:        s.priority_band,
      },
    })
    .select("id, cpi_score, band, case_type")
    .single();

  if (error || !lead) {
    console.error("[v1/leads POST] insert error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to create lead." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      lead_id:        lead.id,
      cpi_score:      lead.cpi_score,
      band:           lead.band,
      practice_area:  lead.case_type,
      case_value:     caseValue ? { label: caseValue.label, tier: caseValue.tier } : null,
      interaction_scoring: interactionScoring
        ? { type: (interactionScoring as { type: string }).type }
        : null,
    },
    { status: 201 },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  -  pull recent leads for the authenticated firm
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const firm = await resolveFirm(req);
  if (!firm) {
    return NextResponse.json({ error: "Invalid or missing API token." }, { status: 401 });
  }

  const url   = new URL(req.url);
  const since = url.searchParams.get("since") ?? new Date(0).toISOString();
  const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10));
  const band  = url.searchParams.get("band"); // optional filter: A | B | C | D | E

  let query = supabase
    .from("leads")
    .select(`
      id, name, email, phone, case_type, band, cpi_score,
      stage, lead_state, source, language, created_at,
      situation_summary, case_value_bucket
    `)
    .eq("law_firm_id", firm.firmId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (band) {
    query = query.eq("band", band.toUpperCase());
  }

  const { data: leads, error } = await query;

  if (error) {
    console.error("[v1/leads GET] query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads: leads ?? [], count: (leads ?? []).length });
}
