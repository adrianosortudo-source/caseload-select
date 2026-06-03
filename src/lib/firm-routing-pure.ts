/**
 * Pure helpers for per-firm lead routing.
 *
 * This is the SINGLE source of truth for how a firm's routing config resolves
 * a lead lawyer + assignees at matter-creation time. `matter-stage.ts`
 * (the live consumer, called on every Band A take) imports `resolveMatterLead`
 * and `resolveMatterAssignees` from here, and the operator routing admin UI
 * imports the same functions for its "what happens now" preview. Sharing the
 * function is what keeps the UI honest: the preview cannot drift from the
 * behaviour a real intake gets.
 *
 * No I/O — the caller passes the already-fetched firm routing fields.
 *
 * Live semantics (do not change without changing the consumer):
 *   lead lawyer = default_lead_by_practice_area[practice_area]   (PA-specific)
 *              ?? default_lead_id                                 (firm fallback)
 *              ?? null                                            (no lead assigned)
 *   assignees   = default_assignees (flat array; NOT practice-area specific)
 *
 * Routing config is SNAPSHOTTED onto the matter at take time, so editing it
 * only affects matters taken afterwards; existing matters keep their snapshot.
 */

export interface FirmRoutingConfig {
  /** Map of practice_area -> firm_lawyers.id. */
  default_lead_by_practice_area?: Record<string, string> | null;
  /** Firm-wide fallback lead lawyer (firm_lawyers.id) when no PA match. */
  default_lead_id?: string | null;
  /** Lawyers snapshotted onto every new matter (firm_lawyers.id[]). */
  default_assignees?: string[] | null;
}

/**
 * The practice areas a lead can be classified into, in display order. Mirrors
 * PRACTICE_AREA_LABELS in screened-leads-labels.ts minus 'unknown' (the
 * unclassified catch-all, which is covered by the firm fallback lead). These
 * are the rows the routing UI offers a per-area default for; any area left
 * unset falls through to `default_lead_id`.
 */
export const ROUTING_PRACTICE_AREAS: readonly string[] = [
  'corporate',
  'real_estate',
  'employment',
  'estates',
  'family',
  'immigration',
  'criminal',
  'personal_injury',
] as const;

/**
 * Resolve the lead lawyer id for a matter, exactly as the live take path does.
 * Returns null when neither a practice-area default nor a firm fallback is set
 * (the matter is created with no lead lawyer).
 */
export function resolveMatterLead(
  config: FirmRoutingConfig | null | undefined,
  practiceArea: string | null | undefined,
): string | null {
  const paMap = (config?.default_lead_by_practice_area ?? {}) as Record<string, string>;
  if (practiceArea && paMap[practiceArea]) {
    return paMap[practiceArea];
  }
  if (config?.default_lead_id) {
    return config.default_lead_id;
  }
  return null;
}

/** How the lead was resolved, for an honest "what happens now" preview. */
export type LeadResolutionSource = 'practice_area' | 'firm_fallback' | 'none';

export function resolveMatterLeadWithSource(
  config: FirmRoutingConfig | null | undefined,
  practiceArea: string | null | undefined,
): { leadId: string | null; source: LeadResolutionSource } {
  const paMap = (config?.default_lead_by_practice_area ?? {}) as Record<string, string>;
  if (practiceArea && paMap[practiceArea]) {
    return { leadId: paMap[practiceArea], source: 'practice_area' };
  }
  if (config?.default_lead_id) {
    return { leadId: config.default_lead_id, source: 'firm_fallback' };
  }
  return { leadId: null, source: 'none' };
}

/** Resolve the assignee snapshot, exactly as the live take path does. */
export function resolveMatterAssignees(
  config: FirmRoutingConfig | null | undefined,
): string[] {
  return Array.isArray(config?.default_assignees) ? config!.default_assignees! : [];
}

// ── Validation + normalization for the admin save path ───────────────────────

export interface RoutingConfigDraft {
  /** practice_area -> firm_lawyers.id. Empty / blank values mean "unset". */
  default_lead_by_practice_area: Record<string, string>;
  default_lead_id: string | null;
  default_assignees: string[];
}

export type RoutingValidationResult =
  | { ok: true; normalized: RoutingConfigDraft }
  | { ok: false; errors: string[] };

/**
 * Validate a routing draft against the firm's actual lawyer ids and normalize
 * it for storage: blank/empty PA defaults are dropped (so the map only holds
 * real assignments), assignees are de-duplicated. Any id that is not a current
 * firm lawyer is a hard error — we never store a dangling reference.
 */
export function validateRoutingConfig(
  draft: RoutingConfigDraft,
  validLawyerIds: Iterable<string>,
): RoutingValidationResult {
  const valid = validLawyerIds instanceof Set ? validLawyerIds : new Set(validLawyerIds);
  const errors: string[] = [];

  // Practice-area defaults: keep only non-blank, validate each.
  const paMap: Record<string, string> = {};
  for (const [pa, rawId] of Object.entries(draft.default_lead_by_practice_area ?? {})) {
    const id = (rawId ?? '').trim();
    if (!id) continue; // blank means "unset" -> drop it
    if (!ROUTING_PRACTICE_AREAS.includes(pa)) {
      errors.push(`Unknown practice area "${pa}".`);
      continue;
    }
    if (!valid.has(id)) {
      errors.push(`Practice-area default for "${pa}" points to a lawyer who is not on this firm.`);
      continue;
    }
    paMap[pa] = id;
  }

  // Firm fallback lead.
  const fallbackRaw = (draft.default_lead_id ?? '').trim();
  const default_lead_id = fallbackRaw || null;
  if (default_lead_id && !valid.has(default_lead_id)) {
    errors.push('Firm fallback lead points to a lawyer who is not on this firm.');
  }

  // Assignees: de-dupe, drop blanks, validate each.
  const seen = new Set<string>();
  const default_assignees: string[] = [];
  for (const rawId of draft.default_assignees ?? []) {
    const id = (rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!valid.has(id)) {
      errors.push('A default assignee points to a lawyer who is not on this firm.');
      continue;
    }
    default_assignees.push(id);
  }

  if (errors.length > 0) {
    // De-dupe identical messages (e.g. multiple bad assignees).
    return { ok: false, errors: Array.from(new Set(errors)) };
  }
  return { ok: true, normalized: { default_lead_by_practice_area: paMap, default_lead_id, default_assignees } };
}
