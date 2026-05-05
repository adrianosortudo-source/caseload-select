/**
 * Decline copy resolution — pure functions and types.
 *
 * Split out from decline-resolver.ts so the precedence rules can be tested
 * without dragging in the supabase-admin client (which marks itself
 * server-only and breaks Vitest module loading).
 *
 * Three-layer model per CRM Bible v5:
 *   1. per-lead override   — screened_leads.status_note (set in the Pass modal)
 *   2. per-PA variant      — firm_decline_templates row matching (firm_id, practice_area)
 *   3. firm default        — firm_decline_templates row matching (firm_id, NULL)
 *   4. system fallback     — hard-coded copy in this file, last resort
 */

// ─── System fallback ─────────────────────────────────────────────────────────
// Used only when no firm template exists. Deliberately neutral and short.
// Per the Brand Book: no em dashes, no italics, no banned vocabulary.

const SYSTEM_FALLBACK_SUBJECT = "Re: your inquiry";

const SYSTEM_FALLBACK_BODY =
  "Thank you for reaching out. After reviewing the details you shared, " +
  "this falls outside the matters our firm is currently in a position to take on. " +
  "We appreciate the time you took to write to us, and we wish you well finding the right counsel for your situation.";

const SYSTEM_FALLBACK_OOS_BODY = (areaLabel: string) =>
  `Thank you for reaching out. ${areaLabel} sits outside the matters our firm currently handles. ` +
  "We recommend contacting a lawyer who works in this area, or the Law Society of Ontario " +
  "referral service, for help finding the right person for your situation.";

const SYSTEM_FALLBACK_BACKSTOP_BODY =
  "Thank you for reaching out. We were not able to circle back on your matter " +
  "within our typical response window. We do not want to leave you waiting; " +
  "please feel free to reach out again if your situation has not yet been addressed.";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeclineSource = "per_lead_override" | "per_pa" | "firm_default" | "system_fallback";

export type DeclineFlavour = "lawyer_pass" | "oos" | "backstop";

export interface DeclineTemplateRow {
  practice_area: string | null;
  subject: string | null;
  body: string;
}

export interface DeclineCandidates {
  perLeadOverride: string | null;        // status_note value, if set
  perPaTemplate: DeclineTemplateRow | null;
  firmDefaultTemplate: DeclineTemplateRow | null;
}

export interface DeclineVerdict {
  subject: string;
  body: string;
  source: DeclineSource;
}

// ─── Pure resolver ────────────────────────────────────────────────────────────

export function resolveDecline(
  candidates: DeclineCandidates,
  flavour: DeclineFlavour,
  oosAreaLabel?: string,
): DeclineVerdict {
  // 1. Per-lead override
  if (candidates.perLeadOverride && candidates.perLeadOverride.trim().length > 0) {
    return {
      subject: SYSTEM_FALLBACK_SUBJECT,
      body: candidates.perLeadOverride.trim(),
      source: "per_lead_override",
    };
  }

  // 2. Per-PA variant
  if (candidates.perPaTemplate) {
    return {
      subject: candidates.perPaTemplate.subject?.trim() || SYSTEM_FALLBACK_SUBJECT,
      body: candidates.perPaTemplate.body.trim(),
      source: "per_pa",
    };
  }

  // 3. Firm default
  if (candidates.firmDefaultTemplate) {
    return {
      subject: candidates.firmDefaultTemplate.subject?.trim() || SYSTEM_FALLBACK_SUBJECT,
      body: candidates.firmDefaultTemplate.body.trim(),
      source: "firm_default",
    };
  }

  // 4. System fallback (flavour-aware)
  return {
    subject: SYSTEM_FALLBACK_SUBJECT,
    body:
      flavour === "oos"      ? SYSTEM_FALLBACK_OOS_BODY(oosAreaLabel ?? "this practice area")
      : flavour === "backstop" ? SYSTEM_FALLBACK_BACKSTOP_BODY
                              : SYSTEM_FALLBACK_BODY,
    source: "system_fallback",
  };
}
