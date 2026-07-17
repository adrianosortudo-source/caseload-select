/**
 * Standing Publishing Authorization.
 *
 * DRG Law (or any firm) may authorize CaseLoad Select to publish future
 * content after it passes the agreed internal QA / legal-safety checks,
 * without waiting for a lawyer to individually review every version. Only
 * the firm's own lawyer/client decision-maker can turn this on or off --
 * never an operator (see set_standing_publishing_authorization in
 * supabase/migrations/20260717230956_standing_publishing_authorization.sql,
 * which independently enforces actor_role='lawyer' at the database layer).
 *
 * This is NOT "blanket legal approval" and must never be described that
 * way, or displayed as though a lawyer reviewed a version she did not
 * review -- see CONTENT_STUDIO_APPROVAL_PLAYBOOK.md.
 *
 * State is append-only (never a mutable boolean): every enable/disable is
 * its own row in standing_publishing_authorizations, and "current state"
 * is always derived by reading the latest row (order by event_seq desc).
 * Nothing here maintains a separate mutable projection to keep in sync.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { PortalSession } from "@/lib/portal-auth";

export const STANDING_AUTHORIZATION_POLICY_VERSION = "standing-publishing-authorization-v1";
export const STANDING_AUTHORIZATION_SCOPE = "all_future_content";

export type NotificationPreference = "per_publication" | "weekly_digest";
export const DEFAULT_NOTIFICATION_PREFERENCE: NotificationPreference = "weekly_digest";

/**
 * The exact wording a lawyer confirms when turning authorization on, with
 * the firm's own name interpolated. This is the single place that text is
 * assembled -- the enable route below always calls this, never accepts
 * authorization_text from a request body, so what gets frozen into the
 * append-only event row can never be something other than this canonical
 * copy for the policy version in force.
 */
export function buildStandingAuthorizationText(firmName: string): string {
  return `By turning this on, you authorize CaseLoad Select to publish future ${firmName} content after it passes the agreed quality and legal-safety checks, without waiting for your individual review of every item. You may turn this off at any time. You can review published content later and request changes.`;
}

export interface StandingAuthorizationActor {
  role: "lawyer";
  id: string | null;
  name: string;
  email: string;
}

export interface StandingAuthorizationEvent {
  id: string;
  firm_id: string;
  event_seq: number;
  event: "enabled" | "disabled";
  actor_role: "lawyer";
  actor_id: string | null;
  actor_name: string;
  actor_email: string;
  authorization_text: string | null;
  policy_version: string | null;
  scope: string | null;
  notification_preference: NotificationPreference | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  effective_at: string;
  created_at: string;
}

export interface StandingAuthorizationState {
  active: boolean;
  latestEvent: StandingAuthorizationEvent;
}

/**
 * Resolves the display name + email for the lawyer session that will act
 * as an authorization event's actor. Mirrors resolveDeliverableActor's
 * lawyer branch (lib/deliverables-auth.ts) but is kept separate here: that
 * module admits operator sessions (for deliverable review), while standing
 * authorization must never be reachable by anything but a firm-matched
 * lawyer session -- callers are expected to have already called
 * getFirmSession(firmId) (lib/portal-auth.ts), which structurally cannot
 * return an operator or client session at all.
 */
export async function resolveFirmLawyerIdentity(
  firmId: string,
  session: PortalSession,
): Promise<StandingAuthorizationActor> {
  let name: string | null = null;
  let email: string | null = null;

  if (session.lawyer_id) {
    const { data } = await supabase
      .from("firm_lawyers")
      .select("display_name, email")
      .eq("id", session.lawyer_id)
      .maybeSingle();
    name = data?.display_name ?? null;
    email = data?.email ?? null;
  }

  if (!email) {
    const { data: firm } = await supabase
      .from("intake_firms")
      .select("branding")
      .eq("id", firmId)
      .maybeSingle();
    const branding = (firm?.branding as { lawyer_email?: string; lawyer_name?: string } | null) ?? null;
    email = branding?.lawyer_email ?? null;
    name = name ?? branding?.lawyer_name ?? null;
  }

  return {
    role: "lawyer",
    id: session.lawyer_id ?? null,
    name: name ?? "Authorised lawyer",
    email: email ?? "",
  };
}

