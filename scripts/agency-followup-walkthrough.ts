import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
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
const WIDTHS = [1440, 1024, 768, 640, 375, 320];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL = process.argv.includes("--manual");
const WALKTHROUGH_STARTED_AT = Date.now();
const WALKTHROUGH_TIMEOUT_MS = 20 * 60_000;
let interrupted = false;
let absoluteDeadline = Number.POSITIVE_INFINITY;
let activeNextServer: ChildProcess | undefined;
let activeBrowser: Browser | undefined;
let runAbortController: AbortController | undefined;
let temporaryRouteInstalled = false;
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
  const source = await readFile(pathname);
  const blobHeader = Buffer.from(`blob ${source.byteLength}\0`, "utf8");
  const workingBlob = createHash("sha1").update(Buffer.concat([blobHeader, source])).digest("hex");
  if (workingBlob !== expectedBlob) {
    throw new Error(`Refusing local database use because ${path.basename(pathname)} no longer matches its verified pushed blob.`);
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
      [["20261013154000", "20261013230354"]],
    ),
  ]);
  if (identity.rows[0]?.database !== "postgres" || !identity.rows[0]?.address || migration.rows[0]?.count !== "2") {
    throw new Error("Disposable Postgres identity or exact two-migration ledger check failed.");
  }
  const tables = await pool.query<{ count: string }>(
    "select count(*)::text as count from information_schema.tables where table_schema='public' and table_name = any($1::text[])",
    [["agency_followup_template_versions", "agency_followup_journeys", "agency_followup_steps",
      "agency_followup_enrollments", "agency_followup_messages", "agency_followup_events"]],
  );
  if (tables.rows[0]?.count !== "6") throw new Error("The verified disposable stack does not contain all six Agency follow-up tables.");
  const grants = await pool.query<{ service_access: boolean; public_access: boolean }>(
    "select bool_and(has_table_privilege('service_role', table_name, 'select') and has_table_privilege('service_role', table_name, 'insert')) as service_access, bool_or(has_table_privilege('anon', table_name, 'select') or has_table_privilege('authenticated', table_name, 'select')) as public_access from unnest(array['public.agency_prospects','public.agency_deals','public.agency_reminders']) as crm_table(table_name)",
  );
  if (grants.rows[0]?.service_access !== true || grants.rows[0]?.public_access !== false) {
    throw new Error("Disposable Agency CRM service-role grants or public-role revocations are not in the expected state.");
  }
  progress("disposable identity, both migration ledger versions, six follow-up tables, and Agency CRM grants checked");
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
  ];
  await pool.query("begin");
  try {
    progress("seeding synthetic operator and six Agency prospects");
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

async function waitForApp(server: ChildProcess, fixtures: Fixtures, portalSecret: string): Promise<void> {
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
  try {
    await waitForListener(server, startupDeadline);
  } finally {
    clearInterval(startupDiagnostics);
  }
  assertRunning("unauthenticated API request");
  progress(`Next child is alive before unauthenticated request; pid=${server.pid}; exitCode=${server.exitCode}; signalCode=${server.signalCode}; proxyBypass=127.0.0.1`);
  progress(`55435 listener is ready; probing unauthenticated Agency follow-up API (expected 401 or 403; ${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  const unauthenticatedStartedAt = Date.now();
  const unauthenticatedProgress = setInterval(() => {
    progress(`unauthenticated API request still pending; elapsed=${Math.floor((Date.now() - unauthenticatedStartedAt) / 1000)}s; next child state=${server.exitCode === null ? "running" : `exit-${server.exitCode}`}`);
  }, 30000);
  let unauthenticated: Response;
  try {
    unauthenticated = await fetch(APP_ORIGIN + API_PATH, {
      signal: AbortSignal.any([runAbortController!.signal, AbortSignal.timeout(Math.min(360_000, remainingMs()))]),
    });
  } finally {
    clearInterval(unauthenticatedProgress);
  }
  progress(`unauthenticated Agency follow-up API returned HTTP ${unauthenticated.status}`);
  if (![401, 403].includes(unauthenticated.status)) {
    throw new Error("Unauthenticated Agency follow-up API returned unexpected HTTP " + unauthenticated.status + ".");
  }
  assertRunning("authenticated API request");
  progress(`Next child is alive before authenticated request; pid=${server.pid}; exitCode=${server.exitCode}; signalCode=${server.signalCode}; proxyBypass=127.0.0.1`);
  const cookie = createSessionCookie(fixtures.firmId, { role: "operator", lawyer_id: fixtures.lawyerId });
  progress(`probing authenticated Agency follow-up API (synthetic operator cookie; ${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  const authenticated = await fetch(APP_ORIGIN + API_PATH, {
    headers: { cookie: `${cookie.name}=${cookie.value}` },
    signal: AbortSignal.any([runAbortController!.signal, AbortSignal.timeout(Math.min(60_000, remainingMs()))]),
  });
  progress(`authenticated Agency follow-up API returned HTTP ${authenticated.status}`);
  if (authenticated.status !== 200) throw new Error("Authenticated Agency follow-up API returned HTTP " + authenticated.status + ".");
  assertRunning("authenticated API response");
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

async function waitForAction(page: Page, action: string, button: ReturnType<Page["getByRole"]>): Promise<void> {
  await button.waitFor({ state: "visible" });
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
  await expect(button).toBeEnabled();
  // App Router can return server HTML before the client bundle has hydrated.
  // Wait for the first page's network work to settle before relying on React
  // event handlers, especially on a cold local compile.
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  // Install the response listener only after readiness waits. Starting its
  // timeout before hydration can expire before the click is even issued.
  const responsePromise = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === API_PATH && response.request().method() === "POST";
  });
  await button.click();
  let response: Awaited<typeof responsePromise>;
  try {
    response = await responsePromise;
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      buttonDisabled: (document.activeElement as HTMLButtonElement | null)?.disabled ?? null,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim() ?? ""),
      readyState: document.readyState,
      pageText: document.body.innerText.slice(0, 1200),
    })).catch(() => null);
    await mkdir(path.join(OUTPUT_DIR, "screenshots"), { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, "screenshots", `failure-${action}.png`), fullPage: true }).catch(() => undefined);
    throw new Error(`Operator action ${action} produced no POST response. UI diagnostics: ${JSON.stringify(diagnostics)}. ${String(error)}`);
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
  await waitForAction(page, "template_approve", templateCard.getByRole("button", { name: "Approve template v1" }));

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
  await waitForAction(page, "journey_activate", page.getByRole("button", { name: "Activate version" }).first());
  const activatedJourneyOption = page.getByLabel("Journey version").locator("option").filter({ hasText: journeyName + " v1" });
  try {
    await expect(activatedJourneyOption).toHaveCount(1, { timeout: 30000 });
  } catch (error) {
    const options = await page.getByLabel("Journey version").locator("option").allTextContents().catch(() => []);
    const alert = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    throw new Error(`Activated journey did not appear in the review selector. Current options=${JSON.stringify(options)}; alerts=${JSON.stringify(alert)}. ${String(error)}`);
  }
  await page.getByLabel("Journey version").selectOption({ label: journeyName + " v1" });
  return journeyName;
}

