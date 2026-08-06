/**
 * Publishing Package Gateway authorization.
 *
 * A single, narrowly-scoped bearer credential for exactly one operation:
 * POST /api/publishing-agent/hero-package (upload one approved hero image
 * and bind it to one exact deliverable). This credential is deliberately
 * NOT CRON_SECRET, PG_CRON_TOKEN (see cron-auth.ts), or any operator/lawyer
 * session -- reusing a broader credential here would let anything that can
 * authenticate as this endpoint reach every other route that credential
 * already unlocks. PUBLISHING_PACKAGE_GATEWAY_TOKEN unlocks this one route
 * and nothing else; see publishing-package-gateway.ts for the operation
 * itself and its own authorization-boundary tests (this module has no
 * awareness of approval, status, placement, or notification logic -- it
 * only decides whether a bearer token is valid).
 *
 * Constant-time compare via Node crypto.timingSafeEqual, reusing
 * cron-auth.ts's constantTimeEquals (same fixed-cost-regardless-of-length
 * property; see that module's own doc comment for the APP-005 rationale).
 * No token value is ever logged, returned, or otherwise exposed by this
 * module.
 */

import type { NextRequest } from "next/server";
import { constantTimeEquals } from "@/lib/cron-auth";

/**
 * True only when the Authorization header carries a well-formed Bearer
 * token that matches PUBLISHING_PACKAGE_GATEWAY_TOKEN exactly. Fails
 * closed on every other input: missing header, malformed header, empty
 * token, mismatched token, or an unset/empty env var (refuses to accept
 * any bearer when no secret has been configured -- never a default-open
 * behavior).
 */
export function isPublishingPackageGatewayAuthorized(req: NextRequest): boolean {
  return isPublishingPackageGatewayTokenValid(req.headers.get("authorization"));
}

/**
 * Lower-level variant for code paths that already have the raw header
 * value. Same fail-closed semantics as isPublishingPackageGatewayAuthorized.
 */
export function isPublishingPackageGatewayTokenValid(headerValue: string | null | undefined): boolean {
  if (!headerValue || !headerValue.startsWith("Bearer ")) return false;
  const presented = headerValue.slice("Bearer ".length).trim();
  if (!presented) return false;

  const configured = process.env.PUBLISHING_PACKAGE_GATEWAY_TOKEN;
  if (typeof configured !== "string" || configured.length === 0) return false;

  return constantTimeEquals(presented, configured);
}
