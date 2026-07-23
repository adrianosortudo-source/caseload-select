/**
 * Rate limiting for public POST routes — Jim Manico audit APP-007.
 *
 * Backing store: Upstash Redis (serverless-friendly Redis-over-HTTP). The
 * @upstash/ratelimit primitives give us fixed-window, sliding-window, and
 * token-bucket algorithms with a single import.
 *
 * Rollout posture: fail-open. If UPSTASH_REDIS_REST_URL or
 * UPSTASH_REDIS_REST_TOKEN are not configured, the limiter returns
 * { success: true } for every call and logs a warn the first time. This
 * lets the code ship before the Redis is provisioned (no broken deploy
 * waiting on infrastructure decisions). Once the operator sets both env
 * vars in Vercel Production, limits engage automatically on the next
 * cold start.
 *
 * Buckets (per IP) chosen to balance "annoying real spam" against
 * "block legitimate intake traffic":
 *
 *   requestLink        5 per 10 minutes
 *     — magic-link email send. The route always returns 200 anyway
 *       (anti-enumeration), so rate-limit silently drops the email
 *       send when the bucket is empty. Attackers can't tell the
 *       difference between throttled and successful.
 *
 *   intake            30 per minute
 *     — /api/intake-v2 + /api/voice-intake. Each call writes a
 *       screened_leads row AND bills us for the Gemini extraction
 *       cost. 30/min is generous for legit firms (a busy intake form
 *       would max ~5/min) but stops a sustained spam flood from
 *       running up the Gemini bill.
 *
 *   screen            30 per minute
 *     — Legacy /api/screen conversational endpoint. Same shape as
 *       intake; same bucket size.
 *
 *   firmOnboarding    10 per hour
 *     — /api/firm-onboarding/[token]/submit. Per-token endpoint but
 *       publicly POSTable. The token gates content access but not
 *       request frequency; tight bucket forces an attacker to
 *       slow-roll guesses.
 *
 *   firmOnboardingUpload  30 per hour
 *     - /api/firm-profile/[token]/upload. Client-list intake now accepts
 *       up to 10 files per submission (spreadsheets, PDFs, photos), so it
 *       needs more headroom than the single-file firmOnboarding bucket
 *       without opening the door to unbounded storage writes.
 *
 *   extract           30 per minute
 *     - /api/extract. Public proxy in front of the Gemini extraction
 *       call (the browser widget calls it, so it must stay public).
 *       The widget makes a handful of calls per intake; 30/min stops
 *       a script from running up the Gemini bill through this route.
 *
 *   transcribe        10 per minute
 *     - /api/transcribe forwards audio to Whisper, billed per minute
 *       of audio. A real intake produces one kickoff recording, maybe
 *       a re-record; 10/min/IP is generous for humans and stops batch
 *       abuse of the OpenAI spend.
 *
 *   otpSend            5 per 10 minutes
 *     - /api/otp/send emails a verification code to an arbitrary
 *       address on demand. Same shape as requestLink (on-demand email
 *       send); tight bucket caps mail-bombing and Resend spend.
 *
 *   otpVerify         10 per 10 minutes
 *     - /api/otp/verify. Second layer behind the per-code attempt cap
 *       (5 wrong tries invalidates the code); the IP bucket slows a
 *       distributed sweep across many sessions.
 *
 *   assist             8 per minute
 *     - /api/assist/[firmId]. Public, cross-origin, no auth (Firm Assist,
 *       DR-100). Each call costs one embedding + one Gemini generation
 *       call. Identity is `${firmId}:${ip}` so one scripted client can't
 *       run up the bill against a single firm while staying under a
 *       global-IP ceiling.
 *
 *   memo              60 per minute
 *     - /api/memo/[sessionId]. Read-only lookup by session UUID, no
 *       write cost. Two callers share this route: the widget polls it
 *       anonymously after Round 3 (the session_id IS the capability
 *       token for that caller, by design, see the route's own
 *       docstring), and a logged-in portal lawyer polls it with an
 *       ownership check layered on top. 60/min is generous for either
 *       polling pattern; the bucket exists to blunt scripted UUID
 *       scraping, not to gate legitimate use.
 *
 *   screenDemoReport   10 per hour
 *     - /api/screen-demo/report. Public marketing surface (no auth).
 *       Each call renders a PDF and sends an email from the brand
 *       domain via Resend. Same tight shape as firmOnboarding: a
 *       generous single visitor never approaches 10/hour, a script
 *       does.
 *
 *   discoveryReport    20 per hour
 *     - /api/discovery-report. Invoked by a ChatGPT GPT Action (Adriano's
 *       own Discovery Intelligence GPT), so the caller is OpenAI's
 *       infrastructure, not the operator's browser. CORS stays `*`
 *       because the Action's runtime has no fixed browser origin. Each
 *       call writes a row and sends an email; low expected volume
 *       (one operator, occasional Discovery interviews), so the cap is
 *       purely an abuse backstop.
 *
 * Per-route bucket selection is done by the caller. Caller passes the
 * bucket name + the IP. We never trust the request body for IP
 * resolution; the helper reads x-forwarded-for and x-real-ip in that
 * order, falls back to a constant marker when neither is set (so a
 * misconfigured proxy can't accidentally exempt everyone — they all
 * share the fallback bucket).
 */

