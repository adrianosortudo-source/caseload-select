/**
 * I/O for the operator portal-access tool.
 *
 * Manages firm_lawyers rows: list, add (the trg_firm_lawyers_invite trigger
 * sends the magic-link invite on insert), resend a link, and soft-disable /
 * enable. There is no unique (firm_id, email) constraint, so add guards
 * duplicates itself. Every call is operator-authorised by the caller.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendPortalMagicLink } from "@/lib/portal-magic-link";
import { type AssignableRole } from "@/lib/firm-members-pure";

export interface FirmMemberRow {
  id: string;
  firm_id: string;
  email: string;
  role: string;
  display_name: string | null;
  title: string | null;
  disabled: boolean;
  disabled_at: string | null;
  invitation_sent_at: string | null;
  last_signed_in_at: string | null;
  created_at: string;
}

const MEMBER_COLS =
  "id, firm_id, email, role, display_name, title, disabled, disabled_at, invitation_sent_at, last_signed_in_at, created_at";

export async function listFirmMembers(firmId: string): Promise<FirmMemberRow[]> {
  const { data, error } = await supabase
    .from("firm_lawyers")
    .select(MEMBER_COLS)
    .eq("firm_id", firmId)
    .order("created_at", { ascending: true })
    .returns<FirmMemberRow[]>();
  if (error) throw new Error(`listFirmMembers failed: ${error.message}`);
  return data ?? [];
}

export async function findFirmMemberByEmail(
  firmId: string,
  email: string,
): Promise<FirmMemberRow | null> {
  const { data, error } = await supabase
    .from("firm_lawyers")
    .select(MEMBER_COLS)
    .eq("firm_id", firmId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findFirmMemberByEmail failed: ${error.message}`);
  return (data as FirmMemberRow | null) ?? null;
}

export interface AddMemberResult {
  ok: true;
  member: FirmMemberRow;
}
export interface AddMemberFailure {
  ok: false;
  status: 400 | 409 | 500;
  reason: string;
  message: string;
}

export async function addFirmMember(args: {
  firmId: string;
  email: string;
  role: AssignableRole;
  displayName: string | null;
  title: string | null;
}): Promise<AddMemberResult | AddMemberFailure> {
  // No unique (firm_id, email) constraint exists, so guard duplicates here.
  const existing = await findFirmMemberByEmail(args.firmId, args.email);
  if (existing) {
    return {
      ok: false,
      status: 409,
      reason: "already_member",
      message: existing.disabled
        ? "This email is already a member but disabled. Enable it instead of adding again."
        : "This email is already a member of this firm.",
    };
  }

  const { data: inserted, error } = await supabase
    .from("firm_lawyers")
    .insert({
      firm_id: args.firmId,
      email: args.email,
      role: args.role,
      display_name: args.displayName,
      name: args.displayName, // the notification path reads `name`
      title: args.title,
    })
    .select(MEMBER_COLS)
    .single();

  if (error) {
    return { ok: false, status: 500, reason: "db_insert_failed", message: error.message };
  }
  // The trg_firm_lawyers_invite trigger fires the magic-link email on insert.
  return { ok: true, member: inserted as FirmMemberRow };
}

export async function setFirmMemberDisabled(args: {
  firmId: string;
  memberId: string;
  disabled: boolean;
}): Promise<
  { ok: true; member: FirmMemberRow } | { ok: false; status: 404 | 500; message: string }
> {
  // Scope the update to the firm to block cross-firm mutation.
  const { data: updated, error } = await supabase
    .from("firm_lawyers")
    .update({
      disabled: args.disabled,
      disabled_at: args.disabled ? new Date().toISOString() : null,
    })
    .eq("id", args.memberId)
    .eq("firm_id", args.firmId)
    .select(MEMBER_COLS)
    .maybeSingle();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!updated) return { ok: false, status: 404, message: "member not found" };
  return { ok: true, member: updated as FirmMemberRow };
}

export async function resendMemberLink(args: {
  firmId: string;
  memberId: string;
  firmName: string;
}): Promise<
  { ok: true; sent: boolean } | { ok: false; status: 404 | 409 | 500; message: string }
> {
  const { data: member, error } = await supabase
    .from("firm_lawyers")
    .select("id, firm_id, email, role, disabled")
    .eq("id", args.memberId)
    .eq("firm_id", args.firmId)
    .maybeSingle<{ id: string; firm_id: string; email: string; role: string; disabled: boolean }>();

  if (error) return { ok: false, status: 500, message: error.message };
  if (!member) return { ok: false, status: 404, message: "member not found" };
  if (member.disabled) {
    return { ok: false, status: 409, message: "member is disabled; enable before sending a link" };
  }

  const role: "lawyer" | "operator" = member.role === "operator" ? "operator" : "lawyer";
  const result = await sendPortalMagicLink({
    email: member.email,
    firmId: args.firmId,
    firmName: args.firmName,
    role,
    lawyerId: member.id,
  });

  await supabase
    .from("firm_lawyers")
    .update({ invitation_sent_at: new Date().toISOString() })
    .eq("id", args.memberId);

  return { ok: true, sent: result.sent };
}
