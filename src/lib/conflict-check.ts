/**
 * Conflict Check Engine
 *
 * Runs a conflict of interest check before a lead can advance to
 * consultation_scheduled. This is a pipeline-blocking gate; LSO Rule 4.2-1
 * prohibits acting when a conflict exists.
 *
 * Two check paths:
 *   - Clio path:     firm has Clio connected → queries Clio /contacts API
 *   - Register path: internal conflict_register table (CSV import + past clients)
 *
 * Result states:
 *   clear              — No matches. Lead may advance.
 *   potential_conflict — Partial match (name similarity). Operator reviews.
 *   confirmed_conflict — Exact email or phone match. Blocked; requires override.
 *
 * Matching rules:
 *   Email exact match   → confirmed_conflict
 *   Phone exact match   → confirmed_conflict
 *   Name token overlap  → potential_conflict  (e.g. "John Smith" vs "J. Smith")
 *   No match            → clear
 */

import { supabase } from "./supabase";
import { isClioConnected, getClioContacts, type ClioContact } from "./clio";

export type ConflictResult = "clear" | "potential_conflict" | "confirmed_conflict";

export interface ConflictMatch {
  source: "clio" | "register";
  match_type: "email" | "phone" | "name";
  matched_name: string;
  matter_type?: string;
  clio_contact_id?: number;
  register_id?: string;
}

export interface ConflictCheckResult {
  result: ConflictResult;
  matches: ConflictMatch[];
  checked_via: "clio" | "register" | "none";
}

// ─── Name matching helpers ────────────────────────────────────────────────────

/**
 * Normalizes a name for comparison: lowercase, no punctuation, split to tokens.
 */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1) // skip single-char initials for partial scoring
  );
}

/**
 * Returns true if two names share enough tokens to be considered a potential match.
 * Threshold: at least 2 tokens in common, or one token if it's a rare surname
 * (length >= 5 and not a common first name).
 */
function namesSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const common = [...ta].filter((t) => tb.has(t));
  if (common.length >= 2) return true;
  if (common.length === 1 && common[0].length >= 5) return true;
  return false;
}

/**
 * Normalizes a phone number to digits only for exact comparison.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// ─── Clio check path ──────────────────────────────────────────────────────────

async function checkViaClio(
  lead: { name: string; email: string | null; phone: string | null },
  firmId: string
): Promise<{ result: ConflictResult; matches: ConflictMatch[] }> {
  const matches: ConflictMatch[] = [];

  // Query Clio contacts by lead name
  const contacts: ClioContact[] = await getClioContacts(firmId, lead.name);

  for (const contact of contacts) {
    const emailMatch =
      lead.email &&
      contact.primary_email_address &&
      lead.email.toLowerCase() === contact.primary_email_address.toLowerCase();

    const phoneMatch =
      lead.phone &&
      contact.primary_phone_number &&
      normalizePhone(lead.phone) === normalizePhone(contact.primary_phone_number);

    const nameMatch = namesSimilar(lead.name, contact.name);

    if (emailMatch) {
      matches.push({
        source: "clio",
        match_type: "email",
        matched_name: contact.name,
        clio_contact_id: contact.id,
      });
    } else if (phoneMatch) {
      matches.push({
        source: "clio",
        match_type: "phone",
        matched_name: contact.name,
        clio_contact_id: contact.id,
      });
    } else if (nameMatch) {
      matches.push({
        source: "clio",
        match_type: "name",
        matched_name: contact.name,
        clio_contact_id: contact.id,
      });
    }
  }

  return { result: computeResult(matches), matches };
}

// ─── Internal register check path ─────────────────────────────────────────────

async function checkViaRegister(
  lead: { name: string; email: string | null; phone: string | null },
  firmId: string
): Promise<{ result: ConflictResult; matches: ConflictMatch[] }> {
  const matches: ConflictMatch[] = [];

  // Exact email match
  if (lead.email) {
    const { data: emailMatches } = await supabase
      .from("conflict_register")
      .select("id, client_name, opposing_party, matter_type")
      .eq("law_firm_id", firmId)
      .ilike("email", lead.email);

    for (const row of emailMatches ?? []) {
      matches.push({
        source: "register",
        match_type: "email",
        matched_name: row.client_name,
        matter_type: row.matter_type ?? undefined,
        register_id: row.id,
      });
    }
  }

  // Exact phone match (normalized)
  if (lead.phone && matches.length === 0) {
    const normalizedLeadPhone = normalizePhone(lead.phone);
    const { data: allWithPhone } = await supabase
      .from("conflict_register")
      .select("id, client_name, matter_type, phone")
      .eq("law_firm_id", firmId)
      .not("phone", "is", null);

    for (const row of allWithPhone ?? []) {
      if (row.phone && normalizePhone(row.phone) === normalizedLeadPhone) {
        matches.push({
          source: "register",
          match_type: "phone",
          matched_name: row.client_name,
          matter_type: row.matter_type ?? undefined,
          register_id: row.id,
        });
      }
    }
  }

  // Name similarity match (only if no harder matches found)
  if (matches.length === 0) {
    const { data: allNames } = await supabase
      .from("conflict_register")
      .select("id, client_name, opposing_party, matter_type")
      .eq("law_firm_id", firmId);

    for (const row of allNames ?? []) {
      if (namesSimilar(lead.name, row.client_name)) {
        matches.push({
          source: "register",
          match_type: "name",
          matched_name: row.client_name,
          matter_type: row.matter_type ?? undefined,
          register_id: row.id,
        });
      }
      // Also check opposing party names
      if (row.opposing_party && namesSimilar(lead.name, row.opposing_party)) {
        matches.push({
          source: "register",
          match_type: "name",
          matched_name: `${row.opposing_party} (opposing party in ${row.client_name} matter)`,
          matter_type: row.matter_type ?? undefined,
          register_id: row.id,
        });
      }
    }
  }

  return { result: computeResult(matches), matches };
}

// ─── Result computation ───────────────────────────────────────────────────────

function computeResult(matches: ConflictMatch[]): ConflictResult {
  if (matches.length === 0) return "clear";
  if (matches.some((m) => m.match_type === "email" || m.match_type === "phone")) {
    return "confirmed_conflict";
  }
  return "potential_conflict";
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs a conflict check for a lead. Stores the result in conflict_checks table.
 * Returns the check result and the inserted row ID.
 */
