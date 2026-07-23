#!/usr/bin/env node
/**
 * npm run publishing:bind-heroes -- --manifest <absolute-manifest-path> [--dry-run] [--continue-on-error]
 *
 * The Publishing Agent's local CLI for the Publishing Package Gateway
 * (src/app/api/publishing-agent/hero-package/route.ts). Reads a hero-
 * binding manifest from local disk and uploads exactly the assets it
 * lists, one call per operation, to the narrow gateway endpoint -- never a
 * directory scan, never a filename-based guess, never any operation this
 * gateway does not itself expose (see publishing-package-gateway.ts's own
 * header comment for the seven publishing-agent operating principles this
 * CLI and its server-side counterpart both enforce).
 *
 * This script intentionally does NOT import src/lib/publishing-package-
 * manifest.ts: that module is TypeScript path-aliased into the Next.js
 * build, and this CLI must run as a plain Node script exactly like every
 * other file in scripts/ (see check-no-em-dash-marketing.mjs). The manifest
 * schema constants below are therefore a hand-maintained mirror of
 * src/lib/publishing-package-gateway.ts's SUPPORTED_HERO_PACKAGE_LOCALES /
 * SUPPORTED_HERO_PACKAGE_CONTENT_KINDS -- the same kind of intentional,
 * documented mirror release-graph-audit.ts's KNOWN_DR105_RULES already is
 * for its own source-of-truth document. If those two files drift, this CLI
 * will accept or reject a locale/content-kind the server itself would not
 * agree with -- keep them in sync by hand whenever either changes.
 *
 * Network calls: fetch + native FormData/Blob (Node >=18 global fetch).
 * No new dependency was added for this CLI.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, isAbsolute, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Hand-maintained mirror -- see header comment.
export const SUPPORTED_LOCALES = ["en-CA", "pt-BR"];
export const SUPPORTED_CONTENT_KINDS = ["text", "image", "pdf"];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/**
 * @typedef {{deliverableId: string, assetPath: string, localSha256: string, dryRun: true, wouldUpload: true}} DryRunOperationReceipt
 * @typedef {{deliverableId: string, assetPath: string, httpStatus?: number, ok: boolean, body?: unknown, error?: string}} UploadOperationReceipt
 * @typedef {{dryRun: true, operations: DryRunOperationReceipt[]}} DryRunReceiptContent
 * @typedef {{dryRun: false, operations: UploadOperationReceipt[]}} UploadReceiptContent
 * @typedef {{exitCode: number, receiptPath: string|null, receiptContent: DryRunReceiptContent|UploadReceiptContent|null}} CliResult
 */

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Schema-level validation only (no filesystem access) -- mirrors
 * publishing-package-manifest.ts's validatePublishingPackageManifest
 * exactly, field for field, including collecting every violation rather
 * than stopping at the first.
 */
