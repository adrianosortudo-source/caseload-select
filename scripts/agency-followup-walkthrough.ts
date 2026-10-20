import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection } from "node:net";
import { Pool, type PoolClient } from "pg";
import { chromium, expect, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createSessionCookie } from "../src/lib/portal-session-cookie";
import { scheduleAgencyFollowupStep } from "../src/lib/agency-followup-schedule";

const STACK_DIR = path.resolve("test-results/crm-local-stack");
const OUTPUT_DIR = path.resolve("test-results/agency-followup-walkthrough");
const APP_ORIGIN = "http://127.0.0.1:55435";
const API_PATH = "/api/admin/agency-crm/follow-up";
const TEST_DISPATCH_PATH = "/api/agency-followup-walkthrough";
const TEST_DISPATCH_DIR = path.resolve("src/app/api/agency-followup-walkthrough");
const STACK_PROJECT_ID = "crm-followup-walkthrough-20261013";
const EXPECTED_MIGRATION_BLOB = "c6d594c51b8c257aaca7a62fff41c96a1534a86a";
const MIGRATION_PATH = "supabase/migrations/20261013154000_agency_followup_journeys.sql";
const EXPECTED_CRM_GRANTS_MIGRATION_BLOB = "af413a079a76e2fc9844f0bb37d61bec3127b558";
const CRM_GRANTS_MIGRATION_PATH = "supabase/migrations/20261013230354_agency_crm_service_role_grants.sql";
const EVENT_MIGRATION_PATH = "supabase/migrations/20261020025251_agency_followup_resend_events_and_shared_suppression.sql";
const EXPECTED_EVENT_MIGRATION_BLOB = "ea4cf8a7186f338d65127d27099902e30949b345";
const EVENT_ROW_LOCK_GRANT_MIGRATION_PATH = "supabase/migrations/20261020141945_agency_followup_provider_event_row_lock_privilege.sql";
const EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB = "4c5a29df51e716fe37b2a1ac34a300ad8beef351";
const WIDTHS = [1440, 1024, 769, 768, 767, 640, 375, 320];
const RUN_ID = process.env.AGENCY_FOLLOWUP_RUN_ID || randomUUID();
const RUN_STARTED_AT = new Date().toISOString();
const SYNTHETIC_WEBHOOK_SECRET = `whsec_${randomBytes(32).toString("base64")}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!UUID.test(RUN_ID)) throw new Error("Acceptance run ID must be a UUID.");
const browserRuntimeErrorsByPage = new WeakMap<Page, string[]>();
const MANUAL = process.argv.includes("--manual");
const JOURNEY_VERSION_REGRESSION_ONLY = process.argv.includes("--journey-version-regression");
const FAILURE_CAPTURE_PREFLIGHT_ONLY = process.argv.includes("--failure-capture-preflight");
const WEBHOOK_PREFLIGHT_ONLY = process.argv.includes("--webhook-preflight-only");
const WALKTHROUGH_STARTED_AT = Date.now();
const WALKTHROUGH_TIMEOUT_MS = 20 * 60_000;
let interrupted = false;
let absoluteDeadline = Number.POSITIVE_INFINITY;
let activeNextServer: ChildProcess | undefined;
let activeBrowser: Browser | undefined;
let runAbortController: AbortController | undefined;
let failureLifecycleContext: {
  abortState: boolean | null;
  nextChildPid: number | null;
  nextChildExitCode: number | null;
  nextChildSignalCode: NodeJS.Signals | null;
} | undefined;
let temporaryRouteInstalled = false;
let temporaryRouteSha256: string | undefined;
let sourceAtStart: ReturnType<typeof captureSourceState> | undefined;
let diagnosticStage = "initialization";
let diagnosticStageStartedAt = Date.now();
let journeyVersionRegressionResult: {
  sameKeyV1Retired: boolean;
  sameKeyV1AbsentFromSelector: boolean;
  sameKeyV2ActiveAndAvailable: boolean;
  otherKeyV1RemainsAvailable: boolean;
} | undefined;

function setDiagnosticStage(stage: string): void {
  diagnosticStage = stage;
  diagnosticStageStartedAt = Date.now();
}

function safeDiagnosticAtom(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : null;
}

function safeErrorDiagnostics(error: unknown): { errorName: string | number | null; errorCode: string | number | null; causeCode: string | number | null } {
  const value = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; cause?: unknown } : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as { code?: unknown } : {};
  return {
    errorName: safeDiagnosticAtom(value.name),
    errorCode: safeDiagnosticAtom(value.code),
    causeCode: safeDiagnosticAtom(cause.code),
  };
}

function captureSourceState() {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", timeout: 30_000 });
  const sourceCommit = git("rev-parse", "HEAD").trim();
  const workingTreeStatus = git("status", "--porcelain", "--untracked-files=normal");
  const untrackedSource = workingTreeStatus.split(/\r?\n/).filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3));
  const fingerprint = createHash("sha256")
    .update(sourceCommit).update("\0").update(workingTreeStatus).digest("hex");
  return { sourceCommit, workingTreeState: workingTreeStatus ? "dirty" : "clean",
    workingTreeStatus, cleanTreeIdentitySha256: fingerprint, untrackedSource };
}
process.on("SIGINT", () => { interrupted = true; });

function progress(message: string): void {
  const seconds = ((Date.now() - WALKTHROUGH_STARTED_AT) / 1000).toFixed(1);
  console.log(`[agency-followup-walkthrough +${seconds}s] ${message}`);
}

function remainingMs(deadline = absoluteDeadline): number {
  return Math.max(1, deadline - Date.now());
}

type SupabaseStatus = {
  API_URL: string;
  DB_URL: string;
  SERVICE_ROLE_KEY: string;
};
type ProspectFixture = { id: string; firmName: string; contactName: string; email: string; conversationId: string };
type ProspectSearchMatch = { id: string; firm_name: string; contact_email?: string | null };
type Fixtures = { firmId: string; lawyerId: string; prospects: Record<string, ProspectFixture> };

function must(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(label + " is required.");
  return value.trim();
}

function assertLoopbackApi(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "55431") {
    throw new Error("The disposable walkthrough requires Supabase API http://127.0.0.1:55431.");
  }
  return url;
}

function assertLoopbackDatabase(raw: string): URL {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
    url.port !== "55432" || url.pathname !== "/postgres") {
    throw new Error("The disposable walkthrough requires direct Postgres at 127.0.0.1:55432/postgres.");
  }
  return url;
}

function getSupabaseStatus(): SupabaseStatus {
  // Supabase CLI status can stall while unrelated Studio/pg_meta health checks
  // run. Use the already verified isolated project ID and fixed loopback ports,
  // deriving only a short-lived local service JWT in process memory.
  const envText = execFileSync("docker", [
    "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}",
    `supabase_auth_${STACK_PROJECT_ID}`,
  ], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
  const jwtSecret = envText.split(/\r?\n/)
    .find((line) => line.startsWith("GOTRUE_JWT_SECRET="))
    ?.slice("GOTRUE_JWT_SECRET=".length);
  if (!jwtSecret) throw new Error("The isolated local Supabase auth container has no JWT secret.");
  const encode = (value: Record<string, string | number>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "supabase", role: "service_role",
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signed = `${header}.${payload}`;
  // Sign only in process memory; the key and secret are never written or logged.
  const jwt = `${signed}.${createHmac("sha256", jwtSecret).update(signed).digest("base64url")}`;
  const status: SupabaseStatus = {
    API_URL: "http://127.0.0.1:55431",
    DB_URL: "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
    SERVICE_ROLE_KEY: jwt,
  };
  assertLoopbackApi(must(status.API_URL, "Local Supabase API"));
  assertLoopbackDatabase(must(status.DB_URL, "Local Supabase database"));
  must(status.SERVICE_ROLE_KEY, "Local Supabase service role key");
  return status;
}

async function verifyLocalPostgrest(status: SupabaseStatus): Promise<void> {
  const startedAt = Date.now();
  const response = await fetch(status.API_URL + "/rest/v1/agency_followup_journeys?select=id&limit=0", {
    headers: { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  progress(`local PostgREST health returned HTTP ${response.status} in ${Date.now() - startedAt}ms`);
  if (response.status !== 200) throw new Error("The disposable local PostgREST health check did not return HTTP 200.");
}

async function verifyPushedMigration(pathname: string, expectedBlob: string): Promise<void> {
  // Ask Git to apply the path clean filters so Windows CRLF checkouts match the pushed blob.
  const workingBlob = execFileSync("git", ["hash-object", "--path", pathname, pathname], { encoding: "utf8", timeout: 30_000 }).trim();
  if (workingBlob !== expectedBlob) {
    throw new Error(`Refusing local database use because ${path.basename(pathname)} no longer matches its verified pushed blob.`);
  }
}

function verifyPushedHead(sourceCommit: string): void {
  const remoteRef = "refs/heads/codex/crm-live-followup-20261019";
  const remoteCommit = execFileSync("git", ["ls-remote", "origin", remoteRef], { encoding: "utf8", timeout: 60_000 })
    .split(/\r?\n/).map((line) => line.trim()).find((line) => line.endsWith(`\t${remoteRef}`))?.split(/\s+/, 1)[0];
  if (remoteCommit !== sourceCommit) {
    throw new Error("Refusing walkthrough because the pushed CRM branch tip does not equal the exact source commit.");
  }
}

async function verifyDisposableTarget(pool: Pool): Promise<void> {
  progress("checking disposable database identity and migration ledger");
  const config = await readFile(path.join(STACK_DIR, "supabase", "config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*["']([^"']+)["']/m.exec(config)?.[1];
  if (projectId !== STACK_PROJECT_ID) throw new Error("Disposable Supabase project identity did not match the expected CRM walkthrough stack.");
  const [identity, migration] = await Promise.all([
    pool.query<{ database: string; address: string | null; port: string }>(
      "select current_database() as database, inet_server_addr()::text as address, current_setting('port') as port",
    ),
    pool.query<{ count: string }>(
      "select count(*)::text as count from supabase_migrations.schema_migrations where version = any($1::text[])",
      [["20261013154000", "20261013230354", "20261020025251", "20261020141945"]],
    ),
  ]);
  if (identity.rows[0]?.database !== "postgres" || !identity.rows[0]?.address || migration.rows[0]?.count !== "4") {
    throw new Error("Disposable Postgres identity or exact four-migration ledger check failed.");
  }
  const tables = await pool.query<{ count: string }>(
    "select count(*)::text as count from information_schema.tables where table_schema='public' and table_name = any($1::text[])",
    [["agency_followup_template_versions", "agency_followup_journeys", "agency_followup_steps",
      "agency_followup_enrollments", "agency_followup_messages", "agency_followup_events",
      "agency_followup_provider_events", "agency_followup_provider_event_applications",
      "prospect_contactability_provider_suppressions"]],
  );
  if (tables.rows[0]?.count !== "9") throw new Error("The verified disposable stack does not contain the six follow-up and three provider-event tables.");
  const providerGrants = await pool.query<{ service_access: boolean; public_access: boolean; public_update_access: boolean; service_event_column_update: boolean; service_event_table_update: boolean; service_event_other_column_update: boolean; immutable_event_trigger: boolean }>(
    "select bool_and(has_table_privilege('service_role', table_name, 'select') and has_table_privilege('service_role', table_name, 'insert')) as service_access, bool_or(has_table_privilege('anon', table_name, 'select') or has_table_privilege('authenticated', table_name, 'select')) as public_access, bool_or(has_table_privilege('anon', table_name, 'update') or has_table_privilege('authenticated', table_name, 'update')) as public_update_access, has_column_privilege('service_role', 'public.agency_followup_provider_events', 'provider_event_id', 'update') as service_event_column_update, has_table_privilege('service_role', 'public.agency_followup_provider_events', 'update') as service_event_table_update, has_column_privilege('service_role', 'public.agency_followup_provider_events', 'processing_result', 'update') as service_event_other_column_update, exists(select 1 from pg_trigger where tgrelid='public.agency_followup_provider_events'::regclass and tgname='agency_followup_provider_events_no_mutation' and not tgisinternal and tgenabled in ('O','A') and (tgtype & 2) = 2 and (tgtype & 8) = 8 and (tgtype & 16) = 16) as immutable_event_trigger from unnest(array['public.agency_followup_provider_events','public.agency_followup_provider_event_applications','public.prospect_contactability_provider_suppressions']) as event_table(table_name)",
  );
  if (providerGrants.rows[0]?.service_access !== true || providerGrants.rows[0]?.public_access !== false
    || providerGrants.rows[0]?.public_update_access !== false
    || providerGrants.rows[0]?.service_event_column_update !== true
    || providerGrants.rows[0]?.service_event_table_update !== false
    || providerGrants.rows[0]?.service_event_other_column_update !== false
    || providerGrants.rows[0]?.immutable_event_trigger !== true) {
    throw new Error("Provider-event row-lock privilege, append-only trigger, or restricted grants are not in the expected state.");
  }
  const grants = await pool.query<{ service_access: boolean; public_access: boolean }>(
    "select bool_and(has_table_privilege('service_role', table_name, 'select') and has_table_privilege('service_role', table_name, 'insert')) as service_access, bool_or(has_table_privilege('anon', table_name, 'select') or has_table_privilege('authenticated', table_name, 'select')) as public_access from unnest(array['public.agency_prospects','public.agency_deals','public.agency_reminders']) as crm_table(table_name)",
  );
  if (grants.rows[0]?.service_access !== true || grants.rows[0]?.public_access !== false) {
    throw new Error("Disposable Agency CRM service-role grants or public-role revocations are not in the expected state.");
  }
  progress("disposable identity, all four migration ledger versions, nine follow-up/provider tables, row-lock-only privilege, append-only trigger, and restricted grants checked");
}

async function verifyProviderEventImmutability(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const providerEventId = `walkthrough-immutability-${RUN_ID}`;
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query(
      "insert into public.agency_followup_provider_events (provider_event_id,event_type,occurred_at,processing_result) values ($1,'email.sent',now(),'unmatched_message')",
      [providerEventId],
    );
    await client.query("savepoint update_immutability_probe");
    let updateRejected = false;
    try {
      await client.query("update public.agency_followup_provider_events set provider_event_id=provider_event_id where provider_event_id=$1", [providerEventId]);
    } catch (error) {
      updateRejected = String(error).includes("Agency follow-up provider events are append-only");
    }
    await client.query("rollback to savepoint update_immutability_probe");
    if (!updateRejected) throw new Error("The provider event UPDATE immutability probe was not rejected by the append-only trigger.");
    await client.query("reset role");
    await client.query("savepoint delete_immutability_probe");
    let deleteRejected = false;
    try {
      await client.query("delete from public.agency_followup_provider_events where provider_event_id=$1", [providerEventId]);
    } catch (error) {
      deleteRejected = String(error).includes("Agency follow-up provider events are append-only");
    }
    await client.query("rollback to savepoint delete_immutability_probe");
    if (!deleteRejected) throw new Error("The provider event DELETE immutability probe was not rejected by the append-only trigger.");
    progress("disposable service_role UPDATE and owner DELETE probes were rejected by the append-only trigger; transaction rolled back");
  } finally {
    try { await client.query("rollback"); } finally { client.release(); }
  }
}

async function seedFixtures(pool: PoolClient): Promise<Fixtures> {
  const suffix = randomUUID().slice(0, 8);
  const firmId = randomUUID();
  const lawyerId = randomUUID();
  const fixtures: Fixtures = { firmId, lawyerId, prospects: {} };
  const names: Array<[string, string, string, "eligible" | "suppressed"]> = [
    ["normal", "Synthetic Walkthrough Normal " + suffix, "Jordan Example", "eligible"],
    ["pause", "Synthetic Walkthrough Pause " + suffix, "Riley Example", "eligible"],
    ["suppressed", "Synthetic Walkthrough Suppressed " + suffix, "Avery Example", "suppressed"],
    ["unknown", "Synthetic Walkthrough Unknown " + suffix, "Morgan Example", "eligible"],
    ["window", "Synthetic Walkthrough Window " + suffix, "Casey Example", "eligible"],
    ["lease", "Synthetic Walkthrough Lease " + suffix, "Quinn Example", "eligible"],
    ["retry", "Synthetic Walkthrough Retry " + suffix, "Devon Example", "eligible"],
  ];
  await pool.query("begin");
  try {
    progress("seeding synthetic operator and seven Agency prospects");
    await pool.query("insert into public.intake_firms (id,name) values ($1,$2)", [firmId, "Synthetic Agency Follow-up " + suffix]);
    await pool.query(
      "insert into public.firm_lawyers (id,firm_id,email,name,role,disabled) values ($1,$2,$3,$4,'operator',false)",
      [lawyerId, firmId, `operator-${suffix}@example.test`, "Synthetic CRM Operator"],
    );
    for (const [key, firmName, contactName, contactability] of names) {
      const prospectId = randomUUID();
      const email = `${key}-${suffix}@example.test`;
      await pool.query(
        "insert into public.agency_prospects (id,firm_name,contact_name,contact_email,stage,source,notes) values ($1,$2,$3,$4,'researching','synthetic_walkthrough','Synthetic local-only CRM walkthrough fixture')",
        [prospectId, firmName, contactName, email],
      );
      // The real Agency CRM after-insert trigger provisions shared organization,
      // person, source-link, conversation, and contactability history. Reuse
      // those rows so the walkthrough tests the same identity path as operators.
      const provisioned = await pool.query<{ conversation_id: string; source_link_id: string }>(
        "select conversation.id as conversation_id, source_link.id as source_link_id from public.prospect_source_links source_link join public.prospect_conversation_sources association on association.source_link_id=source_link.id join public.prospect_conversations conversation on conversation.id=association.conversation_id where source_link.source_system='agency_crm' and source_link.source_record_key=$1",
        [prospectId],
      );
      const conversationId = provisioned.rows[0]?.conversation_id;
      const sourceId = provisioned.rows[0]?.source_link_id;
      if (!conversationId || !sourceId) throw new Error("Agency prospect did not provision shared synthetic history rows.");
      await pool.query("update public.prospect_source_links set history_coverage='known_empty' where id=$1", [sourceId]);
      await pool.query("update public.prospect_conversations set status='awaiting_reply' where id=$1", [conversationId]);
      if (contactability === "suppressed") {
        await pool.query(
          "update public.prospect_contactability set state='suppressed',reason='Synthetic suppression hold',suppressed_at=now(),suppressed_by_operator_id=$2 where conversation_id=$1",
          [conversationId, lawyerId],
        );
      } else {
        await pool.query(
          "update public.prospect_contactability set state='eligible',reviewed_at=now() where conversation_id=$1",
          [conversationId],
        );
      }
      fixtures.prospects[key] = { id: prospectId, firmName, contactName, email, conversationId };
      progress(`seeded synthetic ${key} prospect through Agency CRM history trigger`);
    }
    await pool.query("commit");
    progress("synthetic fixture transaction committed");
    return fixtures;
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

async function installTemporaryDispatchRoute(): Promise<void> {
  progress("installing temporary local-only fake-dispatch route");
  try {
    await readFile(path.join(TEST_DISPATCH_DIR, "route.ts"));
    throw new Error("A walkthrough dispatch route already exists. Refusing to overwrite it.");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(TEST_DISPATCH_DIR, { recursive: false });
  const route = `import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { runFakeAgencyFollowupDispatcher } from "@/lib/agency-followup-service";