async function createDraft(pool: Pool, page: Page, journeyName: string, prospect: ProspectFixture): Promise<void> {
  await page.getByLabel("Journey version").selectOption({ label: journeyName + " v1" });
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
  await card.getByLabel("Eligibility evidence for this prospect").fill("Synthetic evidence for local walkthrough only.");
  await waitForAction(page, "eligibility", card.getByRole("button", { name: "Record eligible" }));
  await card.getByLabel("Individual release basis").fill("Synthetic walkthrough approval basis.");
  await waitForAction(page, "release", card.getByRole("button", { name: "Release this prospect" }));
}

async function postAction(context: BrowserContext, data: Record<string, unknown>): Promise<APIResponse> {
  return context.request.post(APP_ORIGIN + API_PATH, { data });
}

async function dispatchFake(
  context: BrowserContext,
  token: string,
  input: { workerId: string; limit?: number; now?: string; outcomePlan?: Array<Record<string, unknown>> },
): Promise<Record<string, number>> {
  const response = await context.request.post(APP_ORIGIN + TEST_DISPATCH_PATH, { data: { ...input, token } });
  if (!response.ok()) throw new Error("Local fake dispatcher endpoint returned HTTP " + response.status() + ".");
  return await response.json() as Record<string, number>;
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
        const words: Array<{ top: number; left: number; right: number }> = [];
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            for (const rect of range.getClientRects()) if (rect.width && rect.height) words.push({ top: rect.top, left: rect.left, right: rect.right });
          }
        }
        const lines: Array<typeof words> = [];
        for (const word of words) {
          const line = lines.find((candidate) => Math.abs(candidate[0].top - word.top) <= 1);
          if (line) line.push(word); else lines.push([word]);
        }
        lines.sort((a, b) => a[0].top - b[0].top);
        if (lines.length > 1 && lines.at(-1)!.length === 1) failures.push(tag + ": single-word final line");
        for (let index = 0; index < lines.length - 1; index += 1) {
          const line = lines[index];
          const width = Math.max(...line.map((word) => word.right)) - Math.min(...line.map((word) => word.left));
          const remaining = right - Math.max(...line.map((word) => word.right));
          if (width < (right - left) * 0.75 && lines[index + 1][0].right - lines[index + 1][0].left + 5 <= remaining) {
            failures.push(tag + ": avoidably short nonfinal line");
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
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(180_000);
  const responseFailures: string[] = [];
  page.on("pageerror", (error) => responseFailures.push("page error: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") responseFailures.push("browser console: " + message.text());
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/_next/")) responseFailures.push(`asset request failed: ${pathname}; ${request.failure()?.errorText ?? "unknown"}`);
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes("/_next/") && response.status() >= 400) responseFailures.push(`asset response ${response.status()}: ${pathname}`);
  });
  progress(`opening actual operator queue UI (${Math.floor(remainingMs() / 1000)}s overall budget remains)`);
  await page.goto(APP_ORIGIN + "/admin/agency-crm/follow-up", { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.locator('[data-ui-component-content="agency-follow-up-queue"]').waitFor();
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
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
    await page.screenshot({ path: path.join(OUTPUT_DIR, "screenshots", "failure-hydration.png"), fullPage: true }).catch(() => undefined);
    throw new Error(`Operator UI did not hydrate its controlled template input. Diagnostics: ${JSON.stringify(diagnostics)}; browserErrors=${JSON.stringify(responseFailures.slice(0, 20))}. ${String(error)}`);
  }

  const journeyName = await authorJourney(page);
  const normal = fixtures.prospects.normal;
  await createDraft(pool, page, journeyName, normal);
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
  const normalMessages = await pool.query<{ id: string; step_number: number; state: string }>(
    "select id,step_number,state from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) order by step_number",
    [normal.id],
  );
  if (normalMessages.rows.length !== 2 || normalMessages.rows.some((row) => row.state !== "scheduled")) {
    throw new Error("The normal two-step flow did not reach per-message scheduled review.");
  }
  const firstNormalMessage = normalMessages.rows[0];
  await pool.query("update agency_followup_messages set scheduled_at=now()-interval '1 minute' where id=$1", [firstNormalMessage.id]);

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

  const acceptedResult = await dispatchFake(context, walkthroughToken, { workerId: "synthetic-walkthrough-accepted", limit: 10 });
  const accepted = await pool.query<{ state: string; provider_message_id: string | null }>(
    "select state,provider_message_id from agency_followup_messages where id=$1",
    [firstNormalMessage.id],
  );
  if (acceptedResult.accepted !== 1 || accepted.rows[0]?.state !== "accepted" || !accepted.rows[0]?.provider_message_id?.startsWith("fake-provider-")) {
    throw new Error("Normal fake-provider dispatch did not persist an accepted synthetic outcome.");
  }

  const pauseProspect = fixtures.prospects.pause;
  await createDraft(page, journeyName, pauseProspect);
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
  await createDraft(page, journeyName, suppressed);
  await markEligibleAndReleaseAttempt(page, suppressed);
  const suppressedEnrollment = await pool.query<{ state: string; released_at: string | null }>(
    "select state,released_at from agency_followup_enrollments where prospect_id=$1",
    [suppressed.id],
  );
  if (suppressedEnrollment.rows[0]?.state !== "draft" || suppressedEnrollment.rows[0]?.released_at !== null ||
    !(await page.getByRole("alert").innerText()).includes("suppress")) {
    throw new Error("Suppression did not remain visible and block release.");
  }

  const unknownProspect = fixtures.prospects.unknown;
  await createDraft(page, journeyName, unknownProspect);
  await markEligibleAndRelease(page, unknownProspect);
  await waitForAction(page, "approve", queueCard(page, unknownProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const unknownMessage = await pool.query<{ id: string }>(
    "select id from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) and step_number=1",
    [unknownProspect.id],
  );
  await pool.query("update agency_followup_messages set scheduled_at=now()-interval '1 minute' where id=$1", [unknownMessage.rows[0].id]);
  const unknownResult = await dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-unknown",
    limit: 1,
    outcomePlan: [{ kind: "unknown", detail: "synthetic interruption after fake handoff" }],
  });
  const unknownRow = await pool.query<{ state: string; unknown_since: string | null }>(
    "select state,unknown_since from agency_followup_messages where id=$1",
    [unknownMessage.rows[0].id],
  );
  const reclaimed = await pool.query(
    "select * from public.claim_agency_followup_messages('synthetic-walkthrough-no-retry',now()+interval '1 day',120,10)",
  );
  if (unknownResult.unknown !== 1 || unknownRow.rows[0]?.state !== "unknown" || !unknownRow.rows[0]?.unknown_since || reclaimed.rows.length !== 0) {
    throw new Error("UNKNOWN provider outcome was not quarantined or was automatically reclaimed.");
  }

  // Exercise actual schedule policy immediately before handoff with a delayed
  // weekend claim. The current weekday/window come from the persisted journey.
  const windowProspect = fixtures.prospects.window;
  await createDraft(page, journeyName, windowProspect);
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
  const windowResult = await dispatchFake(context, walkthroughToken, {
    workerId: "synthetic-walkthrough-window",
    now: weekendNow,
    limit: 1,
  });
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
  await createDraft(page, journeyName, leaseProspect);
  await markEligibleAndRelease(page, leaseProspect);
  await waitForAction(page, "approve", queueCard(page, leaseProspect.firmName).getByRole("button", { name: "Approve this message" }).nth(0));
  const leaseMessage = await pool.query<{ id: string }>(
    "select id from agency_followup_messages where enrollment_id=(select id from agency_followup_enrollments where prospect_id=$1) and step_number=1",
    [leaseProspect.id],
  );
  await pool.query("update agency_followup_messages set scheduled_at=now()-interval '1 minute' where id=$1", [leaseMessage.rows[0].id]);
  const [claimA, claimB] = await Promise.all([
    pool.query("select id,lease_owner from public.claim_agency_followup_messages('synthetic-lease-a',now(),120,1)"),
    pool.query("select id,lease_owner from public.claim_agency_followup_messages('synthetic-lease-b',now(),120,1)"),
  ]);
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
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const failures = await auditRenderedCopy(page);
    if (failures.length) throw new Error(`Rendered UI gate failed at ${width}px: ${failures.join("; ")}`);
    await page.screenshot({ path: path.join(screenshotDir, `queue-${width}.png`), fullPage: true });
    renderedWidths.push(width);
  }
  if (responseFailures.length) throw new Error(responseFailures.join("; "));
  const summary = {
    synthetic: true,
    provider: "fake-only",
    migrationVersions: ["20261013154000", "20261013230354"],
    verifiedMigrationBlobs: [EXPECTED_MIGRATION_BLOB, EXPECTED_CRM_GRANTS_MIGRATION_BLOB],
    flows: {
      templateJourneyEnrollmentReleaseApproval: "passed",
      repeatedEnrollment: "409 and one enrollment",
      pause: "approved message cancelled; unapproved message preserved for review",
      suppression: "release blocked",
      approvalInvalidation: "content change cleared reviewer and reopened review",
      fakeAccepted: "persisted",
      unknown: "quarantined and not reclaimed",
      businessDayWindow: "weekend claim rescheduled before fake provider",
      concurrentClaim: "exactly one claim",
      staleLeaseOwner: "rejected",
    },
    syntheticProspects: Object.keys(fixtures.prospects).length,
    screenshotViewports: renderedWidths,
    screenshotCount: renderedWidths.length,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(path.join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  return summary;
  } finally {
    await context.close();
    await browser.close();
    if (activeBrowser === browser) activeBrowser = undefined;
  }
}

