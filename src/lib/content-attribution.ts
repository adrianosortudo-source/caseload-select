/**
 * Content Performance / Content-to-Matter Attribution -- I/O layer over
 * content_attribution_evidence and content_attribution_current (see
 * supabase/migrations/20260717030000_content_attribution_evidence.sql).
 *
 * This module never bypasses the database's own scope-validation or
 * append-only triggers; it exists to give routes friendlier error
 * messages before hitting them, and to centralise the shape callers
 * work with. The database remains the source of truth for ownership,
 * identity, and immutability enforcement.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type {
  AttributionEvidenceMethod,
  AttributionSelfReportCategory,
  AttributionState,
  ContentAttributionCurrent,
  ContentAttributionEvidence,
} from "@/lib/types";
import {
  deriveObservedEvidence,
  type ObservedLeadSignal,
  type PlacementMatchCandidate,
} from "@/lib/content-attribution-pure";

export interface RecordEvidenceInput {
  firmId: string;
  screenedLeadId: string;
  deliverableId?: string | null;
  deliverableVersionId?: string | null;
  placementId?: string | null;
  receiptId?: string | null;
  attributionState: AttributionState;
  evidenceMethod: AttributionEvidenceMethod;
  selfReportCategory?: AttributionSelfReportCategory | null;
  evidencePayload?: Record<string, unknown> | null;
  evidenceNote?: string | null;
  observedAt: string;
  recordedByRole: "system" | "operator" | "lawyer";
  recordedById?: string | null;
  recordedByName?: string | null;
  supersedesEvidenceId?: string | null;
}

/**
 * Inserts one evidence row. Never an UPDATE -- corrections pass
 * supersedesEvidenceId to insert a new row that supersedes an earlier
 * one; the database's own append-only trigger is the actual
 * enforcement, this function does not duplicate its logic.
 */
export async function recordAttributionEvidence(
  input: RecordEvidenceInput,
): Promise<{ ok: true; evidence: ContentAttributionEvidence } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_attribution_evidence")
    .insert({
      firm_id: input.firmId,
      screened_lead_id: input.screenedLeadId,
      deliverable_id: input.deliverableId ?? null,
      deliverable_version_id: input.deliverableVersionId ?? null,
      placement_id: input.placementId ?? null,
      receipt_id: input.receiptId ?? null,
      attribution_state: input.attributionState,
      evidence_method: input.evidenceMethod,
      self_report_category: input.selfReportCategory ?? null,
      evidence_payload: input.evidencePayload ?? null,
      evidence_note: input.evidenceNote ?? null,
      observed_at: input.observedAt,
      recorded_by_role: input.recordedByRole,
      recorded_by_id: input.recordedById ?? null,
      recorded_by_name: input.recordedByName ?? null,
      supersedes_evidence_id: input.supersedesEvidenceId ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, evidence: data as ContentAttributionEvidence };
}

export async function listEvidenceForLead(
  firmId: string,
  screenedLeadId: string,
): Promise<ContentAttributionEvidence[]> {
  const { data, error } = await supabase
    .from("content_attribution_evidence")
    .select("*")
    .eq("firm_id", firmId)
    .eq("screened_lead_id", screenedLeadId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not load attribution evidence: ${error.message}`);
  return (data ?? []) as ContentAttributionEvidence[];
}

export async function getCurrentAttributionForLead(
  firmId: string,
  screenedLeadId: string,
): Promise<ContentAttributionCurrent | null> {
  const { data, error } = await supabase
    .from("content_attribution_current")
    .select("*")
    .eq("firm_id", firmId)
    .eq("screened_lead_id", screenedLeadId)
    .maybeSingle();
  if (error) throw new Error(`could not load current attribution: ${error.message}`);
  return (data as ContentAttributionCurrent | null) ?? null;
}

export async function listCurrentAttributionForDeliverable(
  firmId: string,
  deliverableId: string,
): Promise<ContentAttributionCurrent[]> {
  const { data, error } = await supabase
    .from("content_attribution_current")
    .select("*")
    .eq("firm_id", firmId)
    .eq("deliverable_id", deliverableId);
  if (error) throw new Error(`could not load current attribution: ${error.message}`);
  return (data ?? []) as ContentAttributionCurrent[];
}

export async function listCurrentAttributionForFirm(
  firmId: string,
  range?: { fromIso?: string; toIso?: string },
): Promise<ContentAttributionCurrent[]> {
  let query = supabase.from("content_attribution_current").select("*").eq("firm_id", firmId);
  if (range?.fromIso) query = query.gte("observed_at", range.fromIso);
  if (range?.toIso) query = query.lte("observed_at", range.toIso);
  const { data, error } = await query;
  if (error) throw new Error(`could not load current attribution: ${error.message}`);
  return (data ?? []) as ContentAttributionCurrent[];
}

/**
 * Normalizes a screened lead's already-captured UTM/referrer fields into
 * an attribution evidence row, deterministic-matched against the firm's
 * placements (see deriveObservedEvidence). Idempotent: if a
 * verified_utm/observed_referrer row already exists for this lead, this
 * is a no-op (returns null) rather than inserting a duplicate on repeat
 * calls. Returns null when there is nothing to normalize or nothing new
 * to record.
 */
export async function syncObservedEvidenceForLead(
  firmId: string,
  screenedLeadId: string,
): Promise<{ ok: true; evidence: ContentAttributionEvidence } | { ok: true; evidence: null } | { ok: false; error: string }> {
  const { data: lead, error: leadError } = await supabase
    .from("screened_leads")
    .select("id, firm_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, submitted_at, created_at")
    .eq("id", screenedLeadId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (leadError) return { ok: false, error: leadError.message };
  if (!lead) return { ok: false, error: "screened lead not found for this firm" };

  const existing = await listEvidenceForLead(firmId, screenedLeadId);
  const alreadyObserved = existing.some(
    (e) => e.evidence_method === "verified_utm" || e.evidence_method === "observed_referrer",
  );
  if (alreadyObserved) return { ok: true, evidence: null };

  const { data: placementRows, error: placementError } = await supabase
    .from("content_placements")
    .select("id, deliverable_id")
    .eq("firm_id", firmId);
  if (placementError) return { ok: false, error: placementError.message };

  const signal: ObservedLeadSignal = {
    utmSource: lead.utm_source,
    utmMedium: lead.utm_medium,
    utmCampaign: lead.utm_campaign,
    utmTerm: lead.utm_term,
    utmContent: lead.utm_content,
    referrer: lead.referrer,
    observedAt: lead.submitted_at ?? lead.created_at,
  };
  const placements: PlacementMatchCandidate[] = (placementRows ?? []).map((p) => ({
    id: p.id as string,
    deliverableId: p.deliverable_id as string,
  }));

  const derived = deriveObservedEvidence(signal, placements);
  if (!derived) return { ok: true, evidence: null };

  return recordAttributionEvidence({
    firmId,
    screenedLeadId,
    deliverableId: derived.deliverableId,
    placementId: derived.placementId,
    attributionState: derived.attributionState,
    evidenceMethod: derived.evidenceMethod,
    evidencePayload: derived.evidencePayload,
    observedAt: derived.observedAt,
    recordedByRole: "system",
  });
}