export function validateManifestShape(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: [{ path: "$", message: "manifest must be a JSON object" }] };

  if (raw.schema_version !== 1) {
    errors.push({ path: "schema_version", message: `schema_version must equal 1 (got ${JSON.stringify(raw.schema_version)})` });
  }
  const firmId = raw.firm_id;
  if (typeof firmId !== "string" || !UUID_RE.test(firmId)) {
    errors.push({ path: "firm_id", message: `firm_id must be a valid UUID (got ${JSON.stringify(firmId)})` });
  }

  const rawOperations = raw.operations;
  if (!Array.isArray(rawOperations)) {
    errors.push({ path: "operations", message: "operations must be an array" });
  } else if (rawOperations.length === 0) {
    errors.push({ path: "operations", message: "operations must not be empty" });
  }

  const operations = [];
  const seenDeliverableIds = new Set();
  const seenAssetPaths = new Set();
  const duplicateDeliverableIds = new Set();
  const duplicateAssetPaths = new Set();

  if (Array.isArray(rawOperations)) {
    rawOperations.forEach((rawOp, index) => {
      const base = `operations[${index}]`;
      if (!isPlainObject(rawOp)) {
        errors.push({ path: base, message: "each operation must be a JSON object" });
        return;
      }
      const deliverableId = rawOp.deliverable_id;
      const validDeliverableId = typeof deliverableId === "string" && UUID_RE.test(deliverableId);
      if (!validDeliverableId) {
        errors.push({ path: `${base}.deliverable_id`, message: `deliverable_id must be a valid UUID (got ${JSON.stringify(deliverableId)})` });
      } else {
        if (seenDeliverableIds.has(deliverableId)) duplicateDeliverableIds.add(deliverableId);
        seenDeliverableIds.add(deliverableId);
      }

      const expectedLocale = rawOp.expected_locale;
      const validLocale = typeof expectedLocale === "string" && SUPPORTED_LOCALES.includes(expectedLocale);
      if (!validLocale) {
        errors.push({ path: `${base}.expected_locale`, message: `expected_locale must be one of ${SUPPORTED_LOCALES.join(", ")} (got ${JSON.stringify(expectedLocale)})` });
      }

      const expectedContentKind = rawOp.expected_content_kind;
      const validContentKind = typeof expectedContentKind === "string" && SUPPORTED_CONTENT_KINDS.includes(expectedContentKind);
      if (!validContentKind) {
        errors.push({ path: `${base}.expected_content_kind`, message: `expected_content_kind must be one of ${SUPPORTED_CONTENT_KINDS.join(", ")} (got ${JSON.stringify(expectedContentKind)})` });
      }

      const assetPath = rawOp.asset_path;
      const validAssetPath = typeof assetPath === "string" && assetPath.length > 0;
      if (!validAssetPath) {
        errors.push({ path: `${base}.asset_path`, message: "asset_path must be a non-empty relative path" });
      } else {
        if (seenAssetPaths.has(assetPath)) duplicateAssetPaths.add(assetPath);
        seenAssetPaths.add(assetPath);
      }

      const expectedSha256 = rawOp.expected_sha256;
      const validSha = typeof expectedSha256 === "string" && SHA256_HEX_RE.test(expectedSha256);
      if (!validSha) {
        errors.push({ path: `${base}.expected_sha256`, message: `expected_sha256 must be exactly 64 lowercase hexadecimal characters (got ${JSON.stringify(expectedSha256)})` });
      }

      const altText = rawOp.alt_text;
      const validAltText = typeof altText === "string" && altText.trim().length > 0;
      if (!validAltText) {
        errors.push({ path: `${base}.alt_text`, message: "alt_text must be non-empty" });
      }

      if (validDeliverableId && validLocale && validContentKind && validAssetPath && validSha && validAltText) {
        operations.push({ deliverableId, expectedLocale, expectedContentKind, assetPath, expectedSha256, altText });
      }
    });
  }

  for (const dup of duplicateDeliverableIds) errors.push({ path: "operations", message: `duplicate deliverable_id in manifest: ${dup}` });
  for (const dup of duplicateAssetPaths) errors.push({ path: "operations", message: `duplicate asset_path in manifest: ${dup}` });

  if (errors.length > 0 || typeof firmId !== "string") return { ok: false, errors };
  return { ok: true, errors: [], manifest: { schemaVersion: 1, firmId, operations } };
}

/**
 * Resolves one operation's asset_path relative to the manifest's own
 * folder ONLY. Rejects an absolute asset_path outright (never resolved
 * against cwd or the filesystem root), and rejects any path -- traversal
 * or otherwise -- whose resolved, real location falls outside the
 * manifest folder. Returns { ok:false, reason } instead of throwing so the
 * caller can collect this alongside every other pre-flight violation.
 */
export function resolveAssetPathWithinManifestFolder(manifestFolder, assetPath) {
  if (isAbsolute(assetPath)) {
    return { ok: false, reason: "absolute_path", resolvedPath: null };
  }
  const resolvedPath = resolve(manifestFolder, assetPath);
  const normalizedFolder = manifestFolder.endsWith(sep) ? manifestFolder : manifestFolder + sep;
  if (resolvedPath !== manifestFolder && !resolvedPath.startsWith(normalizedFolder)) {
    return { ok: false, reason: "escapes_manifest_folder", resolvedPath };
  }
  return { ok: true, reason: null, resolvedPath };
}

export function sha256HexOfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function parseArgs(argv) {
  const args = { manifestPath: null, dryRun: false, continueOnError: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifestPath = argv[++i] ?? null;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--continue-on-error") args.continueOnError = true;
  }
  return args;
}

/**
 * Full pre-flight: schema validation, then per-operation path-safety and
 * local-hash validation, ALL collected before a single byte is sent over
 * the network -- this function makes zero network calls and is called
 * before any operation is attempted, dry-run or not.
 */
export function preflightManifest(manifestPath) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return { ok: false, errors: [{ path: "$", message: `could not read/parse manifest: ${err instanceof Error ? err.message : String(err)}` }], operations: [] };
  }

  const shapeResult = validateManifestShape(raw);
  if (!shapeResult.ok) return { ok: false, errors: shapeResult.errors, operations: [] };

  const manifestFolder = dirname(resolve(manifestPath));
  const operations = [];
  for (const op of shapeResult.manifest.operations) {
    const resolved = resolveAssetPathWithinManifestFolder(manifestFolder, op.assetPath);
    if (!resolved.ok) {
      errors.push({ path: `asset_path:${op.assetPath}`, message: `asset_path rejected (${resolved.reason})` });
      continue;
    }
    if (!existsSync(resolved.resolvedPath) || !statSync(resolved.resolvedPath).isFile()) {
      errors.push({ path: `asset_path:${op.assetPath}`, message: "asset file does not exist on disk" });
      continue;
    }
    const localSha256 = sha256HexOfFile(resolved.resolvedPath);
    if (localSha256 !== op.expectedSha256) {
      errors.push({ path: `asset_path:${op.assetPath}`, message: `local SHA-256 (${localSha256}) does not match expected_sha256 (${op.expectedSha256})` });
      continue;
    }
    operations.push({ ...op, resolvedPath: resolved.resolvedPath, localSha256, firmId: shapeResult.manifest.firmId });
  }

  if (errors.length > 0) return { ok: false, errors, operations: [] };
  return { ok: true, errors: [], operations };
}

