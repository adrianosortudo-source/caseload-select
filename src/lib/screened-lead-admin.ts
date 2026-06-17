/**
 * I/O for operator lead management on screened_leads.
 *
 * archiveLead       soft-archive / restore one lead
 * deleteLead        hard delete one lead (taken leads are protected)
 * bulkArchiveOlderThan  archive finalised leads older than N days
 *
 * Every call is operator-authorised by the caller. Hard delete relies on the
 * ON DELETE SET NULL inbound FKs (client_matters, channel_intake_sessions,
 * voice_callback_requests), so a delete never cascades or errors; the taken
 * guard exists to preserve a matter's link back to its origin brief.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  isDeletableStatus,
  ARCHIVABLE_HISTORY_STATUSES,
  olderThanCutoffIso,
} from "@/lib/screened-lead-admin-pure";

export async function archiveLead(args: {
  id: string;
  archived: boolean;
  role: string;
}): Promise<{ ok: true } | { ok: false; status: 404 | 500; message: string }> {
  const { data, error } = await supabase
    .from("screened_leads")
    .update({
      archived: args.archived,
      archived_at: args.archived ? new Date().toISOString() : null,
      archived_by_role: args.archived ? args.role : null,
    })
    .eq("id", args.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!data) return { ok: false, status: 404, message: "lead not found" };
  return { ok: true };
}

export async function deleteLead(args: {
  id: string;
}): Promise<{ ok: true } | { ok: false; status: 404 | 409 | 500; message: string }> {
  const { data: lead, error: loadErr } = await supabase
    .from("screened_leads")
    .select("id, status")
    .eq("id", args.id)
    .maybeSingle<{ id: string; status: string }>();

  if (loadErr) return { ok: false, status: 500, message: loadErr.message };
  if (!lead) return { ok: false, status: 404, message: "lead not found" };
  if (!isDeletableStatus(lead.status)) {
    return {
      ok: false,
      status: 409,
      message: "This lead became a client matter and cannot be deleted. Archive it instead.",
    };
  }

  const { error: delErr } = await supabase.from("screened_leads").delete().eq("id", args.id);
  if (delErr) return { ok: false, status: 500, message: delErr.message };
  return { ok: true };
}

export async function bulkArchiveOlderThan(args: {
  days: number;
  role: string;
  firmId?: string | null;
}): Promise<{ ok: true; count: number } | { ok: false; status: 500; message: string }> {
  const cutoff = olderThanCutoffIso(args.days, Date.now());

  let query = supabase
    .from("screened_leads")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by_role: args.role,
    })
    .eq("archived", false)
    .in("status", ARCHIVABLE_HISTORY_STATUSES as unknown as string[])
    .lt("created_at", cutoff);

  if (args.firmId) query = query.eq("firm_id", args.firmId);

  const { data, error } = await query.select("id");
  if (error) return { ok: false, status: 500, message: error.message };
  return { ok: true, count: data?.length ?? 0 };
}
