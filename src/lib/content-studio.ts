import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import type { ValidatorConfig } from "./content-validators";
import type { DelegationGrant } from "./deliverables-pure";

export interface StrategyRow {
  id: string;
  firm_id: string;
  name: string;
  version: number;
  status: string;
  default_locale: string;
  bilingual_enabled: boolean;
  jurisdiction: string;
  strategy_json: Record<string, unknown>;
  format_specs: Record<string, unknown>;
  voice_rules: Record<string, unknown>;
}

export async function getActiveStrategy(
  firmId: string
): Promise<StrategyRow | null> {
  const { data } = await supabaseAdmin
    .from("firm_content_strategies")
    .select("*")
    .eq("firm_id", firmId)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .single();
  return data as StrategyRow | null;
}

export function buildValidatorConfig(
  strategy: StrategyRow,
  format: string
): ValidatorConfig {
  const voice = strategy.voice_rules as Record<string, unknown>;
  const specs = strategy.format_specs as Record<string, Record<string, unknown>>;
  const formatSpec = specs[format] ?? {};

  const fmt = voice.formatting_rules as Record<string, boolean> | undefined;
  return {
    banned_vocabulary: (voice.banned_vocabulary as string[]) ?? [],
    approved_vocabulary: (voice.approved_vocabulary as string[]) ?? [],
    lso_constraints:
      ((voice.lso_rules as Record<string, unknown>)?.constraints as string[]) ?? [],
    formatting_rules: {
      no_em_dashes: fmt?.no_em_dashes ?? true,
      no_italics: fmt?.no_italics ?? true,
      no_orphan_words: fmt?.no_orphan_words ?? true,
      no_rule_of_three: fmt?.no_rule_of_three ?? true,
      no_timing_promises: fmt?.no_timing_promises ?? true,
      no_specialist_language: fmt?.no_specialist_language ?? true,
      no_factual_hallucination: fmt?.no_factual_hallucination ?? true,
      enforce_hook_retain_reward: fmt?.enforce_hook_retain_reward ?? false,
      no_fake_scarcity: fmt?.no_fake_scarcity ?? true,
      no_weasel_words: fmt?.no_weasel_words ?? true,
      enforce_email_respect: fmt?.enforce_email_respect ?? true,
      no_rejected_ctas: fmt?.no_rejected_ctas ?? true,
      enforce_review_request_compliance: fmt?.enforce_review_request_compliance ?? true,
      enforce_negative_review_response: fmt?.enforce_negative_review_response ?? true,
      enforce_testimonial_content: fmt?.enforce_testimonial_content ?? true,
      no_lso_superlatives: fmt?.no_lso_superlatives ?? true,
      no_referral_violations: fmt?.no_referral_violations ?? true,
      no_incentivized_review: fmt?.no_incentivized_review ?? true,
      no_review_removal_copy: fmt?.no_review_removal_copy ?? true,
      no_free_consult_lure: fmt?.no_free_consult_lure ?? true,
      no_distress_hero: fmt?.no_distress_hero ?? true,
      no_us_trust_badges: fmt?.no_us_trust_badges ?? true,
      no_lsa_quality_claim: fmt?.no_lsa_quality_claim ?? true,
    },
    format_spec: {
      word_range: formatSpec.word_range as [number, number] | undefined,
      structure: formatSpec.structure as string[] | undefined,
      page_structure: formatSpec.page_structure as string[] | undefined,
    },
    format,
    rejected_ctas: (voice.rejected_ctas as string[] | undefined) ?? [],
    certified_specialists:
      ((strategy.strategy_json as Record<string, unknown>)
        ?.certified_specialists as Array<{ lawyer: string; areas: string[] }>) ?? [],
  };
}

export async function listCalendarSlots(firmId: string, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("content_calendar_slots")
    .select("*")
    .eq("firm_id", firmId)
    .order("publish_date", { ascending: true })
    .limit(limit);
  return { data: data ?? [], error };
}

export async function createCalendarSlot(slot: {
  firm_id: string;
  strategy_id?: string;
  week_of: string;
  publish_date: string;
  cadence_kind: string;
  territory?: string;
  planned_format: string;
  theme: string;
}) {
  return supabaseAdmin
    .from("content_calendar_slots")
    .insert(slot)
    .select()
    .single();
}

export async function getPiece(id: string) {
  const { data, error } = await supabaseAdmin
    .from("content_pieces")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
}

export async function listPieces(firmId: string, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("content_pieces")
    .select("*")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return { data: data ?? [], error };
}

