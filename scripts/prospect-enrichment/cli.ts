import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseProspectEnrichmentEnvelope } from "../../src/lib/prospect-enrichment-contract";
import { prospectEnrichmentIdempotencyKey } from "../../src/lib/prospect-enrichment-hash";
import { compileCandidate, type CompiledPackage } from "./compiler";
import { assertNoExclusionTokens, compileExclusionScoped, loadPrivateExclusions } from "./private-exclusions";
import { assertEnvelopeProfile, parseProfile, profileConfig, type EnrichmentProfile } from "./profiles";
import { assertWholeFirmManifestCoverage, compileWholeFirmSnapshot, freezeWholeFirmExport, type WholeFirmSourceManifest } from "./whole-firm";
import { snapshotCoordinatorState } from "./whole-firm-coordinator-export";
import { verifyAndSerializeComparisonExport } from "./comparison-export";
import { writeComparisonRequest } from "./comparison-request";
import { prepareManifestRequests, submitManifestChunks, assertManifestPackage } from "./manifest-delivery";
import { buildExpectedRunManifest, buildHeldCandidateEvidence, chunkExpectedRunManifest } from "./run-manifest";
import { archivedDocuments, extractCandidates, inventory, type SourceManifest } from "./inventory";
import { DEFAULT_OUTPUT, DEFAULT_ROOTS, object, protocolHash, sha256, within } from "./model";
import { checkApproval, enqueue, readEntry, readState, receiptStatus, submitOne, type DeliveryApproval } from "./outbox";
import { assertFreshComparison, bindReconciledPackages, reconcilePackage, researchClaimsAccepted, selectPilot, validateComparisonSnapshot, type ComparisonSnapshot, type ReconciledAction } from "./reconciliation";

const HELP = `Prospect enrichment local tools (dry-run by default)
  inventory [--profile legacy-backfill]
  inventory --profile whole-firm --file IMMUTABLE_COORDINATOR_EXPORT
  inventory --profile whole-firm --coordinator-state PATH
  compile --manifest FILE --run-dir DIR [--actions FILE] [--exclusions PRIVATE_FILE]
  comparison-request --manifest FILE --packages FILE --output FILE [--gzip]
  validate --file FILE
  reconcile --packages FILE --snapshot FILE --output FILE
  reconcile --export-comparison --file FILE --output FILE
  pilot --packages FILE --actions FILE --snapshot FILE --output FILE
  enqueue --file FILE --outbox DIR
  status --key KEY --outbox DIR
  submit --key KEY --outbox DIR --manifest-chunks FILE --held-evidence FILE --snapshot FILE
         --approval FILE --approval-sha256 HASH --token-file FILE
         --execute --confirm SUBMIT-APPROVED-PROSPECT-RESEARCH
  receipt --key KEY --outbox DIR --token-file FILE --execute
Whole-firm commands require --profile whole-firm and use a separate private D: output root.
Whole-firm submit additionally requires --manifest SOURCE_MANIFEST.
Use --manifest-only instead of --key only for whole-firm snapshots with zero packages. Default profile remains legacy-backfill.
submit registers the expected inventory and stages a package. It never reviews/applies canonical evidence.
Approval documents must record a real exact user authorization; a file alone does not grant it.`;
const valueFlags = new Set(["manifest", "run-dir", "file", "packages", "snapshot", "output", "key", "outbox", "approval", "approval-sha256", "token-file", "confirm", "actions", "manifest-chunks", "held-evidence", "profile", "coordinator-state", "exclusions"]);
function args(argv: string[]) {
  const [command = "help", ...rest] = argv, options: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--execute" || flag === "--export-comparison" || flag === "--manifest-only" || flag === "--gzip") { const name = flag.slice(2); if (name in options) throw Error("duplicate_cli_argument"); options[name] = true; continue; }
    if (!flag.startsWith("--") || !valueFlags.has(flag.slice(2)) || !rest[i + 1] || rest[i + 1].startsWith("--")) throw Error("invalid_cli_arguments");
    const name = flag.slice(2); if (name in options) throw Error("duplicate_cli_argument"); options[name] = rest[++i];
  }
  return { command, options };
}
const required = (options: Record<string, string | boolean>, key: string): string => { const value = options[key]; if (typeof value !== "string" || !value) throw Error(`missing_${key}`); return value; };
const json = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8"));
async function jsonl<T>(file: string): Promise<T[]> { return (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
function profileOutput(file: string, profile: EnrichmentProfile): string {
  if (!within(profileConfig(profile).outputRoot, file) || DEFAULT_ROOTS.some(r => within(r.path, file))) throw Error("output_must_be_in_profile_private_root");
  return path.resolve(file);
}
async function writeExactBytes(file: string, bytes: Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, bytes, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if (!(await fs.readFile(file)).equals(bytes)) throw Error("immutable_snapshot_bytes_conflict"); }
}
async function writeNew(file: string, content: string) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content, { flag: "wx" }); }
async function writeJsonl(file: string, values: unknown[]) { await writeNew(file, values.map(v => JSON.stringify(v)).join("\n") + (values.length ? "\n" : "")); }

