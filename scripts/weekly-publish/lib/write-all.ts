/**
 * Phase 2.2: the `write` command's full chain (F2: "write -- all DB
 * population, idempotent"). Order: build the manifest (pure) -> create the
 * package -> register kit-asset candidates -> register publication
 * evidence -> activate period readiness. Every step is independently
 * idempotent (Standing Rule 8); a re-run against fully-populated state
 * performs zero writes end to end, which is Phase 2.4's regression proof.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";
import { buildManifest } from "./manifest";
import { createPackage } from "./package";
import { registerKitAssets, type RegisterKitAssetsResult } from "./kit-assets";
import { registerEvidence, type RegisterEvidenceResult } from "./register-evidence";
import { registerPdfEvidence, type RegisterPdfEvidenceResult } from "./register-pdf-evidence";
import { activateReadiness, type ActivateReadinessResult } from "./readiness";

export interface WriteAllResult {
  week: string;
  manifestOk: boolean;
  manifestErrors: { path: string; message: string }[];
  package: { status: string; packageId: string; reason?: string } | null;
  kitAssets: RegisterKitAssetsResult | null;
  evidence: RegisterEvidenceResult;
  pdfEvidence: RegisterPdfEvidenceResult;
  readiness: ActivateReadinessResult;
  totalWrites: number;
}

export async function runWriteAll(supabase: SupabaseClient, weekConfig: WeekConfig, root: string): Promise<WriteAllResult> {
  const manifestResult = await buildManifest(supabase, weekConfig);
  if (!manifestResult.ok || !manifestResult.manifest) {
    throw new Error(
      `manifest failed validation, cannot proceed: ${manifestResult.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  }

  const packageResult = await createPackage(supabase, weekConfig, manifestResult.manifest);
  const kitAssetsResult = await registerKitAssets(supabase, weekConfig, packageResult.packageId, manifestResult.manifest, root);
  const evidenceResult = await registerEvidence(supabase, weekConfig);
  const pdfEvidenceResult = await registerPdfEvidence(supabase, weekConfig);
  const readinessResult = await activateReadiness(supabase, weekConfig);

  const totalWrites =
    (packageResult.status === "created" ? 1 : 0) +
    kitAssetsResult.registered +
    evidenceResult.inserted +
    pdfEvidenceResult.inserted +
    (readinessResult.status === "activated" ? 1 : 0);

  return {
    week: weekConfig.week,
    manifestOk: manifestResult.ok,
    manifestErrors: manifestResult.errors,
    package: packageResult,
    kitAssets: kitAssetsResult,
    evidence: evidenceResult,
    pdfEvidence: pdfEvidenceResult,
    readiness: readinessResult,
    totalWrites,
  };
}
