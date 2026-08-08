/**
 * Phase 2.2 (Appendix B): create this week's publishing_packages row.
 * Ported from ToDelete/kit-create-package.mjs (Standing Rule 4): mirrors
 * createPackageManifest() in publishing-package-control-room-mutations.ts
 * (not imported -- server-only, Phase 0.3 -- mirrored instead), same insert
 * shape, same buildEventReceipt shape for the paired publishing_package_events
 * row.
 *
 * Idempotency adaptation (Standing Rule 8): the one-off script hard-STOPped
 * if a package already existed for the period, since it was never meant to
 * run twice. The reusable module instead returns a graceful skip -- required
 * so `run` performs zero writes on a re-run against an already-populated
 * week (Phase 2.4's regression proof), not a thrown error.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";
import type { RawManifest } from "./manifest";

export interface CreatePackageResult {
  status: "created" | "skipped";
  packageId: string;
  reason?: string;
}

export async function createPackage(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
  manifest: RawManifest,
): Promise<CreatePackageResult> {
  const { data: existing, error: existErr } = await supabase
    .from("publishing_packages")
    .select("id")
    .eq("firm_id", weekConfig.firmId)
    .eq("period_id", weekConfig.periodId);
  if (existErr) throw new Error(`existing-package check failed: ${existErr.message}`);
  if (existing && existing.length > 0) {
    return { status: "skipped", packageId: existing[0].id as string, reason: "already exists" };
  }

  const { data: periodRow, error: periodErr } = await supabase
    .from("content_periods")
    .select("id")
    .eq("id", weekConfig.periodId)
    .eq("firm_id", weekConfig.firmId)
    .maybeSingle();
  if (periodErr || !periodRow) throw new Error(`period lookup failed: ${periodErr?.message ?? "not found"}`);

  const manifestRevision = 1; // no prior rows, confirmed above
  const { data: pkg, error: insertErr } = await supabase
    .from("publishing_packages")
    .insert({
      firm_id: weekConfig.firmId,
      period_id: weekConfig.periodId,
      manifest_revision: manifestRevision,
      schema_version: 1,
      expected_piece_count: weekConfig.expectedPieceCount,
      status: "draft",
      manifest,
    })
    .select("id")
    .single();
  if (insertErr || !pkg) throw new Error(`package insert failed: ${insertErr?.message}`);

  const receipt = {
    operation_id: randomUUID(),
    package_id: pkg.id,
    period_id: weekConfig.periodId,
    firm_id: weekConfig.firmId,
    content_slot_id: null,
    deliverable_id: null,
    source_version_id: null,
    asset_id: null,
    filename: null,
    asset_role: null,
    destination: null,
    locale: null,
    expected_hash: null,
    computed_hash: null,
    previous_binding: null,
    resulting_binding: { manifest_revision: manifestRevision },
    actor_type: "operator",
    timestamp: new Date().toISOString(),
    outcome: "success",
    failure_reason: null,
  };
  const { error: eventErr } = await supabase.from("publishing_package_events").insert({
    package_id: pkg.id,
    firm_id: weekConfig.firmId,
    period_id: weekConfig.periodId,
    content_slot_id: null,
    asset_id: null,
    event_type: "manifest_created",
    actor_type: "operator",
    operation_id: receipt.operation_id,
    receipt,
  });
  if (eventErr) throw new Error(`event insert failed: ${eventErr.message}`);

  return { status: "created", packageId: pkg.id as string };
}
