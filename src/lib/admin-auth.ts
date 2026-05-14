/**
 * Centralized operator-only authorization gate for /api/admin/* routes.
 *
 * Jim Manico audit (2026-05-14) — APP-001 + APP-002:
 *   Two /api/admin/* routes (/domain, /firms) shipped with no auth at all,
 *   on the assumption that "the admin UI is operator-only". The UI is NOT
 *   the gate. The route is. Anyone on the internet could POST to those
 *   endpoints and hijack a firm's custom_domain or insert junk rows into
 *   law_firm_clients.
 *
 * This helper gives every admin route a single import + one-line call
 * pattern:
 *
 *   import { requireOperator } from "@/lib/admin-auth";
 *
 *   export async function POST(req: NextRequest) {
 *     const denied = await requireOperator();
 *     if (denied) return denied;
 *     // ... rest of handler
 *   }
 *
 * Returns null on success (operator session present + role validated);
 * returns a 401 NextResponse on failure that the route hands back to the
 * client directly. No further branching needed.
 *
 * For routes that ALSO support cron-callable bearer auth (CRON_SECRET or
 * PG_CRON_TOKEN), check `isCronAuthorized` first and fall back to
 * requireOperator. Both gates are valid for the same endpoint.
 */

import "server-only";
import { NextResponse } from "next/server";
import { getOperatorSession } from "./portal-auth";

/**
 * Gates a request to operator role. Returns:
 *   - null when the request has a valid operator session (caller proceeds)
 *   - NextResponse with status 401 when there is no operator session
 *
 * Usage:
 *   const denied = await requireOperator();
 *   if (denied) return denied;
 */
export async function requireOperator(): Promise<NextResponse | null> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}