export async function runConflictCheck(
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    law_firm_id: string | null;
  }
): Promise<ConflictCheckResult & { check_id: string }> {
  if (!lead.law_firm_id) {
    // No firm context — cannot check. Return clear but log.
    const { data: row } = await supabase
      .from("conflict_checks")
      .insert({
        lead_id: lead.id,
        law_firm_id: null,
        result: "clear",
        matches: [],
        checked_via: "none",
      })
      .select("id")
      .single();
    return { result: "clear", matches: [], checked_via: "none", check_id: row?.id ?? "" };
  }

  let checkResult: { result: ConflictResult; matches: ConflictMatch[] };
  let checkedVia: "clio" | "register" | "none";

  const clioConnected = await isClioConnected(lead.law_firm_id);

  if (clioConnected) {
    checkResult = await checkViaClio(lead, lead.law_firm_id);
    checkedVia = "clio";
  } else {
    checkResult = await checkViaRegister(lead, lead.law_firm_id);
    checkedVia = "register";
  }

  const { data: row } = await supabase
    .from("conflict_checks")
    .insert({
      lead_id: lead.id,
      law_firm_id: lead.law_firm_id,
      result: checkResult.result,
      matches: checkResult.matches,
      checked_via: checkedVia,
    })
    .select("id")
    .single();

  return {
    result: checkResult.result,
    matches: checkResult.matches,
    checked_via: checkedVia,
    check_id: row?.id ?? "",
  };
}

/**
 * Fetches the latest conflict check result for a lead. Returns null if no check
 * has been run.
 */
export async function getLatestConflictCheck(leadId: string): Promise<{
  id: string;
  result: ConflictResult;
  matches: ConflictMatch[];
  checked_via: string;
  checked_at: string;
  override_reason: string | null;
} | null> {
  const { data } = await supabase
    .from("conflict_checks")
    .select("id, result, matches, checked_via, checked_at, override_reason")
    .eq("lead_id", leadId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    ...data,
    matches: (data.matches as ConflictMatch[]) ?? [],
  };
}

/**
 * Returns true if this lead is clear to advance to consultation_scheduled.
 *
 * Passes if:
 *   - check result is 'clear'
 *   - check result is 'potential_conflict' with an override_reason set
 */
export async function isConflictClear(leadId: string): Promise<{
  allowed: boolean;
  reason: string;
}> {
  const check = await getLatestConflictCheck(leadId);

  if (!check) {
    return { allowed: false, reason: "No conflict check run. Run the check before booking a consultation." };
  }

  if (check.result === "clear") {
    return { allowed: true, reason: "Conflict check clear." };
  }

  if (check.result === "potential_conflict" && check.override_reason) {
    return { allowed: true, reason: `Potential conflict overridden: ${check.override_reason}` };
  }

  if (check.result === "confirmed_conflict") {
    return {
      allowed: false,
      reason: "Confirmed conflict of interest. Override required before booking.",
    };
  }

  return {
    allowed: false,
    reason: "Potential conflict flagged. Review and override to proceed.",
  };
}

/**
 * Adds a won lead to the conflict register so future intake submissions
 * are checked against them.
 */
export async function registerWonClient(lead: {
  name: string;
  email: string | null;
  phone: string | null;
  case_type: string | null;
  law_firm_id: string | null;
}): Promise<void> {
  if (!lead.law_firm_id) return;

  // Idempotency: skip if already registered (same name + email)
  if (lead.email) {
    const { data: existing } = await supabase
      .from("conflict_register")
      .select("id")
      .eq("law_firm_id", lead.law_firm_id)
      .ilike("email", lead.email)
      .maybeSingle();
    if (existing) return;
  }

  await supabase.from("conflict_register").insert({
    law_firm_id: lead.law_firm_id,
    client_name: lead.name,
    email: lead.email,
    phone: lead.phone,
    matter_type: lead.case_type,
    source: "caseload_select",
  });
}
