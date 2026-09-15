import { NextRequest, NextResponse } from "next/server";

import { constantTimeEquals } from "@/lib/cron-auth";
import { stageGtaProspectAgentDraft } from "@/lib/gta-prospect-agent-draft-inbox";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function agentAuthorized(request: NextRequest): boolean {
  const expected = process.env.GTA_PROSPECT_AGENT_DRAFT_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const presented = authorization.slice("Bearer ".length).trim();
  return Boolean(presented) && constantTimeEquals(presented, expected);
}

function actor(): string {
  const configured = process.env.GTA_PROSPECT_AGENT_DRAFT_ACTOR?.trim().toLocaleLowerCase("en-CA") ?? "authorized-agent";
  return /^[-_a-z0-9]{1,120}$/.test(configured) ? configured : "authorized-agent";
}

async function payload(request: NextRequest): Promise<{ sourceName: string; records: unknown[]; sourceSha256?: string } | { error: string; status: number }> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { error: "The draft package is larger than the 2 MB limit.", status: 413 };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: "Expected a JSON object with sourceName and records.", status: 400 }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Expected a JSON object with sourceName and records.", status: 400 };
  const item = value as Record<string, unknown>;
  const unexpected = Object.keys(item).filter((key) => !["sourceName", "records", "sourceSha256"].includes(key));
  if (unexpected.length) return { error: `Unexpected field(s): ${unexpected.join(", ")}.`, status: 400 };
  if (typeof item.sourceName !== "string" || !Array.isArray(item.records)) return { error: "sourceName and records are required.", status: 400 };
  if (item.sourceSha256 !== undefined && (typeof item.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceSha256))) return { error: "sourceSha256 must be a lowercase SHA-256 value when supplied.", status: 400 };
  return { sourceName: item.sourceName, records: item.records, sourceSha256: item.sourceSha256 as string | undefined };
}

/**
 * Bounded external intake. A valid token may stage a reviewed public-evidence
 * package, but this route cannot create firms, contacts, CRM entries, messages,
 * contact submissions, chat sessions, outreach, or canonical imports.
 */
export async function POST(request: NextRequest) {
  if (!agentAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  const parsed = await payload(request);
  if ("error" in parsed) return json({ error: parsed.error }, parsed.status);
  try {
    const receipt = await stageGtaProspectAgentDraft({
      submittedBy: actor(), sourceName: parsed.sourceName, idempotencyKey: key,
      records: parsed.records, expectedPayloadSha256: parsed.sourceSha256,
    });
    return json({
      mode: receipt.state, draftId: receipt.draftId, payloadSha256: receipt.payloadSha256,
      state: receipt.review.summary.invalid || receipt.review.summary.duplicate || receipt.review.summary.reviewRequired ? "review_required" : "ready_for_operator",
      summary: receipt.review.summary,
      note: "The package is private staging only. An operator must review and explicitly import it before any prospect record changes.",
    }, receipt.state === "created" ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI draft could not be staged.";
    const status = /^(submittedBy|sourceName|Idempotency-Key|sourceSha256|Submit)\b/.test(message) ? 400 : 503;
    console.error("[gta-prospect-agent-draft-inbox] stage failed", error);
    return json({ error: message, note: "No prospect, contact, CRM, or outreach record was changed." }, status);
  }
}
