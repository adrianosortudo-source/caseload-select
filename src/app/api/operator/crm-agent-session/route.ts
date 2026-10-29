import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CRM_AGENT_COOKIE, CRM_AGENT_ORIGIN } from "@/lib/crm-agent-policy";
import { crmAgentEnabled, crmAgentHash, crmAgentRegistry, isCrmAgentToken } from "@/lib/crm-agent-registry";
import { verifyCrmConsoleWorkflowToken } from "@/lib/crm-agent-github-oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: NextRequest) {
  if (!crmAgentEnabled()) return NextResponse.json({ error: "Unavailable" }, { status: 404, headers: responseHeaders });
  if (new URL(request.url).origin !== CRM_AGENT_ORIGIN || request.headers.get("origin") !== CRM_AGENT_ORIGIN ||
      request.headers.get("content-type") !== "application/json" || Number(request.headers.get("content-length") ?? 0) > 20_000) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: responseHeaders });
  }
  try {
    // Bound the streamed body before JSON parsing, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 20_000) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { token?: unknown };
    if (typeof body.token !== "string") throw Error();
    const identity = await verifyCrmConsoleWorkflowToken(body.token);
    const previous = request.cookies.get(CRM_AGENT_COOKIE)?.value;
    if (previous !== undefined && !isCrmAgentToken(previous)) throw Error();
    const raw = randomBytes(32).toString("hex");
    // Only verified nonsecret identity fields reach the registry.
    const session = await crmAgentRegistry({ op: "issue", rotating: previous !== undefined,
      sha: identity.sha, runId: identity.runId, runAttempt: identity.runAttempt, jtiSha256: identity.jtiSha256 },
      await crmAgentHash(raw), previous ? await crmAgentHash(previous) : undefined);
    if (!session) throw Error();
    const response = NextResponse.json({ ok: true }, { headers: responseHeaders });
    response.cookies.set(CRM_AGENT_COOKIE, raw, {
      httpOnly: true, secure: true, sameSite: "strict", path: "/",
      maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    });
    return response;
  } catch {
    // No tokens, decoded claims, provider errors, or cookie values in logs.
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: responseHeaders });
  }
}
