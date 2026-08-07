/**
 * weekly-publish -- sanctioned CLI for gating, writing, and proving one
 * week's DRG Law publication evidence. See EXECUTION-PLAN_weekly-publish-
 * tool_v1.md (F1-F13) at
 * D:\00_Work\01_CaseLoad_Select\06_Clients\DRGLaw\03_Authority\Deliverables\2026-W32\.
 *
 * Usage:
 *   npx tsx scripts/weekly-publish/cli.ts <command> --week 2026-W32 --root <week-folder> [--skill-root <path>]
 *
 * Commands:
 *   gate    Validate, zero writes. Non-zero exit on any finding failing.
 *   write   Register this week's publication evidence and Publishing Kit
 *           state (idempotent, INSERT-only except the one sanctioned
 *           readiness UPDATE).
 *   prove   Audit + operator report, zero writes.
 *   run     gate -> write -> prove, stops at the first failure.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { getWeekConfig } from "./config";
import { createSupabaseAdmin, loadDotEnv } from "./lib/env";
import { runGate } from "./lib/gate";
import { runWriteAll } from "./lib/write-all";
import { runProve, renderProveReport } from "./lib/prove";

const DEFAULT_SKILL_ROOT = "C:\\Users\\adria\\.claude\\skills\\drg-asset-placement";

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function optionalFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

async function main() {
  const command = process.argv[2];
  if (!command) {
    throw new Error("Usage: cli.ts <gate|write|prove|run> --week <YYYY-Www> --root <week-folder> [--skill-root <path>]");
  }

  const week = flag("week");
  const root = path.resolve(flag("root"));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`--root "${root}" is not a directory`);
  }
  const skillRoot = optionalFlag("skill-root", DEFAULT_SKILL_ROOT);

  loadDotEnv(path.resolve(__dirname, "../../.env.local"));
  const supabase = createSupabaseAdmin();
  const weekConfig = getWeekConfig(week);

  switch (command) {
    case "gate": {
      const report = await runGate(supabase, weekConfig, root, skillRoot);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "write": {
      const result = await runWriteAll(supabase, weekConfig, root);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "prove": {
      const report = await runProve(supabase, weekConfig);
      console.log(renderProveReport(report));
      break;
    }
    case "run": {
      console.log(`--- gate (${week}) ---`);
      const gateReport = await runGate(supabase, weekConfig, root, skillRoot);
      console.log(JSON.stringify(gateReport, null, 2));
      if (!gateReport.ok) {
        console.error("\nGATE FAILED. Stopping before write (Standing Rule 2).");
        process.exitCode = 1;
        return;
      }

      console.log(`\n--- write (${week}) ---`);
      const writeResult = await runWriteAll(supabase, weekConfig, root);
      console.log(JSON.stringify(writeResult, null, 2));

      console.log(`\n--- prove (${week}) ---`);
      const proveReport = await runProve(supabase, weekConfig);
      console.log(renderProveReport(proveReport));
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Expected gate|write|prove|run.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