import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

export type RateLimitBucket =
  | "requestLink"
  | "intake"
  | "screen"
  | "firmOnboarding"
  | "firmOnboardingUpload"
  | "extract"
  | "transcribe"
  | "otpSend"
  | "otpVerify"
  | "seoCheck"
  | "assist"
  | "memo"
  | "screenDemoReport"
  | "discoveryReport";

interface BucketConfig {
  limit: number;
  windowSeconds: number;
}

const BUCKET_CONFIG: Record<RateLimitBucket, BucketConfig> = {
  requestLink:    { limit: 5,  windowSeconds: 600 },   // 5 per 10 minutes
  intake:         { limit: 30, windowSeconds: 60 },    // 30 per minute
  screen:         { limit: 30, windowSeconds: 60 },    // 30 per minute
  firmOnboarding: { limit: 10, windowSeconds: 3600 },  // 10 per hour
  firmOnboardingUpload: { limit: 30, windowSeconds: 3600 }, // 30 per hour
  extract:        { limit: 30, windowSeconds: 60 },    // 30 per minute
  transcribe:     { limit: 10, windowSeconds: 60 },    // 10 per minute
  otpSend:        { limit: 5,  windowSeconds: 600 },   // 5 per 10 minutes
  otpVerify:      { limit: 10, windowSeconds: 600 },   // 10 per 10 minutes
  seoCheck:       { limit: 8,  windowSeconds: 600 },   // 8 per 10 minutes (public, unauth only)
  assist:         { limit: 8,  windowSeconds: 60 },    // 8 per minute (public, unauth, per firmId:ip)
  memo:              { limit: 60, windowSeconds: 60 },   // 60 per minute (read-only, widget + portal)
  screenDemoReport:  { limit: 10, windowSeconds: 3600 }, // 10 per hour (public marketing form)
  discoveryReport:   { limit: 20, windowSeconds: 3600 }, // 20 per hour (ChatGPT Action caller)
};

/**
 * Lazy-initialised on first use. We don't read process.env at module
 * load time so test imports of this file don't crash when env is
 * missing.
 */
let _redis: Redis | null = null;
let _redisLoadAttempted = false;
let _logged = false;

function getRedis(): Redis | null {
  if (_redisLoadAttempted) return _redis;
  _redisLoadAttempted = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!_logged) {
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL / TOKEN not set; rate limiting is FAIL-OPEN. Set both env vars in Vercel to engage limits.",
      );
      _logged = true;
    }
    return null;
  }
  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    // Construction failure (malformed URL etc.) — fail open, log once.
    if (!_logged) {
      console.warn(
        "[rate-limit] Redis client construction failed; rate limiting is FAIL-OPEN.",
        err instanceof Error ? err.message : String(err),
      );
      _logged = true;
    }
    return null;
  }
}

