import type { IncomingMessage, ServerResponse } from "node:http";
import { assertNoApplicationSecrets, isRenderRequestAuthorized } from "../auth";
import { browserStartupSmoke } from "../renderer";

assertNoApplicationSecrets();

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const authorizationHeader =
    typeof req.headers.authorization === "string" ? req.headers.authorization : null;
  if (!isRenderRequestAuthorized(authorizationHeader)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const result = await browserStartupSmoke();
  res.statusCode = result.ok ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(result));
}