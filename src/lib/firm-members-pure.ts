/**
 * Pure helpers for the operator portal-access tool.
 *
 * Roles assignable from the tool are admin + staff (the schema also permits
 * lawyer and operator, but those are legacy / operator-only and are not
 * offered here). At the session layer admin and staff both resolve to a
 * normal firm-scoped session; the label is for display and future gating.
 */

export type AssignableRole = "admin" | "staff";

export const ASSIGNABLE_ROLES: ReadonlyArray<AssignableRole> = ["admin", "staff"] as const;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  staff: "Staff",
  lawyer: "Lawyer",
  operator: "Operator",
};

export function roleLabel(r: string | null | undefined): string {
  if (!r) return "Member";
  return ROLE_LABELS[r] ?? r;
}

export function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as ReadonlyArray<string>).includes(value);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

export interface MemberInputError {
  ok: false;
  reason: "missing_email" | "invalid_email" | "invalid_role";
  message: string;
}

export interface MemberInputOk {
  ok: true;
  email: string;
  role: AssignableRole;
  displayName: string | null;
  title: string | null;
}

export function validateMemberInput(input: {
  email: string;
  role: string;
  displayName?: string | null;
  title?: string | null;
}): MemberInputOk | MemberInputError {
  const email = normalizeEmail(input.email);
  if (!email) {
    return { ok: false, reason: "missing_email", message: "an email is required" };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, reason: "invalid_email", message: "that is not a valid email" };
  }
  if (!isAssignableRole(input.role)) {
    return {
      ok: false,
      reason: "invalid_role",
      message: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`,
    };
  }
  const displayName = (input.displayName ?? "").trim() || null;
  const title = (input.title ?? "").trim() || null;
  return { ok: true, email, role: input.role, displayName, title };
}

/**
 * Coarse status label for a member row, used in the operator UI.
 */
export function memberStatusLabel(member: {
  disabled: boolean;
  last_signed_in_at: string | null;
  invitation_sent_at: string | null;
}): "Disabled" | "Active" | "Invited" | "Not invited" {
  if (member.disabled) return "Disabled";
  if (member.last_signed_in_at) return "Active";
  if (member.invitation_sent_at) return "Invited";
  return "Not invited";
}
