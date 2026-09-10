import { randomUUID } from "node:crypto";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { executeProspectProvisioningRpc } from "./importer";
import { validateProspectProvisionManifest } from "./manifest";

interface CliOptions {
  manifestPath: string;
  receiptPath: string;
  operatorId: string;
  apply: boolean;
  expectedSha256: string | null;
}

const SQL_EFFECTIVE_SOURCE_PAYLOAD_LIMIT_BYTES = 50_000;

function valueAfter(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/prospecting-control-plane/cli.ts --manifest <100-record.json> --operator-id <uuid> [--receipt <path>]",
    "  npx tsx scripts/prospecting-control-plane/cli.ts --manifest <100-record.json> --operator-id <uuid> --apply --expect-sha256 <digest> [--receipt <path>]",
    "",
    "Dry-run is the default. Both modes require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Apply also requires the exact SHA-256 printed by a reviewed dry-run.",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const manifestValue = valueAfter(argv, "--manifest");
  const operatorId = valueAfter(argv, "--operator-id") ?? process.env.PROSPECT_OPERATOR_ID ?? "";
  if (!manifestValue) throw new Error("Missing --manifest.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operatorId)) {
    throw new Error("--operator-id (or PROSPECT_OPERATOR_ID) must be a UUID.");
  }
  const manifestPath = resolve(process.cwd(), manifestValue);
  const apply = argv.includes("--apply");
  const expectedSha256 = valueAfter(argv, "--expect-sha256");
  if (apply && (!expectedSha256 || !/^[0-9a-f]{64}$/i.test(expectedSha256))) {
    throw new Error("--apply requires --expect-sha256 with the exact 64-character digest from the reviewed dry-run.");
  }
  const receiptValue = valueAfter(argv, "--receipt");
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  const receiptPath = receiptValue
    ? (isAbsolute(receiptValue) ? receiptValue : resolve(process.cwd(), receiptValue))
    : resolve(dirname(manifestPath), `${basename(manifestPath, ".json")}.${apply ? "apply" : "dry-run"}.${timestamp}.receipt.json`);
  return { manifestPath, receiptPath, operatorId, apply, expectedSha256: expectedSha256?.toLowerCase() ?? null };
}

async function writeReceipt(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    // Atomic and exclusive: unlike rename(), link() cannot replace a prior receipt.
    await link(temporaryPath, path);
    await unlink(temporaryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function assertSqlEffectivePayloadLimit(records: ReturnType<typeof validateProspectProvisionManifest>["records"]): void {
  for (const record of records) {
    const effectivePayload = {
      ...record.source_payload,
      person_email_attribution: record.person?.email_attribution ?? null,
    };
    const bytes = Buffer.byteLength(JSON.stringify(effectivePayload), "utf8");
    if (bytes > SQL_EFFECTIVE_SOURCE_PAYLOAD_LIMIT_BYTES) {
      throw new Error(
        `${record.cls_record_id}: source_payload becomes ${bytes} bytes after attribution preservation; `
        + `the SQL limit is ${SQL_EFFECTIVE_SOURCE_PAYLOAD_LIMIT_BYTES} bytes.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  let options: CliOptions | null = null;
  let manifestSha256: string | null = null;
  try {
    options = parseArgs(process.argv.slice(2));
    const raw = await readFile(options.manifestPath, "utf8");
    const manifest = validateProspectProvisionManifest(raw);
    assertSqlEffectivePayloadLimit(manifest.records);
    manifestSha256 = manifest.manifest_sha256;
    if (options.apply && options.expectedSha256 !== manifest.manifest_sha256) {
      throw new Error(`Manifest SHA-256 mismatch. Expected ${options.expectedSha256}; received ${manifest.manifest_sha256}.`);
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !/^https:\/\//.test(supabaseUrl)) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is required and must be an HTTPS URL.");
    }
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");

    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const result = await executeProspectProvisioningRpc(client, manifest, options.operatorId, options.apply);
    const receipt = {
      schema_version: "prospecting-control-plane-provision-receipt-v1",
      run_id: runId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      manifest_path: options.manifestPath,
      manifest_sha256: manifest.manifest_sha256,
      ...result,
    };
    await writeReceipt(options.receiptPath, receipt);
    process.stdout.write(`${JSON.stringify({ receipt_path: options.receiptPath, ...receipt }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options) {
      await writeReceipt(options.receiptPath, {
        schema_version: "prospecting-control-plane-provision-receipt-v1",
        run_id: runId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        manifest_path: options.manifestPath,
        manifest_sha256: manifestSha256,
        mode: options.apply ? "apply" : "dry-run",
        outcome: "failed",
        transaction: "rolled_back_or_not_started",
        error: message,
      }).catch((receiptError) => {
        process.stderr.write(`Receipt write also failed: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}\n`);
      });
    }
    process.stderr.write(`Prospect provisioning failed: ${message}\n`);
    process.exitCode = 1;
  }
}

void main();
