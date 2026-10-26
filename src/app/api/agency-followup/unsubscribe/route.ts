import "server-only";

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT,
  verifyAgencyFollowupUnsubscribeToken,
} from "@/lib/agency-followup-unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://app.caseloadselect.ca; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function htmlPage(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;padding:40px 20px;background:#f4f3ef;color:#1e2f58;font-family:Arial,Helvetica,sans-serif}
main{max-width:480px;margin:0 auto;background:#fff;padding:28px;border-top:3px solid #1e2f58}
h1{font-size:21px;margin:0 0 12px}p{font-size:15px;line-height:1.6}
button{border:0;background:#1e2f58;color:#fff;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

function genericError(status: number): NextResponse {
  return htmlPage(
    "Email preferences",
    "<h1>We could not verify this request.</h1><p>Please use the unsubscribe link in the original email again or reply to that email so we can stop follow-up.</p>",
    status,
  );
}

function getIdentity(request: NextRequest) {
  return verifyAgencyFollowupUnsubscribeToken(
    new URL(request.url).searchParams.get("token"),
    process.env.AGENCY_FOLLOWUP_UNSUBSCRIBE_SECRET,
  );
}

async function readBoundedFormBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 1024) {
        await reader.cancel("form body exceeds the limit").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  const identity = getIdentity(request);
  if (!token || !identity) return genericError(404);

  const action = new URL(AGENCY_FOLLOWUP_UNSUBSCRIBE_ENDPOINT);
  action.searchParams.set("token", token);
  const actionAttribute = action.toString().replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
  return htmlPage(
    "Email preferences",
    `<h1>Stop CaseLoad Select follow-up</h1>
<p>Select the button below to stop further Agency follow-up email for this address.</p>
<form method="post" action="${actionAttribute}">
<input type="hidden" name="List-Unsubscribe" value="One-Click">
<button type="submit">Unsubscribe</button>
</form>`,
  );
}

export async function POST(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  const identity = getIdentity(request);
  if (!token || !identity) return genericError(400);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return genericError(400);

  const body = await readBoundedFormBody(request);
  if (body === null) return genericError(400);
  const form = new URLSearchParams(body);
  const unsubscribeValues = form.getAll("List-Unsubscribe");
  if (unsubscribeValues.length !== 1 || unsubscribeValues[0] !== "One-Click") return genericError(400);

  const tokenSha256 = createHash("sha256").update(token, "utf8").digest("hex");
  let result;
  try {
    result = await supabaseAdmin.rpc("record_agency_followup_recipient_unsubscribe", {
      p_message_id: identity.messageId,
      p_enrollment_id: identity.enrollmentId,
      p_recipient_email_sha256: identity.recipientEmailSha256,
      p_token_sha256: tokenSha256,
    });
  } catch {
    return genericError(503);
  }
  if (result.error) return genericError(503);
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row || typeof row.event_id !== "string" || typeof row.replayed !== "boolean") return genericError(503);

  return htmlPage(
    "Unsubscribed",
    "<h1>You have been unsubscribed.</h1><p>Future Agency follow-up sends to this address are stopped. A message that was already being sent may still arrive.</p>",
  );
}
