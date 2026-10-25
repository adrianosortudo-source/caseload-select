import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection } from "node:net";
import { Pool, type PoolClient } from "pg";
import { chromium, expect, type APIResponse, type Browser, type BrowserContext, type Page, type Response as PlaywrightResponse } from "@playwright/test";
import { createSessionCookie } from "../src/lib/portal-session-cookie";
import { agencyFollowupContentHash, agencyFollowupLogicalMessageKey, agencyFollowupRecipientHash } from "../src/lib/agency-followup-domain";
import { scheduleAgencyFollowupStep } from "../src/lib/agency-followup-schedule";

const DEFAULT_STACK_DIR = "test-results/crm-local-stack";
const DEFAULT_STACK_PROJECT_ID = "crm-followup-walkthrough-20261013";
const STACK_DIR = path.resolve(process.env.AGENCY_FOLLOWUP_STACK_DIR || DEFAULT_STACK_DIR);
const OUTPUT_DIR = path.resolve("test-results/agency-followup-walkthrough");
const APP_ORIGIN = "http://127.0.0.1:55435";
const API_PATH = "/api/admin/agency-crm/follow-up";
const TEST_DISPATCH_PATH = "/api/agency-followup-walkthrough";
const TEST_DISPATCH_DIR = path.resolve("src/app/api/agency-followup-walkthrough");
const STACK_PROJECT_ID = process.env.AGENCY_FOLLOWUP_STACK_PROJECT_ID || DEFAULT_STACK_PROJECT_ID;
const SUPABASE_API_PORT = parseDisposablePort(process.env.AGENCY_FOLLOWUP_SUPABASE_API_PORT, 55431, "Supabase API");
const SUPABASE_DB_PORT = parseDisposablePort(process.env.AGENCY_FOLLOWUP_SUPABASE_DB_PORT, 55432, "Supabase database");
if (SUPABASE_API_PORT === SUPABASE_DB_PORT || SUPABASE_API_PORT === 55435 || SUPABASE_DB_PORT === 55435) {
  throw new Error("Disposable Supabase API/database ports must be distinct and must not overlap the local app port.");
}
const relativeStackDir = path.relative(process.cwd(), STACK_DIR).split(path.sep);
if (relativeStackDir[0] !== "test-results" || relativeStackDir.some((part) => part === "..")
  || !/^crm-local-stack(?:-[A-Za-z0-9-]+)?$/.test(relativeStackDir[1] ?? "")) {
  throw new Error("Disposable stack configuration must stay inside test-results/crm-local-stack[ suffix ].");
}
if (!/^crm-followup-walkthrough-\d{8}(?:-[a-f0-9]{6})?$/.test(STACK_PROJECT_ID) || STACK_PROJECT_ID.length > 40) {
  throw new Error("Disposable Supabase project id must use the guarded CRM walkthrough prefix, date, and at most six hex suffix characters.");
}
const EXPECTED_MIGRATION_BLOB = "c6d594c51b8c257aaca7a62fff41c96a1534a86a";
const MIGRATION_PATH = "supabase/migrations/20261013173327_agency_followup_journeys.sql";
const EXPECTED_FOLLOWUP_EVENT_PRIVILEGES_BLOB = "ee1e90d62b102bae25b1f385902898394ccee7f4";
const FOLLOWUP_EVENT_PRIVILEGES_PATH = "supabase/migrations/20261013174258_harden_agency_followup_events_privileges.sql";
const EXPECTED_CRM_GRANTS_MIGRATION_BLOB = "af413a079a76e2fc9844f0bb37d61bec3127b558";
const CRM_GRANTS_MIGRATION_PATH = "supabase/migrations/20261013230354_agency_crm_service_role_grants.sql";
const EVENT_MIGRATION_PATH = "supabase/migrations/20261020025251_agency_followup_resend_events_and_shared_suppression.sql";
const EXPECTED_EVENT_MIGRATION_BLOB = "ea4cf8a7186f338d65127d27099902e30949b345";
const EVENT_ROW_LOCK_GRANT_MIGRATION_PATH = "supabase/migrations/20261020141945_agency_followup_provider_event_row_lock_privilege.sql";
const EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB = "4c5a29df51e716fe37b2a1ac34a300ad8beef351";
const OPT_IN_EVENT_MIGRATION_PATH = "supabase/migrations/20261021040000_agency_followup_opt_in_events.sql";
const EXPECTED_OPT_IN_EVENT_MIGRATION_BLOB = "7f34b1f9f51772557111c5ba35213d9402e1b6f7";
const OPT_IN_OPERATOR_READ_MIGRATION_PATH = "supabase/migrations/20261021050000_agency_followup_opt_in_operator_read_grant.sql";
const EXPECTED_OPT_IN_OPERATOR_READ_MIGRATION_BLOB = "3776336f64ab72907a7f1a2eac1d1926bed1fd13";
const TEST_MESSAGE_CLAIM_MIGRATION_PATH = "supabase/migrations/20261021173939_agency_followup_test_message_claim.sql";
const EXPECTED_TEST_MESSAGE_CLAIM_MIGRATION_BLOB = "81fcf78ff31d62852ce54cba7f3f4e34ec6093df";
const WEBHOOK_REPLAY_GUARD_MIGRATION_PATH = "supabase/migrations/20261022172352_agency_followup_webhook_replay_quarantine_guard.sql";
const EXPECTED_WEBHOOK_REPLAY_GUARD_MIGRATION_BLOB = "1ee04f22a7b00fa69eaca227e6443c663e88818a";
const PROVIDER_EVENT_LEAST_PRIVILEGE_MIGRATION_PATH = "supabase/migrations/20261022222611_agency_followup_provider_event_least_privilege.sql";
const EXPECTED_PROVIDER_EVENT_LEAST_PRIVILEGE_MIGRATION_BLOB = "1268f5f5883479bb2bf79410f45142303e804d9e";
const TEMPLATE_APPROVAL_ATOMIC_MIGRATION_PATH = "supabase/migrations/20261023170628_agency_followup_template_approval_atomic.sql";
const EXPECTED_TEMPLATE_APPROVAL_ATOMIC_MIGRATION_BLOB = "62d25762c0e753cb7fbe3577e4e7119b41514af2";
const LIVE_MESSAGE_CLAIM_MIGRATION_PATH = "supabase/migrations/20261023185535_agency_followup_live_message_claim.sql";
const EXPECTED_LIVE_MESSAGE_CLAIM_MIGRATION_BLOB = "caf1aa2eb9ffe6a3a9ac9e1b3f500e870068f4c0";
const PROVIDER_IDEMPOTENCY_FENCE_MIGRATION_PATH = "supabase/migrations/20261023185615_agency_followup_provider_idempotency_fence.sql";
const EXPECTED_PROVIDER_IDEMPOTENCY_FENCE_MIGRATION_BLOB = "65cdcf1d16a7f2c61af9ec3cbf38341e59b9d35e";
const RESEND_SUPPRESSED_STATUS_MIGRATION_PATH = "supabase/migrations/20261024054520_agency_followup_resend_suppressed_status.sql";
const EXPECTED_RESEND_SUPPRESSED_STATUS_MIGRATION_BLOB = "5f257491d03b362c59a484c942be1f127f0996fb";
const SERIALIZED_PROVIDER_HANDOFF_GATE_MIGRATION_PATH = "supabase/migrations/20261024171116_agency_followup_serialized_provider_handoff_gate.sql";
const EXPECTED_SERIALIZED_PROVIDER_HANDOFF_GATE_MIGRATION_BLOB = "42d95e2b2dd06c06ef964ee100be5fcf82681b4c";
const UNKNOWN_RESEND_RECONCILIATION_MIGRATION_PATH = "supabase/migrations/20261024175302_agency_followup_resend_unknown_reconciliation.sql";
const EXPECTED_UNKNOWN_RESEND_RECONCILIATION_MIGRATION_BLOB = "bdb560a3d19bc0e382ad87935aad122bdedb4f42";
const CONTACT_HANDOFF_MIGRATION_PATH = "supabase/migrations/20261024213806_agency_followup_handoff_clock_recheck_and_contact_suppression.sql";
const EXPECTED_CONTACT_HANDOFF_MIGRATION_BLOB = "dd5b66599da36d382de74db2030e57e91ee5c50f";
const ACTIVITY_LOCK_ORDER_FIX_MIGRATION_PATH = "supabase/migrations/20261024233611_agency_followup_activity_lock_order_fix.sql";
const EXPECTED_ACTIVITY_LOCK_ORDER_FIX_MIGRATION_BLOB = "d28a2677b14a490b0a5fb81b70c49aecca889b0f";
const WIDTHS = [1440, 1024, 769, 768, 767, 640, 375, 320];
const CONSENT_PANEL_WIDTHS = [1440, 1024, 768, 640, 375, 320];
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

function parseDisposablePort(raw: string | undefined, fallback: number, label: string): number {
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 55430 || port > 55499) {
    throw new Error(`${label} port must be an unused loopback-only test port from 55430 through 55499.`);
  }
  return port;
}

function chooseWindowSafeTimezone(now: Date): string {
  const candidates = [
    "UTC", "America/St_Johns", "America/Toronto", "America/Los_Angeles",
    "Pacific/Honolulu", "Atlantic/Azores", "Europe/London", "Europe/Paris",
    "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Kathmandu",
    "Asia/Tokyo", "Australia/Adelaide", "Australia/Sydney", "Pacific/Kiritimati",
  ];
  const choices = candidates.map((timeZone) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      throw new Error("Could not read the synthetic journey timezone clock.");
    }
    return { timeZone, minutesUntilClose: 23 * 60 + 59 - (hour * 60 + minute) };
  }).sort((left, right) => right.minutesUntilClose - left.minutesUntilClose);
  const selected = choices[0];
  if (!selected || selected.minutesUntilClose < 120) {
    throw new Error("Could not select a synthetic journey timezone at least two hours before its 23:59 close.");
  }
  return selected.timeZone;
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

function redactSensitiveText(value: string): string {
  return value
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|PORTAL_SECRET|AGENCY_FOLLOWUP_WALKTHROUGH_TOKEN)(\s*[=:]\s*)[^\s"']+/g, "$1$2[REDACTED]")
    .replace(/\b(set-cookie|cookie|cookies)\s*[:=]\s*[^}\]\r\n]*/gi, "$1: [REDACTED]")
    .replace(/\bauthorization\s*[:=]\s*[^}\]\r\n]*/gi, "authorization: [REDACTED]")
    .replace(/\b(portal_session|sb-access-token|sb-refresh-token)\s*=\s*[^;,\s}\]]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]{24,})?\b/g, "[REDACTED_TOKEN]");
}

function safeFailureText(value: unknown, maxLength: number): string {
  return redactSensitiveText(String(value)).replace(/[\r\n\s]+/g, " ").slice(0, maxLength);
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
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== String(SUPABASE_API_PORT)) {
    throw new Error(`The disposable walkthrough requires Supabase API http://127.0.0.1:${SUPABASE_API_PORT}.`);
  }
  return url;
}

function assertLoopbackDatabase(raw: string): URL {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
    url.port !== String(SUPABASE_DB_PORT) || url.pathname !== "/postgres") {
    throw new Error(`The disposable walkthrough requires direct Postgres at 127.0.0.1:${SUPABASE_DB_PORT}/postgres.`);
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
    API_URL: `http://127.0.0.1:${SUPABASE_API_PORT}`,
    DB_URL: `postgresql://postgres:postgres@127.0.0.1:${SUPABASE_DB_PORT}/postgres`,
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
  const remoteRef = "refs/heads/codex/crm-live-followup-final-gates-20261024";
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
      [["20261013173327", "20261013174258", "20261013230354", "20261020025251", "20261020141945", "20261021040000", "20261021050000", "20261021173939", "20261022172352", "20261022222611", "20261023170628", "20261023185535", "20261023185615", "20261024054520", "20261024171116", "20261024175302", "20261024213806", "20261024233611"]],
    ),
  ]);
  if (identity.rows[0]?.database !== "postgres" || !identity.rows[0]?.address || migration.rows[0]?.count !== "18") {
    throw new Error("Disposable Postgres identity or exact eighteen-migration ledger check failed.");
  }
  const templateApprovalRpc = await pool.query<{ service_access: boolean; anon_denied: boolean; authenticated_denied: boolean; security_invoker: boolean }>(
    "select has_function_privilege('service_role', 'public.approve_agency_followup_template_version(uuid,uuid)', 'execute') as service_access, not has_function_privilege('anon', 'public.approve_agency_followup_template_version(uuid,uuid)', 'execute') as anon_denied, not has_function_privilege('authenticated', 'public.approve_agency_followup_template_version(uuid,uuid)', 'execute') as authenticated_denied, not prosecdef as security_invoker from pg_proc where oid='public.approve_agency_followup_template_version(uuid,uuid)'::regprocedure",
  );
  if (templateApprovalRpc.rows[0]?.service_access !== true || templateApprovalRpc.rows[0]?.anon_denied !== true ||
    templateApprovalRpc.rows[0]?.authenticated_denied !== true || templateApprovalRpc.rows[0]?.security_invoker !== true) {
    throw new Error("The template-approval RPC must be invoker-only and executable only by service_role.");
  }
  const claimRpc = await pool.query<{ service_access: boolean; anon_denied: boolean; authenticated_denied: boolean; security_invoker: boolean }>(
    "select has_function_privilege('service_role', 'public.claim_agency_followup_test_messages(text,timestamptz,integer,integer,jsonb)', 'execute') as service_access, not has_function_privilege('anon', 'public.claim_agency_followup_test_messages(text,timestamptz,integer,integer,jsonb)', 'execute') as anon_denied, not has_function_privilege('authenticated', 'public.claim_agency_followup_test_messages(text,timestamptz,integer,integer,jsonb)', 'execute') as authenticated_denied, not prosecdef as security_invoker from pg_proc where oid='public.claim_agency_followup_test_messages(text,timestamptz,integer,integer,jsonb)'::regprocedure",
  );
  if (claimRpc.rows[0]?.service_access !== true || claimRpc.rows[0]?.anon_denied !== true ||
    claimRpc.rows[0]?.authenticated_denied !== true || claimRpc.rows[0]?.security_invoker !== true) {
    throw new Error("The test-message claim RPC must be invoker-only and executable only by service_role.");
  }
  const liveClaimRpc = await pool.query<{ service_access: boolean; anon_denied: boolean; authenticated_denied: boolean; security_invoker: boolean }>(
    "select has_function_privilege('service_role', 'public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[])', 'execute') as service_access, not has_function_privilege('anon', 'public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[])', 'execute') as anon_denied, not has_function_privilege('authenticated', 'public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[])', 'execute') as authenticated_denied, not prosecdef as security_invoker from pg_proc where oid='public.claim_agency_followup_live_messages(text,timestamptz,integer,integer,uuid[])'::regprocedure",
  );
  if (liveClaimRpc.rows[0]?.service_access !== true || liveClaimRpc.rows[0]?.anon_denied !== true ||
    liveClaimRpc.rows[0]?.authenticated_denied !== true || liveClaimRpc.rows[0]?.security_invoker !== true) {
    throw new Error("The live-enrollment claim RPC must be invoker-only and executable only by service_role.");
  }
  const providerHandoffRpc = await pool.query<{
    service_access: boolean; anon_denied: boolean; authenticated_denied: boolean; security_invoker: boolean;
    fixed_search_path: boolean; old_prepare_revoked: boolean; first_use_column: boolean; immutable_trigger: boolean;
  }>(
    "select has_function_privilege('service_role', proc.oid, 'execute') as service_access, not has_function_privilege('anon', proc.oid, 'execute') as anon_denied, not has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_denied, not proc.prosecdef as security_invoker, coalesce(proc.proconfig @> ARRAY['search_path=\"\"']::text[], false) as fixed_search_path, not coalesce((select has_function_privilege('service_role', old.oid, 'execute') from pg_proc old where old.oid = to_regprocedure('public.prepare_agency_followup_provider_attempt(uuid,uuid,text,integer,integer,integer)')), false) as old_prepare_revoked, exists(select 1 from information_schema.columns where table_schema='public' and table_name='agency_followup_messages' and column_name='provider_idempotency_first_used_at') as first_use_column, exists(select 1 from pg_trigger where tgrelid='public.agency_followup_messages'::regclass and tgname='agency_followup_provider_idempotency_first_use_immutable' and not tgisinternal and tgenabled in ('O','A')) as immutable_trigger from pg_proc proc where proc.oid='public.authorize_agency_followup_provider_handoff(uuid,uuid,text,integer,integer,integer)'::regprocedure",
  );
  if (providerHandoffRpc.rows[0]?.service_access !== true || providerHandoffRpc.rows[0]?.anon_denied !== true ||
    providerHandoffRpc.rows[0]?.authenticated_denied !== true || providerHandoffRpc.rows[0]?.security_invoker !== true ||
    providerHandoffRpc.rows[0]?.fixed_search_path !== true || providerHandoffRpc.rows[0]?.old_prepare_revoked !== true ||
    providerHandoffRpc.rows[0]?.first_use_column !== true || providerHandoffRpc.rows[0]?.immutable_trigger !== true) {
    throw new Error("The serialized provider authorization RPC, legacy bypass revocation, timestamp, immutable trigger, or restricted grants are not in the expected state.");
  }
  const contactEventRpc = await pool.query<{
    service_access: boolean; anon_denied: boolean; authenticated_denied: boolean; security_invoker: boolean;
    fixed_search_path: boolean; service_table_access: boolean; public_table_denied: boolean;
    rls_forced: boolean; immutable_application_trigger: boolean;
  }>(
    "select has_function_privilege('service_role', proc.oid, 'execute') as service_access, not has_function_privilege('anon', proc.oid, 'execute') as anon_denied, not has_function_privilege('authenticated', proc.oid, 'execute') as authenticated_denied, not proc.prosecdef as security_invoker, coalesce(proc.proconfig @> ARRAY['search_path=\"\"']::text[], false) as fixed_search_path, has_table_privilege('service_role','public.agency_followup_provider_contact_applications','select') and has_table_privilege('service_role','public.agency_followup_provider_contact_applications','insert') as service_table_access, not has_table_privilege('anon','public.agency_followup_provider_contact_applications','select') and not has_table_privilege('anon','public.agency_followup_provider_contact_applications','insert') and not has_table_privilege('anon','public.agency_followup_provider_contact_applications','update') and not has_table_privilege('anon','public.agency_followup_provider_contact_applications','delete') and not has_table_privilege('authenticated','public.agency_followup_provider_contact_applications','select') and not has_table_privilege('authenticated','public.agency_followup_provider_contact_applications','insert') and not has_table_privilege('authenticated','public.agency_followup_provider_contact_applications','update') and not has_table_privilege('authenticated','public.agency_followup_provider_contact_applications','delete') as public_table_denied, relation.relrowsecurity and relation.relforcerowsecurity as rls_forced, exists(select 1 from pg_trigger where tgrelid=relation.oid and tgname='agency_followup_provider_contact_applications_no_mutation' and not tgisinternal and tgenabled in ('O','A')) as immutable_application_trigger from pg_proc proc join pg_class relation on relation.oid='public.agency_followup_provider_contact_applications'::regclass where proc.oid='public.persist_agency_followup_resend_contact_event(text,timestamptz,text,text)'::regprocedure",
  );
  if (contactEventRpc.rows[0]?.service_access !== true || contactEventRpc.rows[0]?.anon_denied !== true ||
    contactEventRpc.rows[0]?.authenticated_denied !== true || contactEventRpc.rows[0]?.security_invoker !== true ||
    contactEventRpc.rows[0]?.fixed_search_path !== true || contactEventRpc.rows[0]?.service_table_access !== true ||
    contactEventRpc.rows[0]?.public_table_denied !== true ||
    contactEventRpc.rows[0]?.rls_forced !== true || contactEventRpc.rows[0]?.immutable_application_trigger !== true) {
    throw new Error("The hash-only contact-event RPC and append-only application table are not protected by the expected service-role boundary.");
  }
  const tables = await pool.query<{ count: string }>(
    "select count(*)::text as count from information_schema.tables where table_schema='public' and table_name = any($1::text[])",
    [["agency_followup_template_versions", "agency_followup_journeys", "agency_followup_steps",
      "agency_followup_enrollments", "agency_followup_messages", "agency_followup_events",
      "agency_followup_provider_events", "agency_followup_provider_event_applications", "agency_followup_provider_contact_applications",
      "prospect_contactability_provider_suppressions"]],
  );
  if (tables.rows[0]?.count !== "10") throw new Error("The verified disposable stack does not contain the six follow-up and four provider-event tables.");
  const providerGrants = await pool.query<{ service_access: boolean; public_access: boolean; public_update_access: boolean; service_event_column_update: boolean; service_event_table_update: boolean; service_event_other_column_update: boolean; immutable_event_trigger: boolean }>(
    "select bool_and(has_table_privilege('service_role', table_name, 'select') and has_table_privilege('service_role', table_name, 'insert')) as service_access, bool_or(has_table_privilege('anon', table_name, 'select') or has_table_privilege('authenticated', table_name, 'select')) as public_access, bool_or(has_table_privilege('anon', table_name, 'update') or has_table_privilege('authenticated', table_name, 'update')) as public_update_access, has_column_privilege('service_role', 'public.agency_followup_provider_events', 'provider_event_id', 'update') as service_event_column_update, has_table_privilege('service_role', 'public.agency_followup_provider_events', 'update') as service_event_table_update, has_column_privilege('service_role', 'public.agency_followup_provider_events', 'processing_result', 'update') as service_event_other_column_update, exists(select 1 from pg_trigger where tgrelid='public.agency_followup_provider_events'::regclass and tgname='agency_followup_provider_events_no_mutation' and not tgisinternal and tgenabled in ('O','A') and (tgtype & 2) = 2 and (tgtype & 8) = 8 and (tgtype & 16) = 16) as immutable_event_trigger from unnest(array['public.agency_followup_provider_events','public.agency_followup_provider_event_applications','public.agency_followup_provider_contact_applications','public.prospect_contactability_provider_suppressions']) as event_table(table_name)",
  );
  if (providerGrants.rows[0]?.service_access !== true || providerGrants.rows[0]?.public_access !== false
    || providerGrants.rows[0]?.public_update_access !== false
    || providerGrants.rows[0]?.service_event_column_update !== true
    || providerGrants.rows[0]?.service_event_table_update !== false
    || providerGrants.rows[0]?.service_event_other_column_update !== false
    || providerGrants.rows[0]?.immutable_event_trigger !== true) {
    throw new Error(`Provider-event row-lock privilege, append-only trigger, or restricted grants are not in the expected state; actual=${JSON.stringify(providerGrants.rows[0] ?? null)}`);
  }
  const grants = await pool.query<{ service_access: boolean; public_access: boolean }>(
    "select bool_and(has_table_privilege('service_role', table_name, 'select') and has_table_privilege('service_role', table_name, 'insert')) as service_access, bool_or(has_table_privilege('anon', table_name, 'select') or has_table_privilege('authenticated', table_name, 'select')) as public_access from unnest(array['public.agency_prospects','public.agency_deals','public.agency_reminders']) as crm_table(table_name)",
  );
  if (grants.rows[0]?.service_access !== true || grants.rows[0]?.public_access !== false) {
    throw new Error("Disposable Agency CRM service-role grants or public-role revocations are not in the expected state.");
  }
  const operatorRead = await pool.query<{ id_access: boolean; role_access: boolean; disabled_access: boolean; public_access: boolean }>(
    "select has_column_privilege('service_role','public.firm_lawyers','id','select') as id_access, has_column_privilege('service_role','public.firm_lawyers','role','select') as role_access, has_column_privilege('service_role','public.firm_lawyers','disabled','select') as disabled_access, not has_column_privilege('anon','public.firm_lawyers','id','select') and not has_column_privilege('authenticated','public.firm_lawyers','id','select') as public_access",
  );
  if (operatorRead.rows[0]?.id_access !== true || operatorRead.rows[0]?.role_access !== true || operatorRead.rows[0]?.disabled_access !== true
    || operatorRead.rows[0]?.public_access !== true) {
    throw new Error(`The opt-in operator identity fields must be available to service_role and unavailable to public roles; actual=${JSON.stringify(operatorRead.rows[0] ?? null)}`);
  }
  progress("disposable identity, all required acceptance migration ledger versions, ten follow-up/provider tables, append-only controls, restricted grants, public operator access denial, and CRM RPC grants checked");
}

