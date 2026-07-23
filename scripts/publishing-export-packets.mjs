#!/usr/bin/env node
/**
 * npm run publishing:export-packets -- --period <id> [--packets <path>] [--out <dir>] [--dry-run]
 *
 * Renders Canonical Publication Packets (src/lib/publication-packet.ts) into
 * the exact manual-handoff text format the 2026-07-22 DRG Law calibration
 * report specifies (friction #9): Title / Body copy (verbatim) / CTA button
 * label / CTA URL / Image filename / Image download link / Publishing
 * date/time -- one file per packet.
 *
 * THIS PHASE ONLY: reads packet JSON from --packets <path> or stdin. It
 * does NOT connect to production Supabase and has no code path that could
 * -- wiring this CLI to the live GET .../publication-packets route is
 * later, separately authorized work (see this build's final report). The
 * input JSON is expected to be the `packets` array a call to that route
 * would return (see publication-packet.ts's PublicationPacket shape;
 * duck-typed here since this script cannot import the TS module, same
 * constraint and same reasoning as publishing-bind-heroes.mjs).
 *
 * Body copy is rendered as PLAIN TEXT via the same word-preserving
 * htmlToPlainText transform publication-packet.ts already applies
 * server-side (packet.copy.plainText) -- this script does not re-derive
 * or re-transform copy itself, it only writes out what the packet already
 * carries.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

function safeSlug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

/** Renders one packet into the exact calibration handoff format. Transports fields verbatim; invents nothing for a missing field ("(none)" / "(not scheduled)" are explicit absence markers, never a guess). */
export function renderPacketText(packet) {
  const title = packet?.copy?.title ?? "(none)";
  const body = packet?.copy?.plainText ?? "(none)";
  const ctaLabel = packet?.cta?.label ?? "(none)";
  const ctaUrl = packet?.cta?.targetPath ?? "(none)";
  const imageFileName = packet?.image?.fileName ?? "(none)";
  const imageLink = packet?.image?.storageOrPublicUrl ?? "(none)";
  const publishDate = packet?.dates?.scheduledFor ?? packet?.dates?.publishedAt ?? "(not scheduled)";

  return [
    `Title`,
    title,
    ``,
    `Body copy (verbatim)`,
    body,
    ``,
    `CTA button label`,
    ctaLabel,
    ``,
    `CTA URL`,
    ctaUrl,
    ``,
    `Image filename`,
    imageFileName,
    ``,
    `Image download link`,
    imageLink,
    ``,
    `Publishing date/time`,
    publishDate,
    ``,
  ].join("\n");
}

export function packetFileName(packet, index) {
  const deliverableId = safeSlug(packet?.identity?.deliverableId ?? `packet-${index}`);
  const channel = safeSlug(packet?.identity?.channel ?? "unknown-channel");
  return `${deliverableId}-${channel}.txt`;
}

/**
 * OS-resolved default output directory -- Downloads\DRG Law\<date>\<period-slug>,
 * resolved via os.homedir() (never a guessed root like C:\Downloads; see
 * the calibration report friction #10 this fixes). Only used when --out is
 * not supplied.
 *
 * The date is the operator's LOCAL calendar date (getFullYear/getMonth/
 * getDate), never toISOString()'s UTC date -- 2026-07-22 audit follow-up:
 * an evening run in a UTC-behind timezone (e.g. EDT) produced a folder
 * dated tomorrow, which is exactly the kind of stale/wrong-date confusion
 * calibration friction #7 is about.
 */
export function defaultOutDir(periodId, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  return resolve(homedir(), "Downloads", "DRG Law", dateStr, safeSlug(periodId));
}

/** Resolves a caller-supplied --out dir the same traversal-safe way bind-heroes resolves asset paths: absolute --out is honored as an explicit override (this is a destination, not an asset path escaping a manifest folder), but a filename derived from packet data is never allowed to escape the resolved outDir itself. */
export function resolveOutputFilePath(outDir, fileName) {
  if (fileName.includes("..") || isAbsolute(fileName) || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error(`unsafe output file name rejected: ${fileName}`);
  }
  const resolvedOutDir = resolve(outDir);
  const filePath = resolve(resolvedOutDir, fileName);
  const normalizedOutDir = resolvedOutDir.endsWith(sep) ? resolvedOutDir : resolvedOutDir + sep;
  if (filePath !== resolvedOutDir && !filePath.startsWith(normalizedOutDir)) {
    throw new Error(`output path escapes the output directory: ${fileName}`);
  }
  return filePath;
}

function parseArgs(argv) {
  const args = { period: null, packetsPath: null, outDir: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--period") args.period = argv[++i] ?? null;
    else if (a === "--packets") args.packetsPath = argv[++i] ?? null;
    else if (a === "--out") args.outDir = argv[++i] ?? null;
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Full export flow, parameterized for testability (same pattern as
 * publishing-bind-heroes.mjs's runCli). No network call anywhere in this
 * function -- packets are supplied as data, never fetched.
 *
 * @param {{argv?: string[], readInput?: () => string, readFile?: typeof readFileSync, now?: Date, log?: (msg: string) => void, logError?: (msg: string) => void}} [options]
 * @returns {{exitCode: number, outDir: string|null, files: string[], dryRun?: boolean}}
 */
export function runExportCli({ argv, readInput = readStdinSync, readFile = readFileSync, now = new Date(), log = console.log, logError = console.error } = {}) {
  const args = parseArgs(argv ?? []);
  if (!args.period) {
    logError("Usage: publishing:export-packets -- --period <id> [--packets <path>] [--out <dir>] [--dry-run]");
    return { exitCode: 1, outDir: null, files: [] };
  }

  let raw;
  try {
    raw = args.packetsPath ? readFile(args.packetsPath, "utf8") : readInput();
  } catch (err) {
    logError(`could not read packets input: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1, outDir: null, files: [] };
  }

  let packets;
  try {
    const parsed = JSON.parse(raw);
    packets = Array.isArray(parsed) ? parsed : parsed.packets;
    if (!Array.isArray(packets)) throw new Error("input JSON must be a packets array, or an object with a packets array");
  } catch (err) {
    logError(`could not parse packets JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1, outDir: null, files: [] };
  }

  if (packets.length === 0) {
    logError("no packets to export (empty array)");
    return { exitCode: 1, outDir: null, files: [] };
  }

  const outDir = args.outDir ? resolve(args.outDir) : defaultOutDir(args.period, now);

  const rendered = packets.map((packet, index) => ({
    fileName: packetFileName(packet, index),
    content: renderPacketText(packet),
  }));

  // Validate every output path resolves safely BEFORE any write -- same
  // validate-the-whole-batch-before-the-first-write discipline as
  // publishing-bind-heroes.mjs's preflightManifest.
  const filePaths = rendered.map((r) => resolveOutputFilePath(outDir, r.fileName));

  if (args.dryRun) {
    log(`Dry run: would write ${rendered.length} packet file(s) to ${outDir}`);
    for (const path of filePaths) log(`  would write: ${path}`);
    return { exitCode: 0, outDir, files: filePaths, dryRun: true };
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!existsSync(outDir)) {
    logError(`failed to create output directory: ${outDir}`);
    return { exitCode: 1, outDir: null, files: [] };
  }

  rendered.forEach((r, i) => writeFileSync(filePaths[i], r.content, "utf8"));

  log(`Exported ${rendered.length} packet(s) to verified directory: ${outDir}`);
  for (const path of filePaths) log(`  ${path}`);

  return { exitCode: 0, outDir, files: filePaths, dryRun: false };
}

async function main() {
  const result = runExportCli({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