export async function createPiece(piece: {
  firm_id: string;
  calendar_slot_id?: string;
  strategy_id?: string;
  strategy_version?: number;
  title_working: string;
  format: string;
  language_mode?: string;
  source_brief?: Record<string, unknown>;
}) {
  return supabaseAdmin
    .from("content_pieces")
    .insert(piece)
    .select()
    .single();
}

export async function updatePiece(
  id: string,
  updates: Record<string, unknown>
) {
  return supabaseAdmin
    .from("content_pieces")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
}

export async function createPieceVersion(version: {
  piece_id: string;
  version_number: number;
  language: string;
  body_structured?: unknown[];
  body_markdown?: string;
  seo_metadata?: Record<string, unknown>;
  source_notes?: Record<string, unknown>;
  text_hash?: string;
  created_by?: string;
  created_with_ai_run_id?: string;
}) {
  await supabaseAdmin
    .from("content_piece_versions")
    .update({ is_current: false })
    .eq("piece_id", version.piece_id)
    .eq("language", version.language);

  return supabaseAdmin
    .from("content_piece_versions")
    .insert({ ...version, is_current: true })
    .select()
    .single();
}

export async function getCurrentVersion(pieceId: string, language = "en") {
  const { data } = await supabaseAdmin
    .from("content_piece_versions")
    .select("*")
    .eq("piece_id", pieceId)
    .eq("language", language)
    .eq("is_current", true)
    .single();
  return data;
}

export async function getNextVersionNumber(pieceId: string, language = "en") {
  const { data } = await supabaseAdmin
    .from("content_piece_versions")
    .select("version_number")
    .eq("piece_id", pieceId)
    .eq("language", language)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  return (data?.version_number ?? 0) + 1;
}

export async function recordAiRun(run: {
  firm_id: string;
  piece_id: string;
  piece_version_id?: string;
  run_type: string;
  model: string;
  prompt_context?: Record<string, unknown>;
  result?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  input_hash?: string;
  output_hash?: string;
  status?: string;
  error_message?: string;
}) {
  return supabaseAdmin
    .from("content_ai_runs")
    .insert({
      ...run,
      status: run.status ?? "succeeded",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
}

export interface PublishGateStatus {
  deliverableStatus: string | null;
  delegation: DelegationGrant | null;
}

/**
 * Resolves the two facts checkLegalGateExitCondition (content-studio-gates.ts)
 * needs to decide whether a piece may leave legal_gate: its linked
 * deliverable's status, and any active publish delegation covering its
 * format. Shared by the workflow-gate PATCH route and the export route so
 * the two never drift on what "cleared for production" means.
 *
 * The delegation read is guarded: content_publish_delegations is a staged,
 * not-yet-applied migration (Amendment No. 1 to CLS-2026-DRG-001). Any
 * error, including "table does not exist," is treated as "no active
 * delegation." This function never creates or assumes that table exists.
 */
export async function resolvePublishGateStatus(piece: {
  firm_id: string;
  deliverable_id: string | null;
}): Promise<PublishGateStatus> {
  let deliverableStatus: string | null = null;
  if (piece.deliverable_id) {
    const { data } = await supabaseAdmin
      .from("content_deliverables")
      .select("status")
      .eq("id", piece.deliverable_id)
      .maybeSingle();
    deliverableStatus = (data?.status as string | undefined) ?? null;
  }

  let delegation: DelegationGrant | null = null;
  try {
    const { data: grant, error: grantErr } = await supabaseAdmin
      .from("content_publish_delegations")
      .select("status, expires_at, scope_formats")
      .eq("firm_id", piece.firm_id)
      .eq("status", "active")
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!grantErr && grant) delegation = grant as unknown as DelegationGrant;
  } catch {
    delegation = null;
  }

  return { deliverableStatus, delegation };
}

export async function recordValidationRun(run: {
  piece_id: string;
  piece_version_id: string;
  firm_id: string;
  results: Array<{ key: string; status: string; severity: string; findings: unknown[] }>;
}) {
  return supabaseAdmin
    .from("content_ai_runs")
    .insert({
      firm_id: run.firm_id,
      // piece_id must be set alongside piece_version_id: the admin piece
      // page loads run history with .eq("piece_id", id), so a version-only
      // row is invisible there (caught by the 2026-07-05 prod smoke test:
      // the Validator Results panel could never populate).
      piece_id: run.piece_id,
      piece_version_id: run.piece_version_id,
      run_type: "validate_deterministic",
      status: "succeeded",
      result: { validators: run.results },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
}
