import "server-only";
import { supabaseAdmin } from "./supabase-admin";
import type { ValidatorConfig } from "./content-validators";

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

  return {
    banned_vocabulary: (voice.banned_vocabulary as string[]) ?? [],
    approved_vocabulary: (voice.approved_vocabulary as string[]) ?? [],
    lso_constraints:
      ((voice.lso_rules as Record<string, unknown>)?.constraints as string[]) ?? [],
    formatting_rules: {
      no_em_dashes:
        (voice.formatting_rules as Record<string, boolean>)?.no_em_dashes ?? true,
      no_italics:
        (voice.formatting_rules as Record<string, boolean>)?.no_italics ?? true,
      no_orphan_words:
        (voice.formatting_rules as Record<string, boolean>)?.no_orphan_words ?? true,
      no_rule_of_three:
        (voice.formatting_rules as Record<string, boolean>)?.no_rule_of_three ?? true,
    },
    format_spec: {
      word_range: formatSpec.word_range as [number, number] | undefined,
      structure: formatSpec.structure as string[] | undefined,
    },
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

export async function recordValidationRun(run: {
  piece_version_id: string;
  firm_id: string;
  results: Array<{ key: string; status: string; severity: string; findings: unknown[] }>;
}) {
  return supabaseAdmin
    .from("content_ai_runs")
    .insert({
      firm_id: run.firm_id,
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