import type { AgencyProviderOutcome } from "@/lib/agency-followup-domain";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (process.env.NODE_ENV === "production" || !/^(127\\.0\\.0\\.1|localhost):55435$/.test(host)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!process.env.AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN ||
      body.token !== process.env.AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const outcomePlan = body.outcomePlan as AgencyProviderOutcome[] | undefined;
  if (outcomePlan && (!Array.isArray(outcomePlan) || outcomePlan.some((item) =>
      !item || !["accepted", "unknown", "definitive_retryable_failure", "definitive_permanent_failure"].includes(item.kind)))) {
    return NextResponse.json({ error: "Unsupported fake provider outcome." }, { status: 400 });
  }
  try {
    return NextResponse.json(await runFakeAgencyFollowupDispatcher({
      workerId: String(body.workerId ?? ""),
      now: typeof body.now === "string" ? body.now : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      outcomePlan,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fake dispatch failed." }, { status: 409 });
  }
}
`;
  await writeFile(path.join(TEST_DISPATCH_DIR, "route.ts"), route, "utf8");
  temporaryRouteInstalled = true;
  temporaryRouteSha256 = createHash("sha256").update(route).digest("hex");
  progress("temporary fake-dispatch route installed");
}

async function removeTemporaryDispatchRoute(): Promise<void> {
  if (!temporaryRouteInstalled) return;
  if (TEST_DISPATCH_DIR !== path.resolve("src/app/api/agency-followup-walkthrough")) {
    throw new Error("Refusing to clean a walkthrough route outside its exact source directory.");
  }
  await rm(TEST_DISPATCH_DIR, { recursive: true, force: true });
  temporaryRouteInstalled = false;
}

function startApp(portalSecret: string, walkthroughToken: string, status: SupabaseStatus): ChildProcess {
  const logPath = path.join(OUTPUT_DIR, "next-server.log");
  const stdoutPath = path.join(OUTPUT_DIR, "next-server.stdout.log");
  const stderrPath = path.join(OUTPUT_DIR, "next-server.stderr.log");
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stderrTail = "";
  const redact = (text: string) => text
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|PORTAL_SECRET|AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN)(\s*[=:]\s*)[^\s"']+/g, "$1$2[REDACTED]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]");
  const envClass = (value: string | undefined) =>
    value === "development" || value === "test" || value === "production" ? value : value ? "other" : "unset";
  const server = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "55435",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      PORTAL_SECRET: portalSecret,
      AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN: walkthroughToken,
      AGENCY_FOLLOWUP_SEND_MODE: "off",
      AGENCY_FOLLOWUP_RESEND_WEBHOOK_SECRET: SYNTHETIC_WEBHOOK_SECRET,
      PORT: "55435",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    const safe = redact(chunk.toString("utf8"));
    appendFileSync(logPath, safe);
    appendFileSync(stdoutPath, safe);
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    const safe = redact(chunk.toString("utf8"));
    stderrTail = (stderrTail + safe).slice(-4000);
    appendFileSync(logPath, safe);
    appendFileSync(stderrPath, safe);
  });
  server.once("spawn", () => progress(`Next child spawned pid=${server.pid}; parent NODE_ENV class=${envClass(process.env.NODE_ENV)}; child NODE_ENV=development`));
  server.once("error", (error) => progress("local Next process error: " + error.message));
  server.once("exit", (code, signal) => progress(`local Next process exited: code=${code} signal=${signal}; stdoutBytes=${stdoutBytes}; stderrBytes=${stderrBytes}`));
  server.once("close", (code, signal) => {
    progress(`local Next streams closed: code=${code} signal=${signal}; stdoutBytes=${stdoutBytes}; stderrBytes=${stderrBytes}`);
    if (stderrTail) progress(`local Next stderr tail (secrets redacted): ${stderrTail.replace(/\s+/g, " ").slice(-1200)}`);
  });
  return server;
}

function stopApp(server: ChildProcess): void {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { server.kill(); }
  } else {
    server.kill("SIGTERM");
  }
}

async function waitForApp(server: ChildProcess, fixtures: Fixtures): Promise<void> {
  const startedAt = Date.now();
  const startupDeadline = Math.min(absoluteDeadline, Date.now() + 10 * 60_000);
  const startupDiagnostics = setInterval(() => {
    progress(`Next startup still waiting; pid=${server.pid ?? "unknown"}; elapsed=${Math.floor((Date.now() - startedAt) / 1000)}s; childState=${server.exitCode === null ? "running" : `exit-${server.exitCode}`}`);
  }, 30000);
  const assertRunning = (stage: string) => {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Local Next child exited before ${stage}: code=${server.exitCode} signal=${server.signalCode}.`);
    }
  };
  setDiagnosticStage("next_listener_wait");
  try {
    await waitForListener(server, startupDeadline);
  } finally {
    clearInterval(startupDiagnostics);
  }
  assertRunning("unauthenticated API request");
  progress(`Next child is alive before unauthenticated request; pid=${server.pid}; exitCode=${server.exitCode}; signalCode=${server.signalCode}; loopbackListenerOwnerVerified=true`);
  progress(`55435 listener is ready; probing unauthenticated Agency follow-up API (expected 401 or 403; ${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  setDiagnosticStage("unauthenticated_api_probe");
  const unauthenticatedStartedAt = Date.now();
  const unauthenticatedProgress = setInterval(() => {
    progress(`unauthenticated API request still pending; elapsed=${Math.floor((Date.now() - unauthenticatedStartedAt) / 1000)}s; next child state=${server.exitCode === null ? "running" : `exit-${server.exitCode}`}`);
  }, 30000);
  let unauthenticated: Response;
  try {
    unauthenticated = await fetch(APP_ORIGIN + API_PATH, {
      signal: AbortSignal.any([runAbortController!.signal, AbortSignal.timeout(Math.min(360_000, remainingMs()))]),
    });
  } catch (error) {
    progress("unauthenticated API probe rejected " + JSON.stringify({
      stage: diagnosticStage,
      elapsedMs: Date.now() - unauthenticatedStartedAt,
      ...safeErrorDiagnostics(error),
      abortState: runAbortController?.signal.aborted ?? null,
      nextChildExitCode: server.exitCode,
      nextChildSignalCode: server.signalCode,
    }));
    throw error;
  } finally {
    clearInterval(unauthenticatedProgress);
  }
  progress(`unauthenticated Agency follow-up API returned HTTP ${unauthenticated.status}`);
  if (![401, 403].includes(unauthenticated.status)) {
    throw new Error("Unauthenticated Agency follow-up API returned unexpected HTTP " + unauthenticated.status + ".");
  }
  assertRunning("authenticated API request");
  progress(`Next child is alive before authenticated request; pid=${server.pid}; exitCode=${server.exitCode}; signalCode=${server.signalCode}; loopbackListenerOwnerVerified=true`);
  const cookie = createSessionCookie(fixtures.firmId, { role: "operator", lawyer_id: fixtures.lawyerId });
  progress(`probing authenticated Agency follow-up API (synthetic operator cookie; ${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  setDiagnosticStage("authenticated_api_probe");
  const authenticated = await fetch(APP_ORIGIN + API_PATH, {
    headers: { cookie: `${cookie.name}=${cookie.value}` },
    signal: AbortSignal.any([runAbortController!.signal, AbortSignal.timeout(Math.min(60_000, remainingMs()))]),
  });
  progress(`authenticated Agency follow-up API returned HTTP ${authenticated.status}`);
  if (authenticated.status !== 200) throw new Error("Authenticated Agency follow-up API returned HTTP " + authenticated.status + ".");
  assertRunning("authenticated API response");
  setDiagnosticStage("browser_ui_walkthrough");
}

async function waitForListener(server: ChildProcess, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Walkthrough was interrupted during local API startup.");
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Local Next child exited before binding: code=${server.exitCode} signal=${server.signalCode}.`);
    }
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port: 55435 });
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, Math.min(750, remainingMs(deadline)));
      socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once("error", () => { clearTimeout(timer); resolve(false); });
    });
    if (connected) {
      if (server.exitCode !== null || server.signalCode !== null) {
        throw new Error(`Local Next child exited as the port became reachable: code=${server.exitCode} signal=${server.signalCode}.`);
      }
      let listenerPid: number | undefined;
      try {
        progress("loopback TCP connected; resolving listener PID with bounded netstat inspection");
        const netstat = execFileSync("netstat", ["-ano", "-p", "tcp"], {
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
        });
        for (const line of netstat.split(/\r?\n/)) {
          const fields = line.trim().split(/\s+/);
          if (fields.length < 5 || fields[0].toUpperCase() !== "TCP") continue;
          if (!fields[1].endsWith(":55435") || fields[3].toUpperCase() !== "LISTENING") continue;
          const pid = Number(fields[4]);
          if (Number.isInteger(pid) && pid > 0) listenerPid = pid;
          break;
        }
      } catch (error) {
        throw new Error(`Could not verify owner of reachable 127.0.0.1:55435 listener: ${error instanceof Error ? error.message : String(error)}.`);
      }
      if (listenerPid === undefined) {
        throw new Error("TCP connect succeeded on 127.0.0.1:55435 but netstat reported no LISTENING owner.");
      }
      const owner = inspectWindowsProcessChain(listenerPid, server.pid!);
      if (!owner.isNextDescendant) {
        throw new Error(`Port 55435 is owned by unrelated PID ${listenerPid}, not Next child PID ${server.pid}; child exitCode=${server.exitCode} signalCode=${server.signalCode}. Owner chain: ${owner.summary}`);
      }
      progress(`Verified 127.0.0.1:55435 LISTENING owner PID=${listenerPid} is descended from Next child PID=${server.pid}; child exitCode=${server.exitCode}; signalCode=${server.signalCode}; process chain: ${owner.summary}`);
      return;
    }
    await delay(Math.min(500, remainingMs(deadline)));
  }
  throw new Error("Next did not bind 127.0.0.1:55435 within 10 minutes.");
}

function inspectWindowsProcessChain(listenerPid: number, nextPid: number): { isNextDescendant: boolean; summary: string } {
  if (process.platform !== "win32") {
    return { isNextDescendant: listenerPid === nextPid, summary: `owner=${listenerPid}, next=${nextPid}` };
  }
  const script = [
    `$current=${listenerPid}`,
    `$root=${nextPid}`,
    "$chain=@()",
    "for($i=0; $i -lt 10 -and $current -gt 0; $i++) {",
    "  $p=Get-CimInstance Win32_Process -Filter \"ProcessId=$current\"",
    "  if(-not $p) { break }",
    "  $chain += [pscustomobject]@{ ProcessId=$p.ProcessId; ParentProcessId=$p.ParentProcessId; Name=$p.Name; ExecutablePath=$p.ExecutablePath; CommandLine=$p.CommandLine }",
    "  if($p.ProcessId -eq $root) { break }",
    "  $current=$p.ParentProcessId",
    "}",
    "$chain | ConvertTo-Json -Compress",
  ].join(";");
  let raw: string;
  try {
    raw = execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Could not identify port owner process ancestry: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const parsed = JSON.parse(raw || "[]") as Array<{
    ProcessId: number;
    ParentProcessId: number;
    Name?: string;
    ExecutablePath?: string;
    CommandLine?: string;
  }> | {
    ProcessId: number;
    ParentProcessId: number;
    Name?: string;
    ExecutablePath?: string;
    CommandLine?: string;
  };
  const chain = Array.isArray(parsed) ? parsed : [parsed];
  const isNextDescendant = chain.some((entry) => Number(entry.ProcessId) === nextPid);
  const summary = chain.map((entry) => {
    const command = (entry.CommandLine ?? "").replace(/(SUPABASE_SERVICE_ROLE_KEY|PORTAL_SECRET|AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN)(\s*[=:]\s*)[^\s"']+/g, "$1$2[REDACTED]").slice(0, 240);
    return `pid=${entry.ProcessId} parent=${entry.ParentProcessId} exe=${entry.ExecutablePath ?? entry.Name ?? "unknown"} cwd=${process.cwd()} cmd=${command || "unknown"}`;
  }).join(" <- ");
  return { isNextDescendant, summary: summary || `owner PID ${listenerPid} not found in process table` };
}

async function signedContext(browser: Browser, fixtures: Fixtures, portalSecret: string): Promise<BrowserContext> {
  process.env.PORTAL_SECRET = portalSecret;
  const cookie = createSessionCookie(fixtures.firmId, { role: "operator", lawyer_id: fixtures.lawyerId });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: cookie.name, value: cookie.value, url: APP_ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  return context;
}

async function recordActionFailure(
  page: Page,
  action: string,
  button: ReturnType<Page["getByRole"]>,
  error: unknown,
): Promise<string> {
  const diagnostics = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      buttonText: element.textContent?.trim().slice(0, 100) ?? "",
      disabled: (element as HTMLButtonElement).disabled,
      ariaDisabled: element.getAttribute("aria-disabled"),
      visible: rect.width > 0 && rect.height > 0,
      pointerEvents: getComputedStyle(element).pointerEvents,
      hitTargetTag: hitTarget?.tagName ?? null,
      hitTargetText: hitTarget?.textContent?.trim().slice(0, 100) ?? "",
      pageTitle: document.title,
      pageText: document.body.innerText.slice(0, 800),
    };
  }).catch(() => null);
  const browserRuntimeErrors = browserRuntimeErrorsByPage.get(page)?.slice(-20) ?? [];
  await mkdir(path.join(OUTPUT_DIR, "screenshots"), { recursive: true });
  const screenshotPath = path.join(OUTPUT_DIR, "screenshots", `failure-${action}-${RUN_ID}.png`);
  const screenshotWritten = await page.screenshot({ path: screenshotPath, fullPage: true }).then(() => true, () => false);
  const errorMessage = String(error).replace(/[\r\n\s]+/g, " ")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").slice(0, 500);
  const failureReceipt = { runId: RUN_ID, action, errorMessage, diagnostics, browserRuntimeErrors, screenshot: screenshotWritten ? path.basename(screenshotPath) : null, recordedAtUtc: new Date().toISOString() };
  await writeFile(path.join(OUTPUT_DIR, `failure-${action}-${RUN_ID}.json`), JSON.stringify(failureReceipt, null, 2) + "\n", "utf8");
  progress(`operator action ${action} failed; diagnostics=${JSON.stringify(diagnostics)}; screenshot=${screenshotWritten ? path.basename(screenshotPath) : "unavailable"}; message=${errorMessage}`);
  return errorMessage;
}

async function waitForAction(
  page: Page,
  action: string,
  button: ReturnType<Page["getByRole"]>,
  enabledTimeoutMs = 30_000,
): Promise<void> {
  setDiagnosticStage(`browser_action_${action}`);
  try {
    await button.waitFor({ state: "visible", timeout: Math.min(90_000, remainingMs()) });
    if (!(await button.isEnabled())) {
      const state = await button.evaluate((element) => {
        const form = element.closest("form");
        return {
          buttonDisabled: (element as HTMLButtonElement).disabled,
          reactAttached: Boolean(form && Object.keys(form).some((key) => key.startsWith("__reactProps$"))),
          controls: [...(form?.querySelectorAll("input,textarea,select") ?? [])].map((control) => ({
            valueLength: (control as HTMLInputElement).value.length,
            reactAttached: Object.keys(control).some((key) => key.startsWith("__reactProps$")),
          })),
        };
      });
      progress(`button ${action} initially disabled; React form diagnostics=${JSON.stringify(state)}`);
    }
    await expect(button).toBeEnabled({ timeout: Math.min(enabledTimeoutMs, remainingMs()) });
  } catch (error) {
    const errorMessage = await recordActionFailure(page, action, button, error);
    throw new Error(`Operator action ${action} readiness failed: ${errorMessage}`);
  }
  // The initial page explicitly verifies controlled-input hydration. For later
  // actions, the enabled locator and Playwright's click actionability checks
  // provide the readiness gate without waiting on unrelated page network work.
  // Start the correlated response waiter immediately before the click.
  const responsePromise = page.waitForResponse((response) => {
    const matched = new URL(response.url()).pathname === API_PATH && response.request().method() === "POST";
    if (matched) progress(`waiter matched Agency CRM POST response HTTP ${response.status()}`);
    return matched;
  }, { timeout: Math.min(60_000, remainingMs()) }).then(
    (response) => ({ ok: true as const, response }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await button.click({ timeout: Math.min(60_000, remainingMs()) });
  } catch (error) {
    const errorMessage = await recordActionFailure(page, action, button, error);
    throw new Error(`Operator action ${action} button click failed: ${errorMessage}`);
  }
  let response: Awaited<typeof responsePromise>;
  try {
    const result = await responsePromise;
    if (!result.ok) throw result.error;
    response = result.response;
  } catch (error) {
    const errorMessage = await recordActionFailure(page, action, button, error);
    throw new Error(`Operator action ${action} produced no POST response: ${errorMessage}`);
  }
  if (response.status() === 401) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    if (payload.error === "Unauthorized") {
      // Membership revalidation can fail closed when the disposable local
      // PostgREST fetch has a brief transport interruption. Retry only after
      // this same signed browser session proves the protected GET is healthy.
      const health = await page.context().request.get(APP_ORIGIN + API_PATH, { timeout: 15000 }).catch(() => undefined);
      if (health?.status() === 200) {
        progress(`operator action ${action} received transient 401; same-session authenticated health check returned 200; retrying once`);
        const retryResponse = page.waitForResponse((candidate) =>
          new URL(candidate.url()).pathname === API_PATH && candidate.request().method() === "POST",
          { timeout: 60000 },
        );
        await button.click();
        response = await retryResponse;
      }
    }
  }
  let actualAction = "unknown";
  try { actualAction = String(response.request().postDataJSON()?.action ?? "unknown"); } catch { /* keep the diagnostic label */ }
  progress(`operator action response: expected=${action}; actual=${actualAction}; HTTP=${response.status()}`);
  if (actualAction !== action) throw new Error(`Operator action expected ${action} but observed ${actualAction} (HTTP ${response.status()}).`);
  if (!response.ok()) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const detail = typeof payload.error === "string"
      ? payload.error.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").slice(0, 240)
      : "no safe error detail";
    progress(`operator action safe error detail: ${detail}`);
    throw new Error(`Operator action ${action} failed with HTTP ${response.status()}: ${detail}`);
  }
}

function queueCard(page: Page, firmName: string) {
  return page.locator('section[aria-labelledby="queue-title"] article').filter({ hasText: firmName }).first();
}

async function authorJourney(page: Page): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const templateKey = "walkthrough-" + suffix;
  const journeyKey = "walkthrough-" + suffix;
  const journeyName = "Synthetic follow-up " + suffix;
  await page.getByLabel("Template key").fill(templateKey);
  await page.getByLabel("Email subject").fill("A synthetic follow-up question");
  await page.getByLabel("Email body").fill("Hello. This message is a local synthetic review fixture and is never sent to a provider.");
  await waitForAction(page, "template_create", page.getByRole("button", { name: "Create template draft" }));
  const templateCard = page.locator("article").filter({ hasText: templateKey }).first();
  const templateApprovalButton = templateCard.getByRole("button", { name: "Approve template v1" });
  await templateApprovalButton.waitFor({ state: "visible", timeout: Math.min(90_000, remainingMs()) });
  await waitForAction(page, "template_approve", templateApprovalButton);
  const approvedTemplateOption = page.getByLabel("Template version").locator("option").filter({ hasText: templateKey + " v1" });
  await expect(approvedTemplateOption).toHaveCount(1, { timeout: Math.min(90_000, remainingMs()) });

  await page.getByLabel("Journey key").fill(journeyKey);
  await page.getByLabel("Journey name").fill(journeyName);
  await page.getByLabel("IANA timezone").fill("America/Toronto");
  await page.getByLabel("Local window start").fill("00:00");
  await page.getByLabel("Local window end").fill("23:59");
  await page.getByLabel("Minimum spacing between scheduled messages, hours").fill("0");
  const addStep = page.getByRole("button", { name: "Add step", exact: true });
  await addStep.click();
  const templateSelects = page.getByLabel("Template version");
  await templateSelects.nth(0).selectOption({ label: templateKey + " v1" });
  await templateSelects.nth(1).selectOption({ label: templateKey + " v1" });
  await page.getByLabel("Delay, business days").nth(1).fill("1");
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const createdJourneyRow = page.getByText(journeyName + " v1 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", createdJourneyRow.getByRole("button", { name: "Activate version" }));
  const journeyOptions = page.getByLabel("Journey version").locator("option");
  const versionOneOption = journeyOptions.filter({ hasText: journeyName + " v1" });
  try {
    await expect(versionOneOption).toHaveCount(1, { timeout: 30000 });
  } catch (error) {
    const options = await journeyOptions.allTextContents().catch(() => []);
    const alert = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    throw new Error(`Activated journey did not appear in the review selector. Current options=${JSON.stringify(options)}; alerts=${JSON.stringify(alert)}. ${String(error)}`);
  }

  const otherJourneyKey = journeyKey + "-other";
  const otherJourneyName = journeyName + " other";
  await page.getByLabel("Journey key").fill(otherJourneyKey);
  await page.getByLabel("Journey name").fill(otherJourneyName);
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const otherJourneyDraft = page.getByText(otherJourneyName + " v1 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", otherJourneyDraft.getByRole("button", { name: "Activate version" }));
  const otherJourneyOption = journeyOptions.filter({ hasText: otherJourneyName + " v1" });
  await expect(otherJourneyOption).toHaveCount(1);

  const mixedCaseJourneyKey = "  " + journeyKey.toUpperCase() + "  ";
  if (mixedCaseJourneyKey.trim().toLowerCase() !== journeyKey) {
    throw new Error("Mixed-case regression fixture must normalize to the original journey key.");
  }
  await page.getByLabel("Journey key").fill(mixedCaseJourneyKey);
  await page.getByLabel("Journey name").fill(journeyName);
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const journeyV2Draft = page.getByText(journeyName + " v2 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", journeyV2Draft.getByRole("button", { name: "Activate version" }));
  await expect(page.getByText(journeyName + " v1 · retired", { exact: false })).toBeVisible();
  await expect(page.getByText(journeyName + " v2 · active", { exact: false })).toBeVisible();
  await expect(versionOneOption).toHaveCount(0);
  const versionTwoOption = journeyOptions.filter({ hasText: journeyName + " v2" });
  await expect(versionTwoOption).toHaveCount(1);
  await expect(otherJourneyOption).toHaveCount(1);
  journeyVersionRegressionResult = {
    sameKeyV1Retired: true,
    sameKeyV1AbsentFromSelector: true,
    sameKeyV2ActiveAndAvailable: true,
    otherKeyV1RemainsAvailable: true,
  };
  await page.getByLabel("Journey version").selectOption({ label: journeyName + " v2" });
  return journeyName + " v2";
}

async function createDraft(pool: Pool, page: Page, journeyVersionLabel: string, prospect: ProspectFixture): Promise<void> {
  await page.getByLabel("Journey version").selectOption({ label: journeyVersionLabel });
  await page.getByLabel("Find one prospect").fill(prospect.firmName);
  const searchResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/admin/agency-crm/prospects?") && response.request().method() === "GET",
    { timeout: 360000 },
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const searchResponse = await searchResponsePromise;
  const searchPayload = await searchResponse.json() as { items?: ProspectSearchMatch[]; error?: string };
  const exactMatch = Array.isArray(searchPayload.items)
    ? searchPayload.items.find((item) => item.id === prospect.id || item.firm_name === prospect.firmName)
    : undefined;
  const searchError = (searchPayload.error ?? "").replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").slice(0, 240);
  progress(`prospect search HTTP ${searchResponse.status()}; returned=${Array.isArray(searchPayload.items) ? searchPayload.items.length : "invalid"}; exactFixtureMatch=${Boolean(exactMatch)}; matchHasEmail=${Boolean(exactMatch?.contact_email)}${searchError ? `; error=${searchError}` : ""}`);
  if (!searchResponse.ok()) throw new Error(`Synthetic prospect search returned HTTP ${searchResponse.status()}${searchError ? `: ${searchError}` : "."}`);
  const existingEnrollments = await countRows(pool, "select count(*)::text as count from agency_followup_enrollments where prospect_id=$1", [prospect.id]);
  progress(`synthetic fixture enrollment count before UI enrollment=${existingEnrollments}`);
  const match = page.getByRole("listitem").filter({ hasText: prospect.firmName }).first();
  await match.waitFor({ state: "visible", timeout: 30000 });
  await waitForAction(page, "enroll", match.getByRole("button", { name: "Create draft review" }));
}

async function markEligibleAndRelease(page: Page, prospect: ProspectFixture): Promise<void> {
  const card = queueCard(page, prospect.firmName);
  const evidenceControl = card.getByLabel("Eligibility evidence for this prospect");
  progress("waiting for the required eligibility control to render for " + prospect.firmName);
  await evidenceControl.waitFor({ state: "visible", timeout: Math.min(90_000, remainingMs()) });
  await evidenceControl.fill("Synthetic evidence for local walkthrough only.");
  await waitForAction(page, "eligibility", card.getByRole("button", { name: "Record eligible" }));
  await card.getByLabel("Individual release basis").fill("Synthetic walkthrough approval basis.");
  await waitForAction(
    page,
    "release",
    card.getByRole("button", { name: "Release this prospect" }),
    Math.min(90_000, remainingMs()),
  );
}

async function postAction(context: BrowserContext, data: Record<string, unknown>): Promise<APIResponse> {
  let response = await context.request.post(APP_ORIGIN + API_PATH, { data });
  if (response.status() === 401) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    if (payload.error === "Unauthorized") {
      // The disposable local membership lookup can briefly fail closed before
      // the protected API is healthy again. A 401 is rejected before action
      // dispatch, so retry once only after this same signed context proves GET.
      const health = await context.request.get(APP_ORIGIN + API_PATH, { timeout: 15000 }).catch(() => undefined);
      if (health?.status() === 200) {
        progress(`synthetic ${String(data.action ?? "unknown")} probe received transient 401; same-session authenticated health check returned 200; retrying once`);
        response = await context.request.post(APP_ORIGIN + API_PATH, { data });
      }
    }
  }
  return response;
}

async function dispatchFake(
  context: BrowserContext,
  token: string,
  input: { workerId: string; limit?: number; now?: string; outcomePlan?: Array<Record<string, unknown>> },
): Promise<Record<string, number>> {
  const response = await context.request.post(APP_ORIGIN + TEST_DISPATCH_PATH, { data: { ...input, token } });
  if (!response.ok()) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const detail = typeof payload.error === "string"
      ? payload.error.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 200)
      : "no_safe_error_detail";
    progress(`fake dispatcher HTTP ${response.status()}; safeError=${detail}`);
    throw new Error("Local fake dispatcher endpoint returned HTTP " + response.status() + ": " + detail);
  }
  return await response.json() as Record<string, number>;
}

async function postSyntheticResendEvent(providerEventId: string, payload: Record<string, unknown>): Promise<{ status: number; outcome: string; error: string }> {
  setDiagnosticStage("synthetic_signed_webhook");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(payload);
  const signingKey = Buffer.from(SYNTHETIC_WEBHOOK_SECRET.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", signingKey)
    .update(`${providerEventId}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");
  progress("sending synthetic signed provider event to the local webhook");
  const response = await fetch(APP_ORIGIN + "/api/webhooks/resend/agency-followup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": providerEventId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body: rawBody,
    signal: AbortSignal.timeout(Math.min(90_000, remainingMs())),
  });
  const result = await response.json().catch(() => ({})) as { outcome?: unknown; error?: unknown };
  const receipt = {
    status: response.status,
    outcome: typeof result.outcome === "string" ? result.outcome : "none",
    error: typeof result.error === "string" ? result.error.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 120) : "none",
  };
  progress(`synthetic signed provider event returned HTTP ${receipt.status}; outcome=${receipt.outcome}; error=${receipt.error}`);
  return receipt;
}

