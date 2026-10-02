import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prospectEnrichmentIdempotencyKey } from "../../src/lib/prospect-enrichment-hash";
import { canonicalJson, object, ordinal, sha256, within } from "./model";
import { WHOLE_FIRM_PROFILE } from "./profiles";
import { compileWholeFirmSnapshot, freezeWholeFirmExport, type WholeFirmSourceManifest } from "./whole-firm";
import { buildHeldCandidateEvidence, chunkExpectedRunManifest } from "./run-manifest";
import { serializeComparisonRequest } from "./comparison-request";
import { capturePublicSource, loadPublicCapture, parsePublicCaptureRequest } from "./public-source-capture";
import { buildPublicVerificationExport } from "./public-source-verification";

const HELP = `Public-source evidence tools for future whole-firm research
  capture --request REQUEST_JSON [--output-root PRIVATE_DIR]
  capture --request REQUEST_JSON [--output-root PRIVATE_DIR] --execute --confirm CAPTURE-PUBLIC-SOURCE
  prepare --receipt CAPTURE_RECEIPT --receipt-sha256 HASH --facts VERIFIED_FACTS_JSON
          [--output-root PRIVATE_DIR] --confirm VERIFIED-PUBLIC-FACTS
  handoff --receipt CAPTURE_RECEIPT --receipt-sha256 HASH --facts VERIFIED_FACTS_JSON
          [--output-root PRIVATE_DIR] --confirm VERIFIED-PUBLIC-FACTS
Capture defaults to a network-free request check. Prepare writes an immutable local export.
Handoff prepares that export and the standard compiler artifacts, pending protected Admin intake.
These tools do not contact Admin, resolve firm identity, review/apply research, or change qualification.
VERIFIED-PUBLIC-FACTS means the researcher checked the claim against the saved body;
a matching quote alone does not establish the truth of a typed claim.
The default private output is under the whole-firm D: output root.`;
const HASH = /^[a-f0-9]{64}$/;
const MAX_FACTS_BYTES = 2_097_152;
type Preparation = {
  schemaVersion: "prospect-public-verification-preparation/v1";
  inputKey: string;
  captureReceiptPath: string;
  captureReceiptSha256: string;
  factsSourcePath: string;
  factsSourceSha256: string;
  factsArchive: string;
  snapshotAt: string;
  exportPath: string;
  exportSha256: string;
  sourceManifestPath: string;
  sourceManifestSha256: string;
  sourceManifestFileSha256: string;
  supportedFactCount: number;
  heldFactCount: number;
  issues: unknown[];
};

export type PublicSourceHandoffCheckpoint = {
  schemaVersion: "prospect-public-source-handoff/v1";
  state: "prepared-pending-admin";
  preparationPath: string;
  preparationSha256: string;
  sourceManifestPath: string;
  sourceManifestSha256: string;
  sourceManifestFileSha256: string;
  snapshotAt: string;
  runId: string;
  runManifestSha256: string;
  artifacts: { relativePath: string; path: string; sha256: string; bytes: number }[];
  counts: {
    expectedRevisionCount: number; accountedRevisionCount: number; packages: number; nonPackageHolds: number;
    heldCandidateEvidence: number; supportedFactCount: number; heldFactCount: number; validationIssues: number;
  };
  networkRequests: 0;
  submitted: 0;
  applied: 0;
  visibleVerified: 0;
};

type HandoffHold = {
  schemaVersion: "prospect-public-source-handoff-hold/v1";
  state: "technical-hold";
  preparationPath: string;
  preparationSha256: string;
  handoffDir: string;
  snapshotAt: string;
  reason: string;
  networkRequests: 0;
  submitted: 0;
  applied: 0;
  visibleVerified: 0;
};
type PreparedVerification = Awaited<ReturnType<typeof preparePublicVerification>>;
const HANDOFF_HOLD_CODES = new Set([
  "public_handoff_publication_incomplete", "public_handoff_artifact_invalid", "public_handoff_artifact_missing",
  "public_handoff_artifact_set_mismatch", "public_handoff_checkpoint_conflict", "public_handoff_source_changed",
  "public_handoff_path_invalid", "public_handoff_preparation_failed",
]);

