import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ScreenFunnelContext } from "./screen-funnel-context";
import type { ScreenFunnelEventV1 } from "./screen-funnel-schema";

export type ScreenFunnelInsertResult = "inserted" | "duplicate" | "conflict" | "error";

function toRow(event: ScreenFunnelEventV1, context: ScreenFunnelContext) {
  return {
    event_id: event.eventId,
    flow_id: event.flowId,
    sequence: event.sequence,
    surface: context.surface,
    firm_id: context.firmId,
    event_name: event.event,
    stage: event.stage,
    step_index: event.stepIndex,
    question_count: event.questionCount,
    answer_mode: event.answerMode ?? null,
    is_revisit: event.isRevisit ?? false,
    locale: event.locale,
    viewport_bucket: event.viewport,
    elapsed_ms: event.elapsedMs,
  };
}

export async function insertScreenFunnelEvent(
  event: ScreenFunnelEventV1,
  context: ScreenFunnelContext,
): Promise<ScreenFunnelInsertResult> {
  const row = toRow(event, context);
  const { error } = await supabaseAdmin.from("screen_funnel_events").insert(row);
  if (!error) return "inserted";
  if (error.code !== "23505") return "error";

  // A unique (flow_id, sequence) collision is idempotent only when the
  // durable event matches exactly. A different payload must remain visible to
  // callers as a conflict rather than quietly corrupting a journey.
  const { data: existing, error: readError } = await supabaseAdmin
    .from("screen_funnel_events")
    .select("event_id, flow_id, sequence, surface, firm_id, event_name, stage, step_index, question_count, answer_mode, is_revisit, locale, viewport_bucket, elapsed_ms")
    .eq("flow_id", event.flowId)
    .eq("sequence", event.sequence)
    .maybeSingle();
  if (readError || !existing) return "error";
  const same = existing.event_id === row.event_id &&
    existing.flow_id === row.flow_id && existing.sequence === row.sequence &&
    existing.surface === row.surface && existing.firm_id === row.firm_id &&
    existing.event_name === row.event_name && existing.stage === row.stage &&
    existing.step_index === row.step_index && existing.question_count === row.question_count &&
    existing.answer_mode === row.answer_mode && existing.is_revisit === row.is_revisit &&
    existing.locale === row.locale && existing.viewport_bucket === row.viewport_bucket &&
    existing.elapsed_ms === row.elapsed_ms;
  return same ? "duplicate" : "conflict";
}