async function warmResendWebhookRoute(): Promise<void> {
  setDiagnosticStage("resend_webhook_cold_route_preflight");
  const response = await fetch(APP_ORIGIN + "/api/webhooks/resend/agency-followup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(Math.min(90_000, remainingMs())),
  });
  const result = await response.json().catch(() => ({})) as { error?: unknown };
  if (response.status !== 400 || result.error !== "invalid_signature") {
    throw new Error(`Unsigned local webhook preflight expected HTTP 400 invalid_signature; got HTTP ${response.status}.`);
  }
  progress("local webhook route compiled; unsigned preflight returned HTTP 400 before persistence");
}

async function withFixtureClaim<T>(pool: Pool, messageId: string, operation: () => Promise<T>): Promise<T> {
  // Keep retained scheduled fixtures out of this claim without rewriting them.
  // The real claim RPC still selects the target using FOR UPDATE SKIP LOCKED.
  const guard = await pool.connect();
  try {
    await guard.query("begin");
    await guard.query("set local lock_timeout = '3s'");
    await guard.query("select id from public.agency_followup_messages where state='scheduled' and id<>$1 order by id for update", [messageId]);
    return await operation();
  } finally {
    try { await guard.query("rollback"); } finally { guard.release(); }
  }
}

async function countRows(pool: Pool, query: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ count: string }>(query, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function auditRenderedCopy(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const failures: string[] = [];
    const components = document.querySelectorAll<HTMLElement>('[data-ui-component-content^="agency-follow-up-"]');
    for (const component of components) {
      const bounds = component.getBoundingClientRect();
      const style = getComputedStyle(component);
      const left = bounds.left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
      const right = bounds.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth);
      for (const copy of component.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
        if (copy.closest("[data-ui-component-content]") !== component || !copy.getClientRects().length) continue;
        const tag = component.dataset.uiComponentContent + "/" + copy.dataset.uiCopy;
        const box = copy.getBoundingClientRect();
        if (Math.abs(box.left - left) > 1 || Math.abs(box.right - right) > 1) failures.push(tag + ": copy does not use full content width");
        if (copy.textContent?.includes("\u2014")) failures.push(tag + ": em dash");
        const words: Array<{ top: number; left: number; right: number; text: string }> = [];
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            for (const rect of range.getClientRects()) if (rect.width && rect.height) words.push({ top: rect.top, left: rect.left, right: rect.right, text: match[0] });
          }
        }
        const lines: Array<typeof words> = [];
        for (const word of words) {
          const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1);
          if (line) line.push(word); else lines.push([word]);
        }
        lines.sort((a, b) => a[0].top - b[0].top);
        if (lines.length > 1 && lines.at(-1)!.length === 1) failures.push(tag + `: single-word final line "${lines.at(-1)![0].text}" after "${lines.at(-2)!.map((word) => word.text).join(" ")}"`);
        for (let index = 0; index < lines.length - 1; index += 1) {
          const line = lines[index];
          const width = Math.max(...line.map((word) => word.right)) - Math.min(...line.map((word) => word.left));
          const remaining = right - Math.max(...line.map((word) => word.right));
          if (width < (right - left) * 0.75 && lines[index + 1][0].right - lines[index + 1][0].left + 5 <= remaining) {
            failures.push(tag + `: avoidably short nonfinal line "${line.map((word) => word.text).join(" ")}" before "${lines[index + 1].map((word) => word.text).join(" ")}"`);
          }
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) failures.push("page: horizontal overflow");
    return failures;
  });
}

