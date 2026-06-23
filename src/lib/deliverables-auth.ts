/**
 * Shared actor resolution for the content approval surfaces.
 *
 * Deliverable routes admit an operator (cross-firm) OR the firm's lawyer.
 * Client-role sessions are rejected; clients never see firm marketing
 * deliverables. For a lawyer actor we resolve a display name + email from
 * firm_lawyers (falling back to intake_firms.branding.lawyer_email) so the
 * approval record can capture who signed.
 */

import "server-only";
import { getPortalSession, type PortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { DeliverableActor } from "@/lib/deliverables";

export interface ResolvedDeliverableActor {
  session: PortalSession;
  actor: DeliverableActor;
}

/**
 * Returns the session + a normalised actor, or null when the caller is not
 * authorised for this firm's deliverables.
 */
export async function resolveDeliverableActor(
  firmId: string,
): Promise<ResolvedDeliverableActor | null> {
  const session = await getPortalSession();
  if (!session) return null;
  if (session.role === "client") return null;

  if (session.role === "operator") {
    return {
      session,
      actor: { role: "operator", id: session.lawyer_id ?? null, name: "Operator", email: null },
    };
  }

  // lawyer role: firm must match
  if (session.firm_id !== firmId) return null;

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
    session,
    actor: {
      role: "lawyer",
      id: session.lawyer_id ?? null,
      name: name ?? "Authorised lawyer",
      email: email ?? null,
    },
  };
}