/** The firm's display name, used to render the authorization card's preview copy and to build authorization_text at enable time. */
export async function getFirmDisplayName(firmId: string): Promise<string | null> {
  const { data } = await supabase.from("intake_firms").select("name").eq("id", firmId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/** Reads the latest event for a firm; null when the firm has never touched this feature. */
export async function getStandingAuthorizationState(
  firmId: string,
): Promise<StandingAuthorizationState | null> {
  const { data, error } = await supabase
    .from("standing_publishing_authorizations")
    .select("*")
    .eq("firm_id", firmId)
    .order("event_seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getStandingAuthorizationState failed: ${error.message}`);
  if (!data) return null;
  const latestEvent = data as StandingAuthorizationEvent;
  return { active: latestEvent.event === "enabled", latestEvent };
}

/** Full history, newest first, for the "view authorization history" surface. */
export async function listStandingAuthorizationHistory(
  firmId: string,
): Promise<StandingAuthorizationEvent[]> {
  const { data, error } = await supabase
    .from("standing_publishing_authorizations")
    .select("*")
    .eq("firm_id", firmId)
    .order("event_seq", { ascending: false });
  if (error) throw new Error(`listStandingAuthorizationHistory failed: ${error.message}`);
  return (data ?? []) as StandingAuthorizationEvent[];
}

export interface SetStandingAuthorizationResult {
  ok: true;
  eventId: string;
  eventSeq: number;
  event: "enabled" | "disabled";
  effectiveAt: string;
}

export interface SetStandingAuthorizationError {
  ok: false;
  error: string;
}

async function callSetStandingAuthorizationRpc(input: {
  firmId: string;
  event: "enabled" | "disabled";
  actor: StandingAuthorizationActor;
  authorizationText: string | null;
  policyVersion: string | null;
  scope: string | null;
  notificationPreference: NotificationPreference | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<SetStandingAuthorizationResult | SetStandingAuthorizationError> {
  const { data, error } = await supabase.rpc("set_standing_publishing_authorization", {
    p_firm_id: input.firmId,
    p_event: input.event,
    p_actor_role: input.actor.role,
    p_actor_id: input.actor.id,
    p_actor_name: input.actor.name,
    p_actor_email: input.actor.email,
    p_authorization_text: input.authorizationText,
    p_policy_version: input.policyVersion,
    p_scope: input.scope,
    p_notification_preference: input.notificationPreference,
    p_reason: input.reason,
    p_ip_address: input.ipAddress,
    p_user_agent: input.userAgent,
  });
  if (error) return { ok: false, error: `standing authorization rpc failed: ${error.message}` };
  const result = data as { ok?: boolean; error?: string; event_id?: string; event_seq?: number; event?: string; effective_at?: string };
  if (!result.ok) return { ok: false, error: result.error ?? "standing authorization change failed" };
  return {
    ok: true,
    eventId: result.event_id as string,
    eventSeq: result.event_seq as number,
    event: result.event as "enabled" | "disabled",
    effectiveAt: result.effective_at as string,
  };
}

/**
 * Turns standing authorization ON for a firm. firmName is used only to
 * assemble the canonical authorization_text (see
 * buildStandingAuthorizationText) -- the caller never supplies the text
 * itself.
 */
export async function enableStandingAuthorization(input: {
  firmId: string;
  firmName: string;
  actor: StandingAuthorizationActor;
  notificationPreference: NotificationPreference;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<SetStandingAuthorizationResult | SetStandingAuthorizationError> {
  return callSetStandingAuthorizationRpc({
    firmId: input.firmId,
    event: "enabled",
    actor: input.actor,
    authorizationText: buildStandingAuthorizationText(input.firmName),
    policyVersion: STANDING_AUTHORIZATION_POLICY_VERSION,
    scope: STANDING_AUTHORIZATION_SCOPE,
    notificationPreference: input.notificationPreference,
    reason: null,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

/** Turns standing authorization OFF. Takes effect immediately for future publication decisions only. */
export async function disableStandingAuthorization(input: {
  firmId: string;
  actor: StandingAuthorizationActor;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<SetStandingAuthorizationResult | SetStandingAuthorizationError> {
  return callSetStandingAuthorizationRpc({
    firmId: input.firmId,
    event: "disabled",
    actor: input.actor,
    authorizationText: null,
    policyVersion: null,
    scope: null,
    notificationPreference: null,
    reason: input.reason,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

export interface SetIndividualReviewResult {
  ok: true;
  versionId: string;
  requiresIndividualReview: boolean;
}

export interface SetIndividualReviewError {
  ok: false;
  error: string;
}

/**
 * Operator-only exception: require an individual lawyer review for one
 * specific version, overriding standing authorization for that version
 * alone. Use for unusual, sensitive, uncertain, or high-risk content. A
 * non-blank reason is required whenever required=true.
 */
export async function setDeliverableVersionIndividualReviewRequirement(input: {
  versionId: string;
  firmId: string;
  required: boolean;
  actor: { role: "operator"; id: string | null; name: string };
  reason: string | null;
}): Promise<SetIndividualReviewResult | SetIndividualReviewError> {
  const { data, error } = await supabase.rpc("set_deliverable_version_individual_review_requirement", {
    p_version_id: input.versionId,
    p_firm_id: input.firmId,
    p_required: input.required,
    p_actor_role: input.actor.role,
    p_actor_id: input.actor.id,
    p_actor_name: input.actor.name,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: `individual review rpc failed: ${error.message}` };
  const result = data as { ok?: boolean; error?: string; version_id?: string; requires_individual_review?: boolean };
  if (!result.ok) return { ok: false, error: result.error ?? "individual review change failed" };
  return {
    ok: true,
    versionId: result.version_id as string,
    requiresIndividualReview: result.requires_individual_review as boolean,
  };
}