async function runBrowserWalkthrough(pool: Pool, fixtures: Fixtures, portalSecret: string, walkthroughToken: string): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  activeBrowser = browser;
  const context = await signedContext(browser, fixtures, portalSecret);
  try {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(180_000);
  const responseFailures: string[] = [];
  const recoveredBrowserRuntimeErrors: string[] = [];
  let initialChunkRecoveryReloaded = false;
  browserRuntimeErrorsByPage.set(page, responseFailures);
  page.on("pageerror", (error) => responseFailures.push("page error: " + error.message));
  page.on("console", (message) => {
    const text = message.text();
    // Chromium reports the deliberately blocked suppressed-prospect release
    // as a console resource error; that API response is asserted as HTTP 409.
    if (message.type() === "error" && !/Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(text)) {
      responseFailures.push("browser console: " + text);
    }
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/_next/")) responseFailures.push(`asset request failed: ${pathname}; ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes("/_next/") && response.status() >= 400) responseFailures.push(`asset response ${response.status()}: ${pathname}`);
    if (pathname === API_PATH && response.request().method() === "POST") progress(`browser observed Agency CRM POST response HTTP ${response.status()}`);
  });
  progress(`opening actual operator queue UI (${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/_next/static/chunks/app/layout.js") progress("browser requested Next app/layout.js chunk");
    if (pathname === API_PATH && request.method() === "POST") {
      let action = "unknown";
      try { action = String(request.postDataJSON()?.action ?? "unknown"); } catch { /* report only the request path */ }
      progress(`browser emitted Agency CRM POST action=${action}`);
    }
  });
  await page.goto(APP_ORIGIN + "/admin/agency-crm/follow-up", { waitUntil: "domcontentloaded", timeout: 180_000 });
  const layoutChunkStartedAt = Date.now();
  try {
    const layoutChunkResponse = await context.request.get(APP_ORIGIN + "/_next/static/chunks/app/layout.js", { timeout: Math.min(180_000, remainingMs()) });
    const layoutChunkBody = await layoutChunkResponse.body();
    progress(`direct app/layout.js asset probe returned HTTP ${layoutChunkResponse.status()}; bytes=${layoutChunkBody.byteLength}; elapsed=${Date.now() - layoutChunkStartedAt}ms`);
  } catch (error) {
    progress(`direct app/layout.js asset probe failed after ${Date.now() - layoutChunkStartedAt}ms: ${String(error).replace(/\\s+/g, " ").slice(0, 300)}`);
    throw error;
  }
  if (await page.getByText(/This page couldn.t load/i).count()) {
    progress("Next rendered its chunk-recovery page during cold compilation; reloading once after the direct asset probe");
    await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
    initialChunkRecoveryReloaded = true;
  }
  await page.locator('[data-ui-component-content="agency-follow-up-queue"]').waitFor();

  if (FAILURE_CAPTURE_PREFLIGHT_ONLY) {
    const disabledButton = page.locator("button[disabled]").first();
    await disabledButton.waitFor({ state: "visible", timeout: Math.min(15_000, remainingMs()) });
    try {
      await waitForAction(page, "capture_preflight", disabledButton, 1000);
      throw new Error("Failure-capture preflight unexpectedly accepted a disabled control.");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Operator action capture_preflight readiness failed:")) throw error;
    }
    const receiptPath = path.join(OUTPUT_DIR, `failure-capture_preflight-${RUN_ID}.json`);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { runId?: string; action?: string; errorMessage?: string; screenshot?: string };
    if (receipt.runId !== RUN_ID || receipt.action !== "capture_preflight" || !receipt.errorMessage || !receipt.screenshot) {
      throw new Error("Failure-capture preflight receipt is missing its run, action, error, or screenshot fields.");
    }
    const screenshotPath = path.join(OUTPUT_DIR, "screenshots", receipt.screenshot);
    const screenshotBytes = await readFile(screenshotPath);
    if (!screenshotBytes.byteLength) throw new Error("Failure-capture preflight screenshot is empty.");
    const receiptSha256 = createHash("sha256").update(await readFile(receiptPath)).digest("hex");
    const screenshotSha256 = createHash("sha256").update(screenshotBytes).digest("hex");
    progress(`failure-capture preflight verified receipt=${path.basename(receiptPath)} bytes=${(await readFile(receiptPath)).byteLength} sha256=${receiptSha256}; screenshot=${receipt.screenshot} bytes=${screenshotBytes.byteLength} sha256=${screenshotSha256}`);
    return {
      runId: RUN_ID,
      ...sourceAtStart,
      sourceAtStart,
      synthetic: true,
      failureCapturePreflight: { action: receipt.action, errorRecorded: true, screenshotCaptured: true, receiptPath: path.relative(process.cwd(), receiptPath), receiptSha256, screenshotPath: path.relative(process.cwd(), screenshotPath), screenshotBytes: screenshotBytes.byteLength, screenshotSha256 },
      startedAtUtc: RUN_STARTED_AT,
      endedAtUtc: new Date().toISOString(),
      command: "npm run agency-followup:walkthrough -- --failure-capture-preflight",
    };
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  setDiagnosticStage("browser_form_hydration");
  try {
    await page.waitForFunction(() => {
      // The template key is a controlled input with an onChange handler, so
      // React attaches its event props to this input after hydration. Checking
      // this concrete control is more stable than assuming the form node is
      // the element carrying React's delegated event props.
      const control = document.querySelector("main form input");
      return Boolean(control && Object.keys(control).some((key) => key.startsWith("__reactProps$")));
    }, null, { polling: "raf", timeout: 180000 });
    progress("operator form hydration confirmed on controlled template input");
  } catch (error) {
    let hydrationError: unknown = error;
    let recovered = false;
    if (await page.getByText(/This page couldn.t load/i).count()) {
      progress("Next rendered its chunk-recovery page during hydration; reloading once after compilation");
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
        await page.waitForFunction(() => {
          const control = document.querySelector("main form input");
          return Boolean(control && Object.keys(control).some((key) => key.startsWith("__reactProps$")));
        }, null, { polling: "raf", timeout: Math.min(120_000, remainingMs()) });
        recovered = true;
        progress("operator form hydration confirmed after one chunk-recovery reload");
      } catch (retryError) {
        hydrationError = retryError;
      }
    }
    if (!recovered) {
      const diagnostics = await page.evaluate(() => ({
        readyState: document.readyState,
        title: document.title,
        mainCount: document.querySelectorAll("main").length,
        formCount: document.querySelectorAll("main form").length,
        scriptCount: document.scripts.length,
        controlledInput: (() => {
          const control = document.querySelector("main form input");
          return control ? {
            type: (control as HTMLInputElement).type,
            valueLength: (control as HTMLInputElement).value.length,
            reactAttached: Object.keys(control).some((key) => key.startsWith("__reactProps$")),
          } : null;
        })(),
        nextScripts: [...document.scripts].map((script) => script.src).filter((src) => src.includes("/_next/")),
        nextResources: performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname).filter((pathname) => pathname.includes("/_next/")),
        pageText: document.body.innerText.slice(0, 1000),
      })).catch(() => null);
      await mkdir(path.join(OUTPUT_DIR, "screenshots"), { recursive: true });
      const screenshotPath = path.join(OUTPUT_DIR, "screenshots", `failure-hydration-${RUN_ID}.png`);
      const screenshotWritten = await page.screenshot({ path: screenshotPath, fullPage: true }).then(() => true, () => false);
      const errorMessage = String(hydrationError).replace(/[\r\n\s]+/g, " ")
        .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").slice(0, 1000);
      const failureReceipt = {
        runId: RUN_ID,
        stage: "browser_form_hydration",
        errorMessage,
        diagnostics,
        browserRuntimeErrors: responseFailures.slice(-20),
        screenshot: screenshotWritten ? path.basename(screenshotPath) : null,
        recordedAtUtc: new Date().toISOString(),
      };
      const receiptPath = path.join(OUTPUT_DIR, `failure-browser_form_hydration-${RUN_ID}.json`);
      await writeFile(receiptPath, JSON.stringify(failureReceipt, null, 2) + "\n", "utf8");
      progress(`operator form hydration failed; receipt=${path.basename(receiptPath)}; screenshot=${failureReceipt.screenshot ?? "unavailable"}; browserErrors=${JSON.stringify(failureReceipt.browserRuntimeErrors)}`);
      throw new Error(`Operator UI did not hydrate its controlled template input. Receipt=${path.basename(receiptPath)}; ${errorMessage}`);
    }
  }

  // A cold Next dev compilation can time out the initial App Router layout
  // chunk. Treat only that exact error as recovered, and only after the
  // controlled reload above plus the controlled-input hydration assertion
  // succeeded. Keep the original error in the run receipt for auditability.
  if (initialChunkRecoveryReloaded) {
    const recoveredChunkFailure = /^(?:page error|browser console): .*ChunkLoadError: Loading chunk app\/layout failed\./;
    for (let index = responseFailures.length - 1; index >= 0; index--) {
      if (recoveredChunkFailure.test(responseFailures[index])) {
        recoveredBrowserRuntimeErrors.unshift(responseFailures[index]);
        responseFailures.splice(index, 1);
      }
    }
    if (recoveredBrowserRuntimeErrors.length) {
      progress(`initial layout chunk error recovered by one reload and successful form hydration; captured=${JSON.stringify(recoveredBrowserRuntimeErrors)}`);
    }
  }

  const journeyName = await authorJourney(page);
  const normal = fixtures.prospects.normal;
  await createDraft(pool, page, journeyName, normal);
  setDiagnosticStage("duplicate_enrollment_conflict");
  const duplicate = await postAction(context, {
    action: "enroll",
    journeyId: await page.getByLabel("Journey version").inputValue(),
    prospectId: normal.id,
  });
  if (duplicate.status() !== 409) throw new Error("Repeated enrollment did not return the expected conflict response.");
  if (await countRows(pool, "select count(*)::text as count from agency_followup_enrollments where prospect_id=$1", [normal.id]) !== 1) {
    throw new Error("Repeated enrollment created a duplicate row.");
  }
  await markEligibleAndRelease(page, normal);
  const normalCard = queueCard(page, normal.firmName);
  const normalApprovalButtons = normalCard.getByRole("button", { name: "Approve this message" });
  await waitForAction(page, "approve", normalApprovalButtons.nth(0));
  await expect(normalCard.getByText("scheduled", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(normalCard.getByRole("button", { name: "Approve this message" })).toHaveCount(1, { timeout: 30000 });
  await waitForAction(page, "approve", queueCard(page, normal.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  await expect(queueCard(page, normal.firmName).getByText("scheduled", { exact: true })).toHaveCount(2, { timeout: 30000 });
  // The action starts an App Router refresh without awaiting it. Wait until
  // both updated message states are rendered before changing the DB fixture
  // and doing a full reload, so the refresh and navigation cannot overlap.
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  const normalMessages = await pool.query<{ id: string; step_number: number; state: string }>(
    "select id,step_number,state from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) order by step_number",
    [normal.id],
  );
  if (normalMessages.rows.length !== 2 || normalMessages.rows.some((row) => row.state !== "scheduled")) {
    throw new Error("The normal two-step flow did not reach per-message scheduled review.");
  }
  const firstNormalMessage = normalMessages.rows[0];
  const acceptedClock = new Date();
  acceptedClock.setUTCHours(16, 0, 0, 0);
  if (acceptedClock.getTime() <= Date.now()) acceptedClock.setUTCDate(acceptedClock.getUTCDate() + 1);
  while (acceptedClock.getUTCDay() === 0 || acceptedClock.getUTCDay() === 6) acceptedClock.setUTCDate(acceptedClock.getUTCDate() + 1);
  const acceptedNow = acceptedClock.toISOString();
  const acceptedDueAt = new Date(acceptedClock.getTime() - 60_000).toISOString();
  await pool.query("update agency_followup_messages set scheduled_at=$2 where id=$1", [firstNormalMessage.id, acceptedDueAt]);

  // Edit a reviewed snapshot in the disposable database to exercise the real
  // invalidation trigger. The trigger must clear reviewer/time and re-open review.
  const secondNormalMessage = normalMessages.rows[1];
  await pool.query(
    "update agency_followup_messages set content_snapshot=jsonb_set(content_snapshot,'{subject}','\"Changed in synthetic test\"'::jsonb) where id=$1",
    [secondNormalMessage.id],
  );
  const invalidated = await pool.query<{ state: string; reviewed_by_operator_id: string | null; reviewed_at: string | null }>(
    "select state,reviewed_by_operator_id,reviewed_at from agency_followup_messages where id=$1",
    [secondNormalMessage.id],
  );
  if (invalidated.rows[0]?.state !== "awaiting_review" || invalidated.rows[0]?.reviewed_by_operator_id !== null || invalidated.rows[0]?.reviewed_at !== null) {
    throw new Error("Content change did not invalidate the reviewed message.");
  }
  await page.reload({ waitUntil: "networkidle" });
  await expect(queueCard(page, normal.firmName).getByText("awaiting review", { exact: true })).toBeVisible();

  const acceptedResult = await withFixtureClaim(pool, firstNormalMessage.id, () => dispatchFake(context, walkthroughToken, { workerId: "synthetic-walkthrough-accepted", now: acceptedNow, limit: 1 }));
  const accepted = await pool.query<{ state: string; provider_message_id: string | null }>(
    "select state,provider_message_id from agency_followup_messages where id=$1",
    [firstNormalMessage.id],
  );
  if (acceptedResult.accepted < 1 || accepted.rows[0]?.state !== "accepted" || !accepted.rows[0]?.provider_message_id?.startsWith("fake-provider-")) {
    throw new Error("Normal fake-provider dispatch did not persist an accepted synthetic outcome.");
  }

  const pauseProspect = fixtures.prospects.pause;
  await createDraft(pool, page, journeyName, pauseProspect);
  await markEligibleAndRelease(page, pauseProspect);
  const pauseCard = queueCard(page, pauseProspect.firmName);
  await waitForAction(page, "approve", pauseCard.getByRole("button", { name: "Approve this message" }).nth(0));
  await waitForAction(page, "pause", queueCard(page, pauseProspect.firmName).getByRole("button", { name: "Pause journey" }));
  const pauseRows = await pool.query<{ state: string }>(
    "select state from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) order by step_number",
    [pauseProspect.id],
  );
  if (pauseRows.rows[0]?.state !== "cancelled" || pauseRows.rows[1]?.state !== "awaiting_review") {
    throw new Error("Pause did not cancel the approved schedule while preserving the unapproved draft.");
  }

  const suppressed = fixtures.prospects.suppressed;
  await createDraft(pool, page, journeyName, suppressed);
  await markEligibleAndReleaseAttempt(page, suppressed);
  const suppressedEnrollment = await pool.query<{ state: string; released_at: string | null }>(
    "select state,released_at from agency_followup_enrollments where prospect_id=$1",
    [suppressed.id],
  );
  if (suppressedEnrollment.rows[0]?.state !== "draft" || suppressedEnrollment.rows[0]?.released_at !== null ||
    !(await page.getByRole("alert").filter({ hasText: /suppress/i }).count())) {
    throw new Error("Suppression did not remain visible and block release.");
  }

  const unknownProspect = fixtures.prospects.unknown;
  await createDraft(pool, page, journeyName, unknownProspect);
  await markEligibleAndRelease(page, unknownProspect);
  await waitForAction(page, "approve", queueCard(page, unknownProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const unknownMessage = await pool.query<{ id: string }>(
    "select id from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) and step_number=1",
    [unknownProspect.id],
  );
  await pool.query("update agency_followup_messages set scheduled_at=$2 where id=$1", [unknownMessage.rows[0].id, acceptedDueAt]);
  const unknownResult = await withFixtureClaim(pool, unknownMessage.rows[0].id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-unknown",
    now: acceptedNow,
    limit: 1,
    outcomePlan: [{ kind: "unknown", detail: "synthetic_interruption_after_fake_handoff" }],
  }));
  const unknownRow = await pool.query<{ state: string; unknown_since: string | null }>(
    "select state,unknown_since from agency_followup_messages where id=$1",
    [unknownMessage.rows[0].id],
  );
  const quarantineClient = await pool.connect();
  let unknownWasReclaimed = false;
  try {
    await quarantineClient.query("begin");
    const reclaimed = await quarantineClient.query<{ id: string }>(
      "select id from public.claim_agency_followup_messages('synthetic-walkthrough-no-retry',now()+interval '1 day',120,100)",
    );
    unknownWasReclaimed = reclaimed.rows.some((row) => row.id === unknownMessage.rows[0].id);
    await quarantineClient.query("rollback");
  } catch (error) {
    await quarantineClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    quarantineClient.release();
  }
  if (unknownResult.unknown !== 1 || unknownRow.rows[0]?.state !== "unknown" || !unknownRow.rows[0]?.unknown_since || unknownWasReclaimed) {
    throw new Error("UNKNOWN provider outcome was not quarantined or was automatically reclaimed.");
  }
  const retryProspect = fixtures.prospects.retry;
  await createDraft(pool, page, journeyName, retryProspect);
  await markEligibleAndRelease(page, retryProspect);
  await waitForAction(page, "approve", queueCard(page, retryProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const retryMessageResult = await pool.query<{ id: string; provider_idempotency_key: string }>(
    "select id,provider_idempotency_key from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) and step_number=1",
    [retryProspect.id],
  );
  const retryMessage = retryMessageResult.rows[0];
  if (!retryMessage) throw new Error("Synthetic retry message was not created.");
  const retryClock = new Date();
  retryClock.setUTCHours(16, 0, 0, 0);
  if (retryClock.getTime() <= Date.now()) retryClock.setUTCDate(retryClock.getUTCDate() + 1);
  while (retryClock.getUTCDay() === 0 || retryClock.getUTCDay() === 6) retryClock.setUTCDate(retryClock.getUTCDate() + 1);
  const retryNow = retryClock.toISOString();
  const retryDueAt = new Date(retryClock.getTime() + 30_000).toISOString();
  const retryInitialDueAt = new Date(retryClock.getTime() - 60_000).toISOString();
  await pool.query("update agency_followup_messages set scheduled_at=$2 where id=$1", [retryMessage.id, retryInitialDueAt]);
  const retryFailure = await withFixtureClaim(pool, retryMessage.id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-retry",
    now: retryNow,
    limit: 1,
    outcomePlan: [{ kind: "definitive_retryable_failure", code: "synthetic_throttle" }],
  }));
  const retryRow = await pool.query<{ state: string; attempt_count: number; scheduled_at: string; last_error_code: string | null; provider_idempotency_key: string }>(
    "select state,attempt_count,scheduled_at,last_error_code,provider_idempotency_key from agency_followup_messages where id=$1",
    [retryMessage.id],
  );
  const retryScheduledAt = retryRow.rows[0]?.scheduled_at ? new Date(retryRow.rows[0].scheduled_at).toISOString() : "";
  if (retryFailure.retryScheduled !== 1 || retryRow.rows[0]?.state !== "scheduled" || Number(retryRow.rows[0]?.attempt_count) !== 1 ||
    retryScheduledAt !== retryDueAt || retryRow.rows[0]?.last_error_code !== "synthetic_throttle" ||
    retryRow.rows[0]?.provider_idempotency_key !== retryMessage.provider_idempotency_key) {
    throw new Error("The disposable database did not persist the first retry, 30-second backoff, and stable idempotency key.");
  }
  const retryClient = await pool.connect();
  try {
    await retryClient.query("begin");
    const earlyClaims = await retryClient.query<{ id: string }>(
      "select id from public.claim_agency_followup_messages($1,$2,120,100)",
      ["synthetic-walkthrough-early-retry", new Date(Date.parse(retryDueAt) - 1).toISOString()],
    );
    if (earlyClaims.rows.some((row) => row.id === retryMessage.id)) throw new Error("The retry message was claimable before its persisted backoff was due.");
    await retryClient.query("rollback");
    await retryClient.query("begin");
    const dueClaims = await retryClient.query<{ id: string }>(
      "select id from public.claim_agency_followup_messages($1,$2,120,100)",
      ["synthetic-walkthrough-due-retry", retryDueAt],
    );
    if (!dueClaims.rows.some((row) => row.id === retryMessage.id)) throw new Error("The retry message was not eligible exactly when its persisted backoff became due.");
    await retryClient.query("rollback");
  } catch (error) {
    await retryClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    retryClient.release();
  }

  const resendEventId = `evt_walkthrough_${RUN_ID}`;
  const retryProviderMessageId = "fake-provider-retry-" + RUN_ID;
  const signedDeliveryEvent = {
    type: "email.delivered",
    created_at: retryDueAt,
    data: { email_id: retryProviderMessageId, to: [retryProspect.email] },
  };
  const earlyProviderEvent = await postSyntheticResendEvent(resendEventId, signedDeliveryEvent);
  if (earlyProviderEvent.status !== 503 || earlyProviderEvent.outcome !== "unmatched_message") {
    throw new Error("An early signed provider event was not durably quarantined and returned for retry.");
  }
  const retryAcceptance = await withFixtureClaim(pool, retryMessage.id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-retry-accepted", now: retryDueAt, limit: 1,
    outcomePlan: [{ kind: "accepted", providerMessageId: retryProviderMessageId, acceptedAt: retryDueAt }],
  }));
  const retryReplay = await withFixtureClaim(pool, retryMessage.id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-retry-replay", now: new Date(Date.parse(retryDueAt) + 1000).toISOString(), limit: 1,
  }));
  const acceptedRetry = await pool.query<{ state: string; attempt_count: number; provider_idempotency_key: string; acceptances: string }>(
    "select m.state,m.attempt_count,m.provider_idempotency_key,(select count(*)::text from agency_followup_events e where e.message_id=m.id and e.event_type='provider_accepted') as acceptances from agency_followup_messages m where m.id=$1",
    [retryMessage.id],
  );
  if (retryAcceptance.accepted !== 1 || retryReplay.claimed !== 0 || acceptedRetry.rows[0]?.state !== "accepted" ||
    Number(acceptedRetry.rows[0]?.attempt_count) !== 2 || acceptedRetry.rows[0]?.provider_idempotency_key !== retryMessage.provider_idempotency_key ||
    acceptedRetry.rows[0]?.acceptances !== "1") {
    throw new Error("The due retry did not persist exactly one acceptance with two attempts and the same logical key.");
  }
  const reconciledProviderEvent = await postSyntheticResendEvent(resendEventId, signedDeliveryEvent);
  const duplicateProviderEvent = await postSyntheticResendEvent(resendEventId, signedDeliveryEvent);
  progress(`synthetic provider event replay: first=${JSON.stringify(reconciledProviderEvent)}; duplicate=${JSON.stringify(duplicateProviderEvent)}`);
  const providerEventState = await pool.query<{ processing_result: string; message_id: string | null; applications: string; applied_message_id: string | null; applied_result: string | null; durable_events: string }>(
    "select provider_event.processing_result,provider_event.message_id,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=provider_event.provider_event_id and application.message_id=$2) as applications,(select application.message_id from public.agency_followup_provider_event_applications application where application.provider_event_id=provider_event.provider_event_id) as applied_message_id,(select application.applied_result from public.agency_followup_provider_event_applications application where application.provider_event_id=provider_event.provider_event_id) as applied_result,(select count(*)::text from public.agency_followup_events event where event.idempotency_key='resend-event:'||provider_event.provider_event_id) as durable_events from public.agency_followup_provider_events provider_event where provider_event.provider_event_id=$1",
    [resendEventId, retryMessage.id],
  );
  const reconciledMessage = await pool.query<{ provider_delivery_status: string }>(
    "select provider_delivery_status from public.agency_followup_messages where id=$1", [retryMessage.id],
  );
  if (reconciledProviderEvent.status !== 200 || reconciledProviderEvent.outcome !== "matched" ||
    duplicateProviderEvent.status !== 200 || duplicateProviderEvent.outcome !== "duplicate" ||
    providerEventState.rows[0]?.processing_result !== "unmatched_message" || providerEventState.rows[0]?.message_id !== null ||
    providerEventState.rows[0]?.applications !== "1" || providerEventState.rows[0]?.applied_message_id !== retryMessage.id ||
    providerEventState.rows[0]?.applied_result !== "matched" || providerEventState.rows[0]?.durable_events !== "1" ||
    reconciledMessage.rows[0]?.provider_delivery_status !== "delivered") {
    throw new Error("The signed provider event did not reconcile after acceptance exactly once with an authoritative application row.");
  }

  // Exercise actual schedule policy immediately before handoff with a delayed
  // weekend claim. The current weekday/window come from the persisted journey.
  const windowProspect = fixtures.prospects.window;
  await createDraft(pool, page, journeyName, windowProspect);
  await markEligibleAndRelease(page, windowProspect);
  const windowMessage = await pool.query<{ id: string; timezone: string; business_days: number[]; local_window_start: string; local_window_end: string }>(
    "select m.id,j.timezone,j.business_days,j.local_window_start,j.local_window_end from agency_followup_messages m join agency_followup_enrollments e on e.id=m.enrollment_id join agency_followup_journeys j on j.id=e.journey_id where e.prospect_id=$1 and m.step_number=1",
    [windowProspect.id],
  );
  await waitForAction(page, "approve", queueCard(page, windowProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const today = new Date();
  const daysToSaturday = ((6 - today.getUTCDay() + 7) % 7) || 7;
  const nextSaturday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysToSaturday, 16, 0));
  const weekendNow = nextSaturday.toISOString();
  const weekendDue = new Date(nextSaturday.getTime() - 60_000).toISOString();
  await pool.query("update agency_followup_messages set scheduled_at=$2 where id=$1", [windowMessage.rows[0].id, weekendDue]);
  const windowResult = await withFixtureClaim(pool, windowMessage.rows[0].id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-window",
    now: weekendNow,
    limit: 1,
  }));
  const policy = {
    timezone: windowMessage.rows[0].timezone,
    businessDays: windowMessage.rows[0].business_days.map(Number),
    localWindowStart: windowMessage.rows[0].local_window_start.slice(0, 5),
    localWindowEnd: windowMessage.rows[0].local_window_end.slice(0, 5),
  };
  const expectedNextWindow = scheduleAgencyFollowupStep({
    anchorAt: weekendNow,
    timezone: policy.timezone,
    businessDays: policy.businessDays,
    delayBusinessDays: 0,
    localWindowStart: policy.localWindowStart,
  });
  const windowRow = await pool.query<{ state: string; scheduled_at: string; last_error_code: string | null }>(
    "select state,scheduled_at,last_error_code from agency_followup_messages where id=$1",
    [windowMessage.rows[0].id],
  );
  if (windowResult.retryScheduled !== 1 || windowRow.rows[0]?.state !== "scheduled" ||
    new Date(windowRow.rows[0].scheduled_at).toISOString() !== expectedNextWindow ||
    windowRow.rows[0]?.last_error_code !== "outside_send_window_rescheduled") {
    throw new Error("A delayed weekend claim was not rescheduled to the configured business-day opening.");
  }

  // Real RPC contention: concurrent workers must yield exactly one claim.
  const leaseProspect = fixtures.prospects.lease;
  await createDraft(pool, page, journeyName, leaseProspect);
  await markEligibleAndRelease(page, leaseProspect);
  await waitForAction(page, "approve", queueCard(page, leaseProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const leaseMessage = await pool.query<{ id: string }>(
    "select id from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) and step_number=1",
    [leaseProspect.id],
  );
  await pool.query("update agency_followup_messages set scheduled_at=now()-interval '1 minute' where id=$1", [leaseMessage.rows[0].id]);
  const [claimA, claimB] = await withFixtureClaim(pool, leaseMessage.rows[0].id, () => Promise.all([
    pool.query("select id,lease_owner from public.claim_agency_followup_messages('synthetic-lease-a',now(),120,1)"),
    pool.query("select id,lease_owner from public.claim_agency_followup_messages('synthetic-lease-b',now(),120,1)"),
  ]));
  const claims = [...claimA.rows, ...claimB.rows];
  if (claims.length !== 1 || claims[0].id !== leaseMessage.rows[0].id) {
    throw new Error("Concurrent database workers did not produce exactly one message lease.");
  }
  const staleDisposition = await pool.query(
    "update agency_followup_messages set state='scheduled',lease_owner=null,lease_until=null where id=$1 and state='claimed' and lease_owner='synthetic-lease-wrong' returning id",
    [leaseMessage.rows[0].id],
  );
  const afterStale = await pool.query<{ state: string; lease_owner: string | null }>(
    "select state,lease_owner from agency_followup_messages where id=$1",
    [leaseMessage.rows[0].id],
  );
  if (staleDisposition.rows.length !== 0 || afterStale.rows[0]?.state !== "claimed" || afterStale.rows[0]?.lease_owner !== claims[0].lease_owner) {
    throw new Error("A stale worker lease owner was able to change the claimed message.");
  }
  const properDisposition = await pool.query(
    "update agency_followup_messages set state='scheduled',lease_owner=null,lease_until=null,scheduled_at=now()+interval '1 day' where id=$1 and state='claimed' and lease_owner=$2 returning id",
    [leaseMessage.rows[0].id, claims[0].lease_owner],
  );
  if (properDisposition.rows.length !== 1) throw new Error("The current lease owner could not persist its disposition.");

  const screenshotDir = path.join(OUTPUT_DIR, "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const renderedWidths: number[] = [];
  const screenshots: Array<{ path: string; sha256: string; viewport: number; navigationState: string }> = [];
  const stableLayout = async () => page.evaluate(async () => {
    await document.fonts.ready;
    let previous: number[] = [];
    let stableFrames = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([(async () => {
        while (stableFrames < 3) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const running = document.getAnimations().some((animation) =>
            animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
          const bounds = Array.from(document.querySelectorAll("main, aside, nav, h1, label input"))
            .flatMap((element) => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
          const stable = previous.length > 0 && previous.length === bounds.length &&
            bounds.every((value, index) => Math.abs(value - previous[index]) <= 1);
          stableFrames = !running && stable ? stableFrames + 1 : 0;
          previous = bounds;
        }
      })(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Layout did not settle within 5000 ms.")), 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  });
  const screenshot = async (filename: string, width: number, navigationState: string) => {
    const file = path.join(screenshotDir, filename);
    await page.screenshot({ path: file, fullPage: true });
    const digest = createHash("sha256").update(await readFile(file)).digest("hex");
    screenshots.push({ path: path.relative(process.cwd(), file).replaceAll("\\", "/"), sha256: digest, viewport: width, navigationState });
  };
  const assertUnoccluded = async (locator: ReturnType<Page["getByRole"]>, label: string, requireFocus = false) => {
    await locator.scrollIntoViewIfNeeded();
    await locator.waitFor({ state: "visible" });
    const usable = await locator.evaluate((element, shouldFocus) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) return false;
      const x = Math.min(rect.right - 1, Math.max(rect.left + 1, rect.left + rect.width / 2));
      const y = Math.min(rect.bottom - 1, Math.max(rect.top + 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) return false;
      if (!shouldFocus) return true;
      (element as HTMLElement).focus();
      return document.activeElement === element;
    }, requireFocus);
    if (!usable) throw new Error(`${label} was hidden, occluded, or not focusable at ${await page.evaluate(() => innerWidth)}px.`);
  };
  const requiredAuthoringControl = async (target: Page) => {
    const control = target.locator("label").filter({ hasText: "Template key" }).locator("input");
    if (await control.count() !== 1) throw new Error("Exactly one Template key authoring control is required.");
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await assertUnoccluded(control, "Template key authoring control", true);
  };
  let missingAuthoringControlRejected = false;
  const reproduction: Array<{ path: string; sha256: string; elapsedAfterCloseMs: number }> = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await stableLayout();
    if (width < 768) {
      const openMenu = page.getByRole("button", { name: "Open menu" });
      if (!(await openMenu.isVisible())) throw new Error(`Mobile navigation opener is missing at ${width}px.`);
      await assertUnoccluded(openMenu, "Mobile navigation opener", true);
      await openMenu.click();
      await stableLayout();
      const closeMenu = page.getByRole("button", { name: "Close menu" });
      await assertUnoccluded(closeMenu, "Open navigation close button", true);
      await screenshot(`${RUN_ID}-queue-${width}-nav-open.png`, width, "open");
      await closeMenu.click();
      if (width === 640) {
        const closedAt = Date.now();
        const immediatePath = path.join(screenshotDir, RUN_ID + "-reproduction-640-after-close.png");
        await page.screenshot({ path: immediatePath, fullPage: true });
        reproduction.push({ path: path.relative(process.cwd(), immediatePath).replaceAll("\\", "/"),
          sha256: createHash("sha256").update(await readFile(immediatePath)).digest("hex"),
          elapsedAfterCloseMs: Date.now() - closedAt });
      }
      await stableLayout();
    }
    const failures = await auditRenderedCopy(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await stableLayout();
    if (failures.length) {
      await screenshot(`${RUN_ID}-failure-queue-${width}-nav-closed.png`, width, "closed");
      throw new Error(`Rendered UI gate failed at ${width}px: ${failures.join("; ")}`);
    }
    await assertUnoccluded(page.getByRole("heading", { level: 1 }).first(), "Follow-up page heading");
    await requiredAuthoringControl(page);
    if (width === 640) {
      const probe = await context.newPage();
      try {
        await probe.setViewportSize({ width, height: 1000 });
        await probe.goto(page.url(), { waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
        const input = probe.locator("label").filter({ hasText: "Template key" }).locator("input");
        await expect(input).toBeVisible();
        await input.evaluate((element) => element.remove());
        try { await requiredAuthoringControl(probe); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== "Exactly one Template key authoring control is required.") throw error;
          missingAuthoringControlRejected = true;
        }
        if (!missingAuthoringControlRejected) throw new Error("Missing required authoring control did not fail acceptance.");
      } finally { await probe.close(); }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await stableLayout();
    await screenshot(`${RUN_ID}-queue-${width}-nav-closed.png`, width, "closed");
    renderedWidths.push(width);
  }
  if (responseFailures.length) throw new Error(responseFailures.join("; "));
  if (!sourceAtStart) throw new Error("Source provenance was not captured before the walkthrough.");
  if (screenshots.length !== 12 || !missingAuthoringControlRejected) throw new Error("Incomplete viewport or required-control evidence.");
  const summary = {
    runId: RUN_ID,
    ...sourceAtStart,
    sourceAtStart,
    temporaryDispatchRoute: { path: path.relative(process.cwd(), TEST_DISPATCH_DIR), sha256: temporaryRouteSha256 },
    reproduction,
    missingAuthoringControlRejected,
    recoveredBrowserRuntimeErrors,
    startedAtUtc: RUN_STARTED_AT,
    endedAtUtc: new Date().toISOString(),
    command: "npm run agency-followup:walkthrough",
    exitCode: 0,
    testedEnvironment: { appOrigin: APP_ORIGIN, databaseProjectId: STACK_PROJECT_ID, databaseHost: "loopback", provider: "network-free fake", databaseReusedWithoutReset: true },
    migrationVersions: ["20261013154000", "20261013230354", "20261020025251", "20261020141945"],
    verifiedMigrationBlobs: [EXPECTED_MIGRATION_BLOB, EXPECTED_CRM_GRANTS_MIGRATION_BLOB, EXPECTED_EVENT_MIGRATION_BLOB, EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB],
    screenshots,
    synthetic: true,
    flows: {
      templateJourneyEnrollmentReleaseApproval: "passed",
      repeatedEnrollment: "409 and one enrollment",
      pause: "approved message cancelled; unapproved message preserved for review",
      suppression: "release blocked",
      approvalInvalidation: "content change cleared reviewer and reopened review",
      fakeAccepted: "persisted",
      unknown: "quarantined and not reclaimed",
      businessDayWindow: "weekend claim rescheduled before fake provider",
      retry: "temporary failure and backoff persisted; early claim excluded; due retry accepted exactly once with stable key and two attempts",
      providerEventReplay: "signed event was quarantined before acceptance, reconciled on retry after acceptance, and deduplicated with one durable application",
      concurrentClaim: "exactly one claim",
      staleLeaseOwner: "rejected",
    },
    syntheticProspects: Object.keys(fixtures.prospects).length,
    screenshotViewports: renderedWidths,
    screenshotCount: screenshots.length
  };
  return summary;
  } finally {
    await context.close();
    await browser.close();
    if (activeBrowser === browser) activeBrowser = undefined;
  }
}

async function runJourneyVersionRegression(fixtures: Fixtures, portalSecret: string): Promise<Record<string, unknown>> {
  setDiagnosticStage("browser_journey_version_regression");
  const browser = await chromium.launch({ headless: true });
  activeBrowser = browser;
  let context: BrowserContext | undefined;
  try {
    context = await signedContext(browser, fixtures, portalSecret);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(180_000);
    const responseFailures: string[] = [];
    page.on("pageerror", (error) => responseFailures.push("page error: " + error.message));
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && !/Failed to load resource: the server responded with a status of 409 \(Conflict\)/.test(text)) {
        responseFailures.push("browser console: " + text);
      }
    });
    page.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes("/_next/")) responseFailures.push(`asset request failed: ${pathname}; ${request.failure()?.errorText ?? "unknown"}`);
    });
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.includes("/_next/") && response.status() >= 400) responseFailures.push(`asset response ${response.status()}: ${pathname}`);
    });
    progress(`opening the follow-up UI for the focused journey-version regression (${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
    await page.goto(APP_ORIGIN + "/admin/agency-crm/follow-up", { waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
    const layoutChunkStartedAt = Date.now();
    try {
      const layoutChunkResponse = await context.request.get(APP_ORIGIN + "/_next/static/chunks/app/layout.js", { timeout: Math.min(30_000, remainingMs()) });
      const layoutChunkBody = await layoutChunkResponse.body();
      progress(`direct app/layout.js asset probe returned HTTP ${layoutChunkResponse.status()}; bytes=${layoutChunkBody.byteLength}; elapsed=${Date.now() - layoutChunkStartedAt}ms`);
    } catch (error) {
      progress(`direct app/layout.js asset probe failed after ${Date.now() - layoutChunkStartedAt}ms; safe diagnostics=${JSON.stringify(safeErrorDiagnostics(error))}`);
      throw error;
    }
    if (await page.getByText(/This page couldn.t load/i).count()) {
      progress("Next rendered its chunk-recovery page during cold compilation; reloading once after the direct asset probe");
      await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
    }
    await page.locator('[data-ui-component-content="agency-follow-up-queue"]').waitFor();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    try {
      await page.waitForFunction(() => {
        const control = document.querySelector("main form input");
        return Boolean(control && Object.keys(control).some((key) => key.startsWith("__reactProps$")));
      }, null, { polling: "raf", timeout: Math.min(180_000, remainingMs()) });
      progress("operator form hydration confirmed on controlled template input");
    } catch (error) {
      let hydrationError: unknown = error;
      let recovered = false;
      if (await page.getByText(/This page couldn.t load/i).count()) {
        progress("Next rendered its chunk-recovery page during hydration; reloading once after compilation");
        try {
          await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
          await page.waitForFunction(() => {
            const control = document.querySelector("main form input");
            return Boolean(control && Object.keys(control).some((key) => key.startsWith("__reactProps$")));
          }, null, { polling: "raf", timeout: Math.min(120_000, remainingMs()) });
          recovered = true;
          progress("operator form hydration confirmed after one chunk-recovery reload");
        } catch (retryError) {
          hydrationError = retryError;
        }
      }
      if (!recovered) {
        const diagnostics = await page.evaluate(() => ({
          readyState: document.readyState,
          title: document.title,
          mainCount: document.querySelectorAll("main").length,
          formCount: document.querySelectorAll("main form").length,
          scriptCount: document.scripts.length,
          controlledInput: (() => {
            const control = document.querySelector("main form input");
            return control ? {
              type: (control as HTMLInputElement).type,
              valueLength: (control as HTMLInputElement).value.length,
              reactAttached: Object.keys(control).some((key) => key.startsWith("__reactProps$")),
            } : null;
          })(),
          nextScripts: [...document.scripts].map((script) => script.src).filter((src) => src.includes("/_next/")),
          nextResources: performance.getEntriesByType("resource").map((entry) => new URL(entry.name).pathname).filter((pathname) => pathname.includes("/_next/")),
          pageText: document.body.innerText.slice(0, 1000),
        })).catch(() => null);
        await mkdir(path.join(OUTPUT_DIR, "screenshots"), { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, "screenshots", `failure-hydration-${RUN_ID}.png`), fullPage: true }).catch(() => undefined);
        throw new Error(`Operator UI did not hydrate its controlled template input. Diagnostics: ${JSON.stringify(diagnostics)}; browserErrors=${JSON.stringify(responseFailures.slice(0, 20))}. ${String(hydrationError)}`);
      }
    }
    await authorJourney(page);
    if (responseFailures.length) {
      throw new Error(`Browser acceptance observed runtime or asset failures: ${JSON.stringify(responseFailures.slice(0, 20))}`);
    }
    if (!journeyVersionRegressionResult || Object.values(journeyVersionRegressionResult).some((passed) => !passed)) {
      throw new Error("Journey-version replacement regression did not record every required assertion.");
    }
    return {
      runId: RUN_ID,
      runStartedAtUtc: RUN_STARTED_AT,
      sourceAtStart,
      synthetic: true,
      focusedRegression: "journey-version replacement state and enrollment selector",
      journeyVersionRegression: journeyVersionRegressionResult,
    };
  } finally {
    await context?.close();
    await browser.close();
    if (activeBrowser === browser) activeBrowser = undefined;
  }
}

async function markEligibleAndReleaseAttempt(page: Page, prospect: ProspectFixture): Promise<void> {
  const card = queueCard(page, prospect.firmName);
  const evidenceControl = card.getByLabel("Eligibility evidence for this prospect");
  progress("waiting for the required eligibility control to render for " + prospect.firmName);
  await evidenceControl.waitFor({ state: "visible", timeout: Math.min(90_000, remainingMs()) });
  await evidenceControl.fill("Synthetic evidence for local walkthrough only.");
  await waitForAction(page, "eligibility", card.getByRole("button", { name: "Record eligible" }));
  await card.getByLabel("Individual release basis").fill("Synthetic release attempt against a seeded suppression.");
  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().includes(API_PATH) || response.request().method() !== "POST") return false;
    try { return response.request().postDataJSON()?.action === "release"; } catch { return false; }
  });
  await card.getByRole("button", { name: "Release this prospect" }).click();
  const response = await responsePromise;
  if (response.status() !== 409) throw new Error("Suppressed prospect release did not return an explicit conflict.");
}

