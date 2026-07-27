/**
 * Receives Vercel's deployment.created webhook. Free-tier Vercel cannot
 * technically block alias assignment on this project (the Checks API
 * requires an integration OAuth token, not a personal access token,
 * confirmed 2026-07-22; Rolling Releases requires a paid plan upgrade,
 * also confirmed 2026-07-22). Prevention of direct production deploys now
 * lives elsewhere: a Claude Code PreToolUse hook
 * (D:/00_Work/01_CaseLoad_Select/.claude/hooks/check-deploy-commands.mjs)
 * blocks the commands before they run, and AGENTS.md carries the same rule
 * for agents outside Claude Code.
 *
 * This route is the detection layer for whatever slips through: for
 * production-target deployments only, it schedules a background check
 * (evaluateAndAlarm) that emails the operator within about a minute if the
 * deployment is dirty-tree, untraceable, or fails its GitHub Actions
 * checks. A clean deployment produces no email.
 *
 * Signed by Vercel via x-vercel-signature (HMAC-SHA1 over the raw body,
 * VERCEL_WEBHOOK_SECRET). Ack fast, evaluate in the background: GitHub
 * Actions CI on this repo takes a few minutes, well past a single
 * invocation's budget.
 *
 * Test-fire mode (2026-07-23): a request carrying
 * "Authorization: Bearer <ALARM_TEST_SECRET>" with body
 * {"type":"synthetic.alarm-test"} bypasses the HMAC check and schedules
 * the same background pipeline against a fixed fake deployment id. The
 * metadata fetch cannot resolve that id, so the alarm arm (Vercel API
 * miss, Resend send, operator inbox) fires end to end with a [TEST]
 * subject tag and no deployment involved. The real Vercel webhook never
 * sends an Authorization header, so this branch cannot shadow real
 * events. ALARM_TEST_SECRET is deliberately a normal encrypted env var,
 * not Sensitive: its blast radius is a test email to the operator inbox,
 * and keeping it readable lets any session run the drill without secret
 * archaeology. VERCEL_WEBHOOK_SECRET stays Sensitive.
 */

import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { requiresGate } from "@/lib/deploy-gate/verify";
import { evaluateAndAlarm } from "@/lib/deploy-gate/resolve";

// 300s matches the proven precedent already live on this plan
// (src/app/api/tools/seo-check/route.ts). The original design assumed an
// 8-minute poll window; that duration was never achievable on any Vercel
// function regardless of plan tier without this export, and the function
// would have been killed mid-poll long before 8 minutes on most plans.
// resolve.ts's MAX_WAIT_MS is kept safely under this ceiling.
export const maxDuration = 300;

// Fixed fake deployment id for the test-fire drill. getDeploymentInfo
// cannot resolve it (404 at the Vercel API), which drives the
// "deployment metadata unavailable" alarm, the exact arm this drill
// exists to prove.
const TEST_DEPLOYMENT_ID = "dpl_SYNTHETIC_ALARM_TEST";

interface VercelWebhookPayload {
  type: string;
  payload: {
    deployment?: { id: string };
    target?: string | null;
  };
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function handleTestFire(token: string, rawBody: string): Response {
  const secret = process.env.ALARM_TEST_SECRET;
  // One shared 403 for "not configured" and "wrong token" so the response
  // does not reveal whether test mode exists on this deployment.
  if (!secret || !timingSafeEquals(token, secret)) {
    return Response.json({ error: "invalid_test_token" }, { status: 403 });
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_test_body" }, { status: 400 });
  }
  if ((json as { type?: string }).type !== "synthetic.alarm-test") {
    return Response.json({ error: "invalid_test_body" }, { status: 400 });
  }
  waitUntil(evaluateAndAlarm(TEST_DEPLOYMENT_ID, { subjectTag: "[TEST]" }));
  return Response.json({ ok: true, mode: "alarm-test" });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return handleTestFire(authHeader.slice("Bearer ".length), rawBody);
  }

  const signature = request.headers.get("x-vercel-signature");

  if (!verifySignature(rawBody, signature)) {
    return Response.json({ error: "invalid_signature" }, { status: 403 });
  }

  const json = JSON.parse(rawBody) as VercelWebhookPayload;

  if (json.type !== "deployment.created") {
    return Response.json({ ok: true, skipped: "not_deployment_created" });
  }

  const deploymentId = json.payload.deployment?.id;
  if (!deploymentId) {
    return Response.json({ ok: true, skipped: "no_deployment_id" });
  }

  if (!requiresGate({ target: json.payload.target ?? null })) {
    return Response.json({ ok: true, skipped: "not_production" });
  }

  waitUntil(evaluateAndAlarm(deploymentId));

  return Response.json({ ok: true, mode: "alarm" });
}
