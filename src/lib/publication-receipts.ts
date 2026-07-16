/**
 * Content Studio publishing evidence system, Workstream 5: publication
 * receipts. I/O layer over the append-only publication_receipts table
 * (see supabase/migrations/20260715130200_publication_receipts.sql).
 *
 * "Published requires a receipt" (mega-assignment doctrine): nothing in
 * this module infers publication from a deliverable's own status or
 * publish_date. A receipt is created only when the caller supplies
 * evidence (a public URL, an external post ID, or an attestation) and the
 * approved_version_id it binds to. The database's own append-only trigger
 * is the actual enforcement; no update/delete function exists here because
 * none should ever exist -- a correction is a NEW receipt referencing the
 * one it corrects via reconciles_receipt_id.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type {
  PublicationReceipt,
  PlacementDestination,
  ReceiptVerificationMethod,
} from "@/lib/types";

const ASSET_BUCKET = "firm-files";
const SIGNED_URL_TTL = 3600;

export interface CreateReceiptInput {
  firmId: string;
  periodId?: string | null;
  deliverableId: string;
  placementId: string;
  destination: PlacementDestination;
  locale?: string | null;
  approvedVersionId: string;
  // Workstream 1: every root receipt this function creates must bind to the
  // exact active placement claim it publishes under -- the database enforces
  // this via a NOT NULL-when-root CHECK plus the validate_publication_
  // receipt_scope trigger, but the caller (the receipts route) resolves and
  // validates the claim before calling here so the failure is a clean
  // 409/422, not a raw Postgres exception.
  claimId: string;
  artifactId?: string | null;
  publicUrl?: string | null;
  externalPostId?: string | null;
  publishedAt: string;
  actorRole: "operator" | "lawyer" | "system";
  actorId?: string | null;
  actorName?: string | null;
  reconcilesReceiptId?: string | null;
}

/**
 * Records that a placement was published. Verification is a separate,
 * later step (verifyReceipt below); a fresh receipt always starts
 * 'unverified' -- a URL or ID alone is evidence of an ATTEMPT, not proof
 * the live result was checked.
 */
export async function createReceipt(
  input: CreateReceiptInput,
): Promise<{ ok: true; receipt: PublicationReceipt } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("publication_receipts")
    .insert({
      firm_id: input.firmId,
      period_id: input.periodId ?? null,
      deliverable_id: input.deliverableId,
      placement_id: input.placementId,
      destination: input.destination,
      locale: input.locale ?? null,
      approved_version_id: input.approvedVersionId,
      claim_id: input.claimId,
      artifact_id: input.artifactId ?? null,
      // artifact_sha256 is intentionally never set from caller input here --
      // it is server-trusted only, derived by the DB trigger from
      // publication_artifacts.sha256 when artifact_id is bound (workstream
      // 4: a caller-supplied hash must never become trusted evidence).
      public_url: input.publicUrl ?? null,
      external_post_id: input.externalPostId ?? null,
      published_at: input.publishedAt,
      actor_role: input.actorRole,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      reconciles_receipt_id: input.reconcilesReceiptId ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, receipt: data as PublicationReceipt };
}

export interface VerifyReceiptInput {
  method: ReceiptVerificationMethod;
  passed: boolean;
  failureReason?: string | null;
  evidenceStoragePath?: string | null;
  // Workstream 5: who actually ran this verification. Previously this
  // function copied actor_role/actor_id/actor_name from the ORIGINAL
  // receipt, so every verification -- regardless of who genuinely
  // performed it -- was permanently misattributed to whoever originally
  // published the receipt (which could be a different operator, or
  // 'system' for a channel-originated receipt). The caller (the verify
  // route) is responsible for resolving the real, currently-authenticated
  // actor and supplying it here, the same way deactivatePeriodReadiness
  // requires its own explicit actor param rather than inferring one.
  verifierRole: "operator" | "lawyer" | "system";
  verifierId?: string | null;
  verifierName?: string | null;
}

/**
 * Verification is recorded by inserting a NEW receipt that reconciles the
 * one being checked (reconciles_receipt_id), never by mutating the
 * original row -- publication_receipts is append-only end to end,
 * including its own verification history. This preserves "a correction
 * creates new evidence, it does not silently alter history" even for the
 * verification pass itself.
 */