async function runManual(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(180_000);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/_next/static/chunks/app/layout.js") progress("browser requested Next app/layout.js chunk");
    if (pathname === API_PATH && request.method() === "POST") {
      let action = "unknown";
      try { action = String(request.postDataJSON()?.action ?? "unknown"); } catch { /* report only the request path */ }
      progress(`browser emitted Agency CRM POST action=${action}`);
    }
  });
  await page.goto(APP_ORIGIN + "/admin/agency-crm/follow-up", { waitUntil: "domcontentloaded", timeout: 180_000 });
  const layoutChunkStartedAt = Date.now();
  try {
    const layoutChunkResponse = await context.request.get(APP_ORIGIN + "/_next/static/chunks/app/layout.js", { timeout: Math.min(180_000, remainingMs()) });
    const layoutChunkBody = await layoutChunkResponse.body();
    progress(`direct app/layout.js asset probe returned HTTP ${layoutChunkResponse.status()}; bytes=${layoutChunkBody.byteLength}; elapsed=${Date.now() - layoutChunkStartedAt}ms`);
  } catch (error) {
    progress(`direct app/layout.js asset probe failed after ${Date.now() - layoutChunkStartedAt}ms: ${String(error).replace(/\\s+/g, " ").slice(0, 300)}`);
    throw error;
  }
  await page.locator('[data-ui-component-content="agency-follow-up-queue"]').waitFor();
  console.log("Synthetic Agency CRM is open at " + APP_ORIGIN + "/admin/agency-crm/follow-up");
  console.log("Create a template and journey, then search Synthetic Walkthrough Normal. Other synthetic prospects are available for pause, suppression, UNKNOWN, window, and lease checks.");
  console.log("Only a signed test operator cookie is active in this browser context. No real provider is configured.");
  console.log("Press Ctrl+C to close the browser and local app. Synthetic audit rows remain only in the disposable stack until its owner discards it.");
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runWebhookPreflightOnly(status: SupabaseStatus, portalSecret: string, walkthroughToken: string): Promise<void> {
  const pool = new Pool({ connectionString: status.DB_URL, max: 2, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000 });
  let server: ChildProcess | undefined;
  try {
    await verifyLocalPostgrest(status);
    await verifyDisposableTarget(pool);
    await verifyProviderEventImmutability(pool);
    const before = await countRows(pool, "select count(*)::text as count from public.agency_followup_provider_events");
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, "next-server.log"), "", "utf8");
    await writeFile(path.join(OUTPUT_DIR, "next-server.stdout.log"), "", "utf8");
    await writeFile(path.join(OUTPUT_DIR, "next-server.stderr.log"), "", "utf8");
    server = startApp(portalSecret, walkthroughToken, status);
    activeNextServer = server;
    const listenerDeadline = Math.min(absoluteDeadline, Date.now() + 120_000);
    await waitForListener(server, listenerDeadline);
    await warmResendWebhookRoute();
    const after = await countRows(pool, "select count(*)::text as count from public.agency_followup_provider_events");
    if (after !== before) throw new Error("Unsigned webhook preflight changed the disposable provider-event count.");
    const sourceAfterCleanup = captureSourceState();
    if (sourceAfterCleanup.workingTreeState !== "clean") throw new Error("Source changed during webhook preflight.");
    const receipt = {
      runId: RUN_ID,
      command: "node --import tsx scripts/agency-followup-walkthrough.ts --webhook-preflight-only",
      sourceCommit: sourceAfterCleanup.sourceCommit,
      databaseProjectId: STACK_PROJECT_ID,
      databaseHost: "loopback",
      browserLaunched: false,
      unsignedRequest: "HTTP 400 invalid_signature",
      providerEventCountUnchanged: true,
      temporaryDispatchRouteInstalled: false,
      completedAtUtc: new Date().toISOString(),
    };
    await writeFile(path.join(OUTPUT_DIR, `webhook-preflight-${RUN_ID}.json`), JSON.stringify(receipt, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    if (server) {
      stopApp(server);
      if (activeNextServer === server) activeNextServer = undefined;
    }
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (JOURNEY_VERSION_REGRESSION_ONLY && MANUAL) {
    throw new Error("The focused journey-version regression cannot be combined with --manual.");
  }
  if (FAILURE_CAPTURE_PREFLIGHT_ONLY && (JOURNEY_VERSION_REGRESSION_ONLY || MANUAL)) {
    throw new Error("The failure-capture preflight cannot be combined with another browser walkthrough mode.");
  }
  progress(`acceptance run id=${RUN_ID}`);
  progress("validating disposable local-only confirmation");
  if (must(process.env.AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION, "Disposable database confirmation") !== "YES-LOCAL-DISPOSABLE-ONLY") {
    throw new Error("Set AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION=YES-LOCAL-DISPOSABLE-ONLY for this disposable local walkthrough.");
  }
  absoluteDeadline = Date.now() + WALKTHROUGH_TIMEOUT_MS;
  progress("checking pushed source HEAD and bounded clean-tree status");
  sourceAtStart = captureSourceState();
  if (sourceAtStart.workingTreeState !== "clean") {
    throw new Error("Refusing walkthrough because the exact pushed source worktree is not clean.");
  }
  verifyPushedHead(sourceAtStart.sourceCommit);
  let completedSummary: Record<string, unknown> | undefined;
  progress("verifying pushed migration blobs");
  await verifyPushedMigration(MIGRATION_PATH, EXPECTED_MIGRATION_BLOB);
  await verifyPushedMigration(CRM_GRANTS_MIGRATION_PATH, EXPECTED_CRM_GRANTS_MIGRATION_BLOB);
  await verifyPushedMigration(EVENT_MIGRATION_PATH, EXPECTED_EVENT_MIGRATION_BLOB);
  await verifyPushedMigration(EVENT_ROW_LOCK_GRANT_MIGRATION_PATH, EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB);
  progress("loading the pinned loopback endpoint and local key in process memory");
  const status = getSupabaseStatus();
  progress("local key loaded from the isolated auth container without logging its value");
  const portalSecret = randomBytes(32).toString("hex") + "-test-only";
  const walkthroughToken = randomBytes(32).toString("hex") + "-test-only";
  if (WEBHOOK_PREFLIGHT_ONLY) {
    progress("running bounded cold webhook route preflight only; no browser or synthetic event persistence");
    await runWebhookPreflightOnly(status, portalSecret, walkthroughToken);
    return;
  }
  await verifyLocalPostgrest(status);
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  process.env.PORTAL_SECRET = portalSecret;
  const pool = new Pool({ connectionString: status.DB_URL, max: 8, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000 });
  if (!MANUAL) runAbortController = new AbortController();
  const hardStop = MANUAL ? undefined : setTimeout(() => {
    interrupted = true;
    runAbortController?.abort(new Error("Overall walkthrough deadline exceeded."));
    progress("overall 20-minute walkthrough deadline reached; closing local browser and app");
    void activeBrowser?.close().catch(() => undefined);
    if (activeNextServer) stopApp(activeNextServer);
  }, remainingMs());
  hardStop?.unref();
  try {
  await verifyDisposableTarget(pool);
  await verifyProviderEventImmutability(pool);
  const seedClient = await pool.connect();
  let fixtures: Fixtures;
  try {
    fixtures = await seedFixtures(seedClient);
  } finally {
    seedClient.release();
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "next-server.log"), "", "utf8");
  await writeFile(path.join(OUTPUT_DIR, "next-server.stdout.log"), "", "utf8");
  await writeFile(path.join(OUTPUT_DIR, "next-server.stderr.log"), "", "utf8");
  await installTemporaryDispatchRoute();
  progress("starting local Next dev server on 127.0.0.1:55435");
  const server = startApp(portalSecret, walkthroughToken, status);
  activeNextServer = server;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    await waitForApp(server, fixtures);
    await warmResendWebhookRoute();
    progress("authenticated API is ready; opening actual operator queue UI");
    if (MANUAL) {
      browser = await chromium.launch({ headless: false });
      activeBrowser = browser;
      context = await signedContext(browser, fixtures, portalSecret);
      await runManual(context);
      return;
    }
    completedSummary = JOURNEY_VERSION_REGRESSION_ONLY
      ? await runJourneyVersionRegression(fixtures, portalSecret)
      : await runBrowserWalkthrough(pool, fixtures, portalSecret, walkthroughToken);
  } catch (error) {
    failureLifecycleContext = {
      abortState: runAbortController?.signal.aborted ?? null,
      nextChildPid: server.pid ?? null,
      nextChildExitCode: server.exitCode,
      nextChildSignalCode: server.signalCode,
    };
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
    if (activeBrowser === browser) activeBrowser = undefined;
    stopApp(server);
    if (activeNextServer === server) activeNextServer = undefined;
  }
  } finally {
    if (hardStop) clearTimeout(hardStop);
    try { await pool.end(); }
    finally { await removeTemporaryDispatchRoute(); }
    runAbortController = undefined;
  }
  if (completedSummary) {
    const sourceAfterCleanup = captureSourceState();
    if (JSON.stringify(sourceAfterCleanup) !== JSON.stringify(sourceAtStart)) {
      throw new Error("Source changed during acceptance or temporary-route cleanup was incomplete.");
    }
    completedSummary.sourceAfterCleanup = sourceAfterCleanup;
    completedSummary.cleanupCompleted = true;
    completedSummary.endedAtUtc = new Date().toISOString();
    await writeFile(path.join(OUTPUT_DIR, "summary-" + RUN_ID + ".json"), JSON.stringify(completedSummary, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(completedSummary, null, 2));
  }
}