const _limiters = new Map<RateLimitBucket, Ratelimit>();

function getLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const cached = _limiters.get(bucket);
  if (cached) return cached;
  const redis = getRedis();
  if (!redis) return null;
  const config = BUCKET_CONFIG[bucket];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
    prefix: `rl:${bucket}`,
    analytics: false,
  });
  _limiters.set(bucket, limiter);
  return limiter;
}

/**
 * Pulls the caller's IP from the request headers. Vercel sets
 * x-forwarded-for to a comma-separated chain; the first entry is the
 * real client. x-real-ip is the simpler form some proxies set.
 *
 * Returns "unknown" when neither header is set — that bucket is
 * shared across every caller without an IP, which is the right
 * behavior (we don't want a missing header to exempt everyone).
 */
export function ipFromRequest(req: NextRequest | Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri && xri.trim()) return xri.trim();
  return "unknown";
}

export interface RateLimitDecision {
  ok: boolean;
  /** Whether limiting is active (false when env vars missing). */
  active: boolean;
  /** Requests remaining in the window (only meaningful when active). */
  remaining: number;
  /** Window reset time as epoch milliseconds (only meaningful when active). */
  reset: number;
  /** Bucket size at full capacity (informational). */
  limit: number;
}

/**
 * Charge one request against the named bucket for the given identity.
 *
 * Returns ok=false ONLY when the bucket has been exceeded AND the
 * limiter is active. When UPSTASH_REDIS_REST_URL / TOKEN are missing
 * (rollout phase), this fails open with ok=true + active=false so the
 * caller can choose to log the would-be-throttle without blocking the
 * request.
 */
// Buckets that protect public abuse/enumeration surfaces. When
// RATE_LIMIT_FAIL_CLOSED=true and the limiter is unconfigured, these reject
// instead of letting traffic through. seoCheck and intake stay fail-open
// because they are tolerant of unauthenticated traffic and the user-visible
// failure mode of a false 429 is worse than the abuse risk. (Codex re-audit
// CP-04. Default remains fail-open until the operator enables Upstash and
// flips RATE_LIMIT_FAIL_CLOSED, so DRG production is not affected.)
const FAIL_CLOSED_BUCKETS: ReadonlySet<RateLimitBucket> = new Set<RateLimitBucket>([
  "requestLink",
  "otpSend",
  "otpVerify",
]);

function failClosedMode(): boolean {
  return process.env.RATE_LIMIT_FAIL_CLOSED === "true";
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  identity: string,
): Promise<RateLimitDecision> {
  const limiter = getLimiter(bucket);
  const config = BUCKET_CONFIG[bucket];
  if (!limiter) {
    if (failClosedMode() && FAIL_CLOSED_BUCKETS.has(bucket)) {
      // Defensive deny: limiter unconfigured but operator has opted into
      // fail-closed mode on a sensitive bucket.
      return { ok: false, active: false, remaining: 0, reset: 0, limit: config.limit };
    }
    return { ok: true, active: false, remaining: config.limit, reset: 0, limit: config.limit };
  }
  try {
    const result = await limiter.limit(identity);
    return {
      ok: result.success,
      active: true,
      remaining: result.remaining,
      reset: result.reset,
      limit: result.limit,
    };
  } catch (err) {
    // Redis hiccup. Fail open and log; never block intake on a transient
    // rate-limiter failure.
    console.warn(
      `[rate-limit] bucket=${bucket} identity=${identity} backing-store error, failing open:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: true, active: false, remaining: config.limit, reset: 0, limit: config.limit };
  }
}

/**
 * Build the standard 429 response headers from a decision. Vercel
 * and most clients honour these.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  if (!decision.active) return {};
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.floor(decision.reset / 1000)),
    "Retry-After": String(Math.max(1, Math.ceil((decision.reset - Date.now()) / 1000))),
  };
}