function parseArgs(argv: string[]) {
  const [command = "help", ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--execute") {
      if ("execute" in options) throw Error("duplicate_cli_argument");
      options.execute = true;
      continue;
    }
    if (!["--request", "--output-root", "--confirm", "--receipt", "--receipt-sha256", "--facts"].includes(flag)
      || !rest[i + 1] || rest[i + 1].startsWith("--")) throw Error("invalid_cli_arguments");
    const key = flag.slice(2);
    if (key in options) throw Error("duplicate_cli_argument");
    options[key] = rest[++i];
  }
  return { command, options };
}

function required(options: Record<string, string | boolean>, key: string) {
  const value = options[key];
  if (typeof value !== "string" || !value) throw Error("missing_" + key);
  return value;
}

async function privateRoot(profileRoot: string, outputRoot: string) {
  const root = path.resolve(profileRoot), output = path.resolve(outputRoot);
  if (!within(root, output)) throw Error("output_must_be_in_whole_firm_private_root");
  // Reject existing junction/symlink ancestors that redirect these private writes.
  for (let cursor = output; ; cursor = path.dirname(cursor)) {
    try {
      if (path.resolve(await fs.realpath(cursor)).toLowerCase() !== cursor.toLowerCase())
        throw Error("output_path_redirected");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (path.dirname(cursor) === cursor) break;
  }
  return output;
}

async function writeImmutable(file: string, bytes: Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await privateRoot(path.dirname(file), path.dirname(file));
  try {
    const handle = await fs.open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length)
      throw Error("public_preparation_artifact_conflict");
    if (!(await fs.readFile(file)).equals(bytes)) throw Error("public_preparation_artifact_conflict");
  }
}

async function boundedInput(file: string) {
  const real = await fs.realpath(file), stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_FACTS_BYTES) throw Error("public_input_body_limit");
  const bytes = await fs.readFile(real);
  if (bytes.length > MAX_FACTS_BYTES) throw Error("public_input_body_limit");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")); }
  catch { throw Error("public_input_json_invalid"); }
  return { file: real, bytes, value, digest: sha256(bytes) };
}

function preparedPaths(root: string, inputKey: string) {
  return {
    preparationPath: path.join(root, "preparations", inputKey + ".json"),
    factsArchive: path.join(root, "facts", inputKey + ".json"),
  };
}

/** Local replay is bound to exact input files and byte hashes, never a new export time. */
export async function preparePublicVerification(options: {
  receiptPath: string; receiptSha256: string; factsPath: string; outputRoot: string;
  now?: () => Date;
}) {
  if (!HASH.test(options.receiptSha256)) throw Error("capture_receipt_hash_invalid");
  const capture = await loadPublicCapture(options.receiptPath, options.receiptSha256);
  const facts = await boundedInput(options.factsPath);
  const root = path.resolve(options.outputRoot);
  await privateRoot(root, root);
  const inputKey = sha256(canonicalJson([
    "public-verification-preparation/v1", capture.receiptPath, capture.receiptSha256, facts.file, facts.digest,
  ]));
  const { preparationPath, factsArchive } = preparedPaths(root, inputKey);
  let prior: Preparation | null = null;
  try {
    await privateRoot(root, path.dirname(preparationPath));
    const value: unknown = (await boundedInput(preparationPath)).value;
    if (!object(value) || value.schemaVersion !== "prospect-public-verification-preparation/v1"
      || value.inputKey !== inputKey || value.captureReceiptPath !== capture.receiptPath
      || value.captureReceiptSha256 !== capture.receiptSha256 || value.factsSourcePath !== facts.file
      || value.factsSourceSha256 !== facts.digest || value.factsArchive !== factsArchive
      || typeof value.snapshotAt !== "string") throw Error("public_preparation_checkpoint_invalid");
    prior = value as Preparation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const snapshotAt = prior?.snapshotAt ?? (options.now?.() ?? new Date()).toISOString();
  const built = buildPublicVerificationExport({
    ...capture, facts: facts.value, snapshotAt,
    factsSourcePath: facts.file, factsSourceSha256: facts.digest,
  });
  const exportBytes = Buffer.from(canonicalJson(built.exported) + "\n");
  const exportSha256 = sha256(exportBytes);
  const exported = freezeWholeFirmExport(built.exported, exportSha256);
  const manifestBytes = Buffer.from(JSON.stringify(exported, null, 2) + "\n");
  const exportPath = path.join(root, "exports", exportSha256 + ".json");
  const sourceManifestPath = path.join(root, "runs", exported.manifestSha256, "source-manifest.json");
  const prepared: Preparation = {
    schemaVersion: "prospect-public-verification-preparation/v1", inputKey,
    captureReceiptPath: capture.receiptPath, captureReceiptSha256: capture.receiptSha256,
    factsSourcePath: facts.file, factsSourceSha256: facts.digest, factsArchive, snapshotAt,
    exportPath, exportSha256, sourceManifestPath, sourceManifestSha256: exported.manifestSha256,
    sourceManifestFileSha256: sha256(manifestBytes), supportedFactCount: built.supportedFactCount,
    heldFactCount: built.heldFactCount, issues: built.issues,
  };
  if (prior) {
    if (canonicalJson(prior) !== canonicalJson(prepared)) throw Error("public_preparation_checkpoint_conflict");
    for (const [file, expected] of [[factsArchive, facts.bytes], [exportPath, exportBytes], [sourceManifestPath, manifestBytes]] as const) {
      await privateRoot(root, path.dirname(file));
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.length)
        throw Error("public_preparation_artifact_conflict");
      if (!(await fs.readFile(file)).equals(expected)) throw Error("public_preparation_artifact_conflict");
    }
  } else {
    // Re-read the original input immediately before publishing the durable checkpoint.
    if (sha256(await fs.readFile(facts.file)) !== facts.digest) throw Error("public_source_changed_during_preparation");
    await loadPublicCapture(options.receiptPath, options.receiptSha256);
    await writeImmutable(factsArchive, facts.bytes);
    await writeImmutable(exportPath, exportBytes);
    await writeImmutable(sourceManifestPath, manifestBytes);
    await writeImmutable(preparationPath, Buffer.from(canonicalJson(prepared) + "\n"));
  }
  return { ...prepared, preparationPath, preparationSha256: sha256(canonicalJson(prepared) + "\n"), replayed: prior !== null, networkRequests: 0 };
}