main().catch(async (error) => {
  const errorMessage = String(error).replace(/[\r\n\s]+/g, " ")
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|PORTAL_SECRET|AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN)(\s*[=:]\s*)[^\s"']+/g, "$1$2[REDACTED]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_JWT]").slice(0, 1500);
  const failureReceiptPath = path.join(OUTPUT_DIR, `failure-run-${RUN_ID}.json`);
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(failureReceiptPath, JSON.stringify({
    runId: RUN_ID,
    stage: diagnosticStage,
    stageElapsedMs: Date.now() - diagnosticStageStartedAt,
    errorMessage,
    ...safeErrorDiagnostics(error),
    abortState: failureLifecycleContext?.abortState ?? runAbortController?.signal.aborted ?? null,
    nextChildPid: failureLifecycleContext?.nextChildPid ?? activeNextServer?.pid ?? null,
    nextChildExitCode: failureLifecycleContext?.nextChildExitCode ?? activeNextServer?.exitCode ?? null,
    nextChildSignalCode: failureLifecycleContext?.nextChildSignalCode ?? activeNextServer?.signalCode ?? null,
    recordedAtUtc: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  console.error("Agency follow-up synthetic walkthrough failed " + JSON.stringify({
    runId: RUN_ID,
    stage: diagnosticStage,
    stageElapsedMs: Date.now() - diagnosticStageStartedAt,
    errorMessage,
    ...safeErrorDiagnostics(error),
    abortState: failureLifecycleContext?.abortState ?? runAbortController?.signal.aborted ?? null,
    nextChildPid: failureLifecycleContext?.nextChildPid ?? activeNextServer?.pid ?? null,
    nextChildExitCode: failureLifecycleContext?.nextChildExitCode ?? activeNextServer?.exitCode ?? null,
    nextChildSignalCode: failureLifecycleContext?.nextChildSignalCode ?? activeNextServer?.signalCode ?? null,
  }));
  console.error(`Failure receipt: ${failureReceiptPath}`);
  process.exitCode = 1;
});
