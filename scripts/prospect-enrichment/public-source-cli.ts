import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson, object, sha256, within } from "./model";
import { WHOLE_FIRM_PROFILE } from "./profiles";
import { freezeWholeFirmExport } from "./whole-firm";
import { capturePublicSource, loadPublicCapture, parsePublicCaptureRequest } from "./public-source-capture";
import { buildPublicVerificationExport } from "./public-source-verification";

const HELP = `Public-source evidence tools for future whole-firm research
  capture --request REQUEST_JSON [--output-root PRIVATE_DIR]
  capture --request REQUEST_JSON [--output-root PRIVATE_DIR] --execute --confirm CAPTURE-PUBLIC-SOURCE
  prepare --receipt CAPTURE_RECEIPT --receipt-sha256 HASH --facts VERIFIED_FACTS_JSON
          [--output-root PRIVATE_DIR] --confirm VERIFIED-PUBLIC-FACTS
Capture defaults to a network-free request check. Prepare writes an immutable local export.
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
  if (command === "prepare") {
    if (options.execute || options.request) throw Error("public_cli_scope_invalid");
    if (options.confirm !== "VERIFIED-PUBLIC-FACTS") throw Error("public_fact_confirmation_required");
    const result = await preparePublicVerification({ receiptPath: required(options, "receipt"),
      receiptSha256: required(options, "receipt-sha256"), factsPath: required(options, "facts"), outputRoot: root, now: context?.now });
    // Issues may describe private source pointers; return their codes only to stdout.
    const { issues, ...summary } = result;
    return { ...summary, issueCodes: [...new Set(issues.filter(object).map(issue => String(issue.code)))] };
  }
  throw Error("unknown_public_source_command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPublicSourceCommand().then(result => console.log(typeof result === "string" ? result : JSON.stringify(result)))
    .catch(error => {
      const reason = error instanceof Error && /^[a-z][a-z0-9_-]{0,100}$/.test(error.message)
        ? error.message : "public_source_command_failed";
      console.error(JSON.stringify({ error: reason, completed: false })); process.exitCode = 1;
    });
}
