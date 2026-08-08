import { isRenderRequestAuthorized } from "./auth";
import { validateOutboundUrl } from "./ssrf";
import { renderUrl as realRenderUrl } from "./renderer";
import type { RenderRunResult } from "./render-types";

/**
 * The service's request-handling logic, kept independent of any HTTP
 * framework object (no IncomingMessage/ServerResponse, no VercelRequest)
 * so it is directly unit-testable: every branch below (auth, validation,
 * SSRF pre-check, concurrency, timeout, render failure) is exercised in
 * __tests__/handle-render-request.test.ts by calling this function with
 * plain data and an injected renderFn, never a real browser or real
 * network. api/render.ts is the thin adapter that turns a real Node.js
 * request into the RenderRequestInput this expects and writes the
 * returned RenderResponse back out.
 *
 * Error shape and status codes follow the isolation spec's §4.4 table
 * (CaseLoadSelect_RendererIsolation_Spec_2026-08-07.md): structured JSON,
 * never a stack trace, so a probing client learns nothing beyond the
 * documented reason code.
 */

export interface RenderRequestInput {
  method: string;
  authorizationHeader: string | null;
  /** Raw body text, not yet JSON-parsed -- parsing happens here so a
   * malformed body is a 400, not an unhandled adapter-level throw. */
  rawBody: string;
}

export type RenderErrorReason =
  | "method_not_allowed"
  | "malformed_json"
  | "missing_url"
  | "invalid_url"
  | "unauthorized"
  | "url_blocked"
  | "concurrency_exceeded"
  | "render_timeout"
  | "render_failed";

export interface RenderErrorBody {
  error: RenderErrorReason;
  message: string;
}

export interface RenderResponse {
  status: number;
  body: RenderRunResult | RenderErrorBody;
}

const REASON_STATUS: Record<RenderErrorReason, number> = {
  method_not_allowed: 400,
  malformed_json: 400,
  missing_url: 400,
  invalid_url: 400,
  unauthorized: 401,
  url_blocked: 403,
  concurrency_exceeded: 429,
  render_timeout: 504,
  render_failed: 422,
};

function errorResponse(reason: RenderErrorReason, message: string): RenderResponse {
  return { status: REASON_STATUS[reason], body: { error: reason, message } };
}

export interface HandleRenderRequestOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to the real browser-launching renderUrl. */
  renderFn?: (url: string) => Promise<RenderRunResult>;
  /** Hard wall-clock budget for a single render, independent of the
   * platform's own function timeout -- this is what turns a stuck
   * render into a clean 504 response instead of the platform silently
   * killing the whole function with no response at all. Set below
   * vercel.json's maxDuration (300s) so this response wins the race. */
  renderTimeoutMs?: number;
  /** Concurrent in-flight renders this instance will accept before
   * returning 429. A real headless-Chromium render at two viewports is
   * memory- and CPU-heavy; a small cap protects one warm instance from
   * being driven into OOM or starvation by concurrent requests, and is
   * cheap insurance against the abuse case Upstash-style rate limiting
   * would otherwise need a whole separate dependency to cover. */
  maxConcurrentRenders?: number;
  /** Shared across calls sharing one instance; tests pass a fresh
   * object per call to keep cases independent. */
  concurrencyState?: { inFlight: number };
}

const DEFAULT_RENDER_TIMEOUT_MS = 280_000; // stays under vercel.json's 300s maxDuration
const DEFAULT_MAX_CONCURRENT_RENDERS = 2;

// Shared across invocations of the real handler within one warm instance.
// A module-level singleton is correct here (not per-request state): the
// whole point is bounding how many renders THIS instance is doing at
// once, which only means something as shared mutable state. Tests never
// touch this directly -- they pass their own concurrencyState via
// HandleRenderRequestOptions so cases stay isolated from each other and
// from whatever the real handler's module-level counter is doing.
const productionConcurrencyState = { inFlight: 0 };

function parseUrlField(rawBody: string): { ok: true; url: string } | { ok: false; response: RenderResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, response: errorResponse("malformed_json", "Request body is not valid JSON.") };
  }
  if (typeof parsed !== "object" || parsed === null || !("url" in parsed)) {
    return { ok: false, response: errorResponse("missing_url", 'Request body must be a JSON object with a "url" field.') };
  }
  const url = (parsed as { url: unknown }).url;
  if (typeof url !== "string" || url.trim().length === 0) {
    return { ok: false, response: errorResponse("missing_url", '"url" must be a non-empty string.') };
  }
  try {
    // eslint-disable-next-line no-new -- validating parseability only
    new URL(url);
  } catch {
    return { ok: false, response: errorResponse("invalid_url", '"url" is not a valid absolute URL.') };
  }
  return { ok: true, url };
}

export async function handleRenderRequest(
  input: RenderRequestInput,
  opts: HandleRenderRequestOptions = {}
): Promise<RenderResponse> {
  if (input.method !== "POST") {
    return errorResponse("method_not_allowed", "Only POST is supported.");
  }

  if (!isRenderRequestAuthorized(input.authorizationHeader, opts.env)) {
    return errorResponse("unauthorized", "Missing or invalid bearer token.");
  }

  const parsed = parseUrlField(input.rawBody);
  if (!parsed.ok) return parsed.response;

  // Defence in depth: the main app already SSRF-checks the domain before
  // ever calling this service (route.ts's existing pre-check stays in
  // place per the build plan), but this service cannot trust its caller
  // -- a future second caller, a misconfigured retry, or a bug upstream
  // must not be able to reach an internal address just because the main
  // app's own check was skipped or wrong. This sync check catches literal
  // blocked IPs and blocklisted hostnames before a browser is ever
  // launched; the DNS-pinned per-hop check inside guardContextRoutes
  // (renderer.ts) covers the deeper rebinding case for the navigation
  // itself and every redirect and subresource within the render.
  const urlCheck = validateOutboundUrl(new URL(parsed.url), { allowedSchemes: ["http:", "https:"] });
  if (!urlCheck.ok) {
    return errorResponse("url_blocked", "That URL cannot be rendered.");
  }

  const state = opts.concurrencyState ?? productionConcurrencyState;
  const maxConcurrent = opts.maxConcurrentRenders ?? DEFAULT_MAX_CONCURRENT_RENDERS;
  if (state.inFlight >= maxConcurrent) {
    return errorResponse("concurrency_exceeded", "Too many renders in progress. Try again shortly.");
  }

  const renderFn = opts.renderFn ?? realRenderUrl;
  const timeoutMs = opts.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;

  state.inFlight++;
  try {
    const result = await Promise.race([
      renderFn(parsed.url),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("render_timeout")), timeoutMs);
      }),
    ]);
    return { status: 200, body: result };
  } catch (err) {
    if (err instanceof Error && err.message === "render_timeout") {
      return errorResponse("render_timeout", "Rendering this site exceeded the time budget.");
    }
    return errorResponse("render_failed", "Could not render this site.");
  } finally {
    state.inFlight--;
  }
}
