import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { validateSameOrigin } from "@/lib/client-import-server";
import { getOperatorSession, type PortalSession } from "@/lib/portal-auth";

export const PROSPECT_ENRICHMENT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProspectEnrichmentOperator = Readonly<{
  id: string;
  session: PortalSession;
}>;

export type ProspectEnrichmentAuthResult =
  | Readonly<{ ok: true; operator: ProspectEnrichmentOperator }>
  | Readonly<{ ok: false; response: NextResponse }>;

export function prospectEnrichmentJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PROSPECT_ENRICHMENT_NO_STORE_HEADERS });
}

export async function requireProspectEnrichmentOperator(
  request: NextRequest,
  mutation = false,
): Promise<ProspectEnrichmentAuthResult> {
  const session = await getOperatorSession();
  if (!session) {
    return { ok: false, response: prospectEnrichmentJson({ error: "Unauthorized" }, 401) };
  }
  if (mutation && !validateSameOrigin(request)) {
    return { ok: false, response: prospectEnrichmentJson({ error: "Invalid request origin." }, 403) };
  }
  const operatorId = session.lawyer_id;
  if (!operatorId || !UUID.test(operatorId)) {
    return { ok: false, response: prospectEnrichmentJson({ error: "An operator identity is required." }, 403) };
  }
  return { ok: true, operator: { id: operatorId, session } };
}

export type BoundedJsonResult =
  | Readonly<{ ok: true; text: string; value: unknown }>
  | Readonly<{ ok: false; status: 400 | 413; error: string }>;

/** Read at most the declared body limit before parsing JSON. */
export async function readBoundedJson(request: Request, limitBytes: number): Promise<BoundedJsonResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > limitBytes) {
    return { ok: false, status: 413, error: "Request body exceeds the allowed size." };
  }

  if (!request.body) return { ok: false, status: 400, error: "A JSON request body is required." };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limitBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "Request body exceeds the allowed size." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Request body could not be read." };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400, error: "Request body must be valid UTF-8 JSON." };
  }

  try {
    return { ok: true, text, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Request body must contain valid JSON." };
  }
}

export function unexpectedEnrichmentError(operation: string): { error: string; errorId: string } {
  const errorId = randomUUID();
  console.error("[prospect-enrichment] operation failed", { operation, errorId });
  return { error: "Prospect research could not be loaded or saved.", errorId };
}