export async function main(argv = process.argv.slice(2)): Promise<unknown> {
  const { command, options } = args(argv);
  const profile = parseProfile(options.profile), config = profileConfig(profile);
  const privateOutput = (file: string) => profileOutput(file, profile);
  if (command === "help" || command === "--help") return HELP;
  if (options.exclusions !== undefined && (command !== "compile" || profile !== "legacy-backfill")) throw Error("exclusions_cli_scope_invalid");
  if (options["coordinator-state"] !== undefined && (command !== "inventory" || profile !== "whole-firm")) throw Error("coordinator_state_input_scope_invalid");
  if (command === "inventory" && profile === "whole-firm") {
    if (options.file !== undefined && options["coordinator-state"] !== undefined) throw Error("whole_firm_inventory_inputs_mutually_exclusive");
    if (typeof options["coordinator-state"] === "string") return snapshotCoordinatorState({ statePath: options["coordinator-state"], outputRoot: privateOutput(config.outputRoot) });
    const file = required(options, "file"), bytes = await fs.readFile(file), exportSha = sha256(bytes);
    const archive = privateOutput(path.join(config.outputRoot, "exports", exportSha + ".json"));
    await writeExactBytes(archive, bytes);
    if (sha256(await fs.readFile(file)) !== exportSha) throw Error("source_changed_during_snapshot");
    const source = freezeWholeFirmExport(JSON.parse(bytes.toString("utf8")), exportSha);
    const runDir = privateOutput(path.join(config.outputRoot, "runs", source.manifestSha256));
    await writeExactBytes(path.join(runDir, "source-manifest.json"), Buffer.from(JSON.stringify(source, null, 2) + "\n"));
    return { profile, runDir, sourceManifestSha256: source.manifestSha256, expectedRevisionCount: source.expectedRevisionCount, sourceExportArchive: archive, networkRequests: 0 };
  }
  if (command === "inventory") {
    const manifest = await inventory({ outputRoot: DEFAULT_OUTPUT });
    const runDir = path.join(DEFAULT_OUTPUT, "runs", manifest.snapshotAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
    await fs.mkdir(path.dirname(runDir), { recursive: true }); await fs.mkdir(runDir);
    await writeNew(path.join(runDir, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeJsonl(path.join(runDir, "artifact-index.jsonl"), manifest.artifacts);
    return { runDir, manifestSha256: manifest.manifestSha256, artifacts: manifest.artifacts.length, issues: manifest.issues.length, networkRequests: 0 };
  }
  if (command === "compile" && profile === "whole-firm") {
    const source = await json<WholeFirmSourceManifest>(required(options, "manifest")), runDir = privateOutput(required(options, "run-dir"));
    const actions = typeof options.actions === "string" ? await jsonl<ReconciledAction>(options.actions) : undefined;
    const result = compileWholeFirmSnapshot(source, actions);
    const heldEvidence = buildHeldCandidateEvidence(result.expected, result.candidates);
    await writeNew(path.join(runDir, "expected-run-manifest.json"), JSON.stringify(result.expected, null, 2) + "\n");
    await writeJsonl(path.join(runDir, "expected-run-manifest-chunks.jsonl"), chunkExpectedRunManifest(result.expected, 100, 1_048_576, profile));
    await writeJsonl(path.join(runDir, "candidate-index.jsonl"), result.candidates);
    await writeJsonl(path.join(runDir, "held-candidate-evidence.jsonl"), heldEvidence);
    await writeJsonl(path.join(runDir, "normalized-packages.jsonl"), result.packages);
    await writeNew(path.join(runDir,"comparison-packages.json"),JSON.stringify(result.packages.map(p=>({envelope:p.envelope,payloadSha256:p.payloadSha256,legacyAssessmentProjectionClaims:p.legacyAssessmentProjectionClaims??[]})),null,2)+"\n");
    for (const p of result.packages) await writeNew(path.join(runDir, "packages", p.envelope.packageId + ".json"), JSON.stringify(p.envelope, null, 2) + "\n");
    await writeJsonl(path.join(runDir, "delivery-index.jsonl"), result.packages.map(p => ({ clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256, key: prospectEnrichmentIdempotencyKey(p.envelope.sourceSystem, p.envelope.runId, p.envelope.packageId), packageFile: path.join(runDir, "packages", p.envelope.packageId + ".json") })));
    await writeJsonl(path.join(runDir, "validation-errors.jsonl"), result.issues);
    const coverage = { profile, runId: result.expected.runId, sourceManifestSha256: source.manifestSha256, runManifestSha256: result.expected.manifestSha256, expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: result.expected.entries.length, packages: result.packages.length, nonPackageHolds: result.expected.entries.filter(e => e.clientPackageId === null).length, submitted: 0, applied: 0, visibleVerified: 0 };
    await writeNew(path.join(runDir, "coverage-report.json"), JSON.stringify(coverage, null, 2) + "\n");
    return coverage;
  }
  if (command === "compile") {
    const originalManifest = await json<SourceManifest>(required(options, "manifest")), runDir = privateOutput(required(options, "run-dir"));
    // Validate independent closed membership before any candidate archive is opened.
    const exclusions = typeof options.exclusions === "string" ? await loadPrivateExclusions(originalManifest, options.exclusions) : null;
    const manifest = exclusions?.source ?? originalManifest;
    const archived = await archivedDocuments(manifest);
    const scoped = exclusions ? compileExclusionScoped(exclusions, archived.documents, [...manifest.issues, ...archived.issues]) : null;
    const candidates = scoped?.candidates ?? [], packages: CompiledPackage[] = scoped?.packages ?? [], issues = scoped?.issues ?? [...manifest.issues, ...archived.issues];
    for (const document of scoped ? [] : archived.documents) {
      const extraction = extractCandidates(document); issues.push(...extraction.issues);
      for (const candidate of extraction.candidates) {
        const result = compileCandidate(candidate, manifest); packages.push(...result.packages); issues.push(...result.issues);
        candidates.push({ researchKey: result.researchKey, sourceRoot: candidate.artifact.sourceRoot, relativePath: candidate.artifact.relativePath, sourcePointer: candidate.pointer, sourceSha256: candidate.artifact.fileSha256, original: result.retainedOriginal, packageIds: result.packages.map(p => p.envelope.packageId), issues: result.issues });
      }
    }
    if (typeof options.actions === "string") {
      const rebound = bindReconciledPackages(packages, await jsonl<ReconciledAction>(options.actions));
      packages.splice(0, packages.length, ...rebound);
    }
    const expected = buildExpectedRunManifest(manifest, packages, candidates, issues);
    const heldEvidence = buildHeldCandidateEvidence(expected, candidates);
    if (exclusions && scoped) {
      assertNoExclusionTokens({ packages, candidates, issues, expected, heldEvidence }, exclusions);
      // These are local provenance artifacts, never package/held-evidence transport.
      await writeNew(path.join(runDir, "original-source-manifest.json"), JSON.stringify(originalManifest, null, 2) + "\n");
      await writeNew(path.join(runDir, "compile-source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      await writeNew(path.join(runDir, "exclusion-audit.json"), JSON.stringify(scoped.audit, null, 2) + "\n");
    }
    await writeNew(path.join(runDir, "expected-run-manifest.json"), JSON.stringify(expected, null, 2) + "\n");
    await writeJsonl(path.join(runDir, "expected-run-manifest-chunks.jsonl"), chunkExpectedRunManifest(expected));
    await writeJsonl(path.join(runDir, "candidate-index.jsonl"), candidates);
    await writeJsonl(path.join(runDir, "held-candidate-evidence.jsonl"), heldEvidence);
    await writeJsonl(path.join(runDir, "normalized-packages.jsonl"), packages);
    await writeNew(path.join(runDir,"comparison-packages.json"),JSON.stringify(packages.map(p=>({envelope:p.envelope,payloadSha256:p.payloadSha256,legacyAssessmentProjectionClaims:p.legacyAssessmentProjectionClaims??[]})),null,2)+"\n");
    await writeJsonl(path.join(runDir, "validation-errors.jsonl"), issues);
    await writeJsonl(path.join(runDir, "identity-reconciliation.jsonl"), packages.map(p => ({ packageId: p.envelope.packageId, ...p.envelope.subject })));
    // Later phase outputs are created only when their actual evidence exists; do not pre-create empty immutable files.
    const coverage = { manifestSha256: manifest.manifestSha256, ...(scoped ? { exclusionAudit: scoped.audit } : {}), sourceFiles: manifest.artifacts.length, candidates: candidates.length, distinctResearchKeys: new Set(candidates.map(c => c.researchKey)).size, packages: packages.length, observations: packages.reduce((n, p) => n + p.envelope.observations.length, 0), assessments: packages.filter(p => p.envelope.assessment).length, validationIssues: issues.length, submitted: 0, applied: 0, visibleVerified: 0 };
    await writeNew(path.join(runDir, "coverage-report.json"), `${JSON.stringify(coverage, null, 2)}\n`);
    await writeNew(path.join(runDir, "RUN_REPORT.md"), `# Offline backfill compilation\n\nManifest: ${manifest.manifestSha256}\n\n${candidates.length} candidate source events retained; ${packages.length} envelopes compiled; ${issues.length} issues/provenance notices.\n\nNo research submitted, imported or marked visible. Fresh operator reconciliation and exact approval remain required.\n`);
    return coverage;
  }
  if (command === "comparison-request") {
    if (Object.keys(options).some(key=>!["manifest","packages","output","profile","gzip"].includes(key))) throw Error("comparison_request_cli_scope_invalid");
    return writeComparisonRequest({manifestPath:required(options,"manifest"),packagesPath:required(options,"packages"),outputPath:privateOutput(required(options,"output")),profile,privateRoot:config.outputRoot,gzip:options.gzip===true});
  }
  if (command === "validate") {
    const value = await json<unknown>(required(options, "file"));
    const result = parseProspectEnrichmentEnvelope(object(value) ? value.envelope ?? value : value);
    if (result.ok) assertEnvelopeProfile(result.envelope, profile);
    return result.ok ? { valid: true, payloadSha256: protocolHash(result.envelope) } : { valid: false, issues: result.issues };
  }
  if (command === "reconcile" && options["export-comparison"] === true) {
    const result = verifyAndSerializeComparisonExport(await json<unknown>(required(options, "file")));
    await writeNew(privateOutput(required(options, "output")), result.body);
    return { snapshotSha256: result.snapshot.snapshotSha256, bodySha256: result.bodySha256, capturedAt: result.snapshot.capturedAt, networkRequests: 0 };
  }
  if (command === "reconcile") {
    const packages = await jsonl<CompiledPackage>(required(options, "packages")), snapshot = await json<ComparisonSnapshot>(required(options, "snapshot"));
    for (const p of packages) assertEnvelopeProfile(p.envelope, profile);
    const actions = packages.map(p => reconcilePackage(p, snapshot, { sourceClaimsAccepted: researchClaimsAccepted(p.envelope.originalResearch.content) }));
    await writeJsonl(privateOutput(required(options, "output")), actions);
    return { packages: actions.length, actions: actions.reduce<Record<string, number>>((counts, a) => { counts[a.action] = (counts[a.action] ?? 0) + 1; return counts; }, {}), networkRequests: 0 };
  }
  if (command === "pilot") {
    if (profile !== "legacy-backfill") throw Error("pilot_is_legacy_backfill_only");
    let packages = await jsonl<CompiledPackage>(required(options, "packages"));
    if (typeof options.actions === "string") packages = bindReconciledPackages(packages, await jsonl<ReconciledAction>(options.actions));
    const comparison = typeof options.snapshot === "string" ? await json<ComparisonSnapshot>(options.snapshot) : null;
    if (comparison && validateComparisonSnapshot(comparison).length) throw Error("fresh_pilot_comparison_required");
    const result = selectPilot(packages, comparison?.currentAssessments ?? []);
    await writeNew(privateOutput(required(options, "output")), `${JSON.stringify(result, null, 2)}\n`); return { ready: result.ready, candidates: result.selected.length, issues: result.issues };
  }
  if (command === "enqueue") {
    const value = await json<unknown>(required(options, "file"));
    const parsed = parseProspectEnrichmentEnvelope(object(value) ? value.envelope ?? value : value);
    if (!parsed.ok) throw Error("invalid_envelope");
    assertEnvelopeProfile(parsed.envelope, profile);
    const result = await enqueue(privateOutput(required(options, "outbox")), parsed.envelope);
    return { key: result.entry.key, payloadSha256: result.entry.payloadSha256, state: result.state.state, replay: result.replay, networkRequests: 0 };
  }
  if (command === "status") return readState(privateOutput(required(options, "outbox")), required(options, "key"));
  if (command === "submit" || command === "receipt") {
    const outbox = privateOutput(required(options, "outbox"));
    const manifestOnly = options["manifest-only"] === true;
    if (manifestOnly && (command !== "submit" || profile !== "whole-firm" || options.key !== undefined)) throw Error("manifest_only_scope_invalid");
    const key = manifestOnly ? null : required(options, "key");
    const comparison = command === "submit" ? await json<unknown>(required(options, "snapshot")) : null;
    if (command === "submit") assertFreshComparison(comparison);
    const manifestChunks = command === "submit" ? await jsonl<unknown>(required(options, "manifest-chunks")) : null;
    const heldEvidence = command === "submit" && typeof options["held-evidence"] === "string" ? await jsonl<unknown>(options["held-evidence"]) : [];
    const prepared = command === "submit" ? prepareManifestRequests(manifestChunks, profile, heldEvidence) : null;
    if (manifestOnly && prepared!.chunks[0].expectedPackageCount !== 0) throw Error("manifest_only_requires_zero_packages");
    const queued = command === "submit" && key ? await readEntry(outbox, key) : null;
    if (queued) assertEnvelopeProfile(queued.envelope, profile);
    if (prepared && queued) assertManifestPackage(prepared.chunks, queued);
    if (command === "submit" && profile === "whole-firm") assertWholeFirmManifestCoverage(await json<WholeFirmSourceManifest>(required(options, "manifest")), prepared!.chunks);
    if (options.execute !== true) return { dryRun: true, command, key, manifestRequests: prepared?.requests.length ?? 0, networkRequests: 0, requiredConfirmation: command === "submit" ? "SUBMIT-APPROVED-PROSPECT-RESEARCH" : null };
    let approval: DeliveryApproval | null = null;
    if (command === "submit") {
      const bytes = await fs.readFile(required(options, "approval"));
      if (sha256(bytes) !== required(options, "approval-sha256")) throw Error("approval_file_hash_mismatch");
      approval = JSON.parse(bytes.toString("utf8"));
      if (required(options, "confirm") !== "SUBMIT-APPROVED-PROSPECT-RESEARCH") throw Error("explicit_submission_confirmation_required");
      if (queued) checkApproval(queued, approval!, profile);
    }
    const token = (await fs.readFile(required(options, "token-file"), "utf8")).trim();
    if (command === "submit") {
      assertFreshComparison(comparison);
      const registration = await submitManifestChunks({ outbox, profile, chunks: prepared!.chunks, heldEvidence, approval: approval!, confirmation: required(options, "confirm"), token, beforeNetwork: () => assertFreshComparison(comparison) });
      if (registration.state !== "finalized" || manifestOnly) return { phase: "manifest_registration", ...registration };
      assertFreshComparison(comparison);
      const delivery = await submitOne({ outbox, key: key!, profile, approval: approval!, confirmation: required(options, "confirm"), token, beforeNetwork: () => assertFreshComparison(comparison) });
      return { phase: "package_delivery", manifest: registration, delivery };
    }
    return receiptStatus({ outbox, key: key!, token });
  }
  throw Error("unknown_command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(value => { process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`); }).catch(error => {
    // Never print request/response bodies, token contents or arbitrary fetch errors.
    const safe = error instanceof Error && /^[a-z0-9_:-]+$/.test(error.message) ? error.message : "prospect_enrichment_command_failed";
    process.stderr.write(`${safe}\n`); process.exitCode = 1;
  });
}
