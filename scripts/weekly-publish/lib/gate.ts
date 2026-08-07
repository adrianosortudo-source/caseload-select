/**
 * Phase 2.3: the `gate` command. Validates, zero writes (Standing Rule 1's
 * INSERT-only scope doesn't even apply here -- gate never writes at all).
 * The gate REJECTS; it never rewrites (Standing Rule 5) -- every check
 * below reports a finding, none of them mutate content. Collects every
 * violation in one pass rather than stopping at the first, matching this
 * codebase's own validatePackageManifest convention.
 *
 * F11 Node-native checks: entity-mojibake signature, bare-URL-outside-href
 * scan, article structure presence, byte-exact locked strings, sha256 of
 * every asset file against the week's manifest, role->content_kind
 * conformance (report-only line).
 *
 * F10 Python step: shells to the skill runtime's calculate_hashes.py via
 * the launcher (lib/python-launcher.ts) for an independent, second-
 * language sha256 computation over every file under the week's assets/
 * dir, cross-checked against config. (The runtime's other validators
 * operate on a different, file-based Publishing Kit manifest schema --
 * publishing-kit-manifest.schema.json's week_id/assets[] shape -- than the
 * Supabase Control Room manifest this tool produces; bridging the two is
 * out of scope here, see Amendments.) STOPs with the launcher's own
 * bootstrap message, never a silent skip, if no interpreter is available.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekConfig } from "../config";
import { LOCKED_STRINGS } from "../canon/locked-strings";
import { runPythonScript } from "./python-launcher";

export interface GateFinding {
  check: string;
  ok: boolean;
  detail: string;
}

export interface GateReport {
  ok: boolean;
  findings: GateFinding[];
}

const MOJIBAKE_RE = /&#\d{1,3};/;
const ARTICLE_STRUCTURE_MARKERS = ["Five-Line Brief", "Decision Box", "FAQ"];

function findBareUrls(html: string): string[] {
  // Strip href="..." / href='...' attribute values first, so a real link's
  // own URL never counts as "bare"; anything left matching a URL pattern is.
  const withoutHrefValues = html.replace(/href=(["'])(.*?)\1/gi, 'href=$1$1');
  const matches = withoutHrefValues.match(/https?:\/\/\S+/g);
  return matches ? matches.map((m) => m.replace(/[)\].,;"']+$/, "")) : [];
}

async function currentBodyHtml(supabase: SupabaseClient, deliverableId: string): Promise<{ title: string; bodyHtml: string }> {
  const { data: d, error: dErr } = await supabase
    .from("content_deliverables")
    .select("title, current_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (dErr || !d) throw new Error(`${deliverableId}: deliverable lookup failed: ${dErr?.message ?? "not found"}`);
  const { data: v, error: vErr } = await supabase
    .from("deliverable_versions")
    .select("body_html")
    .eq("id", d.current_version_id)
    .maybeSingle();
  if (vErr || !v) throw new Error(`${deliverableId}: current version lookup failed: ${vErr?.message ?? "not found"}`);
  return { title: d.title as string, bodyHtml: (v.body_html as string) ?? "" };
}

export async function runGate(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
  root: string,
  skillRoot: string,
): Promise<GateReport> {
  const findings: GateFinding[] = [];
  const push = (check: string, ok: boolean, detail: string) => findings.push({ check, ok, detail });

  // --- content checks (mojibake, bare URLs, article structure, locked strings) ---
  const articlePieces = weekConfig.pieces.filter((p) => p.formatFamily === "counsel_note" || p.formatFamily === "clause_in_the_margin");
  const landingPieces = weekConfig.pieces.filter((p) => p.formatFamily === "lead_magnet_landing_page");

  for (const piece of articlePieces) {
    const { title, bodyHtml } = await currentBodyHtml(supabase, piece.deliverableId);
    const mojibake = MOJIBAKE_RE.test(bodyHtml);
    push(`mojibake:${piece.contentSlotId}`, !mojibake, mojibake ? `entity-encoded mojibake signature found in "${title}"` : "clean");

    const bareUrls = findBareUrls(bodyHtml);
    push(`bare-url:${piece.contentSlotId}`, bareUrls.length === 0, bareUrls.length === 0 ? "clean" : `${bareUrls.length} bare URL(s) outside href: ${bareUrls.join(", ")}`);

    const missingMarkers = ARTICLE_STRUCTURE_MARKERS.filter((marker) => !bodyHtml.includes(marker));
    push(`structure:${piece.contentSlotId}`, missingMarkers.length === 0, missingMarkers.length === 0 ? "Five-Line Brief / Decision Box / FAQ all present" : `missing: ${missingMarkers.join(", ")}`);
  }

  for (const piece of landingPieces) {
    const { title, bodyHtml } = await currentBodyHtml(supabase, piece.deliverableId);
    const hasLockedCta = bodyHtml.includes(LOCKED_STRINGS.leadMagnetCtaHref);
    push(`locked-string:${piece.contentSlotId}`, hasLockedCta, hasLockedCta ? "form-CTA convention present, byte-exact" : `"${LOCKED_STRINGS.leadMagnetCtaHref}" not found in "${title}"`);
  }

  // --- content_kind conformance (F12: report-only, never blocks, never writes) ---
  const decisionToolPieces = weekConfig.pieces.filter((p) => p.formatFamily === "decision_tool");
  for (const piece of decisionToolPieces) {
    const { data: d } = await supabase
      .from("content_deliverables")
      .select("content_kind")
      .eq("id", piece.deliverableId)
      .maybeSingle();
    const kind = (d?.content_kind as string) ?? "unknown";
    push(`content-kind:${piece.contentSlotId}`, true, `content_kind="${kind}" (report-only, canon is "text" per F12; never enforced as a blocker)`);
  }

  // --- sha256 of every asset file against the manifest (Node) ---
  const allFileRows = [
    ...weekConfig.evidence.map((e) => ({ slot: e.label, file: e.file, sha256: e.sha256 })),
    ...weekConfig.kitAssets.filter((k) => k.file).map((k) => ({ slot: k.contentSlotId, file: k.file as string, sha256: k.sha256 })),
  ];
  for (const row of allFileRows) {
    try {
      const buf = readFileSync(path.join(root, row.file));
      const actual = createHash("sha256").update(buf).digest("hex");
      push(`sha256:${row.slot}:${row.file}`, actual === row.sha256, actual === row.sha256 ? "matches manifest" : `expected ${row.sha256}, file on disk is ${actual}`);
    } catch (e) {
      push(`sha256:${row.slot}:${row.file}`, false, `file unreadable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- F10: independent Python cross-check of every file's sha256 ---
  try {
    const assetsRoot = path.join(root, "assets");
    const pyResult = runPythonScript(skillRoot, "calculate_hashes.py", [assetsRoot]);
    if (!pyResult.ok) {
      push("python-launcher", false, `calculate_hashes.py exited ${pyResult.exitCode}. stderr: ${pyResult.stderr.trim()}`);
    } else {
      const records: Array<{ filename: string; sha256: string }> = JSON.parse(pyResult.stdout);
      const byRelPath = new Map(records.map((r) => [r.filename.replace(/\\/g, "/"), r.sha256]));
      let mismatches = 0;
      for (const row of allFileRows) {
        const relUnderAssets = row.file.replace(/^assets[\\/]/, "").replace(/\\/g, "/");
        const pySha = byRelPath.get(relUnderAssets);
        if (pySha && pySha !== row.sha256) mismatches++;
      }
      push("python-launcher", mismatches === 0, mismatches === 0
        ? `calculate_hashes.py cross-checked ${records.length} file(s) under assets/, 0 mismatches against config`
        : `${mismatches} file(s) disagree between Python-computed and config sha256`);
    }
  } catch (e) {
    push("python-launcher", false, e instanceof Error ? e.message : String(e));
  }

  return { ok: findings.every((f) => f.ok), findings };
}
