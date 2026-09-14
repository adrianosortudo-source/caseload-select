import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";

import { constantTimeEquals } from "@/lib/cron-auth";
import {
  GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS,
  claimGtaProspectResearchWorkItems,
  deferGtaProspectResearchWorkItem,
  listGtaProspectResearchWorkQueue,
  renewGtaProspectResearchWorkItemLease,
  resolveGtaProspectResearchWorkItem,
  seedGtaProspectResearchWorkQueue,
  sha256GtaProspectResearchQueue,
  validateGtaProspectResearchWorkSeed,
} from "@/lib/gta-prospect-research-work-queue";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const noExternalAction = " No CRM, outreach, contact, form, chat, or intake action was attempted.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

async function operatorAuthorized(): Promise<boolean> {
  return Boolean(await getOperatorSession());
}

function workerAuthorized(request: NextRequest): boolean {
  const expected = process.env.GTA_PROSPECT_RESEARCH_QUEUE_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const presented = authorization.slice("Bearer ".length).trim();
  return Boolean(presented) && constantTimeEquals(presented, expected);
}

function reviewSecret(): string | null {
  return process.env.GTA_PROSPECT_RESEARCH_QUEUE_REVIEW_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

function signedReviewReceipt(requestSha256: string, expiresAt: number, secret: string): string {
  return `${expiresAt}.${createHmac("sha256", secret).update(`${requestSha256}.${expiresAt}`).digest("hex")}`;
}

function validReviewReceipt(receipt: string, requestSha256: string, secret: string): boolean {
  const [expiresText, signature, ...extra] = receipt.split(".");
  if (extra.length || !/^\d{13}$/.test(expiresText ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now() || expiresAt > Date.now() + 20 * 60_000) return false;
  return constantTimeEquals(receipt, signedReviewReceipt(requestSha256, expiresAt, secret));
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try { return object(await request.json()); }
  catch { return null; }
}

function positiveInteger(value: string | null, fallback: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

/** Bounded operator status page. Candidate evidence snapshots are intentionally omitted. */
export async function GET(request: NextRequest) {
  if (!(await operatorAuthorized())) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = positiveInteger(url.searchParams.get("limit"), 50, 100);
  const offset = positiveInteger(url.searchParams.get("offset"), 0, 100_000);
  if (limit === null || limit < 1 || offset === null) return json({ error: "limit must be 1-100 and offset must be 0-100,000." }, 400);
  try {
    return json({ queue: await listGtaProspectResearchWorkQueue({ limit, offset }) });
  } catch (error) {
    console.error("[gta-prospect-research-queue] list failed", error);
    return json({ error: `The research queue could not be loaded.${noExternalAction}` }, 503);
  }
}

/** Zero-write deterministic review. */
export async function POST(request: NextRequest) {
  if (!(await operatorAuthorized())) return json({ error: "Unauthorized" }, 401);
  const payload = await body(request);
  if (!payload || !("seed" in payload)) return json({ error: "Expected a JSON object with a seed." }, 400);
  let seed;
  try { seed = validateGtaProspectResearchWorkSeed(payload.seed); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "The queue seed is invalid." }, 400); }
  const requestSha256 = sha256GtaProspectResearchQueue(seed);
  const secret = reviewSecret();
  if (!secret) return json({ error: `The queue review signer is not configured.${noExternalAction}` }, 503);
  const expiresAt = Date.now() + 15 * 60_000;
  return json({ mode: "dry_run", requestSha256, reviewReceipt: signedReviewReceipt(requestSha256, expiresAt, secret), reviewExpiresAt: new Date(expiresAt).toISOString(), sourceSystem: seed.sourceSystem, sourceSha256: seed.sourceSha256, itemCount: seed.items.length });
}

/** Apply only the exact seed reviewed by POST. Replays are idempotent. */
export async function PUT(request: NextRequest) {
  if (!(await operatorAuthorized())) return json({ error: "Unauthorized" }, 401);
  const payload = await body(request);
  if (!payload || !("seed" in payload) || typeof payload.requestSha256 !== "string" || typeof payload.reviewReceipt !== "string") return json({ error: "Expected a seed, reviewed requestSha256, and signed reviewReceipt." }, 400);
  let seed;
  try { seed = validateGtaProspectResearchWorkSeed(payload.seed); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "The queue seed is invalid." }, 400); }
  const requestSha256 = sha256GtaProspectResearchQueue(seed);
  const secret = reviewSecret();
  if (!secret) return json({ error: `The queue review signer is not configured.${noExternalAction}` }, 503);
  if (payload.requestSha256 !== requestSha256 || !validReviewReceipt(payload.reviewReceipt, requestSha256, secret)) return json({ error: "The review receipt expired or the reviewed queue seed changed. Run review again before applying it." }, 409);
  try {
    const receipt = await seedGtaProspectResearchWorkQueue({ seed });
    return json({ mode: receipt.state, requestSha256, sourceSystem: seed.sourceSystem, sourceSha256: seed.sourceSha256, ...receipt });
  } catch (error) {
    console.error("[gta-prospect-research-queue] seed failed", error);
    return json({ error: `The research queue seed could not be applied.${noExternalAction}` }, 503);
  }
}