async function verifyTemplateApprovalRollback(pool: Pool, actorId: string): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const templateKey = `walkthrough-rollback-${suffix}`;
  const subject = "Synthetic approval rollback probe";
  const body = "This draft exists only inside the disposable walkthrough transaction.";
  const contentHash = createHash("sha256").update(`${subject}\n${body}`, "utf8").digest("hex");
  const functionName = `walkthrough_reject_template_approval_${suffix}`;
  const triggerName = `walkthrough_reject_template_approval_${suffix}`;
  try {
    await client.query("begin");
    const activeActor = await client.query<{ role: string; disabled: boolean }>(
      "select role,disabled from public.firm_lawyers where id=$1",
      [actorId],
    );
    if (activeActor.rows[0]?.role !== "operator" || activeActor.rows[0]?.disabled !== false) {
      throw new Error("The walkthrough rollback probe requires its seeded actor to be an active operator.");
    }
    const inserted = await client.query<{ id: string }>(
      "insert into public.agency_followup_template_versions (template_key,version,channel,subject,body,content_sha256,state,created_by_operator_id) values ($1,1,'email',$2,$3,$4,'draft',$5) returning id",
      [templateKey, subject, body, contentHash, actorId],
    );
    const templateId = inserted.rows[0]?.id;
    if (!templateId) throw new Error("The disposable rollback probe draft was not created.");
    const rejectedActorStates: string[] = [];
    const assertActorRejected = async (label: string, candidateActorId: string, mutation?: "lawyer" | "disabled") => {
      const savepoint = `before_actor_guard_${rejectedActorStates.length}`;
      await client.query(`savepoint ${savepoint}`);
      if (mutation === "lawyer") await client.query("update public.firm_lawyers set role='lawyer' where id=$1", [actorId]);
      if (mutation === "disabled") await client.query("update public.firm_lawyers set disabled=true where id=$1", [actorId]);
      await client.query("set local role service_role");
      let rejected = false;
      try {
        await client.query("select public.approve_agency_followup_template_version($1::uuid,$2::uuid)", [templateId, candidateActorId]);
      } catch (error) {
        rejected = String(error).includes("only an active operator may approve an agency follow-up template version");
      }
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
      if (!rejected) throw new Error(`The approval RPC did not reject the ${label} actor.`);
      const [template, events, restoredActor] = await Promise.all([
        client.query<{ state: string }>("select state from public.agency_followup_template_versions where id=$1", [templateId]),
        client.query<{ count: string }>("select count(*)::text as count from public.agency_followup_events where template_version_id=$1 and event_type='template_approved'", [templateId]),
        client.query<{ role: string; disabled: boolean }>("select role,disabled from public.firm_lawyers where id=$1", [actorId]),
      ]);
      if (template.rows[0]?.state !== "draft" || events.rows[0]?.count !== "0" || restoredActor.rows[0]?.role !== "operator" || restoredActor.rows[0]?.disabled !== false) {
        throw new Error(`Rejecting the ${label} actor changed approval state, audit history, or the seeded operator fixture.`);
      }
      rejectedActorStates.push(label);
    };
    await assertActorRejected("missing", randomUUID());
    await assertActorRejected("non-operator", actorId, "lawyer");
    await assertActorRejected("disabled operator", actorId, "disabled");
    await client.query(`
      create function public.${functionName}() returns trigger
      language plpgsql as $$
      begin
        if new.template_version_id = '${templateId}'::uuid and new.event_type = 'template_approved' then
          raise exception 'walkthrough injected template approval audit failure';
        end if;
        return new;
      end;
      $$
    `);
    await client.query(`create trigger ${triggerName} before insert on public.agency_followup_events for each row execute function public.${functionName}()`);
    await client.query("savepoint before_template_approval_failure");
    await client.query("set local role service_role");
    let auditFailureInjected = false;
    try {
      await client.query("select public.approve_agency_followup_template_version($1::uuid,$2::uuid)", [templateId, actorId]);
    } catch (error) {
      auditFailureInjected = String(error).includes("walkthrough injected template approval audit failure");
    }
    await client.query("rollback to savepoint before_template_approval_failure");
    if (!auditFailureInjected) throw new Error("The disposable approval RPC did not reach the injected audit-insert failure.");
    const [template, events] = await Promise.all([
      client.query<{ state: string; approved_by_operator_id: string | null; approved_at: Date | null }>(
        "select state,approved_by_operator_id,approved_at from public.agency_followup_template_versions where id=$1",
        [templateId],
      ),
      client.query<{ count: string }>(
        "select count(*)::text as count from public.agency_followup_events where template_version_id=$1 and event_type='template_approved'",
        [templateId],
      ),
    ]);
    const row = template.rows[0];
    if (row?.state !== "draft" || row.approved_by_operator_id !== null || row.approved_at !== null || events.rows[0]?.count !== "0") {
      throw new Error("A failed approval audit insert did not roll back the template approval row and audit event together.");
    }
    progress("disposable RPC rejected missing, non-operator, and disabled actors; injected audit-insert failure left its template draft and no approval event");
    return { rejectedActorStates, injectedAuditFailure: true, rowStateAfterFailure: row.state, approvalActorAfterFailure: row.approved_by_operator_id, approvalTimeAfterFailure: row.approved_at, approvalEventCountAfterFailure: 0, transactionRolledBackInFinally: true };
  } finally {
    try { await client.query("rollback").catch(() => undefined); }
    finally { client.release(); }
  }
}

async function verifyTemplateApprovalAudit(pool: Pool, templateKey: string, actorId: string): Promise<Record<string, unknown>> {
  const template = await pool.query<{
    id: string; state: string; version: number; template_key: string; content_sha256: string;
    approved_by_operator_id: string | null; approved_at: Date | null;
  }>(
    "select id,state,version,template_key,content_sha256,approved_by_operator_id,approved_at from public.agency_followup_template_versions where template_key=$1 and version=1",
    [templateKey],
  );
  const row = template.rows[0];
  if (template.rows.length !== 1 || !row || row.state !== "approved" || row.approved_by_operator_id !== actorId || !row.approved_at) {
    throw new Error("The synthetic template approval row did not persist its exact reviewer and approval time.");
  }
  const events = await pool.query<{
    idempotency_key: string; event_payload: Record<string, unknown>; actor_operator_id: string | null; occurred_at: Date;
  }>(
    "select idempotency_key,event_payload,actor_operator_id,occurred_at from public.agency_followup_events where template_version_id=$1 and event_type='template_approved'",
    [row.id],
  );
  const event = events.rows[0];
  const reviewedAt = typeof event?.event_payload.reviewedAt === "string" ? Date.parse(event.event_payload.reviewedAt) : Number.NaN;
  if (events.rows.length !== 1 || !event || event.actor_operator_id !== actorId ||
    event.idempotency_key !== `template-approved:${row.id}:${actorId}` ||
    event.event_payload.templateKey !== row.template_key || Number(event.event_payload.version) !== row.version ||
    event.event_payload.contentSha256 !== row.content_sha256 || event.event_payload.reviewerId !== actorId ||
    !Number.isFinite(reviewedAt) || reviewedAt !== row.approved_at.getTime()) {
    throw new Error("The synthetic template approval audit event did not exactly match the approved row's reviewer, time, content hash, key, and version.");
  }
  progress("synthetic template approval row and exactly one audit event matched reviewer, timestamp, content hash, key, and version");
  return { templateId: row.id, templateKey: row.template_key, version: row.version, reviewerId: actorId, approvedAt: row.approved_at.toISOString(), contentSha256: row.content_sha256, approvalEventIdempotencyKey: event.idempotency_key, approvalEventCount: 1, auditReviewedAtMatchesApprovedAt: true };
}

async function verifyTestMessageClaimRpc(
  pool: Pool,
  input: { messageId: string; enrollmentId: string; recipientEmail: string },
  now: string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  const target = { enrollmentId: input.enrollmentId, messageId: input.messageId, recipientEmail: input.recipientEmail };
  const mismatches = [
    { ...target, enrollmentId: randomUUID() },
    { ...target, messageId: randomUUID() },
    { ...target, recipientEmail: `mismatch-${input.recipientEmail}` },
  ];
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const claim = async (workerId: string, allowedTarget: typeof target, limit = 1) => client.query<{
      id: string; enrollment_id: string; recipient_email_snapshot: string; attempt_count: number; lease_owner: string;
    }>(
      "select id,enrollment_id,recipient_email_snapshot,attempt_count,lease_owner from public.claim_agency_followup_test_messages($1,$2::timestamptz,60,$3,$4::jsonb)",
      [workerId, now, limit, JSON.stringify([allowedTarget])],
    );
    for (const [index, mismatch] of mismatches.entries()) {
      const excluded = await claim(`walkthrough-test-claim-mismatch-${index}-${RUN_ID}`, mismatch);
      if (excluded.rows.length !== 0) throw new Error("The test-message claim RPC claimed a target with an enrollment, message, or recipient mismatch.");
    }
    await client.query("savepoint invalid_test_claim_limit");
    let invalidLimitRejected = false;
    try {
      await claim(`walkthrough-test-claim-invalid-limit-${RUN_ID}`, target, 2);
    } catch (error) {
      invalidLimitRejected = String(error).includes("test mode may claim exactly one message");
    }
    await client.query("rollback to savepoint invalid_test_claim_limit");
    if (!invalidLimitRejected) throw new Error("The test-message claim RPC did not reject a batch size above one.");
    const claimed = await claim(`walkthrough-test-claim-allowed-${RUN_ID}`, target);
    if (claimed.rows.length !== 1 || claimed.rows[0]?.id !== target.messageId ||
      claimed.rows[0]?.enrollment_id !== target.enrollmentId || claimed.rows[0]?.recipient_email_snapshot !== target.recipientEmail ||
      claimed.rows[0]?.attempt_count !== 1 || claimed.rows[0]?.lease_owner !== `walkthrough-test-claim-allowed-${RUN_ID}`) {
      throw new Error("The test-message claim RPC did not claim exactly the configured enrollment/message/recipient target.");
    }
    await client.query("rollback");
    progress("runtime test-claim RPC excluded enrollment/message/recipient mismatches, enforced limit one, and claimed the exact synthetic target");
    return { mismatchedTargetsExcluded: 3, maximumBatchSize: 1, exactTargetClaimed: true, transactionRolledBack: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verifyLiveClaimRpc(
  pool: Pool,
  input: { allowedMessageId: string; offListMessageId: string; expiredOffListMessageId: string },
  now: string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  const workerId = `walkthrough-live-claim-${RUN_ID}`;
  const dueAt = new Date(Date.parse(now) - 60_000).toISOString();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const identities = await client.query<{ id: string; enrollment_id: string }>(
      "select id,enrollment_id from public.agency_followup_messages where id=any($1::uuid[])",
      [[input.allowedMessageId, input.offListMessageId, input.expiredOffListMessageId]],
    );
    const byId = new Map(identities.rows.map((row) => [row.id, row]));
    const allowed = byId.get(input.allowedMessageId);
    const offList = byId.get(input.offListMessageId);
    const expiredOffList = byId.get(input.expiredOffListMessageId);
    if (!allowed || !offList || !expiredOffList || new Set(identities.rows.map((row) => row.enrollment_id)).size !== 3) {
      throw new Error("The live-claim fixture must use three existing messages from three distinct synthetic enrollments.");
    }
    await client.query(
      "update public.agency_followup_messages set state='scheduled',scheduled_at=$2,lease_owner=null,lease_until=null where id=$1",
      [allowed.id, dueAt],
    );
    await client.query(
      "update public.agency_followup_messages set state='scheduled',scheduled_at=$2,lease_owner=null,lease_until=null where id=$1",
      [offList.id, dueAt],
    );
    await client.query(
      "update public.agency_followup_messages set state='claimed',scheduled_at=$2,lease_owner=$3,lease_until=$4::timestamptz,attempt_count=attempt_count+1 where id=$1",
      [expiredOffList.id, dueAt, `${workerId}-expired`, new Date(Date.parse(now) - 60_000).toISOString()],
    );
    const before = await client.query<{
      id: string; state: string; scheduled_at: Date; attempt_count: number; lease_owner: string | null; lease_until: Date | null;
    }>(
      "select id,state,scheduled_at,attempt_count,lease_owner,lease_until from public.agency_followup_messages where id=any($1::uuid[]) order by id",
      [[offList.id, expiredOffList.id]],
    );
    const claim = async (allowedIds: string[], limit = 1) => client.query<{
      id: string; enrollment_id: string; attempt_count: number; lease_owner: string;
    }>(
      "select id,enrollment_id,attempt_count,lease_owner from public.claim_agency_followup_live_messages($1,$2::timestamptz,60,$3,$4::uuid[])",
      [workerId, now, limit, allowedIds],
    );
    let emptyRejected = false;
    await client.query("savepoint invalid_live_claim_empty");
    try { await claim([]); } catch (error) { emptyRejected = String(error).includes("live enrollment allowlist is invalid"); }
    await client.query("rollback to savepoint invalid_live_claim_empty");
    let oversizedRejected = false;
    await client.query("savepoint invalid_live_claim_limit");
    try { await claim([allowed.enrollment_id], 2); } catch (error) { oversizedRejected = String(error).includes("exactly one message"); }
    await client.query("rollback to savepoint invalid_live_claim_limit");
    if (!emptyRejected || !oversizedRejected) throw new Error("The live claim RPC accepted an empty allowlist or a limit above one.");
    const claimed = await claim([allowed.enrollment_id]);
    if (claimed.rows.length !== 1 || claimed.rows[0]?.id !== allowed.id ||
      claimed.rows[0]?.enrollment_id !== allowed.enrollment_id || claimed.rows[0]?.lease_owner !== workerId) {
      throw new Error("The live claim RPC did not claim the one due message in the allowlisted enrollment.");
    }
    const after = await client.query<{
      id: string; state: string; scheduled_at: Date; attempt_count: number; lease_owner: string | null; lease_until: Date | null;
    }>(
      "select id,state,scheduled_at,attempt_count,lease_owner,lease_until from public.agency_followup_messages where id=any($1::uuid[]) order by id",
      [[offList.id, expiredOffList.id]],
    );
    const snapshot = (row: typeof before.rows[number] | undefined) => row && ({
      id: row.id, state: row.state, scheduledAt: row.scheduled_at.toISOString(), attemptCount: Number(row.attempt_count),
      leaseOwner: row.lease_owner, leaseUntil: row.lease_until?.toISOString() ?? null,
    });
    const event = await client.query<{ count: string }>(
      "select count(*)::text as count from public.agency_followup_events where idempotency_key=$1",
      [`lease-expired:${expiredOffList.id}`],
    );
    if (JSON.stringify(before.rows.map(snapshot)) !== JSON.stringify(after.rows.map(snapshot)) || event.rows[0]?.count !== "0") {
      throw new Error("The live claim RPC changed or quarantined an off-list due/expired message.");
    }
    await client.query("rollback");
    progress("runtime live claim RPC claimed the allowlisted message, rejected empty/oversized input, and left off-list due and expired rows unchanged");
    return { allowlistedMessageClaimed: true, emptyAllowlistRejected: true, limitAboveOneRejected: true, offListScheduledUntouched: true, offListExpiredLeaseUntouched: true, transactionRolledBack: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type AgencyProviderAuthorization = {
  result: "ready" | "blocked" | "deferred" | "expired" | "stale";
  request?: { idempotencyKey: string; recipientEmail: string; subject: string; body: string };
  blockers?: string[];
  blocker?: string;
  retryAt?: string;
};

type ExactAgencyProviderRequest = NonNullable<AgencyProviderAuthorization["request"]>;
const SAFE_PROVIDER_AUTHORIZATION_RESULTS = new Set<string>(["ready", "blocked", "deferred", "expired", "stale"]);
const SAFE_PROVIDER_AUTHORIZATION_BLOCKERS = new Set<string>([
  "contactability_unknown", "contactability_blocked", "conversation_stopped", "prospect_status_stopped",
  "sequence_not_released", "eligibility_not_approved", "eligibility_evidence_missing", "recipient_email_invalid",
  "recipient_identity_missing", "explicit_opt_in_withdrawn", "explicit_opt_in_missing", "approval_stale_recipient",
  "approval_missing", "approval_invalid_reviewer_or_time", "approval_stale_content", "previous_step_unresolved",
  "previous_step_pending", "minimum_spacing_not_elapsed", "not_due", "invalid_schedule", "outside_send_window",
]);

function safeProviderAuthorizationDiagnostic(value: unknown): {
  authorizationResult: string;
  authorizationBlocker: string;
} {
  const authorization = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const authorizationResult = typeof authorization.result === "string" &&
      SAFE_PROVIDER_AUTHORIZATION_RESULTS.has(authorization.result)
    ? authorization.result
    : "unknown";
  const rawBlockers = Array.isArray(authorization.blockers)
    ? authorization.blockers
    : authorization.blocker === undefined ? [] : [authorization.blocker];
  const authorizationBlocker = [...new Set(rawBlockers.map((blocker) =>
    typeof blocker === "string" && SAFE_PROVIDER_AUTHORIZATION_BLOCKERS.has(blocker) ? blocker : "other",
  ))].sort().join(",") || "none";
  return { authorizationResult, authorizationBlocker };
}

function safeProviderAuthorizationFields(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)).sort();
}

function hasExactProviderRequest(actual: unknown, expected: ExactAgencyProviderRequest): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const value = actual as Record<string, unknown>;
  const keys = ["body", "idempotencyKey", "recipientEmail", "subject"] as const;
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key) && value[key] === expected[key]);
}

