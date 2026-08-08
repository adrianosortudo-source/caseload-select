import type { IncomingMessage, ServerResponse } from "node:http";
import { assertNoApplicationSecrets } from "../auth";
import { handleRenderRequest } from "../handle-render-request";

/**
 * The render service's single HTTP endpoint. A plain Node.js Vercel
 * Serverless Function (Root Directory = services/render, no framework)
 * rather than a Next.js route: the point of this whole service is a
 * smaller surface than the main app, and Next.js itself is one more
 * dependency this zero-application-secret process does not need.
 *
 * assertNoApplicationSecrets runs at module load -- i.e. once per cold
 * start, before the first request this instance ever handles -- so a
 * misconfigured deployment that somehow inherited an application secret
 * (a copy-pasted Vercel env-var group, a shared team default) fails
 * every request loudly rather than quietly rendering hostile content
 * next to a credential it was never supposed to see. See auth.ts and
 * docs/BUILD_PLAN_render_isolation_v1.md §3.3 / acceptance criterion 1.
 */
assertNoApplicationSecrets();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = req.method === "POST" ? await readBody(req).catch(() => "") : "";
  const authorizationHeader = (req.headers.authorization as string | undefined) ?? null;

  const result = await handleRenderRequest({
    method: req.method ?? "",
    authorizationHeader,
    rawBody,
  });

  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(result.body));
}
