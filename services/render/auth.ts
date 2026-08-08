import { timingSafeEqual } from "node:crypto";

/**
 * The render service's whole security model rests on holding no
 * application secret. `assertNoApplicationSecrets` is the enforcement of
 * that: every deployment's cold start calls it before handling a single
 * request, and it throws (failing the deployment loudly, not degrading
 * silently) if any known application-secret env var name is present.
 * This is the isolation spec's §6.1 requirement made concrete -- see
 * docs/BUILD_PLAN_render_isolation_v1.md §3.3 and the companion spec's
 * "6.1 No application secrets" section.
 *
 * The list is deliberately the exact set the isolation spec names as the
 * reason this service exists (CaseLoadSelect_RendererIsolation_Spec_
 * 2026-08-07.md §1's table): Supabase, direct Postgres, Vercel API
 * control, Clio, transactional mail/SMS, and every LLM key. It is not
 * meant to be a complete inventory of the main app's 63 env vars --
 * RENDER_SERVICE_TOKEN itself is the one credential this service is
 * supposed to hold, and is correctly absent from this list.
 */
const KNOWN_APPLICATION_SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DIRECT_DATABASE_URL",
  "VERCEL_API_TOKEN",
  "CLIO_CLIENT_SECRET",
  "RESEND_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
] as const;

export class ApplicationSecretPresentError extends Error {
  constructor(public readonly foundNames: string[]) {
    super(
      `Refusing to start: this render service's environment carries application secret(s) it must never hold: ${foundNames.join(", ")}. ` +
        "The render service exists specifically so that a browser rendering attacker-chosen content never shares a process boundary with these credentials -- see docs/BUILD_PLAN_render_isolation_v1.md."
    );
    this.name = "ApplicationSecretPresentError";
  }
}

/**
 * Throws ApplicationSecretPresentError if any known application-secret
 * name is a non-empty value in process.env. Called at module load / cold
 * start, not per-request: an env var does not change between requests
 * within one running instance, so checking once is both correct and
 * cheap.
 */
export function assertNoApplicationSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const found = KNOWN_APPLICATION_SECRET_NAMES.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0;
  });
  if (found.length > 0) {
    throw new ApplicationSecretPresentError(found);
  }
}

/**
 * Constant-time comparison, same rationale and technique as the main
 * app's src/lib/cron-auth.ts constantTimeEquals: burns equivalent CPU
 * time on a length mismatch as on a same-length mismatch, rather than
 * short-circuiting, so the timing side channel carries no information
 * about how close a guess was.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length === bufB.length) {
    return timingSafeEqual(bufA, bufB);
  }
  const longest = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(longest);
  const padB = Buffer.alloc(longest);
  bufA.copy(padA);
  bufB.copy(padB);
  timingSafeEqual(padA, padB);
  return false;
}

/**
 * Validates the Authorization header against RENDER_SERVICE_TOKEN. The
 * one credential this service is allowed to hold. No token configured
 * means fail closed (reject everything), matching the main app's own
 * cron-auth posture: an unconfigured secret must never mean "accept
 * anything."
 */
export function isRenderRequestAuthorized(
  authorizationHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = env.RENDER_SERVICE_TOKEN;
  if (!expected) return false;
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) return false;
  const presented = authorizationHeader.slice("Bearer ".length).trim();
  if (!presented) return false;
  return constantTimeEquals(presented, expected);
}