async function authorizeProviderHandoff(
  client: PoolClient,
  input: { messageId: string; enrollmentId: string; owner: string; attemptCount: number },
): Promise<AgencyProviderAuthorization> {
  const result = await client.query<{ authorization: unknown }>(
    "select public.authorize_agency_followup_provider_handoff($1::uuid,$2::uuid,$3,$4,300,82800) as authorization",
    [input.messageId, input.enrollmentId, input.owner, input.attemptCount],
  );
  const value = result.rows[0]?.authorization;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The disposable provider authorization RPC returned no JSON object.");
  }
  const authorization = value as Record<string, unknown>;
  if (!(["ready", "blocked", "deferred", "expired", "stale"] as unknown[]).includes(authorization.result)) {
    throw new Error("The disposable provider authorization RPC returned an unknown result state.");
  }
  if (authorization.result === "ready") {
    const request = authorization.request as Record<string, unknown> | undefined;
    if (!request || typeof request.idempotencyKey !== "string" || typeof request.recipientEmail !== "string" ||
        typeof request.subject !== "string" || typeof request.body !== "string") {
      throw new Error("The ready provider authorization did not contain an exact request payload.");
    }
  } else if (authorization.request !== undefined) {
    throw new Error("A non-ready provider authorization exposed a send request.");
  }
  if (authorization.result === "blocked" && (!Array.isArray(authorization.blockers) || authorization.blockers.length === 0)) {
    throw new Error("The blocked provider authorization did not contain blocker reasons.");
  }
  if (authorization.result === "deferred" && (typeof authorization.blocker !== "string" || typeof authorization.retryAt !== "string")) {
    throw new Error("The deferred provider authorization did not contain its blocker and retryAt.");
  }
  return authorization as AgencyProviderAuthorization;
}

