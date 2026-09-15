import { NextRequest, NextResponse } from "next/server";
import {
  createPreviewQaSession,
  isPreviewQaBootstrapAuthorized,
  recordPreviewQaAudit,
} from "@/lib/preview-qa-auth";
import { PREVIEW_QA_COOKIE_NAME } from "@/lib/preview-qa-policy";

export const dynamic = "force-dynamic";

function denied(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Creates a short-lived, host-only preview QA session. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const hostname = req.nextUrl.hostname;
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    recordPreviewQaAudit("denied", { audience: hostname });
    return denied();
  }

  let accessSecret = "";
  let bootstrapNonce = "";
  try {
    const body = await req.json() as { accessSecret?: unknown; bootstrapNonce?: unknown };
    accessSecret = typeof body.accessSecret === "string" ? body.accessSecret : "";
    bootstrapNonce = typeof body.bootstrapNonce === "string" ? body.bootstrapNonce : "";
  } catch {
    recordPreviewQaAudit("denied", { audience: hostname });
    return denied();
  }
  if (!isPreviewQaBootstrapAuthorized(hostname, accessSecret, bootstrapNonce)) {
    recordPreviewQaAudit("denied", { audience: hostname });
    return denied();
  }

  const issued = await createPreviewQaSession(
    hostname,
    bootstrapNonce,
    req.cookies.get(PREVIEW_QA_COOKIE_NAME)?.value,
  );
  if (!issued) {
    recordPreviewQaAudit("denied", { audience: hostname });
    return denied();
  }

  recordPreviewQaAudit("issued", {
    audience: issued.session.audience,
    session_id: issued.session.session_id,
  });
  const response = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
  response.cookies.set(issued.name, issued.value, issued.options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
