/**
 * Receives Vercel's deployment.created webhook and, for production-target
 * deployments only, registers a blocking check that Vercel will not assign
 * the production alias without. Ships the corrective action for issue #61:
 * a direct `vercel --prod` from a dirty tree can no longer reach
 * app.caseloadselect.ca without a green GitHub Actions run on the exact
 * committed (non-dirty) tree.
 *
 * Signed by Vercel via x-vercel-signature (HMAC-SHA1 over the raw body,
 * VERCEL_WEBHOOK_SECRET). Ack fast, resolve in the background: GitHub
 * Actions CI on this repo takes a few minutes, well past a single
 * invocation's budget.
 */

import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { requiresGate } from "@/lib/deploy-gate/verify";
import { createDeploymentCheck } from "@/lib/deploy-gate/vercel-api";
import { resolveDeployGate, CHECK_NAME } from "@/lib/deploy-gate/resolve";

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

  const checkId = await createDeploymentCheck(deploymentId, CHECK_NAME);
  if (!checkId) {
    // Fail closed: could not register the blocking check at all. Vercel
    // still has no succeeded check for this deployment, so the alias
    // assignment stays blocked; nothing further to do here.
    return Response.json({ ok: false, error: "check_creation_failed" }, { status: 502 });
  }

  waitUntil(resolveDeployGate(deploymentId, checkId));

  return Response.json({ ok: true, checkId });
}
