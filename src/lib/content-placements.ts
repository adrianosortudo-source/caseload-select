/**
 * Content Studio publishing evidence system, Workstream 4: destination
 * placements. I/O layer over content_placements (see
 * supabase/migrations/20260715130100_content_placements.sql).
 *
 * This module never bypasses the database's own scope/identity triggers;
 * it exists to give routes friendlier error messages before hitting them,
 * and to centralise the shape callers work with. The database remains the
 * source of truth for ownership and identity-lock enforcement.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type { ContentPlacement, PlacementDestination, PublicationArtifactType } from "@/lib/types";

export interface CreatePlacementInput {
  firmId: string;
  deliverableId: string;
  periodId?: string | null;
  destination: PlacementDestination;
  locale?: string | null;
  intendedPath?: string | null;
  requiredArtifactType?: PublicationArtifactType | null;
  scheduledPublishDate?: string | null;
  createdByRole: "operator" | "lawyer" | "system";
  createdById?: string | null;
}

export async function listPlacementsForDeliverable(
  deliverableId: string,
): Promise<ContentPlacement[]> {
  const { data, error } = await supabase
    .from("content_placements")
    .select("*")
    .eq("deliverable_id", deliverableId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not load placements: ${error.message}`);
  return (data ?? []) as ContentPlacement[];
}

export async function listPlacementsForPeriod(periodId: string): Promise<ContentPlacement[]> {
  const { data, error } = await supabase
    .from("content_placements")
    .select("*")
    .eq("period_id", periodId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not load placements: ${error.message}`);
  return (data ?? []) as ContentPlacement[];
}

/**
 * Creates a placement. Returns { ok: false, error } on any failure,
 * including the database's own ownership-scope trigger firing (a
 * deliverable from a different firm than firmId, or a period from a
 * different firm) -- that trigger is the actual enforcement; this function
 * does not duplicate its logic, only surfaces its message.
 */
export async function createPlacement(
  input: CreatePlacementInput,
): Promise<{ ok: true; placement: ContentPlacement } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_placements")
    .insert({
      firm_id: input.firmId,
      deliverable_id: input.deliverableId,
      period_id: input.periodId ?? null,
      destination: input.destination,
      locale: input.locale ?? null,
      intended_path: input.intendedPath ?? null,
      required_artifact_type: input.requiredArtifactType ?? null,
      scheduled_publish_date: input.scheduledPublishDate ?? null,
      created_by_role: input.createdByRole,
      created_by_id: input.createdById ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, placement: data as ContentPlacement };
}

export interface UpdatePlacementInput {
  state?: "planned" | "ready" | "published" | "retired";
  intendedPath?: string | null;
  requiredArtifactType?: PublicationArtifactType | null;
  scheduledPublishDate?: string | null;
  periodId?: string | null;
}

/**
 * Updates only the mutable (non-identity) fields on a placement. The
 * database's identity-lock trigger rejects any attempt to change firm_id,
 * deliverable_id, destination, or locale; this function never attempts to
 * send those fields on an update.
 */
export async function updatePlacement(
  placementId: string,
  patch: UpdatePlacementInput,
): Promise<{ ok: true; placement: ContentPlacement } | { ok: false; error: string }> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.state !== undefined) update.state = patch.state;
  if (patch.intendedPath !== undefined) update.intended_path = patch.intendedPath;
  if (patch.requiredArtifactType !== undefined) update.required_artifact_type = patch.requiredArtifactType;
  if (patch.scheduledPublishDate !== undefined) update.scheduled_publish_date = patch.scheduledPublishDate;
  if (patch.periodId !== undefined) update.period_id = patch.periodId;

  const { data, error } = await supabase
    .from("content_placements")
    .update(update)
    .eq("id", placementId)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, placement: data as ContentPlacement };
}
