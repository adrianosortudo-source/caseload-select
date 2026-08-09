/**
 * Read-only projection of the append-only client change-hold ledger.
 *
 * A client request for changes is release evidence, not a UI-only status.
 * Every release-oriented loader uses this helper so a hold cannot be omitted
 * by one surface while another correctly blocks the same exact version.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

interface ChangeHoldEventRow {
  id: string;
  version_id: string;
  event: "opened" | "resolved";
  resolves_open_event_id: string | null;
}

/** Returns the exact version ids that still have a client-owned open hold. */
export async function loadUnresolvedClientChangeHoldVersionIds(
  firmId: string,
  deliverableIds: string[],
): Promise<Set<string>> {
  if (deliverableIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("deliverable_client_change_hold_events")
    .select("id, version_id, event, resolves_open_event_id")
    .eq("firm_id", firmId)
    .in("deliverable_id", deliverableIds);
  if (error) throw new Error(`could not load client change holds: ${error.message}`);

  const resolvedOpenIds = new Set(
    ((data ?? []) as ChangeHoldEventRow[])
      .filter((event) => event.event === "resolved" && event.resolves_open_event_id)
      .map((event) => event.resolves_open_event_id as string),
  );
  return new Set(
    ((data ?? []) as ChangeHoldEventRow[])
      .filter((event) => event.event === "opened" && !resolvedOpenIds.has(event.id))
      .map((event) => event.version_id),
  );
}