/** Autonomous worker lease lifecycle. Every action requires operator or scoped Bearer authorization. */
export async function PATCH(request: NextRequest) {
  if (!workerAuthorized(request) && !(await operatorAuthorized())) return json({ error: "Unauthorized" }, 401);
  const payload = await body(request);
  if (!payload || typeof payload.action !== "string") return json({ error: "Expected a supported queue action." }, 400);
  const workerId = typeof payload.workerId === "string" ? payload.workerId : "";
  if (!workerId) return json({ error: "workerId is required." }, 400);

  try {
    if (payload.action === "claim") {
      if (!Number.isInteger(payload.limit)) return json({ error: "claim requires an integer limit." }, 400);
      const leaseMinutes = payload.leaseMinutes === undefined ? 120 : payload.leaseMinutes;
      if (!Number.isInteger(leaseMinutes)) return json({ error: "leaseMinutes must be an integer." }, 400);
      const items = await claimGtaProspectResearchWorkItems({ workerId, limit: payload.limit as number, leaseMinutes: leaseMinutes as number });
      return json({ mode: "claimed", items });
    }
    if (payload.action === "renew") {
      if (typeof payload.itemId !== "string") return json({ error: "renew requires itemId." }, 400);
      const leaseMinutes = payload.leaseMinutes === undefined ? 120 : payload.leaseMinutes;
      if (!Number.isInteger(leaseMinutes)) return json({ error: "leaseMinutes must be an integer." }, 400);
      const leaseExpiresAt = await renewGtaProspectResearchWorkItemLease({ itemId: payload.itemId, workerId, leaseMinutes: leaseMinutes as number });
      return json({ mode: "renewed", itemId: payload.itemId, leaseExpiresAt });
    }
    if (payload.action === "defer") {
      if (typeof payload.itemId !== "string" || typeof payload.error !== "string" || typeof payload.retryAt !== "string") return json({ error: "defer requires itemId, error, and retryAt." }, 400);
      await deferGtaProspectResearchWorkItem({ itemId: payload.itemId, workerId, error: payload.error, retryAt: payload.retryAt });
      return json({ mode: "deferred", itemId: payload.itemId });
    }
    if (payload.action === "resolve") {
      if (typeof payload.itemId !== "string" || typeof payload.note !== "string" || typeof payload.resolution !== "string" || !GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS.includes(payload.resolution as never)) {
        return json({ error: "resolve requires itemId, note, and a supported resolution." }, 400);
      }
      const canonicalFirmId = payload.canonicalFirmId === null || payload.canonicalFirmId === undefined ? null : typeof payload.canonicalFirmId === "string" ? payload.canonicalFirmId : undefined;
      if (canonicalFirmId === undefined) return json({ error: "canonicalFirmId must be a UUID string or null." }, 400);
      await resolveGtaProspectResearchWorkItem({ itemId: payload.itemId, workerId, resolution: payload.resolution as typeof GTA_PROSPECT_RESEARCH_QUEUE_RESOLUTIONS[number], note: payload.note, canonicalFirmId });
      return json({ mode: "resolved", itemId: payload.itemId, resolution: payload.resolution, canonicalFirmId });
    }
    return json({ error: "Expected claim, renew, defer, or resolve." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("invalid owned GTA prospect research queue lease")) return json({ error: "The queue lease is no longer owned by this worker." }, 409);
    if (/^(workerId|limit|leaseMinutes|canonicalFirmId|retryAt|itemId|resolution|note|error)\b/.test(message)) return json({ error: message }, 400);
    console.error("[gta-prospect-research-queue] worker action failed", error);
    return json({ error: `The research queue action could not be completed.${noExternalAction}` }, 503);
  }
}
