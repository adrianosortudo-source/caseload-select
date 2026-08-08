import "server-only";
import type { RenderCapture, RenderRunResult } from "./render-types";

/**
 * The main app's client for the isolated render service (services/render/
 * in this repo, deployed as its own Vercel project -- see
 * docs/BUILD_PLAN_render_isolation_v1.md). This is the ONE place the main
 * app reaches across that process boundary; everything downstream of
 * fetchRenderResult (the dimension scorers, the vision judgment calls,
 * aggregate.ts) is unchanged from before the isolation work, because the
 * decoded shape this module hands back matches exactly what the old
 * in-process renderUrl() used to return.
 *
 * Two deliberate translations happen here, both undone at this one
 * boundary so nothing downstream has to know the render happened on
 * another process at all:
 *   - screenshotPng crosses the wire as base64 (RenderCapture in
 *     render-types.ts); this decodes it back to a Buffer, matching what
 *     judgeAuthorityScreenshot/judgeScreenshot have always expected.
 *   - The service's structured error reasons (isolation spec §4.4) become
 *     typed Error subclasses the route can distinguish with `instanceof`,
 *     so it can map a guard rejection onto the exact same
 *     "That domain can't be checked." response its own local pre-check
 *     already returns -- a prober must not be able to tell the main app's
 *     pre-check and the service's guard apart from the outside.
 */

export interface DecodedRenderCapture extends Omit<RenderCapture, "screenshotPng"> {
  screenshotPng: Buffer;
}

export interface DecodedRenderRunResult {
  captures: DecodedRenderCapture[];
  totalMs: number;
}

/** The service refused the URL (its own SSRF pre-check, mirroring the
 * main app's own). Maps onto the exact same rejection the main app's
 * local pre-check already returns. */
export class RenderServiceBlockedError extends Error {}

/** The service accepted the request but could not produce a render
 * (target site down, navigation failure, or the render exceeded its
 * time budget). Maps onto the existing "could not render this site"
 * message. */
export class RenderServiceRenderFailedError extends Error {}

/** Anything else: misconfiguration (missing/wrong token), the service is
 * over capacity, a network failure reaching it, or a response shape this
 * client does not recognize. Callers should treat this the same as any
 * other unexpected failure in the scan pipeline. */
export class RenderServiceUnavailableError extends Error {}

interface RenderServiceErrorBody {
  error?: string;
  message?: string;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as RenderServiceErrorBody;
    return body.message ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function decodeCapture(capture: RenderCapture): DecodedRenderCapture {
  return { ...capture, screenshotPng: Buffer.from(capture.screenshotPng, "base64") };
}

/**
 * Fetches a render from the isolated service and decodes it back into the
 * shape the rest of the design-check pipeline expects. Throws one of the
 * three typed errors above on any non-200 response or transport failure;
 * never returns a partial/undecoded result.
 */
export async function fetchRenderResult(url: string): Promise<DecodedRenderRunResult> {
  const serviceUrl = process.env.RENDER_SERVICE_URL;
  const serviceToken = process.env.RENDER_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) {
    throw new RenderServiceUnavailableError("RENDER_SERVICE_URL / RENDER_SERVICE_TOKEN are not configured.");
  }

  const controller = new AbortController();
  // Comfortably under this route's own maxDuration (120s, route.ts) so a
  // stuck service call still leaves room for this route to respond with
  // its own error rather than being killed by the platform mid-fetch.
  const timer = setTimeout(() => controller.abort(), 100_000);

  let res: Response;
  try {
    res = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new RenderServiceUnavailableError(
      `Could not reach the render service: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 403) {
    throw new RenderServiceBlockedError(await parseErrorBody(res));
  }
  if (res.status === 422 || res.status === 504) {
    throw new RenderServiceRenderFailedError(await parseErrorBody(res));
  }
  if (!res.ok) {
    throw new RenderServiceUnavailableError(await parseErrorBody(res));
  }

  const result = (await res.json()) as RenderRunResult;
  return {
    captures: result.captures.map(decodeCapture),
    totalMs: result.totalMs,
  };
}
