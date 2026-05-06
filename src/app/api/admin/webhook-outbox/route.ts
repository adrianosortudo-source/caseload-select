/**
 * GET /api/admin/webhook-outbox
 *
 * Operator-visible outbox listing. Surfaces recent webhook deliveries with
 * status, attempt count, last error, and timestamps so the operator can
 * see what fired, what's still pending, and what failed without an admin UI.
 *
 * Auth: Bearer CRON_SECRET (operator-only).
 *
 * Query params:
 *   firm_id   filter to a specific firm (optional)
 *   status    pending | sent | failed (optional, default = all)
 *   limit     1–500 (default 100)
 *
 * Returns: { items: [...], total_count, filter }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getOperatorSession } from "@/lib/portal-auth";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  // Two valid auth paths:
  //   1. Bearer CRON_SECRET / PG_CRON_TOKEN — operator curl, automation.
  //   2. Operator session cookie — operator console UI fetch.
  const cronAuthed = isCronAuthorized(req);
  const operatorSession = cronAuthed ? null : await getOperatorSession();
  if (!cronAuthed && !operatorSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const firmId = url.searchParams.get("firm_id");
  const status = url.searchParams.get("status");
  const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT));

  let query = supabase
    .from("webhook_outbox")
    .select(`
      id, lead_id, firm_id, action, idempotency_key,
      status, attempts, max_attempts, next_attempt_at,
      last_error, last_http_status, webhook_url,
      created_at, updated_at, sent_at, failed_at
    `, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (firmId) query = query.eq("firm_id", firmId);
  if (status === "pending" || status === "sent" || status === "failed") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: data ?? [],
    total_count: count ?? 0,
    filter: { firm_id: firmId ?? null, status: status ?? "all", limit },
  });
}