export async function uploadOneOperation(op, endpoint, token, fetchImpl = fetch) {
  const bytes = readFileSync(op.resolvedPath);
  const form = new FormData();
  form.set("firm_id", op.firmId);
  form.set("deliverable_id", op.deliverableId);
  form.set("expected_locale", op.expectedLocale);
  form.set("expected_content_kind", op.expectedContentKind);
  form.set("expected_sha256", op.expectedSha256);
  form.set("file", new Blob([bytes]), basename(op.resolvedPath));

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ok: res.ok && body?.ok === true, body };
}

/**
 * The full CLI flow, parameterized over argv/env/fetch/logger so it is
 * directly unit-testable without mutating global process state. main()
 * below is a thin wrapper that calls this with the real process argv/env
 * when run as a script. Returns { exitCode, receiptPath, receiptContent }
 * -- receiptContent is also what gets written to receiptPath, exposed
 * directly so tests don't need to re-read the file from disk.
 *
 * @param {{argv?: string[], env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, log?: (msg: string) => void, logError?: (msg: string) => void}} [options]
 * @returns {Promise<CliResult>}
 */
export async function runCli({ argv, env = process.env, fetchImpl = fetch, log = console.log, logError = console.error } = {}) {
  const args = parseArgs(argv ?? []);
  if (!args.manifestPath) {
    logError("Usage: publishing:bind-heroes -- --manifest <absolute-manifest-path> [--dry-run] [--continue-on-error]");
    return { exitCode: 1, receiptPath: null, receiptContent: null };
  }

  const preflight = preflightManifest(args.manifestPath);
  if (!preflight.ok) {
    logError(`Manifest validation failed (${preflight.errors.length} issue(s)):`);
    for (const e of preflight.errors) logError(`  - ${e.path}: ${e.message}`);
    return { exitCode: 1, receiptPath: null, receiptContent: null };
  }
  log(`Manifest valid: ${preflight.operations.length} operation(s).`);

  const receiptPath = resolve(dirname(resolve(args.manifestPath)), `${basename(args.manifestPath)}.receipt.json`);

  if (args.dryRun) {
    const dryReceipts = preflight.operations.map((op) => ({
      deliverableId: op.deliverableId,
      assetPath: op.assetPath,
      localSha256: op.localSha256,
      dryRun: true,
      wouldUpload: true,
    }));
    const receiptContent = { dryRun: true, operations: dryReceipts };
    writeFileSync(receiptPath, JSON.stringify(receiptContent, null, 2));
    log(`Dry run only -- no network requests made. Receipt written to ${receiptPath}`);
    return { exitCode: 0, receiptPath, receiptContent };
  }

  const endpoint = env.PUBLISHING_PACKAGE_GATEWAY_URL;
  const token = env.PUBLISHING_PACKAGE_GATEWAY_TOKEN;
  if (!endpoint || !token) {
    logError("PUBLISHING_PACKAGE_GATEWAY_URL and PUBLISHING_PACKAGE_GATEWAY_TOKEN must both be set to perform a real (non-dry-run) upload.");
    return { exitCode: 1, receiptPath: null, receiptContent: null };
  }

  const results = [];
  let anyFailed = false;
  for (const op of preflight.operations) {
    try {
      const result = await uploadOneOperation(op, endpoint, token, fetchImpl);
      results.push({ deliverableId: op.deliverableId, assetPath: op.assetPath, ...result });
      if (!result.ok) {
        anyFailed = true;
        logError(`FAILED ${op.assetPath} -> deliverable ${op.deliverableId}: HTTP ${result.httpStatus}`);
        if (!args.continueOnError) break;
      } else {
        log(`OK ${op.assetPath} -> deliverable ${op.deliverableId} (operation ${result.body?.receipt?.operationId ?? "?"})`);
      }
    } catch (err) {
      anyFailed = true;
      results.push({ deliverableId: op.deliverableId, assetPath: op.assetPath, ok: false, error: err instanceof Error ? err.message : String(err) });
      logError(`FAILED ${op.assetPath} -> deliverable ${op.deliverableId}: ${err instanceof Error ? err.message : String(err)}`);
      if (!args.continueOnError) break;
    }
  }

  const receiptContent = { dryRun: false, operations: results };
  writeFileSync(receiptPath, JSON.stringify(receiptContent, null, 2));
  log(`Receipt written to ${receiptPath}`);
  return { exitCode: anyFailed ? 1 : 0, receiptPath, receiptContent };
}

async function main() {
  const { exitCode } = await runCli({ argv: process.argv.slice(2) });
  process.exitCode = exitCode;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
