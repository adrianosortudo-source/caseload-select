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

export type RateLimitBucket = "requestLink" | "intake" | "screen" | "firmOnboarding";

interface BucketConfig {
  limit: number;
  windowSeconds: number;
}

const BUCKET_CONFIG: Record<RateLimitBucket, BucketConfig> = {
  requestLink:    { limit: 5,  windowSeconds: 600 },   // 5 per 10 minutes
  intake:         { limit: 30, windowSeconds: 60 },    // 30 per minute
  screen:         { limit: 30, windowSeconds: 60 },    // 30 per minute
  firmOnboarding: { limit: 10, windowSeconds: 3600 },  // 10 per hour
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
export async function checkRateLimit(
  bucket: RateLimitBucket,
  identity: string,
): Promise<RateLimitDecision> {
  const limiter = getLimiter(bucket);
  const config = BUCKET_CONFIG[bucket];
  if (!limiter) {
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
    // eslint-disable-next-line no-console
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
