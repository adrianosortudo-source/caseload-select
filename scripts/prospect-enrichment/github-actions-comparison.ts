import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { CASEY_MOSS_HELD_EVIDENCE_RECOVERY } from "./manifest-delivery";
import { canonicalJson, protocolHash } from "./model";
import { assertMachineOpenRunRecoveryBinding, verifyAndSerializeMachineComparisonExport } from "./comparison-export";
import { configuredComparisonTrust } from "./comparison-signature";

const repo = "adrianosortudo-source/caseload-select";
const audience = "caseload-prospect-comparison-read/v1";
const endpoint = "https://caseloadselect.ca/api/internal/prospect-enrichment/comparison-export/github-actions";
function required(name: string): string { const value = process.env[name]; if (!value) throw Error(`workflow_environment_${name.toLowerCase()}_missing`); return value; }

async function main() {
  const runId = required("GITHUB_RUN_ID"), runAttempt = required("GITHUB_RUN_ATTEMPT"), sha = required("GITHUB_SHA");
  if (!/^[1-9][0-9]{0,19}$/.test(runId) || !/^[1-9][0-9]{0,5}$/.test(runAttempt) || !/^[a-f0-9]{40}$/.test(sha) || required("GITHUB_REPOSITORY") !== repo || required("GITHUB_REF") !== "refs/heads/main" || required("GITHUB_EVENT_NAME") !== "workflow_dispatch") throw Error("workflow_run_binding_invalid");
  const fixture = JSON.parse(gunzipSync(await fs.readFile("scripts/prospect-enrichment/fixtures/casey-moss-held-recovery-source.json.gz")).toString("utf8"));
  const comparisonRequest = fixture?.comparisonRequest;
  if (!comparisonRequest || protocolHash(comparisonRequest) !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.comparisonRequestSha256 ||
      comparisonRequest.manifest.runId !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runId || comparisonRequest.manifest.sourceManifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.sourceManifestSha256 ||
      comparisonRequest.manifest.manifestSha256 !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.runManifestSha256 || comparisonRequest.packages.length !== CASEY_MOSS_HELD_EVIDENCE_RECOVERY.expectedPackageCount) throw Error("workflow_frozen_request_pin_mismatch");
  const tokenUrl = new URL(required("ACTIONS_ID_TOKEN_REQUEST_URL"));
  if (tokenUrl.protocol !== "https:" || tokenUrl.hostname !== "pipelines.actions.githubusercontent.com") throw Error("github_oidc_request_endpoint_invalid");
  tokenUrl.searchParams.set("audience", audience);
  const tokenResponse = await fetch(tokenUrl, { headers: { authorization: `Bearer ${required("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}` }, signal: AbortSignal.timeout(10_000) });
  if (!tokenResponse.ok) throw Error("github_oidc_token_request_failed");
  const tokenValue = await tokenResponse.json() as { value?: unknown };
  if (typeof tokenValue.value !== "string" || tokenValue.value.length > 16_384) throw Error("github_oidc_token_response_invalid");
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${tokenValue.value}`, "content-type": "application/json" }, body: canonicalJson(comparisonRequest) + "\n", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 32 * 1024 * 1024) throw Error(`comparison_read_failed_${response.status}`);
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (responseBytes.byteLength > 32 * 1024 * 1024) throw Error("comparison_read_response_too_large");
  let snapshot: Record<string, unknown>;
  try { snapshot = JSON.parse(Buffer.from(responseBytes).toString("utf8")) as Record<string, unknown>; }
  catch { throw Error("comparison_read_response_invalid"); }
  const verified = verifyAndSerializeMachineComparisonExport(snapshot, new Date().toISOString(), configuredComparisonTrust());
  assertMachineOpenRunRecoveryBinding(verified.snapshot, CASEY_MOSS_HELD_EVIDENCE_RECOVERY.comparisonRequestSha256);
  const provenance = verified.snapshot.provenance;
  if (provenance.sha !== sha || provenance.runId !== runId || provenance.runAttempt !== runAttempt || provenance.eventName !== "workflow_dispatch" ||
      provenance.repository !== repo || provenance.ref !== "refs/heads/main" || verified.snapshot.packages.length !== 0 || Object.hasOwn(provenance, "operatorAuthenticated")) throw Error("comparison_read_provenance_mismatch");
  const artifactPath = path.join(required("RUNNER_TEMP"), "casey-moss-bootstrap-comparison.json");
  await fs.writeFile(artifactPath, verified.body, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ outcome: "verified_read_only_comparison", snapshotSha256: verified.snapshot.snapshotSha256, bodySha256: verified.bodySha256, requestSha256: provenance.sourceArtifactSha256, runId, runAttempt, packageCount: 0 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "workflow_comparison_failed"); process.exitCode = 1; });