export async function verifyReceipt(
  originalReceiptId: string,
  verification: VerifyReceiptInput,
): Promise<{ ok: true; receipt: PublicationReceipt } | { ok: false; error: string }> {
  const { data: original, error: loadError } = await supabase
    .from("publication_receipts")
    .select("*")
    .eq("id", originalReceiptId)
    .maybeSingle();
  if (loadError) return { ok: false, error: loadError.message };
  if (!original) return { ok: false, error: "receipt not found" };

  const o = original as PublicationReceipt;
  const { data, error } = await supabase
    .from("publication_receipts")
    .insert({
      firm_id: o.firm_id,
      period_id: o.period_id,
      deliverable_id: o.deliverable_id,
      placement_id: o.placement_id,
      destination: o.destination,
      locale: o.locale,
      approved_version_id: o.approved_version_id,
      artifact_id: o.artifact_id,
      artifact_sha256: o.artifact_sha256,
      public_url: o.public_url,
      external_post_id: o.external_post_id,
      published_at: o.published_at,
      actor_role: verification.verifierRole,
      actor_id: verification.verifierId ?? null,
      actor_name: verification.verifierName ?? null,
      verification_state: verification.passed ? "verified" : "failed",
      verified_at: new Date().toISOString(),
      verification_method: verification.method,
      evidence_storage_bucket: verification.evidenceStoragePath ? ASSET_BUCKET : null,
      evidence_storage_path: verification.evidenceStoragePath ?? null,
      failure_reason: verification.passed ? null : (verification.failureReason ?? "verification failed"),
      reconciles_receipt_id: originalReceiptId,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, receipt: data as PublicationReceipt };
}

async function signEvidence(r: PublicationReceipt): Promise<PublicationReceipt> {
  if (!r.evidence_storage_path) return r;
  const { data } = await supabase.storage
    .from(r.evidence_storage_bucket ?? ASSET_BUCKET)
    .createSignedUrl(r.evidence_storage_path, SIGNED_URL_TTL);
  return { ...r, evidence_signed_url: data?.signedUrl ?? undefined };
}

export async function getReceiptById(receiptId: string): Promise<PublicationReceipt | null> {
  const { data, error } = await supabase
    .from("publication_receipts")
    .select("*")
    .eq("id", receiptId)
    .maybeSingle();
  if (error) throw new Error(`could not load receipt: ${error.message}`);
  if (!data) return null;
  return signEvidence(data as PublicationReceipt);
}

export async function listReceiptsForDeliverable(deliverableId: string): Promise<PublicationReceipt[]> {
  const { data, error } = await supabase
    .from("publication_receipts")
    .select("*")
    .eq("deliverable_id", deliverableId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`could not load receipts: ${error.message}`);
  const rows = (data ?? []) as PublicationReceipt[];
  return Promise.all(rows.map(signEvidence));
}

export async function listReceiptsForPlacement(placementId: string): Promise<PublicationReceipt[]> {
  const { data, error } = await supabase
    .from("publication_receipts")
    .select("*")
    .eq("placement_id", placementId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`could not load receipts: ${error.message}`);
  const rows = (data ?? []) as PublicationReceipt[];
  return Promise.all(rows.map(signEvidence));
}

/**
 * The current, authoritative receipt for a placement: the most recent row
 * in the reconciliation chain rooted at the placement's root receipt FOR
 * approvedVersionId (a receipt with no other receipt pointing back at it via
 * reconciles_receipt_id, i.e. the tip of that chain). Used by the
 * preflight/export layer to answer "is this placement actually published
 * for its current approved version, and was it verified" without the caller
 * re-deriving the reconciliation chain itself.
 *
 * Workstream 2: scoped by approvedVersionId, not just placementId -- a
 * placement's receipt history can now contain root receipts for more than
 * one approved version (a later version republishing after an earlier one
 * was verified), so "the tip of ALL receipts for this placement" would pick
 * up a stale prior version's chain. When approvedVersionId is omitted the
 * unscoped tip-of-everything behavior is preserved for callers that
 * genuinely want the whole history (e.g. an audit view).
 */
export async function getCurrentReceiptForPlacement(
  placementId: string,
  approvedVersionId?: string | null,
): Promise<PublicationReceipt | null> {
  const all = await listReceiptsForPlacement(placementId);
  return currentReceiptFromChain(all, approvedVersionId);
}

function currentReceiptFromChain(
  receipts: PublicationReceipt[],
  approvedVersionId?: string | null,
): PublicationReceipt | null {
  if (receipts.length === 0) return null;
  const scoped = approvedVersionId
    ? receipts.filter((r) => r.approved_version_id === approvedVersionId)
    : receipts;
  if (scoped.length === 0) return null;
  const reconciledIds = new Set(
    scoped.map((r) => r.reconciles_receipt_id).filter((id): id is string => id !== null),
  );
  const tip = scoped.find((r) => !reconciledIds.has(r.id));
  return tip ?? scoped[0];
}

/**
 * The current receipt per placement for every placement belonging to one
 * deliverable, in a single query. Used by the preflight report (Workstream
 * 7), which needs this for every placement on every active deliverable in
 * a period and cannot afford an N+1 fetch per placement.
 *
 * approvedVersionId scopes each placement's chain lookup to that specific
 * version (see currentReceiptFromChain) -- pass the deliverable's OWN
 * current approved_version_id, not an arbitrary/historical one, so a
 * verified receipt from a superseded version never masks readiness for the
 * version actually up for publication now.
 */
export async function listCurrentReceiptsByPlacementForDeliverable(
  deliverableId: string,
  approvedVersionId: string | null,
): Promise<Record<string, PublicationReceipt | null>> {
  const { data, error } = await supabase
    .from("publication_receipts")
    .select("*")
    .eq("deliverable_id", deliverableId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`could not load receipts: ${error.message}`);
  const rows = (data ?? []) as PublicationReceipt[];
  const byPlacement = new Map<string, PublicationReceipt[]>();
  for (const r of rows) {
    const list = byPlacement.get(r.placement_id) ?? [];
    list.push(r);
    byPlacement.set(r.placement_id, list);
  }
  const result: Record<string, PublicationReceipt | null> = {};
  for (const [placementId, list] of byPlacement) {
    result[placementId] = currentReceiptFromChain(list, approvedVersionId);
  }
  return result;
}