async function markEligibleAndReleaseAttempt(page: Page, prospect: ProspectFixture): Promise<void> {
  const card = queueCard(page, prospect.firmName);
  await card.getByLabel("Eligibility evidence for this prospect").fill("Synthetic evidence for local walkthrough only.");
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

async function runManual(context: BrowserContext, fixtures: Fixtures): Promise<void> {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(180_000);
  await page.goto(APP_ORIGIN + "/admin/agency-crm/follow-up", { waitUntil: "domcontentloaded", timeout: 180_000 });
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

async function main(): Promise<void> {
  progress("validating disposable local-only confirmation");
  if (must(process.env.AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION, "Disposable database confirmation") !== "YES-LOCAL-DISPOSABLE-ONLY") {
    throw new Error("Set AGENCY_FOLLOWUP_DISPOSABLE_DATABASE_CONFIRMATION=YES-LOCAL-DISPOSABLE-ONLY for this disposable local walkthrough.");
  }
  absoluteDeadline = Date.now() + WALKTHROUGH_TIMEOUT_MS;
  progress("verifying pushed migration blobs");
  await verifyPushedMigration(MIGRATION_PATH, EXPECTED_MIGRATION_BLOB);
  await verifyPushedMigration(CRM_GRANTS_MIGRATION_PATH, EXPECTED_CRM_GRANTS_MIGRATION_BLOB);
  progress("loading the pinned loopback endpoint and local key in process memory");
  const status = getSupabaseStatus();
  progress("local key loaded from the isolated auth container without logging its value");
  await verifyLocalPostgrest(status);
  const portalSecret = randomBytes(32).toString("hex") + "-test-only";
  const walkthroughToken = randomBytes(32).toString("hex") + "-test-only";
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
    await waitForApp(server, fixtures, portalSecret);
    progress("authenticated API is ready; opening actual operator queue UI");
    if (MANUAL) {
      browser = await chromium.launch({ headless: false });
      activeBrowser = browser;
      context = await signedContext(browser, fixtures, portalSecret);
      await runManual(context, fixtures);
      return;
    }
    const summary = await runBrowserWalkthrough(pool, fixtures, portalSecret, walkthroughToken);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await context?.close();
    await browser?.close();
    if (activeBrowser === browser) activeBrowser = undefined;
    stopApp(server);
    if (activeNextServer === server) activeNextServer = undefined;
  }
  } finally {
    if (hardStop) clearTimeout(hardStop);
    await pool.end().catch(() => undefined);
    await removeTemporaryDispatchRoute().catch(() => undefined);
    runAbortController = undefined;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown walkthrough failure.";
  console.error("Agency follow-up synthetic walkthrough failed: " + message);
  process.exitCode = 1;
});
