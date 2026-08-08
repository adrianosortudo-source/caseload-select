/**
 * Lead-magnet landing-page CTA canon (F3, revised per
 * EXECUTION-PLAN_publish-gate-truthfulness_v1 Decision D4).
 *
 * The prior version of this file exported a single byte-exact literal,
 * `LOCKED_STRINGS.leadMagnetCtaHref = '<a href="[FORM DESTINATION
 * PENDING]">'`, and gate.ts asserted its PRESENCE in every landing body.
 * That string is the placeholder bug itself, corrected by
 * EXECUTION-PLAN_lead-magnet-chain_v1.md: the real, shipped landing bodies
 * (W32, both locales, both at v6) now carry a real destination href
 * (EN `https://drglaw.ca/resources/federal-corporation-annual-filing-checklist`,
 * PT `https://drglaw.ca/pt/resources/federal-corporation-annual-filing-checklist`).
 * A gate that demands the placeholder string be present was demanding the
 * bug back -- it could only ever pass on a body that still had the defect.
 *
 * Replaced with a rule, not a literal (Decision D4): assert the landing body
 * contains at least one href beginning `https://drglaw.ca/`, and zero hrefs
 * containing `PENDING` or beginning `[`. No slug is hardcoded, so this
 * cannot go stale when a future week's slug differs from this week's. Check
 * id renamed from `locked-string:` to `lead-magnet-cta:` in gate.ts to match.
 */

const REAL_HREF_RE = /href=(["'])(https:\/\/drglaw\.ca\/[^"']*)\1/gi;
const ANY_HREF_RE = /href=(["'])(.*?)\1/gi;

export interface LeadMagnetCtaResult {
  ok: boolean;
  /** What was verified, or what is wrong -- never a bare "ok". */
  detail: string;
}

/**
 * Pure evaluation of one landing-page body against the D4 CTA rule. Never
 * mutates, never reads the database or filesystem.
 */
export function evaluateLeadMagnetCta(bodyHtml: string): LeadMagnetCtaResult {
  const allHrefs: string[] = [];
  let m: RegExpExecArray | null;
  ANY_HREF_RE.lastIndex = 0;
  while ((m = ANY_HREF_RE.exec(bodyHtml)) !== null) {
    allHrefs.push(m[2]);
  }

  if (allHrefs.length === 0) {
    return { ok: false, detail: "no href attributes found in body at all; expected at least one https://drglaw.ca/ destination" };
  }

  const pendingOrBracket = allHrefs.filter((h) => h.includes("PENDING") || h.startsWith("["));
  REAL_HREF_RE.lastIndex = 0;
  const realCount = (bodyHtml.match(REAL_HREF_RE) ?? []).length;

  if (pendingOrBracket.length > 0) {
    return { ok: false, detail: `${pendingOrBracket.length} placeholder href(s) found (PENDING or bracket-prefixed): ${pendingOrBracket.join(", ")}` };
  }
  if (realCount === 0) {
    return { ok: false, detail: `no href beginning https://drglaw.ca/ found among ${allHrefs.length} href(s): ${allHrefs.join(", ")}` };
  }
  return { ok: true, detail: `${realCount} href(s) beginning https://drglaw.ca/ found, 0 PENDING/bracket placeholders` };
}