async function handoffFile(root: string, file: string, expected?: Buffer, maxBytes?: number) {
  if (!within(root, file) || path.resolve(file) === root) throw Error("public_handoff_path_invalid");
  await privateRoot(root, path.dirname(file));
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()
    || path.resolve(await fs.realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase())
    throw Error("public_handoff_path_invalid");
  if ((expected && stat.size !== expected.length) || (maxBytes !== undefined && stat.size > maxBytes))
    throw Error("public_handoff_artifact_invalid");
  const bytes = await fs.readFile(file);
  if ((expected && !bytes.equals(expected)) || (maxBytes !== undefined && bytes.length > maxBytes))
    throw Error("public_handoff_artifact_invalid");
  return bytes;
}

async function handoffFileSet(root: string, directory: string, relativePaths: string[]) {
  const directories = new Set<string>([""]);
  for (const relative of relativePaths) {
    const parts = relative.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
  }
  const files: string[] = [];
  async function visit(relative: string) {
    const target = path.join(directory, relative);
    await privateRoot(root, target);
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("public_handoff_path_invalid");
    for (const item of await fs.readdir(target, { withFileTypes: true })) {
      const child = relative ? relative + "/" + item.name : item.name;
      if (item.isSymbolicLink()) throw Error("public_handoff_path_invalid");
      if (item.isDirectory()) {
        if (!directories.has(child)) throw Error("public_handoff_artifact_set_mismatch");
        await visit(child);
      } else if (item.isFile()) files.push(child);
      else throw Error("public_handoff_path_invalid");
    }
  }
  await visit("");
  if (canonicalJson(files.sort(ordinal)) !== canonicalJson([...relativePaths].sort(ordinal)))
    throw Error("public_handoff_artifact_set_mismatch");
}

function handoffHold(prepared: PreparedVerification, handoffDir: string, reason: string): HandoffHold {
  return {
    schemaVersion: "prospect-public-source-handoff-hold/v1", state: "technical-hold",
    preparationPath: prepared.preparationPath, preparationSha256: prepared.preparationSha256,
    handoffDir, snapshotAt: prepared.snapshotAt, reason, networkRequests: 0, submitted: 0, applied: 0, visibleVerified: 0,
  };
}

