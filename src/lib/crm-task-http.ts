import "server-only";
/** Bound chunked and declared bodies before parsing. Never log request content. */
export async function readCrmTaskJson(request: Request, maxBytes = 40_000): Promise<Record<string, unknown>> {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || request.headers.get("content-type") !== "application/json" || Number(request.headers.get("content-length") ?? 0) > maxBytes) throw Error("crm_task_invalid");
  const reader = request.body?.getReader();
  if (!reader) throw Error("crm_task_invalid");
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw Error("crm_task_invalid"); }
    chunks.push(value);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("crm_task_invalid");
  return body as Record<string, unknown>;
}