async function verifyProviderIdempotencyFenceRpc(
  pool: Pool,
  input: { firstUseMessageId: string },
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  const claims = new Map<string, { owner: string; attemptCount: number; enrollmentId: string; stepNumber: number }>();
  const insertFixture = async (sourceMessageId: string, owner: string, age: string | null) => {
    const sourceIdentity = await client.query<{ enrollment_id: string }>(
      "select enrollment_id from public.agency_followup_messages where id=$1",
      [sourceMessageId],
    );
    const enrollmentId = sourceIdentity.rows[0]?.enrollment_id;
    if (!enrollmentId) throw new Error("A source enrollment was not found for the provider authorization fixture.");
    const id = randomUUID();
    const logicalKey = agencyFollowupLogicalMessageKey(enrollmentId, id);
    const result = await client.query<{ id: string; enrollment_id: string; attempt_count: number; step_number: number }>(
      `with source as (
         select message.*, enrollment.journey_id
         from public.agency_followup_messages message
         join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id
         where message.id=$1
       ), step as (
         insert into public.agency_followup_steps (journey_id,step_number,template_version_id,delay_business_days)
         select source.journey_id,
                (select coalesce(max(existing.step_number),0)+1 from public.agency_followup_steps existing where existing.journey_id=source.journey_id),
                source.template_version_id,0
         from source
         returning id,journey_id,step_number
       )
       insert into public.agency_followup_messages (
         id,enrollment_id,step_id,step_number,template_version_id,state,content_snapshot,content_sha256,
         recipient_name_snapshot,recipient_email_snapshot,recipient_sha256,
         approved_content_sha256,approved_recipient_sha256,reviewed_by_operator_id,reviewed_at,
         scheduled_at,logical_message_key,provider_idempotency_key,attempt_count,lease_owner,lease_until,
         provider_idempotency_first_used_at
       )
       select $2::uuid,source.enrollment_id,step.id,step.step_number,source.template_version_id,'claimed',source.content_snapshot,
              source.content_sha256,source.recipient_name_snapshot,source.recipient_email_snapshot,source.recipient_sha256,
              source.content_sha256,source.recipient_sha256,source.reviewed_by_operator_id,coalesce(source.reviewed_at,clock_timestamp()),
              clock_timestamp(),$3,$3,1,$4,clock_timestamp()+interval '5 minutes',
              case when $5::text is null then null else clock_timestamp()-$5::interval end
       from source join step on step.journey_id=source.journey_id
       returning id,enrollment_id,attempt_count,step_number`,
      [sourceMessageId, id, logicalKey, owner, age],
    );
    const row = result.rows[0];
    if (!row) throw new Error("A dedicated provider-window message fixture could not be inserted.");
    // The primary synthetic journey is authored with an all-days window and
    // one-hour spacing; this RPC contract never mutates immutable journey policy.
    await client.query(
      `update public.agency_followup_messages predecessor
       set state='accepted', scheduled_at=coalesce(predecessor.scheduled_at,clock_timestamp()-interval '2 days'),
           approved_content_sha256=predecessor.content_sha256, approved_recipient_sha256=predecessor.recipient_sha256,
           reviewed_by_operator_id=coalesce(predecessor.reviewed_by_operator_id,target.reviewed_by_operator_id),
           reviewed_at=coalesce(predecessor.reviewed_at,target.reviewed_at,clock_timestamp()-interval '2 days'),
           provider_message_id=coalesce(predecessor.provider_message_id,'walkthrough-predecessor-'||predecessor.id::text),
           provider_accepted_at=clock_timestamp()-interval '2 days',
           lease_owner=null,lease_until=null,unknown_since=null,last_error_code=null,updated_at=clock_timestamp()
       from public.agency_followup_messages target
       where target.id=$1 and predecessor.enrollment_id=target.enrollment_id and predecessor.step_number<target.step_number`,
      [row.id],
    );
    return { id: row.id, owner, attemptCount: Number(row.attempt_count), enrollmentId: row.enrollment_id, stepNumber: Number(row.step_number) };
  };
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const firstClaim = await insertFixture(input.firstUseMessageId, `first-${RUN_ID}`, null);
    claims.set(firstClaim.id, firstClaim);
    const prepare = async (id: string) => {
      const claim = claims.get(id)!;
      return authorizeProviderHandoff(client, { messageId: id, enrollmentId: claim.enrollmentId, owner: claim.owner, attemptCount: claim.attemptCount });
    };

    const firstUseState = await prepare(firstClaim.id);
    const firstTimestamp = await client.query<{ first_used_at: Date }>(
      "select provider_idempotency_first_used_at as first_used_at from public.agency_followup_messages where id=$1", [firstClaim.id],
    );
    const firstUseAgain = await prepare(firstClaim.id);
    const stableTimestamp = await client.query<{ first_used_at: Date }>(
      "select provider_idempotency_first_used_at as first_used_at from public.agency_followup_messages where id=$1", [firstClaim.id],
    );
    const expected = await client.query<{
      message_id: string; enrollment_id: string; logical_message_key: string; recipient_email_snapshot: string;
      content_snapshot: { channel: "email"; subject: string; body: string };
      content_sha256: string; recipient_sha256: string; approved_content_sha256: string; approved_recipient_sha256: string;
      prospect_id: string; firm_name: string; contact_name: string | null; contact_email: string;
    }>(
      `select message.id as message_id,message.enrollment_id,message.logical_message_key,message.recipient_email_snapshot,
              message.content_snapshot,message.content_sha256,message.recipient_sha256,
              message.approved_content_sha256,message.approved_recipient_sha256,
              prospect.id as prospect_id,prospect.firm_name,prospect.contact_name,prospect.contact_email
       from public.agency_followup_messages message
       join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id
       join public.agency_prospects prospect on prospect.id=enrollment.prospect_id
       where message.id=$1`, [firstClaim.id],
    );
    const snapshot = expected.rows[0];
    if (!snapshot) throw new Error("The final-gate request fixture could not be read back.");
    const contentHash = agencyFollowupContentHash(snapshot.content_snapshot);
    const recipientHash = agencyFollowupRecipientHash({
      prospectId: snapshot.prospect_id,
      firmName: snapshot.firm_name,
      contactName: snapshot.contact_name,
      contactEmail: snapshot.contact_email,
    });
    const expectedRequest = {
      idempotencyKey: agencyFollowupLogicalMessageKey(snapshot.enrollment_id, snapshot.message_id),
      recipientEmail: snapshot.recipient_email_snapshot,
      subject: snapshot.content_snapshot.subject,
      body: snapshot.content_snapshot.body,
    };
    const authorizationsReady = firstUseState.result === "ready" && firstUseAgain.result === "ready";
    const firstRequestExact = hasExactProviderRequest(firstUseState.request, expectedRequest);
    const repeatedRequestExact = hasExactProviderRequest(firstUseAgain.request, expectedRequest);
    const approvedHashesMatch = snapshot.logical_message_key === expectedRequest.idempotencyKey &&
      snapshot.content_sha256 === contentHash && snapshot.approved_content_sha256 === contentHash &&
      snapshot.recipient_sha256 === recipientHash && snapshot.approved_recipient_sha256 === recipientHash;
    const firstUsedAt = firstTimestamp.rows[0]?.first_used_at;
    const firstUsedAgainAt = stableTimestamp.rows[0]?.first_used_at;
    const firstUseReserved = firstUsedAt instanceof Date;
    const firstUseStable = firstUseReserved && firstUsedAgainAt instanceof Date &&
      firstUsedAt.toISOString() === firstUsedAgainAt.toISOString();
    if (!authorizationsReady || !firstRequestExact || !repeatedRequestExact || !approvedHashesMatch ||
      !firstUseReserved || !firstUseStable) {
      throw new Error("The final authorization did not preserve its exact approved request/hash and first-use time: " + JSON.stringify({
        authorizationsReady, firstRequestExact, repeatedRequestExact, approvedHashesMatch, firstUseReserved, firstUseStable,
        firstUseAuthorization: safeProviderAuthorizationDiagnostic(firstUseState),
        repeatedAuthorization: safeProviderAuthorizationDiagnostic(firstUseAgain),
      }));
    }
    let timestampMutationRejected = false;
    await client.query("savepoint immutable_first_use");
    try {
      await client.query("update public.agency_followup_messages set provider_idempotency_first_used_at=null where id=$1", [firstClaim.id]);
    } catch (error) {
      timestampMutationRejected = String(error).includes("timestamp is immutable");
    }
    await client.query("rollback to savepoint immutable_first_use");
    if (!timestampMutationRejected) throw new Error("The provider first-use timestamp could be cleared after reservation.");

    // Keep all boundary fixtures in this known-clear enrollment. Insert and
    // exercise each step before adding the next so each preceding step can be
    // deterministically reconciled as accepted by insertFixture.
    const insideClaim = await insertFixture(input.firstUseMessageId, `inside-${RUN_ID}`, "22 hours 59 minutes");
    claims.set(insideClaim.id, insideClaim);
    const insideState = await prepare(insideClaim.id);
    const insideTimestamp = await client.query<{ age_seconds: number; still_in_window: boolean }>(
      "select floor(extract(epoch from clock_timestamp()-provider_idempotency_first_used_at))::integer as age_seconds, " +
        "clock_timestamp()<provider_idempotency_first_used_at+interval '23 hours' as still_in_window " +
        "from public.agency_followup_messages where id=$1",
      [insideClaim.id],
    );
    const insideRetryAllowed = insideState.result === "ready" && insideTimestamp.rows[0]?.still_in_window === true;

    const expiredClaim = await insertFixture(input.firstUseMessageId, `expired-${RUN_ID}`, "23 hours");
    claims.set(expiredClaim.id, expiredClaim);
    const expiredState = await prepare(expiredClaim.id);
    const expired = await client.query<{ state: string; last_error_code: string | null; scheduled_at: Date | null; lease_owner: string | null; unknown_events: string }>(
      "select message.state,message.last_error_code,message.scheduled_at,message.lease_owner,(select count(*)::text from public.agency_followup_events event where event.idempotency_key='resend-window-expired:'||message.id::text) as unknown_events from public.agency_followup_messages message where message.id=$1",
      [expiredClaim.id],
    );
    if (!insideRetryAllowed || expiredState.result !== "expired" || expired.rows[0]?.state !== "unknown" ||
      expired.rows[0]?.last_error_code !== "resend_idempotency_window_expired" || expired.rows[0]?.scheduled_at !== null ||
      expired.rows[0]?.lease_owner !== null || expired.rows[0]?.unknown_events !== "1") {
      throw new Error("The provider handoff RPC did not allow an in-window retry and atomically quarantine an expired key: " + JSON.stringify({
        insideResult: insideState.result,
        insideBlocker: "blocker" in insideState ? insideState.blocker : null,
        insideBlockers: "blockers" in insideState ? insideState.blockers : null,
        insideAgeSeconds: insideTimestamp.rows[0]?.age_seconds ?? null,
        insideStillInWindow: insideTimestamp.rows[0]?.still_in_window ?? false,
        expiredResult: expiredState.result,
        expiredCode: "code" in expiredState ? expiredState.code : null,
        expiredBlocker: "blocker" in expiredState ? expiredState.blocker : null,
        expiredBlockers: "blockers" in expiredState ? expiredState.blockers : null,
        expiredMessageState: expired.rows[0]?.state ?? null,
        expiredErrorCode: expired.rows[0]?.last_error_code ?? null,
        expiredScheduleCleared: expired.rows[0]?.scheduled_at === null,
        expiredLeaseOwnerCleared: expired.rows[0]?.lease_owner === null,
        expiredUnknownEvents: expired.rows[0]?.unknown_events ?? null,
      }));
    }

    const dispositionSnapshot = async (messageId: string) => {
      const result = await client.query<{ state: string; lease_owner: string | null; event_count: number }>(
        `select message.state,message.lease_owner,
                (select count(*)::integer from public.agency_followup_events event where event.message_id=message.id) as event_count
         from public.agency_followup_messages message where message.id=$1`, [messageId],
      );
      if (!result.rows[0]) throw new Error("The final-gate disposition fixture disappeared.");
      return result.rows[0];
    };
    const assertPureGateResult = async (
      claim: { id: string; owner: string; attemptCount: number; enrollmentId: string },
      expected: { result: "blocked" | "deferred"; blocker: string },
    ) => {
      const before = await dispositionSnapshot(claim.id);
      const checked = await authorizeProviderHandoff(client, {
        messageId: claim.id, enrollmentId: claim.enrollmentId, owner: claim.owner, attemptCount: claim.attemptCount,
      });
      const after = await dispositionSnapshot(claim.id);
      const hasBlocker = checked.result === "blocked"
        ? checked.blockers?.includes(expected.blocker) === true
        : checked.blocker === expected.blocker && typeof checked.retryAt === "string" && Number.isFinite(Date.parse(checked.retryAt));
      if (checked.result !== expected.result || !hasBlocker || checked.request !== undefined ||
        before.state !== "claimed" || before.lease_owner !== claim.owner || after.state !== before.state ||
        after.lease_owner !== before.lease_owner || after.event_count !== before.event_count) {
        throw new Error(`The ${expected.blocker} gate did not return a payload-free ${expected.result} result without persisting worker disposition.`);
      }
      return checked;
    };

    const conversationIdentity = await client.query<{
      conversation_id: string; organization_id: string; person_id: string | null; source_link_id: string;
    }>(
      [
        "select distinct conversation.id as conversation_id, conversation.organization_id, conversation.person_id, source_link.id as source_link_id",
        "from public.agency_followup_messages target",
        "join public.agency_followup_enrollments enrollment on enrollment.id=target.enrollment_id",
        "join public.prospect_source_links source_link on source_link.source_record_key=enrollment.prospect_id::text",
        "  and source_link.source_system=case when exists (select 1 from public.prospect_source_links exact_contact",
        "    where exact_contact.source_system='agency_crm_contact' and exact_contact.source_record_key=enrollment.prospect_id::text)",
        "    then 'agency_crm_contact' else 'agency_crm' end",
        "join public.prospect_conversation_sources association on association.source_link_id=source_link.id",
        "join public.prospect_conversations conversation on conversation.id=association.conversation_id",
        "where target.id=$1 and source_link.active and source_link.person_id is not null",
      ].join("\n"),
      [firstClaim.id],
    );
    if (conversationIdentity.rows.length !== 1) {
      throw new Error("The final-gate activity fixture does not resolve to exactly one mapped conversation.");
    }
    const conversation = conversationIdentity.rows[0]!;
    const stopActivityCases = [
      { name: "replied", kind: "human_reply", channel: "email", direction: "inbound", deliveryStatus: "unknown", responseKind: "human", replyDisposition: "neutral", meetingOutcome: null, expectedStatus: "replied" },
      { name: "declined", kind: "human_reply", channel: "email", direction: "inbound", deliveryStatus: "unknown", responseKind: "human", replyDisposition: "declined", meetingOutcome: null, expectedStatus: "declined" },
      { name: "meeting-scheduled", kind: "meeting", channel: "video", direction: "internal", deliveryStatus: "unknown", responseKind: "none", replyDisposition: "unknown", meetingOutcome: null, expectedStatus: "meeting_scheduled" },
      { name: "meeting-completed", kind: "meeting", channel: "video", direction: "internal", deliveryStatus: "unknown", responseKind: "none", replyDisposition: "unknown", meetingOutcome: "Completed synthetic meeting", expectedStatus: "completed" },
      { name: "bounce", kind: "bounce", channel: "email", direction: "inbound", deliveryStatus: "bounced", responseKind: "none", replyDisposition: "unknown", meetingOutcome: null, expectedStatus: "unreachable" },
    ] as const;
    for (const stopCase of stopActivityCases) {
      await client.query("savepoint stop_activity_case");
      const nextActivityTime = await client.query<{ occurred_at: Date }>(
        "select coalesce(last_activity_at + interval '1 second', clock_timestamp()) as occurred_at from public.prospect_conversations where id=$1",
        [conversation.conversation_id],
      );
      const occurredAt = nextActivityTime.rows[0]?.occurred_at;
      if (!(occurredAt instanceof Date)) throw new Error("The synthetic conversation has no activity timestamp.");
      await client.query(
        [
          "insert into public.prospect_activities (conversation_id,organization_id,person_id,source_link_id,kind,channel,direction,occurred_at,delivery_status,response_kind,reply_disposition,meeting_outcome,provenance_system,idempotency_key)",
          "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'walkthrough',$13)",
        ].join("\n"),
        [
          conversation.conversation_id, conversation.organization_id, conversation.person_id, conversation.source_link_id,
          stopCase.kind, stopCase.channel, stopCase.direction, occurredAt, stopCase.deliveryStatus, stopCase.responseKind,
          stopCase.replyDisposition, stopCase.meetingOutcome, "agency-followup-stop:" + RUN_ID + ":" + stopCase.name,
        ],
      );
      const mappedStatus = await client.query<{ status: string }>(
        "select status from public.prospect_conversations where id=$1",
        [conversation.conversation_id],
      );
      if (mappedStatus.rows[0]?.status !== stopCase.expectedStatus) {
        throw new Error("The synthetic " + stopCase.name + " activity mapped to an unexpected conversation state.");
      }
      const stopClaim = await insertFixture(input.firstUseMessageId, "stop-" + stopCase.name + "-" + RUN_ID, null);
      await assertPureGateResult(stopClaim, { result: "blocked", blocker: "conversation_stopped" });
      await client.query("rollback to savepoint stop_activity_case");
      await client.query("release savepoint stop_activity_case");
    }
    const futureReviewClaim = await insertFixture(input.firstUseMessageId, "future-review-" + RUN_ID, null);
    await client.query(
      "update public.agency_followup_messages set reviewed_at=clock_timestamp()+interval '1 minute' where id=$1",
      [futureReviewClaim.id],
    );
    await assertPureGateResult(futureReviewClaim, { result: "blocked", blocker: "approval_invalid_reviewer_or_time" });
    // A terminal UNKNOWN predecessor must stop the sequence. The gate is a pure
    // authorization check; the worker persists the blocked disposition separately.
    const unresolvedClaim = await insertFixture(input.firstUseMessageId, `unresolved-${RUN_ID}`, null);
    await client.query(
      `update public.agency_followup_messages predecessor
       set state='unknown',unknown_since=clock_timestamp(),lease_owner=null,lease_until=null,provider_accepted_at=null,
           last_error_code='walkthrough_unknown_predecessor',updated_at=clock_timestamp()
       where predecessor.id=(select prior.id from public.agency_followup_messages target
         join public.agency_followup_messages prior on prior.enrollment_id=target.enrollment_id and prior.step_number<target.step_number
         where target.id=$1 order by prior.step_number desc limit 1)`, [unresolvedClaim.id],
    );
    await assertPureGateResult(unresolvedClaim, { result: "blocked", blocker: "previous_step_unresolved" });

    // A claimed predecessor defers the target and returns its retry time without
    // moving the target or creating an event; the caller owns that disposition.
    const pendingClaim = await insertFixture(input.firstUseMessageId, `pending-${RUN_ID}`, null);
    await client.query(
      `update public.agency_followup_messages predecessor
       set state='claimed',unknown_since=null,provider_accepted_at=null,lease_owner='walkthrough-prior-${RUN_ID}',
           lease_until=clock_timestamp()+interval '4 minutes',last_error_code=null,updated_at=clock_timestamp()
       where predecessor.id=(select prior.id from public.agency_followup_messages target
         join public.agency_followup_messages prior on prior.enrollment_id=target.enrollment_id and prior.step_number<target.step_number
         where target.id=$1 order by prior.step_number desc limit 1)`, [pendingClaim.id],
    );
    const checkedPending = await assertPureGateResult(pendingClaim, { result: "deferred", blocker: "previous_step_pending" });
    if (Date.parse(checkedPending.retryAt!) <= Date.now()) throw new Error("A claimed predecessor returned a non-future retryAt.");

    const spacingClaim = await insertFixture(input.firstUseMessageId, `spacing-${RUN_ID}`, null);
    await client.query(
      `update public.agency_followup_messages predecessor
       set state='accepted',unknown_since=null,provider_accepted_at=clock_timestamp(),lease_owner=null,lease_until=null,
           last_error_code=null,updated_at=clock_timestamp()
       where predecessor.id=(select prior.id from public.agency_followup_messages target
         join public.agency_followup_messages prior on prior.enrollment_id=target.enrollment_id and prior.step_number<target.step_number
         where target.id=$1 order by prior.step_number desc limit 1)`, [spacingClaim.id],
    );
    const checkedSpacing = await assertPureGateResult(spacingClaim, { result: "deferred", blocker: "minimum_spacing_not_elapsed" });
    if (Date.parse(checkedSpacing.retryAt!) <= Date.now()) throw new Error("A recent accepted predecessor returned a non-future spacing retryAt.");

    const notDueClaim = await insertFixture(input.firstUseMessageId, `not-due-${RUN_ID}`, null);
    const scheduledRetryAt = await client.query<{ retry_at: Date }>(
      "update public.agency_followup_messages set scheduled_at=clock_timestamp()+interval '5 minutes' where id=$1 returning scheduled_at as retry_at",
      [notDueClaim.id],
    );
    const checkedNotDue = await assertPureGateResult(notDueClaim, { result: "deferred", blocker: "not_due" });
    if (Math.abs(Date.parse(checkedNotDue.retryAt!) - scheduledRetryAt.rows[0]!.retry_at.getTime()) > 1_000) {
      throw new Error("The standalone not-due result did not return the target's exact scheduled retryAt.");
    }

    const changedAssociationClaim = await insertFixture(input.firstUseMessageId, `association-change-${RUN_ID}`, null);
    const identityMapping = await client.query<{ source_link_id: string; organization_id: string; person_id: string }>(
      `select source_link.id as source_link_id,source_link.organization_id,source_link.person_id
       from public.agency_followup_enrollments enrollment
       join public.agency_followup_messages target on target.enrollment_id=enrollment.id
       join public.prospect_source_links source_link on source_link.source_record_key=enrollment.prospect_id::text
         and source_link.source_system=case when exists (
           select 1 from public.prospect_source_links exact_contact
           where exact_contact.source_system='agency_crm_contact' and exact_contact.source_record_key=enrollment.prospect_id::text
         ) then 'agency_crm_contact' else 'agency_crm' end and source_link.active
       where target.id=$1 and source_link.person_id is not null`, [changedAssociationClaim.id],
    );
    const mapping = identityMapping.rows[0];
    if (!mapping?.organization_id || !mapping.person_id) throw new Error("The disposable identity fixture has no mapped person for the association revalidation check.");
    const alternatePerson = await client.query<{ id: string }>(
      "insert into public.prospect_people(display_name,primary_email) values ($1,null) returning id",
      [`Synthetic association-change ${RUN_ID}`],
    );
    const alternatePersonId = alternatePerson.rows[0]?.id;
    if (!alternatePersonId) throw new Error("The disposable identity fixture could not create its alternate synthetic person.");
    await client.query(
      "insert into public.prospect_person_firm_roles(organization_id,person_id,is_primary,active) values ($1,$2,false,true)",
      [mapping.organization_id, alternatePersonId],
    );
    await client.query("update public.prospect_source_links set person_id=$2 where id=$1", [mapping.source_link_id, alternatePersonId]);
    await assertPureGateResult(changedAssociationClaim, { result: "blocked", blocker: "contactability_unknown" });

    await client.query("rollback");
    progress("runtime serialized authorization returned the exact approved request/hash, preserved immutable first-use time, allowed an in-window retry, quarantined an expired key, mapped synthetic reply/decline/meeting/completion/bounce activities to stopped conversation states, blocked each stopped state and future-dated review, unknown predecessors and changed identity mappings, deferred claimed/recently-accepted predecessors and not-due messages, exposed no send payload on non-ready results, and left disposition to the worker");
    return { firstUseReservedOnce: true, timestampImmutable: true, retryUnder23HoursAllowed: true, retryAt23HoursQuarantined: true, unknownPredecessorBlocked: true, changedIdentityBlocked: true, claimedPredecessorDeferred: true, minimumSpacingDeferred: true, standaloneNotDueDeferred: true, futureReviewBlocked: true, conversationActivityStatusMappingVerified: true, stopStatusesBlockHandoff: stopActivityCases.map((stopCase) => stopCase.expectedStatus), nonReadyHasNoRequest: true, gateDoesNotPersistDisposition: true, historicalTimestampsSeededAtInsert: true, networkHandoff: "none", transactionRolledBack: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verifyProviderIdempotencyLockWaitBoundary(
  pool: Pool,
  sourceMessageId: string,
): Promise<Record<string, unknown>> {
  const lockWaitQueryTimeoutMs = 45_000;
  const runBoundaryCase = async (scenario: "lease" | "idempotency_window"): Promise<Record<string, unknown>> => {
    const holder = await pool.connect();
    const waiter = await pool.connect();
    let holderTransaction = false;
    let waiterTransaction = false;
    let rpcPromise: Promise<unknown> | null = null;
    let rpcSettled = false;
    let rpcRejected = false;
    let rpcErrorCode: string | null = null;
    let rpcErrorName: string | null = null;
    try {
      const sourceIdentity = await holder.query<{ enrollment_id: string }>(
        "select enrollment_id from public.agency_followup_messages where id=$1",
        [sourceMessageId],
      );
      const enrollmentId = sourceIdentity.rows[0]?.enrollment_id;
      if (!enrollmentId) throw new Error("The provider boundary source enrollment was not found.");
      const messageId = randomUUID();
      const logicalKey = agencyFollowupLogicalMessageKey(enrollmentId, messageId);
      const owner = "boundary-" + scenario + "-" + RUN_ID;
      const firstUseExpression = scenario === "idempotency_window"
        ? "clock_timestamp()-interval '22 hours 59 minutes 30 seconds'"
        : "null";
      const leaseExpression = scenario === "lease"
        ? "clock_timestamp()+interval '30 seconds'"
        : "clock_timestamp()+interval '5 minutes'";

      await holder.query("begin");
      holderTransaction = true;
      await holder.query("set local role service_role");
      const inserted = await holder.query<{
        id: string;
        attempt_count: number;
        template_version_id: string;
      }>(
        "with source as (" +
          " select message.*, enrollment.journey_id" +
          " from public.agency_followup_messages message" +
          " join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id" +
          " where message.id=$1" +
          "), step as (" +
          " insert into public.agency_followup_steps (journey_id,step_number,template_version_id,delay_business_days)" +
          " select source.journey_id," +
          "        (select coalesce(max(existing.step_number),0)+1 from public.agency_followup_steps existing where existing.journey_id=source.journey_id)," +
          "        source.template_version_id,0" +
          " from source" +
          " returning id,journey_id,step_number" +
          ")" +
          " insert into public.agency_followup_messages (" +
          " id,enrollment_id,step_id,step_number,template_version_id,state,content_snapshot,content_sha256," +
          " recipient_name_snapshot,recipient_email_snapshot,recipient_sha256," +
          " approved_content_sha256,approved_recipient_sha256,reviewed_by_operator_id,reviewed_at," +
          " scheduled_at,logical_message_key,provider_idempotency_key,attempt_count,lease_owner,lease_until," +
          " provider_idempotency_first_used_at" +
          " )" +
          " select $2::uuid,source.enrollment_id,step.id,step.step_number,source.template_version_id,'claimed',source.content_snapshot," +
          "        source.content_sha256,source.recipient_name_snapshot,source.recipient_email_snapshot,source.recipient_sha256," +
          "        source.content_sha256,source.recipient_sha256,source.reviewed_by_operator_id,coalesce(source.reviewed_at,clock_timestamp())," +
          "        clock_timestamp(),$3,$3,1,$4," + leaseExpression + "," + firstUseExpression +
          " from source join step on step.journey_id=source.journey_id" +
          " returning id,attempt_count,template_version_id",
        [sourceMessageId, messageId, logicalKey, owner],
      );
      const fixture = inserted.rows[0];
      if (!fixture) throw new Error("The " + scenario + " boundary message fixture could not be inserted.");
      // The primary synthetic journey already has a safe all-days policy;
      // preserve its immutability while preparing rollback-only message state.
      await holder.query(
        "update public.agency_followup_messages predecessor" +
          " set state='accepted',scheduled_at=coalesce(predecessor.scheduled_at,clock_timestamp()-interval '2 days')," +
          " approved_content_sha256=predecessor.content_sha256,approved_recipient_sha256=predecessor.recipient_sha256," +
          " reviewed_by_operator_id=coalesce(predecessor.reviewed_by_operator_id,target.reviewed_by_operator_id)," +
          " reviewed_at=coalesce(predecessor.reviewed_at,target.reviewed_at,clock_timestamp()-interval '2 days')," +
          " provider_message_id=coalesce(predecessor.provider_message_id,'walkthrough-predecessor-'||predecessor.id::text)," +
          " provider_accepted_at=clock_timestamp()-interval '2 days'," +
          " lease_owner=null,lease_until=null,unknown_since=null,last_error_code=null,updated_at=clock_timestamp()" +
          " from public.agency_followup_messages target" +
          " where target.id=$1 and predecessor.enrollment_id=target.enrollment_id and predecessor.step_number<target.step_number",
        [fixture.id],
      );
      await holder.query("commit");
      holderTransaction = false;

      const holderPid = Number((await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);
      const waiterPid = Number((await waiter.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid);
      if (!Number.isInteger(holderPid) || !Number.isInteger(waiterPid)) {
        throw new Error("The lock-wait regression could not identify both disposable Postgres backends.");
      }
      await holder.query("begin");
      holderTransaction = true;
      await holder.query("set local role service_role");
      await holder.query(
        "select id from public.agency_followup_template_versions where id=$1 for no key update",
        [fixture.template_version_id],
      );

      const boundaryRow = (await pool.query<{
        state: string;
        lease_owner: string | null;
        attempt_count: number;
        lease_until: Date;
        lease_until_exact: string;
        first_used_at: Date | null;
        first_used_at_exact: string | null;
        key_cutoff: Date | null;
        database_now: Date;
      }>(
        "select message.state,message.lease_owner,message.attempt_count,message.lease_until," +
          "to_char(message.lease_until,'YYYY-MM-DD HH24:MI:SS.US') as lease_until_exact," +
          "message.provider_idempotency_first_used_at as first_used_at," +
          "to_char(message.provider_idempotency_first_used_at,'YYYY-MM-DD HH24:MI:SS.US') as first_used_at_exact," +
          "message.provider_idempotency_first_used_at+interval '23 hours' as key_cutoff,clock_timestamp() as database_now" +
          " from public.agency_followup_messages message where message.id=$1",
        [fixture.id],
      )).rows[0];
      if (!boundaryRow) throw new Error("The " + scenario + " boundary fixture disappeared before the RPC wait.");
      const targetBoundary = scenario === "lease" ? boundaryRow.lease_until : boundaryRow.key_cutoff;
      if (!targetBoundary) throw new Error("The " + scenario + " boundary did not have its expected database timestamp.");
      const marginSeconds = (targetBoundary.getTime() - boundaryRow.database_now.getTime()) / 1000;
      if (marginSeconds <= 15 || marginSeconds > 32) {
        throw new Error("The " + scenario + " fixture did not leave a bounded pre-boundary margin (" + marginSeconds.toFixed(3) + " seconds).");
      }

      await waiter.query("begin");
      waiterTransaction = true;
      await waiter.query("set local role service_role");
      await waiter.query("select set_config('statement_timeout',$1,true)", [String(lockWaitQueryTimeoutMs) + "ms"]);
      const pendingRpcPromise = waiter.query<{ authorization: unknown }>({
        text: "select public.authorize_agency_followup_provider_handoff($1::uuid,$2::uuid,$3,$4,300,82800) as authorization",
        values: [fixture.id, enrollmentId, owner, fixture.attempt_count],
      }).then((result) => result.rows[0]?.authorization);
      rpcPromise = pendingRpcPromise;
      void pendingRpcPromise.then(
        () => { rpcSettled = true; },
        (error: unknown) => {
          rpcRejected = true;
          if (error && typeof error === "object") {
            const queryError = error as { code?: unknown };
            rpcErrorCode = typeof queryError.code === "string" && /^[A-Z0-9]{5}$/.test(queryError.code)
              ? queryError.code
              : null;
            rpcErrorName = error instanceof Error ? error.name : null;
          }
          rpcSettled = true;
        },
      );

      const observationDeadline = Date.now() + 5_000;
      let observedWait: { database_now: Date; state: string | null; wait_event_type: string | null } | undefined;
      while (Date.now() < observationDeadline) {
        const activity = await pool.query<{
          database_now: Date;
          state: string | null;
          wait_event_type: string | null;
          blocked_by_holder: boolean;
        }>(
          "select clock_timestamp() as database_now,activity.state,activity.wait_event_type," +
            "array_position(pg_blocking_pids(activity.pid),$2::integer) is not null as blocked_by_holder" +
            " from pg_stat_activity activity where activity.pid=$1::integer",
          [waiterPid, holderPid],
        );
        const row = activity.rows[0];
        if (row?.state === "active" && row.wait_event_type === "Lock" && row.blocked_by_holder === true) {
          observedWait = row;
          break;
        }
        if (rpcSettled) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!observedWait) {
        const settledAuthorization = rpcSettled && rpcPromise
          ? await rpcPromise.catch(() => undefined)
          : undefined;
        throw new Error("The " + scenario + " authorization did not appear active on a lock wait blocked by the held template row: " +
          JSON.stringify({
            authorizationResult: rpcSettled ? safeProviderAuthorizationDiagnostic(settledAuthorization).authorizationResult : "pending",
            authorizationBlocker: rpcSettled ? safeProviderAuthorizationDiagnostic(settledAuthorization).authorizationBlocker : "none",
            observedWaitEventType: "not_observed",
            blockerMatched: false,
            rpcRejected,
            rpcErrorCode,
            rpcErrorName,
            authorizationFields: safeProviderAuthorizationFields(settledAuthorization),
          }));
      }
      if (targetBoundary.getTime() <= observedWait.database_now.getTime() + 5_000) {
        const settledAuthorization = rpcSettled && rpcPromise
          ? await rpcPromise.catch(() => undefined)
          : undefined;
        throw new Error("The " + scenario + " authorization was not proven blocked with time remaining before its boundary: " +
          JSON.stringify({
            authorizationResult: rpcSettled ? safeProviderAuthorizationDiagnostic(settledAuthorization).authorizationResult : "pending",
            authorizationBlocker: rpcSettled ? safeProviderAuthorizationDiagnostic(settledAuthorization).authorizationBlocker : "none",
            observedWaitEventType: observedWait.wait_event_type,
            blockerMatched: true,
          }));
      }

      const crossBoundaryAt = new Date(targetBoundary.getTime() + 1_000);
      const crossingDeadline = Date.now() + crossBoundaryAt.getTime() - observedWait.database_now.getTime() + 5_000;
      let crossedWhileBlocked = false;
      while (Date.now() < crossingDeadline) {
        const clock = await pool.query<{ crossed: boolean }>(
          "select clock_timestamp() >= $1::timestamptz as crossed",
          [crossBoundaryAt.toISOString()],
        );
        if (clock.rows[0]?.crossed === true) {
          crossedWhileBlocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!crossedWhileBlocked) {
        throw new Error("The " + scenario + " boundary was not crossed on the database clock while the RPC remained blocked.");
      }
      if (rpcSettled) {
        const settledAuthorization = rpcPromise ? await rpcPromise.catch(() => undefined) : undefined;
        const diagnostic = safeProviderAuthorizationDiagnostic(settledAuthorization);
        throw new Error("The " + scenario + " RPC stopped waiting before the database boundary: " + JSON.stringify({
          authorizationResult: diagnostic.authorizationResult,
          authorizationBlocker: diagnostic.authorizationBlocker,
          blockerMatched: true,
          rpcRejected,
          rpcErrorCode,
          rpcErrorName,
          authorizationFields: safeProviderAuthorizationFields(settledAuthorization),
        }));
      }

      await holder.query("commit");
      holderTransaction = false;
      const authorization = await Promise.race([
        rpcPromise,
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error("The " + scenario + " authorization did not resume within five seconds after releasing the template lock.")),
          5_000,
        )),
      ]);
      const authorizationDiagnostic = safeProviderAuthorizationDiagnostic(authorization);
      const authorizationObject = authorization && typeof authorization === "object" && !Array.isArray(authorization)
        ? authorization as Record<string, unknown>
        : {};
      const sendRequestPresent = authorizationObject.request !== undefined;
      const expectedResult = scenario === "lease" ? "stale" : "expired";
      if (authorizationDiagnostic.authorizationResult !== expectedResult || sendRequestPresent) {
        throw new Error("The " + scenario + " authorization returned an unexpected result after crossing its boundary: " +
          JSON.stringify({
            authorizationResult: authorizationDiagnostic.authorizationResult,
            authorizationBlocker: authorizationDiagnostic.authorizationBlocker,
            sendRequestPresent,
            expectedResult,
          }));
      }

      await waiter.query("commit");
      waiterTransaction = false;
      const persisted = await pool.query<{
        state: string;
        lease_owner: string | null;
        attempt_count: number;
        lease_until_exact: string | null;
        first_used_at_exact: string | null;
        last_error_code: string | null;
        scheduled_at: Date | null;
        unknown_since: Date | null;
        window_events: string;
        provider_unknown_events: string;
      }>(
        "select message.state,message.lease_owner,message.attempt_count," +
          "to_char(message.lease_until,'YYYY-MM-DD HH24:MI:SS.US') as lease_until_exact," +
          "to_char(message.provider_idempotency_first_used_at,'YYYY-MM-DD HH24:MI:SS.US') as first_used_at_exact," +
          "message.last_error_code,message.scheduled_at,message.unknown_since," +
          "(select count(*)::text from public.agency_followup_events event where event.message_id=message.id" +
          " and event.idempotency_key='resend-window-expired:'||message.id::text) as window_events," +
          "(select count(*)::text from public.agency_followup_events event where event.message_id=message.id" +
          " and event.idempotency_key='resend-window-expired:'||message.id::text and event.event_type='provider_unknown') as provider_unknown_events" +
          " from public.agency_followup_messages message where message.id=$1",
        [fixture.id],
      );
      const saved = persisted.rows[0];
      if (!saved) throw new Error("The " + scenario + " fixture could not be read after the authorization RPC.");
      if (scenario === "lease") {
        if (saved.state !== boundaryRow.state || saved.lease_owner !== boundaryRow.lease_owner ||
            saved.attempt_count !== boundaryRow.attempt_count || saved.lease_until_exact !== boundaryRow.lease_until_exact ||
            saved.first_used_at_exact !== null) {
          throw new Error("The stale lease result mutated the claimed message or reserved a first-use timestamp: " +
            JSON.stringify({
              authorizationResult: authorizationDiagnostic.authorizationResult,
              authorizationBlocker: authorizationDiagnostic.authorizationBlocker,
              stateUnchanged: saved.state === boundaryRow.state,
              ownerUnchanged: saved.lease_owner === boundaryRow.lease_owner,
              attemptsUnchanged: saved.attempt_count === boundaryRow.attempt_count,
              leaseUnchanged: saved.lease_until_exact === boundaryRow.lease_until_exact,
              firstUseStillNull: saved.first_used_at_exact === null,
            }));
        }
        progress("the lease-boundary RPC waited on its template row lock, crossed lease expiry on the database clock, returned stale, and left first-use and claim state unchanged");
        return {
          templateLockWaitObserved: true,
          leaseExpiryCrossedWhileBlocked: true,
          returnedStaleWithoutRequest: true,
          firstUseRemainedNull: true,
          claimStateUnchanged: true,
          providerHandoff: "none",
        };
      }

      if (saved.state !== "unknown" || saved.last_error_code !== "resend_idempotency_window_expired" ||
          saved.scheduled_at !== null || saved.lease_owner !== null || saved.lease_until_exact !== null ||
          saved.unknown_since === null || saved.window_events !== "1" || saved.provider_unknown_events !== "1" ||
          saved.first_used_at_exact !== boundaryRow.first_used_at_exact) {
        throw new Error("The expired-key result did not atomically persist UNKNOWN, one provider_unknown event, and its original first-use time: " +
          JSON.stringify({
            authorizationResult: authorizationDiagnostic.authorizationResult,
            authorizationBlocker: authorizationDiagnostic.authorizationBlocker,
            unknownPersisted: saved.state === "unknown",
            errorCodePersisted: saved.last_error_code === "resend_idempotency_window_expired",
            scheduleCleared: saved.scheduled_at === null,
            leaseCleared: saved.lease_owner === null && saved.lease_until_exact === null,
            unknownTimestampPersisted: saved.unknown_since !== null,
            oneWindowEvent: saved.window_events === "1",
            oneProviderUnknownEvent: saved.provider_unknown_events === "1",
            firstUseTimestampPreserved: saved.first_used_at_exact === boundaryRow.first_used_at_exact,
          }));
      }
      progress("the 23-hour RPC waited on its template row lock, crossed the key-age cutoff on the database clock, returned expired, and atomically persisted UNKNOWN with one provider_unknown event");
      return {
        templateLockWaitObserved: true,
        keyAgeCutoffCrossedWhileBlocked: true,
        returnedExpiredWithoutRequest: true,
        unknownPersisted: true,
        oneProviderUnknownEvent: true,
        firstUseTimestampPreserved: true,
        providerHandoff: "none",
      };
    } finally {
      if (holderTransaction) await holder.query("rollback").catch(() => undefined);
      if (waiterTransaction) await waiter.query("rollback").catch(() => undefined);
      if (rpcPromise && !rpcSettled) {
        await Promise.race([
          rpcPromise.then(() => undefined, () => undefined),
          new Promise((resolve) => setTimeout(resolve, 3_000)),
        ]);
      }
      holder.release();
      waiter.release();
    }
  };

  const leaseBoundary = await runBoundaryCase("lease");
  const keyAgeBoundary = await runBoundaryCase("idempotency_window");
  return {
    leaseBoundary,
    keyAgeBoundary,
    boundedDbClockWait: true,
    templateLockMode: "FOR NO KEY UPDATE",
    observer: "pg_stat_activity + pg_blocking_pids",
    providerHandoff: "none",
  };
}
async function verifyQuarantinedSourceEventReplay(
  pool: Pool,
  prospect: ProspectFixture,
  providerMessageId: string,
  occurredAt: string,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  const eventId = `evt_source_quarantine_${RUN_ID}`;
  const recipientHash = createHash("sha256").update(prospect.email.trim().toLowerCase(), "utf8").digest("hex");
  try {
    const sourceLinks = await client.query<{ id: string; organization_id: string; person_id: string | null; conversation_id: string }>(
      "select source_link.id,source_link.organization_id,source_link.person_id,association.conversation_id from public.prospect_source_links source_link join public.prospect_conversation_sources association on association.source_link_id=source_link.id where source_link.source_system='agency_crm' and source_link.source_record_key=$1",
      [prospect.id],
    );
    if (sourceLinks.rows.length !== 1) throw new Error("The synthetic prospect did not have exactly one Agency source link for the quarantine replay check.");
    const references = await client.query<{ events: string; applications: string }>(
      "select (select count(*)::text from public.agency_followup_provider_events where source_link_id=$1) as events, (select count(*)::text from public.agency_followup_provider_event_applications where source_link_id=$1) as applications",
      [sourceLinks.rows[0].id],
    );
    if (references.rows[0]?.events !== "0" || references.rows[0]?.applications !== "0") {
      throw new Error("The synthetic Agency source is already referenced by provider-event evidence and cannot be used for an isolated quarantine replay check.");
    }
    const message = await client.query<{ id: string; provider_delivery_status: string }>(
      "select message.id,message.provider_delivery_status from public.agency_followup_messages message join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id where enrollment.prospect_id=$1 and message.provider_message_id=$2 and message.provider_recipient_email_sha256=$3 and message.state='accepted' and message.provider_accepted_at is not null",
      [prospect.id, providerMessageId, recipientHash],
    );
    if (message.rows.length !== 1) throw new Error("The source-quarantine replay requires one accepted synthetic message with no existing provider-event application.");
    const globalProviderMatches = await client.query<{ count: string }>(
      "select count(*)::text as count from public.agency_followup_messages where provider_message_id=$1 and provider_recipient_email_sha256=$2 and state='accepted' and provider_accepted_at is not null",
      [providerMessageId, recipientHash],
    );
    if (globalProviderMatches.rows[0]?.count !== "1") {
      throw new Error("The source-quarantine replay requires a globally unique accepted provider identity; matching synthetic rows="
        + (globalProviderMatches.rows[0]?.count ?? "unknown"));
    }
    await client.query("begin");
    const contactSource = await client.query<{ id: string; organization_id: string; person_id: string | null; associations: string }>(
      "select source_link.id,source_link.organization_id,source_link.person_id,(select count(*)::text from public.prospect_conversation_sources association where association.source_link_id=source_link.id) as associations from public.prospect_source_links source_link where source_link.source_system='agency_crm_contact' and source_link.source_record_key=$1",
      [prospect.id],
    );
    if (contactSource.rows.length > 1) throw new Error("The synthetic prospect has ambiguous contact-source links for the quarantine replay check.");
    if (contactSource.rows.length === 1 && (contactSource.rows[0].associations !== "0" ||
      contactSource.rows[0].organization_id !== sourceLinks.rows[0].organization_id ||
      contactSource.rows[0].person_id !== sourceLinks.rows[0].person_id)) {
      throw new Error("The synthetic contact-source link is already mapped or does not match the Agency source identity needed for quarantine replay.");
    }
    const orphanSource = contactSource.rows[0]?.id
      ? contactSource.rows[0]
      : (await client.query<{ id: string; organization_id: string; person_id: string | null; associations: string }>(
        "insert into public.prospect_source_links (source_system,source_record_key,organization_id,person_id,source_payload,history_coverage) select 'agency_crm_contact',source_record_key,organization_id,person_id,jsonb_build_object('syntheticPurpose','provider_event_source_quarantine'), 'history_unknown' from public.prospect_source_links where id=$1 returning id,organization_id,person_id,'0'::text as associations",
        [sourceLinks.rows[0].id],
      )).rows[0];
    if (!orphanSource || orphanSource.associations !== "0") throw new Error("The synthetic orphan contact-source link was not prepared without detaching protected Agency history.");
    const orphanReferences = await client.query<{ events: string; applications: string }>(
      "select (select count(*)::text from public.agency_followup_provider_events where source_link_id=$1) as events, (select count(*)::text from public.agency_followup_provider_event_applications where source_link_id=$1) as applications",
      [orphanSource.id],
    );
    if (orphanReferences.rows[0]?.events !== "0" || orphanReferences.rows[0]?.applications !== "0") {
      throw new Error("The orphan contact-source fixture already has provider-event evidence.");
    }
    const parameters = [eventId, providerMessageId, "email.bounced", null, occurredAt, prospect.email, recipientHash, null, null];
    const persist = () => client.query<{ result: { result?: string } }>(
      "select public.persist_agency_followup_resend_event($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::uuid,$9::uuid) as result",
      parameters,
    );
    const firstReceipt = await persist();
    if (firstReceipt.rows[0]?.result?.result !== "unmatched_source") {
      throw new Error("The synthetic provider event did not record its initial unmatched-source quarantine.");
    }
    await client.query(
      "insert into public.prospect_conversation_sources (conversation_id,source_link_id,is_primary) values ($1,$2,false)",
      [sourceLinks.rows[0].conversation_id, orphanSource.id],
    );
    const replay = await persist();
    const state = await client.query<{ processing_result: string; source_link_id: string | null; applications: string; delivery_status: string }>(
      "select event.processing_result,event.source_link_id,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=event.provider_event_id) as applications,message.provider_delivery_status as delivery_status from public.agency_followup_provider_events event join public.agency_followup_messages message on message.id=event.message_id where event.provider_event_id=$1",
      [eventId],
    );
    if (replay.rows[0]?.result?.result !== "duplicate" || state.rows[0]?.processing_result !== "unmatched_source" ||
      state.rows[0]?.source_link_id !== null || state.rows[0]?.applications !== "0" ||
      state.rows[0]?.delivery_status !== message.rows[0]?.provider_delivery_status) {
      throw new Error("An identical retry applied a source-quarantined event after the synthetic source mapping became unique.");
    }
    await client.query("rollback");
    progress("source-quarantined signed-event replay remained immutable after an orphan contact-source mapping was added; protected Agency and opt-in history stayed attached");
    return { initialResult: "unmatched_source", replayResult: "duplicate", applications: 0, deliveryStatusUnchanged: true, transactionRolledBack: true, existingSourceHistoryDetached: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
    ["consent", "Synthetic Walkthrough Consent " + suffix, "Taylor Example", "eligible"],
    ["tagged_unknown", "Synthetic Walkthrough Tagged UNKNOWN " + suffix, "Sam Example", "eligible"],
    ["contact_unsubscribe", "Synthetic Walkthrough Contact Unsubscribe " + suffix, "Lee Example", "eligible"],
  ];
  await pool.query("begin");
  try {
    progress("seeding synthetic operator and ten Agency prospects");
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
      if (["normal", "pause", "unknown", "window", "lease", "retry", "tagged_unknown"].includes(key)) {
        const syntheticConsent = "Synthetic opt-in fixture for local acceptance only; this is not real prospect consent.";
        const databaseClock = await pool.query<{ captured_at: Date }>("select clock_timestamp() - interval '1 minute' as captured_at");
        const capturedAt = databaseClock.rows[0]?.captured_at.toISOString();
        if (!capturedAt) throw new Error("Could not derive a past synthetic consent timestamp from disposable PostgreSQL.");
        const syntheticConsentHash = createHash("sha256").update(syntheticConsent).digest("hex");
        await pool.query(
          `select * from public.record_agency_followup_opt_in_event(
            $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::timestamptz,
            $7::text, $8::text, $9::text, $10::text, $11::text, $12::uuid, $13::text
          )`,
          [
            prospectId,
            sourceId,
            conversationId,
            createHash("sha256").update(email.trim().toLowerCase()).digest("hex"),
            "opt_in_granted",
            capturedAt,
            "other_verified_evidence",
            "synthetic-walkthrough-consent-v1",
            syntheticConsentHash,
            `synthetic://agency-followup-walkthrough/${RUN_ID}/${key}-opt-in`,
            syntheticConsentHash,
            lawyerId,
            `walkthrough:${RUN_ID}:synthetic-opt-in:${key}:${prospectId}`,
          ],
        );
        progress(`seeded synthetic-only opt-in grant for ${key}; it is not real consent evidence`);
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
    return NextResponse.json({ error: "Fake dispatch failed." }, { status: 409 });
  }
}
`;
  try {
    const existingRoute = await readFile(path.join(TEST_DISPATCH_DIR, "route.ts"), "utf8");
    if (existingRoute.replace(/\r\n/g, "\n") !== route) {
      throw new Error("A walkthrough dispatch route already exists and does not match the guarded local fake route.");
    }
    temporaryRouteSha256 = createHash("sha256").update(existingRoute).digest("hex");
    progress("verified the tracked loopback-only fake-dispatch route");
    return;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(TEST_DISPATCH_DIR, { recursive: false });
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
  const redact = (text: string) => redactSensitiveText(text);
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
      AGENCY_FOLLOWUP_WALKTHROUGH_CAPTURE: "1",
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
  server.once("error", (error) => progress("local Next process error: " + safeFailureText(error.message, 300)));
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
        const windows = process.platform === "win32";
        progress(`loopback TCP connected; resolving listener PID with bounded ${windows ? "netstat" : "ss"} inspection`);
        const listenerTable = execFileSync(windows ? "netstat" : "ss", windows ? ["-ano", "-p", "tcp"] : ["-ltnp"], {
          encoding: "utf8",
          timeout: 30000,
          windowsHide: true,
        });
        for (const line of listenerTable.split(/\r?\n/)) {
          if (!line.includes(":55435")) continue;
          if (windows) {
            const fields = line.trim().split(/\s+/);
            if (fields.length < 5 || fields[0].toUpperCase() !== "TCP" || fields[3].toUpperCase() !== "LISTENING") continue;
            const pid = Number(fields[4]);
            if (Number.isInteger(pid) && pid > 0) listenerPid = pid;
          } else {
            const fields = line.trim().split(/\s+/);
            if (fields.length < 4 || fields[0].toUpperCase() !== "LISTEN") continue;
            const pidMatch = /\bpid=(\d+)\b/.exec(line);
            const pid = Number(pidMatch?.[1]);
            if (Number.isInteger(pid) && pid > 0) listenerPid = pid;
          }
          if (listenerPid !== undefined) break;
        }
      } catch (error) {
        throw new Error(safeFailureText(`Could not verify owner of reachable 127.0.0.1:55435 listener: ${error instanceof Error ? error.message : String(error)}.`, 1000));
      }
      if (listenerPid === undefined) {
        throw new Error(`TCP connect succeeded on 127.0.0.1:55435 but ${process.platform === "win32" ? "netstat" : "ss"} reported no listener owner.`);
      }
      const owner = inspectProcessChain(listenerPid, server.pid!);
      if (!owner.isNextDescendant) {
        throw new Error(`Port 55435 is owned by unrelated PID ${listenerPid}, not launched Next process PID ${server.pid}; child exitCode=${server.exitCode} signalCode=${server.signalCode}. Owner chain: ${owner.summary}`);
      }
      progress(`Verified 127.0.0.1:55435 listener owner PID=${listenerPid} is descended from launched Next process PID=${server.pid}; child exitCode=${server.exitCode}; signalCode=${server.signalCode}; process chain: ${owner.summary}`);
      return;
    }
    await delay(Math.min(500, remainingMs(deadline)));
  }
  throw new Error("Next did not bind 127.0.0.1:55435 within 10 minutes.");
}

function inspectProcessChain(listenerPid: number, nextPid: number): { isNextDescendant: boolean; summary: string } {
  if (process.platform !== "win32") {
    const chain: string[] = [];
    let current = listenerPid;
    try {
      for (let depth = 0; depth < 10 && current > 0; depth++) {
        const raw = execFileSync("ps", ["-o", "pid=,ppid=,comm=", "-p", String(current)], {
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
        }).trim();
        const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(raw);
        if (!match) break;
        const pid = Number(match[1]);
        const parentPid = Number(match[2]);
        chain.push(`${match[3]} pid=${pid} parent=${parentPid}`);
        if (pid === nextPid) return { isNextDescendant: true, summary: chain.join(" <- ") };
        if (parentPid === pid) break;
        current = parentPid;
      }
    } catch (error) {
      throw new Error(safeFailureText(`Could not identify port owner process ancestry: ${error instanceof Error ? error.message : String(error)}.`, 1000));
    }
    return { isNextDescendant: false, summary: chain.join(" <- ") || `owner PID ${listenerPid} not found in process table` };
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
    throw new Error(safeFailureText(`Could not identify port owner process ancestry: ${error instanceof Error ? error.message : String(error)}.`, 1000));
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
  const browserRuntimeErrors = (browserRuntimeErrorsByPage.get(page)?.slice(-20) ?? [])
    .map((entry) => safeFailureText(entry, 1000));
  await mkdir(path.join(OUTPUT_DIR, "screenshots"), { recursive: true });
  const screenshotPath = path.join(OUTPUT_DIR, "screenshots", `failure-${action}-${RUN_ID}.png`);
  const screenshotWritten = await page.screenshot({ path: screenshotPath, fullPage: false }).then(() => true, () => false);
  const errorMessage = safeFailureText(error, 500);
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
  let response: PlaywrightResponse;
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

async function authorJourney(page: Page, afterTemplateApproval?: (templateKey: string) => Promise<void>): Promise<{ journeyName: string; weekdayJourneyName: string; taggedUnknownJourneyName: string }> {
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
  await afterTemplateApproval?.(templateKey);
  const approvedTemplateOption = page.getByLabel("Template version").locator("option").filter({ hasText: templateKey + " v1" });
  await expect(approvedTemplateOption).toHaveCount(1, { timeout: Math.min(90_000, remainingMs()) });

  await page.getByLabel("Journey key").fill(journeyKey);
  await page.getByLabel("Journey name").fill(journeyName);
  await page.getByLabel("IANA timezone").fill(chooseWindowSafeTimezone(new Date()));
  await page.getByLabel("Local window start").fill("00:00");
  await page.getByLabel("Local window end").fill("23:59");
  await page.getByLabel("Minimum spacing between scheduled messages, hours").fill("1");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    await page.getByLabel(day, { exact: true }).check();
  }
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
    throw new Error(`Activated journey did not appear in the review selector. Current options=${JSON.stringify(options)}; alerts=${JSON.stringify(alert)}. ${safeFailureText(error, 1000)}`);
  }

  const otherJourneyKey = journeyKey + "-other";
  const otherJourneyName = journeyName + " other";
  await page.getByLabel("Journey key").fill(otherJourneyKey);
  await page.getByLabel("Journey name").fill(otherJourneyName);
  await page.getByLabel("IANA timezone").fill("America/Toronto");
  await page.getByLabel("Local window start").fill("09:00");
  await page.getByLabel("Local window end").fill("17:00");
  await page.getByLabel("Minimum spacing between scheduled messages, hours").fill("1");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
    await page.getByLabel(day, { exact: true }).check();
  }
  for (const day of ["Sat", "Sun"]) {
    await page.getByLabel(day, { exact: true }).uncheck();
  }
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const otherJourneyDraft = page.getByText(otherJourneyName + " v1 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", otherJourneyDraft.getByRole("button", { name: "Activate version" }));
  const otherJourneyOption = journeyOptions.filter({ hasText: otherJourneyName + " v1" });
  await expect(otherJourneyOption).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });

  const mixedCaseJourneyKey = "  " + journeyKey.toUpperCase() + "  ";
  if (mixedCaseJourneyKey.trim().toLowerCase() !== journeyKey) {
    throw new Error("Mixed-case regression fixture must normalize to the original journey key.");
  }
  await page.getByLabel("Journey key").fill(mixedCaseJourneyKey);
  await page.getByLabel("Journey name").fill(journeyName);
  await page.getByLabel("IANA timezone").fill(chooseWindowSafeTimezone(new Date()));
  await page.getByLabel("Local window start").fill("00:00");
  await page.getByLabel("Local window end").fill("23:59");
  await page.getByLabel("Minimum spacing between scheduled messages, hours").fill("1");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    await page.getByLabel(day, { exact: true }).check();
  }
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const journeyV2Draft = page.getByText(journeyName + " v2 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", journeyV2Draft.getByRole("button", { name: "Activate version" }));
  await expect(page.getByText(journeyName + " v1 · retired", { exact: false })).toBeVisible({ timeout: Math.min(30_000, remainingMs()) });
  await expect(page.getByText(journeyName + " v2 · active", { exact: false })).toBeVisible({ timeout: Math.min(30_000, remainingMs()) });
  await expect(versionOneOption).toHaveCount(0, { timeout: Math.min(30_000, remainingMs()) });
  const versionTwoOption = journeyOptions.filter({ hasText: journeyName + " v2" });
  await expect(versionTwoOption).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });
  await expect(otherJourneyOption).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });
  journeyVersionRegressionResult = {
    sameKeyV1Retired: true,
    sameKeyV1AbsentFromSelector: true,
    sameKeyV2ActiveAndAvailable: true,
    otherKeyV1RemainsAvailable: true,
  };
  await page.getByLabel("Journey version").selectOption({ label: journeyName + " v2" });

  const taggedUnknownJourneyKey = "walkthrough-unknown-" + suffix;
  const taggedUnknownJourneyName = "Synthetic tagged UNKNOWN " + suffix;
  await page.getByLabel("Journey key").fill(taggedUnknownJourneyKey);
  await page.getByLabel("Journey name").fill(taggedUnknownJourneyName);
  await page.getByLabel("IANA timezone").fill(chooseWindowSafeTimezone(new Date()));
  await page.getByLabel("Local window start").fill("00:00");
  await page.getByLabel("Local window end").fill("23:59");
  for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    await page.getByLabel(day, { exact: true }).check();
  }
  await waitForAction(page, "journey_create", page.getByRole("button", { name: "Save draft journey version" }));
  const taggedUnknownDraft = page.getByText(taggedUnknownJourneyName + " v1 · draft", { exact: false }).locator("..");
  await waitForAction(page, "journey_activate", taggedUnknownDraft.getByRole("button", { name: "Activate version" }));
  const taggedUnknownOption = journeyOptions.filter({ hasText: taggedUnknownJourneyName + " v1" });
  await expect(taggedUnknownOption).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });
  return {
    journeyName: journeyName + " v2",
    weekdayJourneyName: otherJourneyName + " v1",
    taggedUnknownJourneyName: taggedUnknownJourneyName + " v1",
  };
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
  setDiagnosticStage("fake_dispatch");
  const response = await context.request.post(APP_ORIGIN + TEST_DISPATCH_PATH, {
    data: { ...input, token },
    timeout: Math.min(90_000, remainingMs()),
  });
  if (!response.ok()) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const detail = typeof payload.error === "string"
      ? safeFailureText(payload.error, 200).replace(/[^A-Za-z0-9_.:-]+/g, "_")
      : "no_safe_error_detail";
    progress(`fake dispatcher HTTP ${response.status()}; safeError=${detail}`);
    throw new Error("Local fake dispatcher endpoint returned HTTP " + response.status() + ": " + detail);
  }
  return await response.json() as Record<string, number>;
}

async function diagnoseBouncedResendFailureInRollback(
  pool: Pool,
  providerEventId: string,
  providerMessageId: string,
  occurredAt: string,
  recipientEmail: string,
): Promise<string> {
  const client = await pool.connect();
  let transactionStarted = false;
  let discardClient = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET LOCAL ROLE service_role");
    const recipientHash = createHash("sha256")
      .update(recipientEmail.trim().toLowerCase(), "utf8")
      .digest("hex");
    const result = await client.query<{ result: { result?: unknown } }>(
      "select public.persist_agency_followup_resend_event($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::uuid,$9::uuid) as result",
      [providerEventId, providerMessageId, "email.bounced", null, occurredAt, recipientEmail, recipientHash, null, null],
    );
    const outcome = typeof result.rows[0]?.result?.result === "string"
      ? result.rows[0].result.result
      : "unknown";
    return JSON.stringify({ mode: "rollback_only", rpc: "returned", outcome });
  } catch (cause) {
    const failure = cause as { code?: unknown; where?: unknown; schema?: unknown; table?: unknown; constraint?: unknown };
    const code = typeof failure.code === "string" && /^[A-Z0-9]{5}$/.test(failure.code)
      ? failure.code
      : "unknown";
    const context = typeof failure.where === "string"
      ? failure.where.split(/\r?\n/)
          .filter((line) => line.startsWith("PL/pgSQL function "))
          .map((line) => line.replace(/[^A-Za-z0-9_.,() ]/g, "").replace(/\s+/g, " "))
          .slice(-5)
      : [];
    const safeName = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.]+$/.test(value)
      ? value
      : undefined;
    const classification = code === "42P10"
      ? "no_unique_or_exclusion_constraint_for_on_conflict"
      : "database_error_redacted";
    return JSON.stringify({
      mode: "rollback_only",
      rpc: "failed",
      code,
      classification,
      context,
      schema: safeName(failure.schema),
      table: safeName(failure.table),
      constraint: safeName(failure.constraint),
    });
  } finally {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discardClient = true;
      }
    }
    client.release(discardClient);
  }
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
    signal: AbortSignal.timeout(Math.min(180_000, remainingMs())),
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

async function auditRenderedCopy(page: Page, componentSelector = '[data-ui-component-content^="agency-follow-up-"]'): Promise<string[]> {
  return page.evaluate((selector) => {
    const failures: string[] = [];
    const components = document.querySelectorAll<HTMLElement>(selector);
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
        if (copy.matches('p[aria-label^="Provider delivery status:"]') && copy.scrollWidth > copy.clientWidth + 1) {
          failures.push(tag + ": provider delivery status overflows its content width");
        }
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
  }, componentSelector);
}

async function runBrowserWalkthrough(pool: Pool, fixtures: Fixtures, portalSecret: string, walkthroughToken: string, templateApprovalRollbackEvidence: Record<string, unknown>): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ headless: true });
  activeBrowser = browser;
  const context = await signedContext(browser, fixtures, portalSecret);
  try {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(180_000);
  const responseFailures: string[] = [];
  const recoveredBrowserRuntimeErrors: string[] = [];
  let templateApprovalAuditEvidence: Record<string, unknown> | undefined;
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
    progress(`direct app/layout.js asset probe failed after ${Date.now() - layoutChunkStartedAt}ms: ${safeFailureText(error, 300)}`);
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
      const screenshotWritten = await page.screenshot({ path: screenshotPath, fullPage: false }).then(() => true, () => false);
      const errorMessage = safeFailureText(hydrationError, 1000);
      const failureReceipt = {
        runId: RUN_ID,
        stage: "browser_form_hydration",
        errorMessage,
        diagnostics,
        browserRuntimeErrors: responseFailures.slice(-20).map((entry) => safeFailureText(entry, 1000)),
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

  const { journeyName, weekdayJourneyName, taggedUnknownJourneyName } = await authorJourney(page, async (templateKey) => {
    templateApprovalAuditEvidence = await verifyTemplateApprovalAudit(pool, templateKey, fixtures.lawyerId);
  });
  const consentProspect = fixtures.prospects.consent;
  await createDraft(pool, page, journeyName, consentProspect);
  const consentCard = queueCard(page, consentProspect.firmName);
  const syntheticConsentText = "Synthetic consent evidence for local acceptance only; this is not real prospect consent.";
  const syntheticConsentHash = createHash("sha256").update(syntheticConsentText).digest("hex");
  const consentTimeLocal = (instant: Date) => new Date(instant.getTime() - instant.getTimezoneOffset() * 60_000 - 60_000).toISOString().slice(0, 19);
  const recordConsentEvent = async (eventType: "opt_in_granted" | "opt_in_withdrawn") => {
    await consentCard.getByLabel("Record event").selectOption(eventType);
    await consentCard.getByLabel(/Date and time recorded in evidence/).fill(consentTimeLocal(new Date()));
    await consentCard.getByLabel("Evidence source").selectOption("other_verified_evidence");
    await consentCard.getByLabel("Consent text version").fill("synthetic-walkthrough-consent-v1");
    await consentCard.getByLabel("Consent text SHA-256").fill(syntheticConsentHash);
    await consentCard.getByLabel("Evidence reference").fill(`synthetic://agency-followup-walkthrough/${RUN_ID}/consent/${eventType}`);
    await consentCard.getByLabel("Evidence SHA-256").fill(syntheticConsentHash);
    await consentCard.getByLabel(/I reviewed this source and confirmed it supports/).check();
    const submit = consentCard.getByRole("button", { name: "Record append-only consent event" });
    await expect(submit).toBeEnabled();
    const sendOptIn = async () => {
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/agency-crm/follow-up/opt-in" && response.request().method() === "POST");
      await submit.click();
      return responsePromise;
    };
    let response = await sendOptIn();
    if (response.status() === 401) {
      const health = await page.context().request.get(APP_ORIGIN + API_PATH, { timeout: 15000 }).catch(() => undefined);
      if (health?.status() === 200) response = await sendOptIn();
    }
    let submittedEventType = "unknown";
    try { submittedEventType = String(response.request().postDataJSON()?.eventType ?? "unknown"); } catch { /* diagnostic only */ }
    if (submittedEventType !== eventType) throw new Error(`Consent UI expected ${eventType} but submitted ${submittedEventType}.`);
    if (response.status() !== 201) throw new Error(`Synthetic ${eventType} did not append a new consent event (HTTP ${response.status()}).`);
    await expect(consentCard.getByRole("status").filter({ hasText: eventType === "opt_in_granted" ? "Opt-in grant recorded" : "Opt-in withdrawal recorded" })).toBeVisible();
  };
  await recordConsentEvent("opt_in_granted");
  const historyButton = consentCard.getByRole("button", { name: "View consent history" });
  const historyResponsePromise = page.waitForResponse((response) => response.url().includes("/api/admin/agency-crm/follow-up/opt-in?") && response.request().method() === "GET");
  await historyButton.click();
  const grantHistoryResponse = await historyResponsePromise;
  if (!grantHistoryResponse.ok()) throw new Error(`Authenticated consent history returned HTTP ${grantHistoryResponse.status()}.`);
  const grantHistoryPayload = await grantHistoryResponse.json() as { events?: Array<{ eventType: string; actorOperatorId: string; evidenceReference: string }> };
  if (!Array.isArray(grantHistoryPayload.events) || grantHistoryPayload.events.length !== 1 || grantHistoryPayload.events[0].eventType !== "opt_in_granted" ||
      grantHistoryPayload.events[0].actorOperatorId !== fixtures.lawyerId || !grantHistoryPayload.events[0].evidenceReference.endsWith("/opt_in_granted")) {
    throw new Error("Grant history did not expose the synthetic append-only event and authenticated operator.");
  }
  await recordConsentEvent("opt_in_withdrawn");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  const finalHistoryResponse = await context.request.get(`${APP_ORIGIN}/api/admin/agency-crm/follow-up/opt-in?prospectId=${encodeURIComponent(consentProspect.id)}`);
  if (!finalHistoryResponse.ok()) throw new Error(`Synthetic consent history readback returned HTTP ${finalHistoryResponse.status()}.`);
  const finalHistoryPayload = await finalHistoryResponse.json() as { events?: Array<{ eventType: string; actorOperatorId: string; evidenceReference: string; recipientEmailSha256: string }> };
  if (!Array.isArray(finalHistoryPayload.events) || finalHistoryPayload.events.length !== 2 || finalHistoryPayload.events[0].eventType !== "opt_in_granted" ||
      finalHistoryPayload.events[1].eventType !== "opt_in_withdrawn" || finalHistoryPayload.events.some((entry) => entry.actorOperatorId !== fixtures.lawyerId || !entry.recipientEmailSha256 || !entry.evidenceReference.startsWith("synthetic://"))) {
    throw new Error("Grant and withdrawal were not preserved in chronological consent history for the signed synthetic operator.");
  }
  await expect(consentCard.getByText("Current opt-in state: withdrawn")).toBeVisible({ timeout: 30000 });
  await expect(consentCard.getByRole("heading", { name: "Opt-in withdrawal · other verified evidence" })).toBeVisible({ timeout: 30000 });
  await expect(consentCard.getByText(`Evidence reference: synthetic://agency-followup-walkthrough/${RUN_ID}/consent/opt_in_withdrawn`, { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(consentCard.getByText(`Recorded by operator: ${fixtures.lawyerId}`).last()).toBeVisible({ timeout: 30000 });

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
  const normalMessages = await pool.query<{ id: string; enrollment_id: string; recipient_email_snapshot: string; step_number: number; state: string }>(
    "select id,enrollment_id,recipient_email_snapshot,step_number,state from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) order by step_number",
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
  const testClaimEvidence = await verifyTestMessageClaimRpc(pool, {
    messageId: firstNormalMessage.id,
    enrollmentId: firstNormalMessage.enrollment_id,
    recipientEmail: firstNormalMessage.recipient_email_snapshot,
  }, acceptedNow);

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

  const acceptedProviderMessageId = `fake-provider-normal-${RUN_ID}`;
  const acceptedResult = await withFixtureClaim(pool, firstNormalMessage.id, () => dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-accepted",
    now: acceptedNow,
    limit: 1,
    outcomePlan: [{ kind: "accepted", providerMessageId: acceptedProviderMessageId, acceptedAt: acceptedNow }],
  }));
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

  const taggedUnknownProspect = fixtures.prospects.tagged_unknown;
  await createDraft(pool, page, taggedUnknownJourneyName, taggedUnknownProspect);
  await markEligibleAndRelease(page, taggedUnknownProspect);
  await waitForAction(page, "approve", queueCard(page, taggedUnknownProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const taggedUnknownRow = await pool.query<{ id: string; enrollment_id: string; recipient_email_snapshot: string }>(
    "select message.id,message.enrollment_id,message.recipient_email_snapshot from public.agency_followup_messages message join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id where enrollment.prospect_id=$1 and message.step_number=1",
    [taggedUnknownProspect.id],
  );
  const taggedMessage = taggedUnknownRow.rows[0];
  if (!taggedMessage) throw new Error("Tagged UNKNOWN reconciliation message was not created.");
  // The all-days policy was authored as a new immutable journey version through the UI.
  // Make only this disposable message due against the same database clock used for its claim.
  await pool.query(
    "update public.agency_followup_messages set scheduled_at=clock_timestamp()-interval '10 minutes' where id=$1",
    [taggedMessage.id],
  );
  const taggedDbNowResult = await pool.query<{ now: Date }>("select clock_timestamp() as now");
  const taggedDbNow = taggedDbNowResult.rows[0]?.now;
  if (!(taggedDbNow instanceof Date) || !Number.isFinite(taggedDbNow.getTime())) {
    throw new Error("The database clock for the tagged UNKNOWN synthetic claim could not be read.");
  }
  const taggedOwner = `synthetic-tagged-unknown-${RUN_ID}`;
  const taggedClaimed = await withFixtureClaim(pool, taggedMessage.id, async () => pool.query<{
    id: string; enrollment_id: string; attempt_count: number; lease_owner: string; state: string;
  }>(
    "select id,enrollment_id,attempt_count,lease_owner,state from public.claim_agency_followup_messages($1,$2,120,1)",
    [taggedOwner, taggedDbNow.toISOString()],
  ));
  const taggedLease = taggedClaimed.rows[0];
  if (!taggedLease || taggedLease.id !== taggedMessage.id || taggedLease.state !== "claimed" || taggedLease.lease_owner !== taggedOwner) {
    throw new Error("The signed UNKNOWN-tag fixture could not be claimed by the real database claim RPC.");
  }
  const taggedGateClient = await pool.connect();
  try {
    await taggedGateClient.query("begin");
    await taggedGateClient.query("set local role service_role");
    const gate = await authorizeProviderHandoff(taggedGateClient, {
      messageId: taggedMessage.id, enrollmentId: taggedMessage.enrollment_id,
      owner: taggedOwner, attemptCount: Number(taggedLease.attempt_count),
    });
    const recipientMatches = gate.request?.recipientEmail === taggedMessage.recipient_email_snapshot;
    if (gate.result !== "ready" || !recipientMatches) {
      const gateBlockers = gate.blockers ?? [];
      const safeGateDetails = {
        ready: gate.result === "ready",
        blocked: gate.result === "blocked",
        deferred: gate.result === "deferred",
        expired: gate.result === "expired",
        stale: gate.result === "stale",
        blockerCount: gateBlockers.length,
        contactabilityUnknown: gateBlockers.includes("contactability_unknown"),
        contactabilityBlocked: gateBlockers.includes("contactability_blocked"),
        conversationStopped: gateBlockers.includes("conversation_stopped"),
        prospectStatusStopped: gateBlockers.includes("prospect_status_stopped"),
        sequenceNotReleased: gateBlockers.includes("sequence_not_released"),
        eligibilityNotApproved: gateBlockers.includes("eligibility_not_approved"),
        eligibilityEvidenceMissing: gateBlockers.includes("eligibility_evidence_missing"),
        recipientEmailInvalid: gateBlockers.includes("recipient_email_invalid"),
        recipientIdentityMissing: gateBlockers.includes("recipient_identity_missing"),
        explicitOptInWithdrawn: gateBlockers.includes("explicit_opt_in_withdrawn"),
        explicitOptInMissing: gateBlockers.includes("explicit_opt_in_missing"),
        approvalStaleRecipient: gateBlockers.includes("approval_stale_recipient"),
        approvalMissing: gateBlockers.includes("approval_missing"),
        approvalReviewerInvalid: gateBlockers.includes("approval_invalid_reviewer_or_time"),
        approvalStaleContent: gateBlockers.includes("approval_stale_content"),
        previousStepUnresolved: gateBlockers.includes("previous_step_unresolved"),
        notDue: gateBlockers.includes("not_due"),
        invalidSchedule: gateBlockers.includes("invalid_schedule"),
        outsideSendWindow: gateBlockers.includes("outside_send_window"),
        spacingNotElapsed: gateBlockers.includes("minimum_spacing_not_elapsed"),
        previousStepPending: gate.blocker === "previous_step_pending",
        requestPresent: Boolean(gate.request),
        recipientMatches,
      };
      progress("tagged UNKNOWN handoff gate flags: " + Object.entries(safeGateDetails).map(([key, value]) => key + "=" + String(value)).join(","));
      throw new Error("The tagged UNKNOWN fixture failed final handoff authorization; see the safe gate flags above.");
    }
    await taggedGateClient.query("commit");
  } catch (error) {
    await taggedGateClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    taggedGateClient.release();
  }

  const taggedProviderMessageId = `fake-provider-tagged-unknown-${RUN_ID}`;
  const taggedResendEventId = `evt_tagged_unknown_${RUN_ID}`;
  const taggedEventBase = {
    type: "email.sent",
    created_at: acceptedNow,
    data: {
      email_id: taggedProviderMessageId,
      to: [taggedMessage.recipient_email_snapshot.toUpperCase()],
      tags: {
        agency_followup_message_id: taggedMessage.id,
        agency_followup_enrollment_id: taggedMessage.enrollment_id,
      },
    },
  };
  const claimedTaggedReceipt = await postSyntheticResendEvent(taggedResendEventId, taggedEventBase);
  const claimedTaggedEvidence = await pool.query<{ processing_result: string; message_id: string | null; enrollment_id: string | null; signed_message_id: string | null; signed_enrollment_id: string | null; tags_recorded: boolean; applications: string }>(
    "select event.processing_result,event.message_id,event.enrollment_id,event.signed_agency_followup_message_id as signed_message_id,event.signed_agency_followup_enrollment_id as signed_enrollment_id,event.signed_agency_followup_tags_recorded as tags_recorded,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=event.provider_event_id) as applications from public.agency_followup_provider_events event where event.provider_event_id=$1",
    [taggedResendEventId],
  );
  if (claimedTaggedReceipt.status !== 503 || claimedTaggedReceipt.outcome !== "unmatched_message" ||
      claimedTaggedEvidence.rows[0]?.processing_result !== "unmatched_message" || claimedTaggedEvidence.rows[0]?.message_id !== taggedMessage.id ||
      claimedTaggedEvidence.rows[0]?.enrollment_id !== taggedMessage.enrollment_id ||
      claimedTaggedEvidence.rows[0]?.signed_message_id !== taggedMessage.id || claimedTaggedEvidence.rows[0]?.signed_enrollment_id !== taggedMessage.enrollment_id ||
      claimedTaggedEvidence.rows[0]?.tags_recorded !== true ||
      claimedTaggedEvidence.rows[0]?.applications !== "0") {
    throw new Error("A signed tagged email.sent arriving while claimed was not stored unmatched for safe replay.");
  }
  const changedTaggedReplay = await postSyntheticResendEvent(taggedResendEventId, {
    ...taggedEventBase,
    data: { ...taggedEventBase.data, tags: { ...taggedEventBase.data.tags, agency_followup_message_id: randomUUID() } },
  });
  const immutableTaggedInbox = await pool.query<{ processing_result: string; signed_message_id: string | null; signed_enrollment_id: string | null; tags_recorded: boolean }>(
    "select processing_result,signed_agency_followup_message_id as signed_message_id,signed_agency_followup_enrollment_id as signed_enrollment_id,signed_agency_followup_tags_recorded as tags_recorded from public.agency_followup_provider_events where provider_event_id=$1",
    [taggedResendEventId],
  );
  if (changedTaggedReplay.status !== 500 || changedTaggedReplay.error !== "event_persistence_failed" ||
      immutableTaggedInbox.rows[0]?.processing_result !== "unmatched_message" || immutableTaggedInbox.rows[0]?.signed_message_id !== taggedMessage.id ||
      immutableTaggedInbox.rows[0]?.signed_enrollment_id !== taggedMessage.enrollment_id || immutableTaggedInbox.rows[0]?.tags_recorded !== true) {
    throw new Error("A repeated signed event ID with a changed tag pair altered its immutable inbox binding.");
  }

  const unknownDispositionClient = await pool.connect();
  try {
    await unknownDispositionClient.query("begin");
    await unknownDispositionClient.query("set local role service_role");
    await unknownDispositionClient.query(
      "select public.persist_agency_followup_disposition($1::uuid,$2::uuid,$3,$4,$5::jsonb)",
      [taggedMessage.id, taggedMessage.enrollment_id, taggedOwner, Number(taggedLease.attempt_count),
        JSON.stringify({ state: "unknown", detail: "synthetic_tagged_email_sent_interruption", at: taggedDbNow.toISOString() })],
    );
    await unknownDispositionClient.query("commit");
  } catch (error) {
    await unknownDispositionClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    unknownDispositionClient.release();
  }
  const exactTaggedMessageBeforeReplay = await pool.query<{ state: string; provider_message_id: string | null; accepted_events: string }>(
    "select message.state,message.provider_message_id,(select count(*)::text from public.agency_followup_events event where event.message_id=message.id and event.event_type='provider_accepted') as accepted_events from public.agency_followup_messages message where message.id=$1",
    [taggedMessage.id],
  );
  if (exactTaggedMessageBeforeReplay.rows[0]?.state !== "unknown" || exactTaggedMessageBeforeReplay.rows[0]?.provider_message_id !== null ||
      exactTaggedMessageBeforeReplay.rows[0]?.accepted_events !== "0") {
    throw new Error("The synthetic worker did not leave the tagged message quarantined UNKNOWN before replay.");
  }

  const rejectedTaggedEvents = [
    {
      id: `evt_wrong_message_tag_${RUN_ID}`,
      payload: { ...taggedEventBase, data: { ...taggedEventBase.data, tags: {
        agency_followup_message_id: randomUUID(),
        agency_followup_enrollment_id: taggedMessage.enrollment_id,
      } } },
      name: "wrong message tag",
      outcome: "unmatched_message",
      status: 503,
    },
    {
      id: `evt_wrong_enrollment_tag_${RUN_ID}`,
      payload: { ...taggedEventBase, data: { ...taggedEventBase.data, tags: {
        agency_followup_message_id: taggedMessage.id,
        agency_followup_enrollment_id: randomUUID(),
      } } },
      name: "wrong enrollment tag",
      outcome: "unmatched_message",
      status: 503,
    },
    {
      id: `evt_wrong_tagged_recipient_${RUN_ID}`,
      payload: { ...taggedEventBase, data: { ...taggedEventBase.data, to: ["different-recipient@example.test"] } },
      name: "wrong normalized recipient",
      outcome: "unmatched_recipient",
      status: 200,
    },
    {
      id: `evt_tagged_not_sent_${RUN_ID}`,
      payload: { ...taggedEventBase, type: "email.delivered" },
      name: "non-email.sent event",
      outcome: "unmatched_message",
      status: 503,
    },
  ];
  for (const rejected of rejectedTaggedEvents) {
    const receipt = await postSyntheticResendEvent(rejected.id, rejected.payload);
    const unchanged = await pool.query<{ state: string; provider_message_id: string | null; accepted_events: string; applications: string; signed_message_id: string | null; signed_enrollment_id: string | null; tags_recorded: boolean }>(
      "select message.state,message.provider_message_id,(select count(*)::text from public.agency_followup_events event where event.message_id=message.id and event.event_type='provider_accepted') as accepted_events,(select count(*)::text from public.agency_followup_provider_event_applications application join public.agency_followup_provider_events provider_event on provider_event.provider_event_id=application.provider_event_id where application.message_id=message.id and provider_event.provider_event_id=$2) as applications,(select provider_event.signed_agency_followup_message_id from public.agency_followup_provider_events provider_event where provider_event.provider_event_id=$2) as signed_message_id,(select provider_event.signed_agency_followup_enrollment_id from public.agency_followup_provider_events provider_event where provider_event.provider_event_id=$2) as signed_enrollment_id,(select provider_event.signed_agency_followup_tags_recorded from public.agency_followup_provider_events provider_event where provider_event.provider_event_id=$2) as tags_recorded from public.agency_followup_messages message where message.id=$1",
      [taggedMessage.id, rejected.id],
    );
    if (receipt.status !== rejected.status || receipt.outcome !== rejected.outcome || unchanged.rows[0]?.state !== "unknown" ||
        unchanged.rows[0]?.provider_message_id !== null || unchanged.rows[0]?.accepted_events !== "0" || unchanged.rows[0]?.applications !== "0" ||
        unchanged.rows[0]?.signed_message_id !== rejected.payload.data.tags.agency_followup_message_id ||
        unchanged.rows[0]?.signed_enrollment_id !== rejected.payload.data.tags.agency_followup_enrollment_id || unchanged.rows[0]?.tags_recorded !== true) {
      throw new Error(`The ${rejected.name} event mutated the tagged UNKNOWN follow-up message.`);
    }
  }

  const taggedReplay = await postSyntheticResendEvent(taggedResendEventId, taggedEventBase);
  const duplicateTaggedReplay = await postSyntheticResendEvent(taggedResendEventId, taggedEventBase);
  const taggedPromotion = await pool.query<{ state: string; provider_message_id: string | null; provider_delivery_status: string | null; accepted_events: string; applications: string; applied_result: string | null }>(
    "select message.state,message.provider_message_id,message.provider_delivery_status,(select count(*)::text from public.agency_followup_events event where event.message_id=message.id and event.event_type='provider_accepted') as accepted_events,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=$2 and application.message_id=message.id) as applications,(select application.applied_result from public.agency_followup_provider_event_applications application where application.provider_event_id=$2 and application.message_id=message.id) as applied_result from public.agency_followup_messages message where message.id=$1",
    [taggedMessage.id, taggedResendEventId],
  );
  if (taggedReplay.status !== 200 || taggedReplay.outcome !== "matched" || duplicateTaggedReplay.status !== 200 || duplicateTaggedReplay.outcome !== "duplicate" ||
      taggedPromotion.rows[0]?.state !== "accepted" || taggedPromotion.rows[0]?.provider_message_id !== taggedProviderMessageId ||
      taggedPromotion.rows[0]?.provider_delivery_status !== "accepted" || taggedPromotion.rows[0]?.accepted_events !== "1" ||
      taggedPromotion.rows[0]?.applications !== "1" || taggedPromotion.rows[0]?.applied_result !== "matched") {
    throw new Error("An exact signed email.sent replay did not promote UNKNOWN exactly once, or its duplicate was not idempotent.");
  }
  progress("signed tagged email.sent stayed unmatched while claimed, promoted the exact UNKNOWN message on replay once, rejected mismatched message/enrollment/recipient/non-sent events, and ignored duplicate replay");

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
  const quarantinedSourceReplayEvidence = await verifyQuarantinedSourceEventReplay(
    pool,
    fixtures.prospects.normal,
    accepted.rows[0]!.provider_message_id!,
    acceptedNow,
  );
  if (reconciledProviderEvent.status !== 200 || reconciledProviderEvent.outcome !== "matched" ||
    duplicateProviderEvent.status !== 200 || duplicateProviderEvent.outcome !== "duplicate" ||
    providerEventState.rows[0]?.processing_result !== "unmatched_message" || providerEventState.rows[0]?.message_id !== null ||
    providerEventState.rows[0]?.applications !== "1" || providerEventState.rows[0]?.applied_message_id !== retryMessage.id ||
    providerEventState.rows[0]?.applied_result !== "matched" || providerEventState.rows[0]?.durable_events !== "1" ||
    reconciledMessage.rows[0]?.provider_delivery_status !== "delivered") {
    throw new Error("The signed provider event did not reconcile after acceptance exactly once with an authoritative application row.");
  }


  const stopEventCases = [
    { type: "email.bounced", suffix: "bounced", reason: "resend_email_bounced", deliveryStatus: "bounced", auditType: "bounce_observed" },
    { type: "email.complained", suffix: "complained", reason: "resend_email_complaint", deliveryStatus: "complained", auditType: "complaint_observed" },
    { type: "email.unsubscribed", suffix: "unsubscribed", reason: "resend_email_unsubscribed", deliveryStatus: "unsubscribed", auditType: "unsubscribe_observed" },
    { type: "email.suppressed", suffix: "suppressed", reason: "resend_email_suppressed", deliveryStatus: "suppressed", auditType: "provider_suppressed" },
  ] as const;
  let latestStopEventTime = "";
  for (let index = 0; index < stopEventCases.length; index += 1) {
    const eventCase = stopEventCases[index]!;
    const eventId = "evt_" + eventCase.suffix + "_" + RUN_ID;
    const eventTime = new Date(Date.parse(retryDueAt) + 2000 + index * 1000).toISOString();
    const payload = {
      type: eventCase.type,
      created_at: eventTime,
      data: { email_id: retryProviderMessageId, to: [retryProspect.email] },
    };
    const receipt = await postSyntheticResendEvent(eventId, payload);
    const duplicateReceipt = await postSyntheticResendEvent(eventId, payload);
    if (eventCase.type === "email.bounced" && (receipt.status === 500 || duplicateReceipt.status === 500)) {
      const diagnostic = await diagnoseBouncedResendFailureInRollback(pool, eventId, retryProviderMessageId, eventTime, retryProspect.email);
      progress("rollback-only sanitized database diagnosis for email.bounced: " + diagnostic);
    }
    const appliedState = await pool.query<{
      processing_result: string; message_id: string | null; applications: string; applied_result: string | null;
      suppression_rows: string; audit_events: string; delivery_status: string | null; contact_state: string | null;
    }>(
      "select event.processing_result,event.message_id,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=event.provider_event_id and application.message_id=$2) as applications,(select application.applied_result from public.agency_followup_provider_event_applications application where application.provider_event_id=event.provider_event_id and application.message_id=$2) as applied_result,(select count(*)::text from public.prospect_contactability_provider_suppressions suppression where suppression.provider_event_id=event.provider_event_id and suppression.suppression_reason=$3) as suppression_rows,(select count(*)::text from public.agency_followup_events audit where audit.idempotency_key='resend-event:'||event.provider_event_id and audit.event_type=$4) as audit_events,(select message.provider_delivery_status from public.agency_followup_messages message where message.id=$2) as delivery_status,(select contactability.state from public.prospect_contactability contactability where contactability.conversation_id=$5) as contact_state from public.agency_followup_provider_events event where event.provider_event_id=$1",
      [eventId, retryMessage.id, eventCase.reason, eventCase.auditType, retryProspect.conversationId],
    );
    if (receipt.status !== 200 || receipt.outcome !== "matched" ||
      duplicateReceipt.status !== 200 || duplicateReceipt.outcome !== "duplicate" ||
      appliedState.rows[0]?.processing_result !== "matched" || appliedState.rows[0]?.message_id !== retryMessage.id ||
      appliedState.rows[0]?.applications !== "1" || appliedState.rows[0]?.applied_result !== "matched" ||
      appliedState.rows[0]?.suppression_rows !== "1" || appliedState.rows[0]?.audit_events !== "1" ||
      appliedState.rows[0]?.delivery_status !== eventCase.deliveryStatus || appliedState.rows[0]?.contact_state !== "suppressed") {
      throw new Error("The signed " + eventCase.type + " did not apply exactly once, create its shared stop, retain the expected status, or deduplicate its replay.");
    }
    latestStopEventTime = eventTime;
  }

  const lateAcceptanceId = "evt_late_sent_" + RUN_ID;
  const lateAcceptance = await postSyntheticResendEvent(lateAcceptanceId, {
    type: "email.sent",
    created_at: retryDueAt,
    data: { email_id: retryProviderMessageId, to: [retryProspect.email] },
  });
  const statusAfterLateAcceptance = await pool.query<{
    provider_delivery_status: string | null; provider_delivery_status_at: Date | string | null;
    contact_state: string | null; suppression_rows: string; late_applications: string; late_acceptance_audit: string;
  }>(
    "select message.provider_delivery_status,message.provider_delivery_status_at,contactability.state as contact_state,(select count(*)::text from public.prospect_contactability_provider_suppressions suppression where suppression.conversation_id=contactability.conversation_id and suppression.suppression_reason=any($2::text[])) as suppression_rows,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=$3 and application.message_id=message.id) as late_applications,(select count(*)::text from public.agency_followup_events audit where audit.idempotency_key='resend-event:'||$3 and audit.event_type='provider_accepted') as late_acceptance_audit from public.agency_followup_messages message join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id join public.prospect_source_links source_link on source_link.source_record_key=enrollment.prospect_id::text and source_link.source_system='agency_crm' join public.prospect_conversation_sources association on association.source_link_id=source_link.id join public.prospect_contactability contactability on contactability.conversation_id=association.conversation_id where message.id=$1",
    [retryMessage.id, stopEventCases.map((eventCase) => eventCase.reason), lateAcceptanceId],
  );
  if (lateAcceptance.status !== 200 || lateAcceptance.outcome !== "matched" ||
    statusAfterLateAcceptance.rows[0]?.provider_delivery_status !== "suppressed" ||
    !statusAfterLateAcceptance.rows[0]?.provider_delivery_status_at ||
    new Date(statusAfterLateAcceptance.rows[0].provider_delivery_status_at).toISOString() !== latestStopEventTime ||
    statusAfterLateAcceptance.rows[0]?.contact_state !== "suppressed" ||
    statusAfterLateAcceptance.rows[0]?.suppression_rows !== String(stopEventCases.length) ||
    statusAfterLateAcceptance.rows[0]?.late_applications !== "1" ||
    statusAfterLateAcceptance.rows[0]?.late_acceptance_audit !== "1") {
    throw new Error("A late signed email.sent event downgraded provider stop status or removed shared suppression evidence.");
  }
  progress("signed bounce, complaint, unsubscribe, and provider-suppressed events each created one shared stop and audit; exact duplicates were idempotent; older email.sent did not downgrade the final status");

  const contactProspect = fixtures.prospects.contact_unsubscribe;
  const contactEventId = "evt_contact_unsubscribe_" + RUN_ID;
  const contactOccurredAt = new Date().toISOString();
  const contactRecipientHash = createHash("sha256").update(contactProspect.email.trim().toLowerCase(), "utf8").digest("hex");
  const contactEventPayload = {
    type: "contact.updated",
    created_at: contactOccurredAt,
    data: { email: contactProspect.email, unsubscribed: true },
  };
  const contactReceipt = await postSyntheticResendEvent(contactEventId, contactEventPayload);
  const duplicateContactReceipt = await postSyntheticResendEvent(contactEventId, contactEventPayload);
  const contactEventState = await pool.query<{
    processing_result: string; recipient_sha256: string | null; provider_message_id: string | null;
    message_id: string | null; enrollment_id: string | null; conversation_id: string | null; source_link_id: string | null;
    contact_applications: string; message_applications: string; suppression_rows: string; message_rows: string;
    audit_events: string; contact_state: string | null; contact_reason: string | null;
    suppressed_by_provider_event_id: string | null; raw_email_absent: boolean;
  }>(
    "select event.processing_result,event.recipient_sha256,event.provider_message_id,event.message_id,event.enrollment_id,event.conversation_id,event.source_link_id,(select count(*)::text from public.agency_followup_provider_contact_applications application where application.provider_event_id=event.provider_event_id and application.conversation_id=event.conversation_id and application.source_link_id=event.source_link_id) as contact_applications,(select count(*)::text from public.agency_followup_provider_event_applications application where application.provider_event_id=event.provider_event_id) as message_applications,(select count(*)::text from public.prospect_contactability_provider_suppressions suppression where suppression.provider_event_id=event.provider_event_id and suppression.suppression_reason='resend_email_unsubscribed') as suppression_rows,(select count(*)::text from public.agency_followup_messages message join public.agency_followup_enrollments enrollment on enrollment.id=message.enrollment_id where enrollment.prospect_id=$2) as message_rows,(select count(*)::text from public.agency_followup_events audit where audit.idempotency_key='resend-event:'||event.provider_event_id) as audit_events,contactability.state as contact_state,contactability.reason as contact_reason,contactability.suppressed_by_provider_event_id,not (to_jsonb(event)::text ilike '%'||$3||'%') as raw_email_absent from public.agency_followup_provider_events event left join public.prospect_contactability contactability on contactability.conversation_id=event.conversation_id where event.provider_event_id=$1",
    [contactEventId, contactProspect.id, contactProspect.email],
  );
  if (contactReceipt.status !== 200 || contactReceipt.outcome !== "matched_contact" ||
    duplicateContactReceipt.status !== 200 || duplicateContactReceipt.outcome !== "duplicate" ||
    contactEventState.rows[0]?.processing_result !== "matched_contact" ||
    contactEventState.rows[0]?.recipient_sha256 !== contactRecipientHash ||
    contactEventState.rows[0]?.provider_message_id !== null ||
    contactEventState.rows[0]?.message_id !== null || contactEventState.rows[0]?.enrollment_id !== null ||
    !contactEventState.rows[0]?.conversation_id || !contactEventState.rows[0]?.source_link_id ||
    contactEventState.rows[0]?.contact_applications !== "1" || contactEventState.rows[0]?.message_applications !== "0" ||
    contactEventState.rows[0]?.suppression_rows !== "1" || contactEventState.rows[0]?.message_rows !== "0" ||
    contactEventState.rows[0]?.audit_events !== "0" || contactEventState.rows[0]?.contact_state !== "suppressed" ||
    contactEventState.rows[0]?.contact_reason !== "resend_email_unsubscribed" ||
    contactEventState.rows[0]?.suppressed_by_provider_event_id !== contactEventId ||
    contactEventState.rows[0]?.raw_email_absent !== true) {
    throw new Error("The contact.updated unsubscribe did not create a hash-only contact match and shared suppression without a message application or email audit.");
  }
  progress("signed contact.updated unsubscribe matched by normalized hash without any accepted message; raw email was not persisted; contact application and shared suppression were created once; no message application or message audit exists");
  // Exercise actual schedule policy immediately before handoff with a delayed
  // weekend claim. The current weekday/window come from the persisted journey.
  const windowProspect = fixtures.prospects.window;
  await createDraft(pool, page, weekdayJourneyName, windowProspect);
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

  const liveClaimEvidence = await verifyLiveClaimRpc(pool, {
    allowedMessageId: firstNormalMessage.id,
    offListMessageId: retryMessage.id,
    expiredOffListMessageId: leaseMessage.rows[0].id,
  }, new Date().toISOString());
  const providerIdempotencyFenceEvidence = await verifyProviderIdempotencyFenceRpc(pool, {
    firstUseMessageId: firstNormalMessage.id,
  });
  const providerIdempotencyLockWaitEvidence = await verifyProviderIdempotencyLockWaitBoundary(pool, firstNormalMessage.id);

  const screenshotDir = path.join(OUTPUT_DIR, "screenshots");
  await mkdir(screenshotDir, { recursive: true });
  const renderedWidths: number[] = [];
  const screenshots: Array<{ path: string; sha256: string; viewport: number; navigationState: string }> = [];
  const consentPanelScreenshots: Array<{ path: string; sha256: string; viewport: number; panel: string }> = [];
  const activityPanelScreenshots: Array<{ path: string; sha256: string; viewport: number; panel: string }> = [];
  const providerStatusScreenshots: Array<{ path: string; sha256: string; viewport: number; contentWidth: number; scrollWidth: number; text: string }> = [];
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
    await page.screenshot({ path: file, fullPage: false });
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
      const closedAt = Date.now();
      await stableLayout();
      const closedNavigation = await page.evaluate(() => {
        const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
        const drawer = document.querySelector<HTMLElement>("aside");
        const backdrop = drawer?.previousElementSibling as HTMLElement | null;
        return {
          expanded: toggle?.getAttribute("aria-expanded"),
          drawerRight: drawer?.getBoundingClientRect().right ?? null,
          backdropOpacity: Number.parseFloat(backdrop ? getComputedStyle(backdrop).opacity : "1"),
        };
      });
      if (closedNavigation.expanded !== "false" || closedNavigation.drawerRight === null || closedNavigation.drawerRight > 1 || closedNavigation.backdropOpacity > 0.01) {
        throw new Error(`Mobile navigation did not reach a closed, unobscured state at ${width}px: ${JSON.stringify(closedNavigation)}.`);
      }
      if (width === 640) {
        const immediatePath = path.join(screenshotDir, RUN_ID + "-reproduction-640-after-close.png");
        await page.screenshot({ path: immediatePath, fullPage: false });
        reproduction.push({ path: path.relative(process.cwd(), immediatePath).replaceAll("\\", "/"),
          sha256: createHash("sha256").update(await readFile(immediatePath)).digest("hex"),
          elapsedAfterCloseMs: Date.now() - closedAt });
      }
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
    if (width === 320) {
      const providerStatus = queueCard(page, retryProspect.firmName).locator('[data-ui-component-content="agency-follow-up-message"] dl').first();
      const providerStatusLabel = providerStatus.locator('dt[data-ui-copy="supporting"]');
      const providerStatusValue = providerStatus.locator('dd[data-ui-copy="supporting"]');
      if ((await providerStatusLabel.count()) !== 1 || (await providerStatusValue.count()) !== 1) throw new Error("The synthetic review queue did not render one provider delivery label/value pair.");
      if ((await providerStatusLabel.innerText()).trim() !== "Provider delivery:" || (await providerStatusValue.innerText()).trim() !== "Blocked by provider") throw new Error("The synthetic suppression event was not rendered as a provider-blocked delivery status.");
      await providerStatus.scrollIntoViewIfNeeded();
      await stableLayout();
      const statusGeometry = await providerStatus.evaluate((element) => {
        const value = element.querySelector<HTMLElement>('dd[data-ui-copy="supporting"]');
        if (!value) throw new Error("Provider delivery status value is missing.");
        return {
          clientWidth: value.clientWidth,
          scrollWidth: value.scrollWidth,
          text: (element.textContent ?? "").trim(),
        };
      });
      if (statusGeometry.scrollWidth > statusGeometry.clientWidth + 1) {
        throw new Error(`Provider delivery status overflows its content width at 320px: ${JSON.stringify(statusGeometry)}.`);
      }
      const statusScreenshotPath = path.join(screenshotDir, `${RUN_ID}-provider-status-320.png`);
      await page.screenshot({ path: statusScreenshotPath, fullPage: false });
      providerStatusScreenshots.push({
        path: path.relative(process.cwd(), statusScreenshotPath).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(await readFile(statusScreenshotPath)).digest("hex"),
        viewport: width,
        contentWidth: statusGeometry.clientWidth,
        scrollWidth: statusGeometry.scrollWidth,
        text: statusGeometry.text,
      });
    }
    if (CONSENT_PANEL_WIDTHS.includes(width)) {
      const panel = queueCard(page, consentProspect.firmName).locator('[data-ui-component-content="agency-follow-up-opt-in"]');
      await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await stableLayout();
      await expect(panel).toBeVisible();
      const panelGeometry = await panel.evaluate((element) => {
        const header = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]')?.parentElement;
        return {
          top: element.getBoundingClientRect().top,
          headerBottom: header?.getBoundingClientRect().bottom ?? 0,
          columnCount: getComputedStyle(element.querySelector("form")!).gridTemplateColumns.split(" ").length,
        };
      });
      const expectedColumns = width >= 1024 ? 2 : 1;
      if (panelGeometry.columnCount !== expectedColumns) throw new Error(`Consent form must have ${expectedColumns} columns at ${width}px, found ${panelGeometry.columnCount}.`);
      if (width < 768 && panelGeometry.top < panelGeometry.headerBottom - 1) throw new Error(`Consent panel is obscured by the fixed operator bar at ${width}px: ${JSON.stringify(panelGeometry)}.`);
      const captureTimeLabel = panel.locator("label").filter({ hasText: "Date and time recorded in evidence" });
      await expect(captureTimeLabel).toContainText(/browser timezone: (?!loading).+/i);
      const overflow = await panel.evaluate((element) => {
        const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
        return nodes.filter((node) => node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1)
          .map((node) => ({ tag: node.tagName.toLowerCase(), text: (node.textContent ?? "").trim().slice(0, 80), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
      });
      if (overflow.length) throw new Error(`Consent panel has horizontal overflow at ${width}px: ${JSON.stringify(overflow.slice(0, 5))}`);
      const file = path.join(screenshotDir, `${RUN_ID}-consent-${width}.png`);
      await panel.screenshot({ path: file });
      consentPanelScreenshots.push({ path: path.relative(process.cwd(), file).replaceAll("\\", "/"), sha256: createHash("sha256").update(await readFile(file)).digest("hex"), viewport: width, panel: "operator consent form and chronological synthetic history" });
    }
    renderedWidths.push(width);
  }
  progress("opening synthetic Agency CRM contact history to verify the manual reconciliation controls");
  await page.goto(APP_ORIGIN + "/admin/agency-crm", { waitUntil: "domcontentloaded", timeout: Math.min(180_000, remainingMs()) });
  const normalProspectCard = page.getByRole("listitem")
    .filter({ hasText: normal.firmName })
    .filter({ has: page.getByRole("button", { name: "Contact history", exact: true }) });
  for (let reveal = 0; reveal < 30 && await normalProspectCard.count() === 0; reveal += 1) {
    const showMore = page.getByRole("button", { name: /^Show \d+ more \(/ }).first();
    if (await showMore.count() === 0) break;
    await showMore.click();
  }
  await expect(normalProspectCard).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });
  const normalHistoryButton = normalProspectCard.getByRole("button", { name: "Contact history", exact: true });
  await expect(normalHistoryButton).toHaveCount(1, { timeout: Math.min(30_000, remainingMs()) });
  await normalHistoryButton.click();
  const activityPanel = page.locator('[data-ui-component-content="prospect-activity-panel"]');
  await expect(activityPanel).toBeVisible({ timeout: Math.min(30_000, remainingMs()) });
  const activityType = page.getByLabel("Activity type");
  await expect(activityType).toBeVisible();
  await activityType.selectOption("meeting");
  const meetingOutcome = page.getByPlaceholder("What happened at the meeting", { exact: true });
  await expect(meetingOutcome).toBeVisible();
  await expect(meetingOutcome).toHaveAttribute("placeholder", "What happened at the meeting");
  await expect(page.getByLabel("Next action")).toBeVisible();
  const activityPanelWidths = [1440, 1024, 768, 640, 375, 320] as const;
  const activityCopySelector = '[data-ui-component-content="prospect-activity-form"],[data-ui-component-content="prospect-contact-controls"]';
  for (const width of activityPanelWidths) {
    await page.setViewportSize({ width, height: 1000 });
    await activityPanel.scrollIntoViewIfNeeded();
    await stableLayout();
    const activityCopyFailures = await auditRenderedCopy(page, activityCopySelector);
    if (activityCopyFailures.length) {
      const failureFile = path.join(screenshotDir, RUN_ID + "-failure-prospect-activity-" + width + ".png");
      await activityPanel.screenshot({ path: failureFile });
      throw new Error("Rendered prospect activity UI gate failed at " + width + "px: " + activityCopyFailures.join("; "));
    }
    await assertUnoccluded(activityType, "Activity type control", true);
    await assertUnoccluded(meetingOutcome, "Meeting outcome control", true);
    await activityPanel.scrollIntoViewIfNeeded();
    await stableLayout();
    const file = path.join(screenshotDir, RUN_ID + "-prospect-activity-" + width + ".png");
    await activityPanel.screenshot({ path: file });
    activityPanelScreenshots.push({
      path: path.relative(process.cwd(), file).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
      viewport: width,
      panel: "synthetic operator contact history and meeting reconciliation form",
    });
  }
  progress("synthetic Agency prospect history showed the meeting outcome and next action as separate controls; tagged copy, keyboard focus, point-hit behavior and screenshots passed at six supported widths");
  if (responseFailures.length) throw new Error(responseFailures.join("; "));
  if (!sourceAtStart) throw new Error("Source provenance was not captured before the walkthrough.");
  if (screenshots.length !== 12 || consentPanelScreenshots.length !== CONSENT_PANEL_WIDTHS.length || providerStatusScreenshots.length !== 1 || activityPanelScreenshots.length !== 6 || !missingAuthoringControlRejected || !templateApprovalAuditEvidence) throw new Error("Incomplete queue, consent-panel, provider-status, activity-panel, authoring approval, or required-control evidence.");
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
    testedEnvironment: {
      appOrigin: APP_ORIGIN,
      databaseProjectId: STACK_PROJECT_ID,
      databaseConfigDirectory: path.relative(process.cwd(), STACK_DIR),
      databaseApiPort: SUPABASE_API_PORT,
      databaseDirectPort: SUPABASE_DB_PORT,
      databaseHost: "loopback",
      provider: "network-free fake",
      databaseReusedWithoutReset: STACK_PROJECT_ID === DEFAULT_STACK_PROJECT_ID,
      databaseFreshScratchProject: STACK_PROJECT_ID !== DEFAULT_STACK_PROJECT_ID,
    },
    migrationVersions: ["20261013173327", "20261013174258", "20261013230354", "20261020025251", "20261020141945", "20261021040000", "20261021050000", "20261021173939", "20261022172352", "20261022222611", "20261023170628", "20261023185535", "20261023185615", "20261024054520", "20261024171116", "20261024175302", "20261024213806", "20261024233611"],
    verifiedMigrationBlobs: [EXPECTED_MIGRATION_BLOB, EXPECTED_FOLLOWUP_EVENT_PRIVILEGES_BLOB, EXPECTED_CRM_GRANTS_MIGRATION_BLOB, EXPECTED_EVENT_MIGRATION_BLOB, EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB, EXPECTED_OPT_IN_EVENT_MIGRATION_BLOB, EXPECTED_OPT_IN_OPERATOR_READ_MIGRATION_BLOB, EXPECTED_TEST_MESSAGE_CLAIM_MIGRATION_BLOB, EXPECTED_WEBHOOK_REPLAY_GUARD_MIGRATION_BLOB, EXPECTED_PROVIDER_EVENT_LEAST_PRIVILEGE_MIGRATION_BLOB, EXPECTED_TEMPLATE_APPROVAL_ATOMIC_MIGRATION_BLOB, EXPECTED_LIVE_MESSAGE_CLAIM_MIGRATION_BLOB, EXPECTED_PROVIDER_IDEMPOTENCY_FENCE_MIGRATION_BLOB, EXPECTED_RESEND_SUPPRESSED_STATUS_MIGRATION_BLOB, EXPECTED_SERIALIZED_PROVIDER_HANDOFF_GATE_MIGRATION_BLOB, EXPECTED_UNKNOWN_RESEND_RECONCILIATION_MIGRATION_BLOB, EXPECTED_CONTACT_HANDOFF_MIGRATION_BLOB, EXPECTED_ACTIVITY_LOCK_ORDER_FIX_MIGRATION_BLOB],
    screenshots,
    consentPanelScreenshots,
    providerStatusScreenshots,
    activityPanelScreenshots,
    syntheticConsentCapture: { grantAndWithdrawal: "passed through signed operator UI", chronologicalHistoryEvents: finalHistoryPayload.events.length, authenticatedOperatorId: fixtures.lawyerId, consentIsSynthetic: true },
    templateApprovalAuditAtomicityFailureRollback: templateApprovalRollbackEvidence,
    synthetic: true,
    flows: {
      templateJourneyEnrollmentReleaseApproval: "passed",
      templateApprovalAuditAtomicity: templateApprovalAuditEvidence,
      repeatedEnrollment: "409 and one enrollment",
      pause: "approved message cancelled; unapproved message preserved for review",
      suppression: "release blocked",
      approvalInvalidation: "content change cleared reviewer and reopened review",
      fakeAccepted: "persisted",
      unknown: "quarantined and not reclaimed",
      businessDayWindow: "weekend claim rescheduled before fake provider",
      retry: "temporary failure and backoff persisted; early claim excluded; due retry accepted exactly once with stable key and two attempts",
      providerEventReplay: "signed event was quarantined before acceptance, reconciled on retry after acceptance, and deduplicated with one durable application",
      testClaimRpc: testClaimEvidence,
      liveEnrollmentClaimRpc: liveClaimEvidence,
      providerIdempotencyRetryFence: providerIdempotencyFenceEvidence,
      providerIdempotencyLockWaitBoundary: providerIdempotencyLockWaitEvidence,
      sourceQuarantineReplay: quarantinedSourceReplayEvidence,
      concurrentClaim: "exactly one claim",
      staleLeaseOwner: "rejected",
    },
    syntheticProspects: Object.keys(fixtures.prospects).length,
    screenshotViewports: renderedWidths,
    screenshotCount: screenshots.length,
    consentPanelScreenshotCount: consentPanelScreenshots.length,
    activityPanelScreenshotCount: activityPanelScreenshots.length
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
        await page.screenshot({ path: path.join(OUTPUT_DIR, "screenshots", `failure-hydration-${RUN_ID}.png`), fullPage: false }).catch(() => undefined);
        throw new Error(`Operator UI did not hydrate its controlled template input. Diagnostics: ${JSON.stringify(diagnostics)}; browserErrors=${JSON.stringify(responseFailures.slice(0, 20))}. ${safeFailureText(hydrationError, 1000)}`);
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
    progress(`direct app/layout.js asset probe failed after ${Date.now() - layoutChunkStartedAt}ms: ${safeFailureText(error, 300)}`);
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
  await verifyPushedMigration(FOLLOWUP_EVENT_PRIVILEGES_PATH, EXPECTED_FOLLOWUP_EVENT_PRIVILEGES_BLOB);
  await verifyPushedMigration(CRM_GRANTS_MIGRATION_PATH, EXPECTED_CRM_GRANTS_MIGRATION_BLOB);
  await verifyPushedMigration(EVENT_MIGRATION_PATH, EXPECTED_EVENT_MIGRATION_BLOB);
  await verifyPushedMigration(EVENT_ROW_LOCK_GRANT_MIGRATION_PATH, EXPECTED_EVENT_ROW_LOCK_GRANT_MIGRATION_BLOB);
  await verifyPushedMigration(OPT_IN_EVENT_MIGRATION_PATH, EXPECTED_OPT_IN_EVENT_MIGRATION_BLOB);
  await verifyPushedMigration(OPT_IN_OPERATOR_READ_MIGRATION_PATH, EXPECTED_OPT_IN_OPERATOR_READ_MIGRATION_BLOB);
  await verifyPushedMigration(TEST_MESSAGE_CLAIM_MIGRATION_PATH, EXPECTED_TEST_MESSAGE_CLAIM_MIGRATION_BLOB);
  await verifyPushedMigration(WEBHOOK_REPLAY_GUARD_MIGRATION_PATH, EXPECTED_WEBHOOK_REPLAY_GUARD_MIGRATION_BLOB);
  await verifyPushedMigration(PROVIDER_EVENT_LEAST_PRIVILEGE_MIGRATION_PATH, EXPECTED_PROVIDER_EVENT_LEAST_PRIVILEGE_MIGRATION_BLOB);
  await verifyPushedMigration(TEMPLATE_APPROVAL_ATOMIC_MIGRATION_PATH, EXPECTED_TEMPLATE_APPROVAL_ATOMIC_MIGRATION_BLOB);
  await verifyPushedMigration(LIVE_MESSAGE_CLAIM_MIGRATION_PATH, EXPECTED_LIVE_MESSAGE_CLAIM_MIGRATION_BLOB);
  await verifyPushedMigration(PROVIDER_IDEMPOTENCY_FENCE_MIGRATION_PATH, EXPECTED_PROVIDER_IDEMPOTENCY_FENCE_MIGRATION_BLOB);
  await verifyPushedMigration(RESEND_SUPPRESSED_STATUS_MIGRATION_PATH, EXPECTED_RESEND_SUPPRESSED_STATUS_MIGRATION_BLOB);
  await verifyPushedMigration(SERIALIZED_PROVIDER_HANDOFF_GATE_MIGRATION_PATH, EXPECTED_SERIALIZED_PROVIDER_HANDOFF_GATE_MIGRATION_BLOB);
  await verifyPushedMigration(UNKNOWN_RESEND_RECONCILIATION_MIGRATION_PATH, EXPECTED_UNKNOWN_RESEND_RECONCILIATION_MIGRATION_BLOB);
  await verifyPushedMigration(CONTACT_HANDOFF_MIGRATION_PATH, EXPECTED_CONTACT_HANDOFF_MIGRATION_BLOB);
  await verifyPushedMigration(ACTIVITY_LOCK_ORDER_FIX_MIGRATION_PATH, EXPECTED_ACTIVITY_LOCK_ORDER_FIX_MIGRATION_BLOB);
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
  const pool = new Pool({ connectionString: status.DB_URL, max: 8, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 60000 });
  runAbortController = new AbortController();
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
  const templateApprovalRollbackEvidence = await verifyTemplateApprovalRollback(pool, fixtures.lawyerId);
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
      : await runBrowserWalkthrough(pool, fixtures, portalSecret, walkthroughToken, templateApprovalRollbackEvidence);
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
  const errorMessage = safeFailureText(error, 1500);
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