async function priorHandoffHold(root: string, prepared: PreparedVerification, handoffDir: string) {
  const holdDir = path.join(root, "handoff-holds", prepared.preparationSha256);
  await privateRoot(root, holdDir);
  let names: string[];
  try { names = await fs.readdir(holdDir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let retained: { value: HandoffHold; holdPath: string; holdSha256: string } | null = null;
  for (const name of names.sort(ordinal)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw Error("public_handoff_hold_invalid");
    const holdPath = path.join(holdDir, name), bytes = await handoffFile(root, holdPath, undefined, MAX_FACTS_BYTES);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw Error("public_handoff_hold_invalid"); }
    if (!object(value) || typeof value.reason !== "string" || !HANDOFF_HOLD_CODES.has(value.reason))
      throw Error("public_handoff_hold_invalid");
    const expected = handoffHold(prepared, handoffDir, value.reason), holdSha256 = sha256(bytes);
    if (holdSha256 + ".json" !== name || !bytes.equals(Buffer.from(canonicalJson(expected) + "\n")))
      throw Error("public_handoff_hold_invalid");
    retained ??= { value: expected, holdPath, holdSha256 };
  }
  return retained;
}

async function retainHandoffHold(root: string, prepared: PreparedVerification, handoffDir: string, reason: string) {
  const prior = await priorHandoffHold(root, prepared, handoffDir);
  if (prior) return { ...prior.value, held: true as const, holdPath: prior.holdPath, holdSha256: prior.holdSha256, replayed: true };
  const value = handoffHold(prepared, handoffDir, reason), bytes = Buffer.from(canonicalJson(value) + "\n");
  const holdSha256 = sha256(bytes), holdPath = path.join(root, "handoff-holds", prepared.preparationSha256, holdSha256 + ".json");
  await writeImmutable(holdPath, bytes);
  return { ...value, held: true as const, holdPath, holdSha256, replayed: false };
}

/** Offline producer handoff only. No Admin comparison, identity resolution or submission is performed. */
export async function preparePublicSourceHandoff(options: Parameters<typeof preparePublicVerification>[0]) {
  const prepared = await preparePublicVerification(options), root = path.resolve(options.outputRoot);
  const handoffDir = path.join(root, "handoffs", prepared.preparationSha256);
  const checkpointPath = path.join(handoffDir, "checkpoint.json");
  await privateRoot(root, root);
  const priorHold = await priorHandoffHold(root, prepared, handoffDir);
  if (priorHold) return { ...priorHold.value, held: true as const, holdPath: priorHold.holdPath, holdSha256: priorHold.holdSha256, replayed: true };
  try {
    const preparationBytes = await handoffFile(root, prepared.preparationPath, undefined, MAX_FACTS_BYTES);
    const sourceBytes = await handoffFile(root, prepared.sourceManifestPath);
    if (sha256(preparationBytes) !== prepared.preparationSha256 || sha256(sourceBytes) !== prepared.sourceManifestFileSha256)
      throw Error("public_handoff_source_changed");
    const source = JSON.parse(sourceBytes.toString("utf8")) as WholeFirmSourceManifest;
    const result = compileWholeFirmSnapshot(source);
    const heldEvidence = buildHeldCandidateEvidence(result.expected, result.candidates);
    const chunks = chunkExpectedRunManifest(result.expected, 100, 1_048_576, "whole-firm");
    const comparisonPackages = result.packages.map(p => ({
      envelope: p.envelope, payloadSha256: p.payloadSha256, legacyAssessmentProjectionClaims: p.legacyAssessmentProjectionClaims ?? [],
    }));
    const comparison = serializeComparisonRequest(result.expected, comparisonPackages, "whole-firm");
    const counts = {
      expectedRevisionCount: source.expectedRevisionCount, accountedRevisionCount: result.expected.entries.length,
      packages: result.packages.length, nonPackageHolds: result.expected.entries.filter(e => e.clientPackageId === null).length,
      heldCandidateEvidence: heldEvidence.length, supportedFactCount: prepared.supportedFactCount,
      heldFactCount: prepared.heldFactCount, validationIssues: result.issues.length,
    };
    const coverage = {
      profile: "whole-firm", runId: result.expected.runId, sourceManifestSha256: source.manifestSha256,
      runManifestSha256: result.expected.manifestSha256, expectedRevisionCount: counts.expectedRevisionCount,
      accountedRevisionCount: counts.accountedRevisionCount, packages: counts.packages, nonPackageHolds: counts.nonPackageHolds,
      submitted: 0, applied: 0, visibleVerified: 0,
    };
    const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
    const jsonlBytes = (values: unknown[]) => Buffer.from(values.map(value => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""));
    const artifactBytes = new Map<string, Buffer>([
      ["source-manifest.json", sourceBytes],
      ["expected-run-manifest.json", jsonBytes(result.expected)],
      ["expected-run-manifest-chunks.jsonl", jsonlBytes(chunks)],
      ["candidate-index.jsonl", jsonlBytes(result.candidates)],
      ["held-candidate-evidence.jsonl", jsonlBytes(heldEvidence)],
      ["normalized-packages.jsonl", jsonlBytes(result.packages)],
      ["comparison-packages.json", jsonBytes(comparisonPackages)],
      ["delivery-index.jsonl", jsonlBytes(result.packages.map(p => ({
        clientPackageId: p.envelope.packageId, payloadSha256: p.payloadSha256,
        key: prospectEnrichmentIdempotencyKey(p.envelope.sourceSystem, p.envelope.runId, p.envelope.packageId),
        packageFile: path.join(handoffDir, "packages", p.envelope.packageId + ".json"),
      })))],
      ["validation-errors.jsonl", jsonlBytes(result.issues)],
      ["coverage-report.json", jsonBytes(coverage)],
      ["comparison-request.json", Buffer.from(comparison.body)],
    ]);
    for (const p of result.packages) {
      if (!/^pe-[a-f0-9]{64}$/.test(p.envelope.packageId)) throw Error("public_handoff_artifact_invalid");
      artifactBytes.set("packages/" + p.envelope.packageId + ".json", jsonBytes(p.envelope));
    }
    const checkpoint: PublicSourceHandoffCheckpoint = {
      schemaVersion: "prospect-public-source-handoff/v1", state: "prepared-pending-admin",
      preparationPath: prepared.preparationPath, preparationSha256: prepared.preparationSha256,
      sourceManifestPath: prepared.sourceManifestPath, sourceManifestSha256: prepared.sourceManifestSha256,
      sourceManifestFileSha256: prepared.sourceManifestFileSha256, snapshotAt: prepared.snapshotAt,
      runId: result.expected.runId, runManifestSha256: result.expected.manifestSha256,
      artifacts: [...artifactBytes].sort(([a], [b]) => ordinal(a, b)).map(([relativePath, bytes]) => ({
        relativePath, path: path.join(handoffDir, relativePath), sha256: sha256(bytes), bytes: bytes.length,
      })), counts, networkRequests: 0, submitted: 0, applied: 0, visibleVerified: 0,
    };
    const checkpointBytes = Buffer.from(canonicalJson(checkpoint) + "\n"), checkpointSha256 = sha256(checkpointBytes);
    await privateRoot(root, handoffDir);
    await fs.mkdir(path.dirname(handoffDir), { recursive: true, mode: 0o700 });
    await privateRoot(root, path.dirname(handoffDir));
    let replayed = false;
    try { await fs.mkdir(handoffDir, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; replayed = true; }
    if (replayed) {
      let actual: Buffer;
      try { actual = await handoffFile(root, checkpointPath, undefined, MAX_FACTS_BYTES); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw Error("public_handoff_publication_incomplete");
        throw error;
      }
      if (!actual.equals(checkpointBytes)) throw Error("public_handoff_checkpoint_conflict");
    } else {
      // Claim the directory once. A failed publication is preserved, never silently repaired.
      for (const [relativePath, bytes] of artifactBytes) await writeImmutable(path.join(handoffDir, relativePath), bytes);
    }
    await handoffFileSet(root, handoffDir, [...artifactBytes.keys(), ...(replayed ? ["checkpoint.json"] : [])]);
    for (const [relativePath, bytes] of artifactBytes) await handoffFile(root, path.join(handoffDir, relativePath), bytes);
    await handoffFile(root, prepared.preparationPath, preparationBytes);
    await handoffFile(root, prepared.sourceManifestPath, sourceBytes);
    if (sha256(await fs.readFile(prepared.factsSourcePath)) !== prepared.factsSourceSha256)
      throw Error("public_handoff_source_changed");
    await loadPublicCapture(options.receiptPath, options.receiptSha256);
    const concurrentHold = await priorHandoffHold(root, prepared, handoffDir);
    if (concurrentHold) return { ...concurrentHold.value, held: true as const, holdPath: concurrentHold.holdPath, holdSha256: concurrentHold.holdSha256, replayed: true };
    if (!replayed) await writeImmutable(checkpointPath, checkpointBytes);
    await handoffFile(root, checkpointPath, checkpointBytes);
    await handoffFileSet(root, handoffDir, [...artifactBytes.keys(), "checkpoint.json"]);
    const finalHold = await priorHandoffHold(root, prepared, handoffDir);
    if (finalHold) return { ...finalHold.value, held: true as const, holdPath: finalHold.holdPath, holdSha256: finalHold.holdSha256, replayed: true };
    return { ...checkpoint, held: false as const, handoffDir, checkpointPath, checkpointSha256, replayed };
  } catch (error) {
    const reason = error instanceof Error && HANDOFF_HOLD_CODES.has(error.message) ? error.message
      : (error as NodeJS.ErrnoException).code === "ENOENT" ? "public_handoff_artifact_missing"
      : error instanceof Error && error.message === "output_path_redirected" ? "public_handoff_path_invalid"
      : "public_handoff_preparation_failed";
    return retainHandoffHold(root, prepared, handoffDir, reason);
  }
}

export async function runPublicSourceCommand(argv = process.argv.slice(2), context?: {
  profileRoot?: string; now?: () => Date;
  captureDependencies?: Parameters<typeof capturePublicSource>[0]["dependencies"];
}) {
  const { command, options } = parseArgs(argv);
  if (command === "help" || command === "--help") return HELP;
  const profileRoot = context?.profileRoot ?? WHOLE_FIRM_PROFILE.outputRoot;
  const root = await privateRoot(profileRoot, typeof options["output-root"] === "string"
    ? options["output-root"] : path.join(profileRoot, "public-source"));
  if (command === "capture") {
    if (options.receipt || options["receipt-sha256"] || options.facts) throw Error("public_cli_scope_invalid");
    const input = await boundedInput(required(options, "request"));
    const request = parsePublicCaptureRequest(input.value);
    if (!options.execute) {
      if (options.confirm) throw Error("public_cli_scope_invalid");
      return { valid: true, requestSha256: input.digest, outputRoot: root, networkRequests: 0, executed: false };
    }
    if (options.confirm !== "CAPTURE-PUBLIC-SOURCE") throw Error("public_capture_confirmation_required");
    const result = await capturePublicSource({ request, outputRoot: root, dependencies: context?.captureDependencies });
    // CLI output contains only safe status/hash/path metadata, never source bytes or URLs.
    return result.ok
      ? { captured: true, receiptPath: result.receiptPath, receiptSha256: result.receiptSha256,
        bodySha256: result.receipt.bodySha256, bytes: result.receipt.bytes, observationsVerified: false, networkRequests: result.networkRequests }
      : { captured: false, held: true, attemptPath: result.attemptPath, attemptSha256: result.attemptSha256, networkRequests: result.networkRequests };
  }
  if (command === "prepare" || command === "handoff") {
    if (options.execute || options.request) throw Error("public_cli_scope_invalid");
    if (options.confirm !== "VERIFIED-PUBLIC-FACTS") throw Error("public_fact_confirmation_required");
    const prepareOptions = { receiptPath: required(options, "receipt"),
      receiptSha256: required(options, "receipt-sha256"), factsPath: required(options, "facts"), outputRoot: root, now: context?.now };
    if (command === "handoff") return preparePublicSourceHandoff(prepareOptions);
    const result = await preparePublicVerification(prepareOptions);
    // Issues may describe private source pointers; return their codes only to stdout.
    const { issues, ...summary } = result;
    return { ...summary, issueCodes: [...new Set(issues.filter(object).map(issue => String(issue.code)))] };
  }
  throw Error("unknown_public_source_command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPublicSourceCommand().then(result => {
    console.log(typeof result === "string" ? result : JSON.stringify(result));
    if (object(result) && "schemaVersion" in result && result.schemaVersion === "prospect-public-source-handoff-hold/v1" && result.held === true)
      process.exitCode = 1;
  })
    .catch(error => {
      const reason = error instanceof Error && /^[a-z][a-z0-9_-]{0,100}$/.test(error.message)
        ? error.message : "public_source_command_failed";
      console.error(JSON.stringify({ error: reason, completed: false })); process.exitCode = 1;
    });
}
