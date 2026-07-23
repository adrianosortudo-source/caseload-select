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

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
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
