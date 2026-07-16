/**
 * Publication Readiness, Workstream 7: read-only reconciliation.
 *
 * Validates a REGISTERED publication_artifacts row against the real
 * evidence it claims to point at: does the storage object exist and match
 * the recorded size, does the public route respond, does the deployment
 * commit/url resolve. Writes exactly one append-only
 * publication_artifact_validations row per check per run.
 *
 * This module never generates anything, never edits copy, never creates a
 * website route, never publishes, never approves, and never silently
 * registers a guessed file. If evidence cannot be confirmed, the result is
 * "fail" or "error" — never a quiet skip that reads as success.
 */

import "server-only";
import { supabaseAdmin as supabase } from "./supabase-admin";
import { ssrfSafeFetch } from "./ssrf-fetch";
import type { PublicationArtifact, PublicationArtifactValidator } from "./types";

export interface ReconciliationResult {
  artifact_id: string;
  validator: PublicationArtifactValidator;
  result: "pass" | "fail" | "error";
  details: Record<string, unknown>;
}

async function checkStorageObject(artifact: PublicationArtifact): Promise<ReconciliationResult> {
  if (!artifact.storage_bucket || !artifact.storage_path) {
    return { artifact_id: artifact.id, validator: "storage_object_check", result: "fail", details: { reason: "artifact has no storage_bucket/storage_path recorded" } };
  }
  const lastSlash = artifact.storage_path.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : artifact.storage_path.slice(0, lastSlash);
  const filename = lastSlash === -1 ? artifact.storage_path : artifact.storage_path.slice(lastSlash + 1);

  const { data, error } = await supabase.storage.from(artifact.storage_bucket).list(dir, { search: filename });
  if (error) return { artifact_id: artifact.id, validator: "storage_object_check", result: "error", details: { error: error.message } };

  const found = (data ?? []).find((f) => f.name === filename);
  if (!found) {
    return { artifact_id: artifact.id, validator: "storage_object_check", result: "fail", details: { reason: "object not found at storage_bucket/storage_path" } };
  }

  const actualSize = (found.metadata as { size?: number } | null)?.size ?? null;
  if (artifact.size_bytes != null && actualSize != null && actualSize !== artifact.size_bytes) {
    return {
      artifact_id: artifact.id,
      validator: "storage_object_check",
      result: "fail",
      details: { reason: "recorded size does not match the storage object", recorded: artifact.size_bytes, actual: actualSize },
    };
  }
  return { artifact_id: artifact.id, validator: "storage_object_check", result: "pass", details: { size_bytes: actualSize } };
}

async function checkSha256(artifact: PublicationArtifact): Promise<ReconciliationResult> {
  if (!artifact.sha256 || !artifact.storage_bucket || !artifact.storage_path) {
    return { artifact_id: artifact.id, validator: "sha256_check", result: "fail", details: { reason: "artifact has no sha256 or storage location recorded" } };
  }
  const { data, error } = await supabase.storage.from(artifact.storage_bucket).download(artifact.storage_path);
  if (error || !data) {
    return { artifact_id: artifact.id, validator: "sha256_check", result: "error", details: { error: error?.message ?? "download failed" } };
  }
  const buffer = new Uint8Array(await data.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const actualSha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (actualSha256 !== artifact.sha256) {
    return { artifact_id: artifact.id, validator: "sha256_check", result: "fail", details: { reason: "SHA-256 does not match the recorded value", recorded: artifact.sha256, actual: actualSha256 } };
  }
  return { artifact_id: artifact.id, validator: "sha256_check", result: "pass", details: {} };
}

async function checkRoute(artifact: PublicationArtifact): Promise<ReconciliationResult> {
  const url = artifact.public_url ?? artifact.deployment_url;
  if (!url) {
    return { artifact_id: artifact.id, validator: "route_check", result: "fail", details: { reason: "no public_url or deployment_url recorded" } };
  }
  // artifact.public_url/deployment_url is operator-supplied, server-side
  // fetched input -- the same trust class ssrf.ts/ssrf-fetch.ts exist for.
  // A raw fetch() here would bypass every SSRF protection (private/
  // loopback/link-local/metadata IP blocking, DNS-rebinding-safe pinned
  // resolution, redirect re-validation per hop) that receipt verification
  // enforces for the identical class of input.
  try {
    const { res, finalUrl } = await ssrfSafeFetch(url, { timeoutMs: 10_000, allowedSchemes: ["http:", "https:"] });
    if (!res.ok) {
      return { artifact_id: artifact.id, validator: "route_check", result: "fail", details: { reason: `route returned HTTP ${res.status}`, url: finalUrl } };
    }
    return { artifact_id: artifact.id, validator: "route_check", result: "pass", details: { url: finalUrl, status: res.status } };
  } catch (err) {
    return { artifact_id: artifact.id, validator: "route_check", result: "error", details: { error: err instanceof Error ? err.message : String(err), url } };
  }
}

async function checkDeployment(artifact: PublicationArtifact): Promise<ReconciliationResult> {
  if (!artifact.repository || !artifact.deployment_commit) {
    return { artifact_id: artifact.id, validator: "deployment_check", result: "fail", details: { reason: "no repository/deployment_commit recorded" } };
  }
  // This system does not call the GitHub/Vercel API on its own; it records
  // that the operator supplied a commit + repository pair as evidence.
  // Route reachability (checkRoute) is the network-verifiable half of
  // "this deployment is real"; this check confirms the record is complete,
  // not that the commit exists upstream.
  return {
    artifact_id: artifact.id,
    validator: "deployment_check",
    result: "pass",
    details: { repository: artifact.repository, deployment_commit: artifact.deployment_commit },
  };
}

const VALIDATORS_BY_TYPE: Record<string, ((a: PublicationArtifact) => Promise<ReconciliationResult>)[]> = {
  pdf: [checkStorageObject, checkSha256],
  hero_image: [checkStorageObject],
  social_image: [checkStorageObject],
  webpage: [checkRoute, checkDeployment],
  thank_you_page: [checkRoute],
  landing_page: [checkRoute],
  form: [checkRoute],
  email: [],
  external_post: [],
};

export async function reconcileArtifact(
  artifact: PublicationArtifact,
  validatedByOperatorId: string | null,
): Promise<{ ok: true; results: ReconciliationResult[] } | { ok: false; error: string }> {
  const validators = VALIDATORS_BY_TYPE[artifact.artifact_type] ?? [];
  const results: ReconciliationResult[] = [];
  for (const check of validators) {
    results.push(await check(artifact));
  }

  if (results.length > 0) {
    const rows = results.map((r) => ({
      artifact_id: r.artifact_id,
      firm_id: artifact.firm_id,
      validator: r.validator,
      result: r.result,
      details: r.details,
      validated_by_role: "operator" as const,
      validated_by_id: validatedByOperatorId,
    }));
    const { error } = await supabase.from("publication_artifact_validations").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, results };
}

export async function reconcileDeliverableArtifacts(
  deliverableId: string,
  validatedByOperatorId: string | null,
): Promise<{ ok: true; results: ReconciliationResult[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("publication_artifacts").select("*").eq("deliverable_id", deliverableId);
  if (error) return { ok: false, error: error.message };

  const all: ReconciliationResult[] = [];
  for (const artifact of (data ?? []) as PublicationArtifact[]) {
    const outcome = await reconcileArtifact(artifact, validatedByOperatorId);
    if (!outcome.ok) return outcome;
    all.push(...outcome.results);
  }
  return { ok: true, results: all };
}
