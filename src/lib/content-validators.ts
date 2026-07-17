// Note (2026-07-02): "import server-only" removed. This file is pure logic
// with no I/O (no supabaseAdmin, no fetch, no secrets), so the guard was
// defensive boilerplate rather than a real requirement, and the real
// "server-only" package throws unconditionally on import (it is only made
// safe by Next.js aliasing it away in server bundles). This file now has its
// own direct unit test (content-validators.test.ts) that imports it as a
// plain module under vitest's node environment, which does not get that
// Next.js aliasing, so the unconditional throw would break the test. Same
// pattern already documented in CLAUDE.md's Developer Gotchas section for IO
// libs imported by a route that has its own test.
import {
  SERVICE_PAGE_SECTION_KEYS,
  flattenServicePageToPlainText,
  type ServicePageBlock,
} from "./content-studio-structured";
import { extractHost, type InternalLinkTarget } from "./content-studio-links";

export type ValidatorKey =
  | "answer_top_30_percent_text"
  | "primary_query_presence_text"
  | "jurisdiction_service_area_early_text"
  | "banned_vocabulary"
  | "approved_vocabulary"
  | "em_dash"
  | "italics_markup"
  | "orphan_words"
  | "word_count"
  | "required_sections"
  | "lso_compliance"
  | "opening_discipline"
  | "source_integrity"
  | "rule_of_three"
  | "factual_claim"
  | "specialist_self_designation"
  | "timing_promise"
  | "hook_retain_reward"
  | "fake_scarcity"
  | "email_respect"
  | "weasel_words"
  | "rejected_cta"
  | "review_request"
  | "review_request_casl"
  | "negative_review_response"
  | "testimonial_content"
  | "lso_superlative"
  | "referral_copy"
  | "no_incentivized_review"
  | "no_review_removal"
  | "no_free_consult_lure"
  | "no_distress_hero"
  | "no_us_trust_badge"
  | "no_lsa_quality_claim"
  | "page_structure"
  | "named_author_present"
  | "faq_block_present"
  | "answer_top_30_percent"
  | "last_updated_visible"
  | "primary_query_presence"
  | "jurisdiction_service_area_early"
  | "internal_links_present"
  | "faq_question_shape"
  | "schema_directives_present"
  | "internal_link_domain_allowlist"
  | "heading_query_alignment"
  | "entity_present"
  | "secondary_query_coverage"
  | "service_area_presence"
  | "no_cannibalization"
  | "pt_jurisdiction_disclosure"
  | "structural_monotony";

export type Severity = "fail" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  location?: string;
}

export interface ValidatorResult {
  key: ValidatorKey;
  status: "pass" | "warn" | "fail" | "error";
  severity: Severity;
  findings: Finding[];
}

export interface ValidatorConfig {
  banned_vocabulary: string[];
  approved_vocabulary: string[];
  lso_constraints: string[];
  formatting_rules: {
    no_em_dashes: boolean;
    no_italics: boolean;
    no_orphan_words: boolean;
    no_rule_of_three: boolean;
    no_timing_promises?: boolean;
    no_specialist_language?: boolean;
    no_factual_hallucination?: boolean;
    enforce_hook_retain_reward?: boolean;
    no_fake_scarcity?: boolean;
    no_weasel_words?: boolean;
    enforce_email_respect?: boolean;
    no_rejected_ctas?: boolean;
    enforce_review_request_compliance?: boolean;
    enforce_negative_review_response?: boolean;
    enforce_testimonial_content?: boolean;
    no_lso_superlatives?: boolean;
    no_referral_violations?: boolean;
    no_incentivized_review?: boolean;
    no_review_removal_copy?: boolean;
    no_free_consult_lure?: boolean;
    no_distress_hero?: boolean;
    no_us_trust_badges?: boolean;
    no_lsa_quality_claim?: boolean;
    no_structural_monotony?: boolean;
  };
  rejected_ctas?: string[];
  certified_specialists?: Array<{ lawyer: string; areas: string[] }>;
  format_spec: {
    word_range?: [number, number];
    structure?: string[];
    page_structure?: string[];
  };
  format?: string;
  // Ses.17 WP-3: the firm's real entity facts, threaded through so the new
  // entity/domain validators need no extra parameters beyond config +
  // sourceBrief. Populated by buildValidatorConfig from
  // strategy_json.canonical_nap.
  entity_names?: string[];
  firm_website?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateBannedVocabulary(
  text: string,
  banned: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  for (const term of banned) {
    const pattern = new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, "gi");
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "banned_vocabulary",
        severity: "fail",
        message: `Banned term "${term}" found (${matches.length} occurrence${matches.length > 1 ? "s" : ""}).`,
      });
    }
  }
  return {
    key: "banned_vocabulary",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateApprovedVocabulary(
  text: string,
  approved: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  let found = 0;
  for (const term of approved) {
    if (lower.includes(term.toLowerCase())) found++;
  }
  const ratio = approved.length > 0 ? found / approved.length : 1;
  if (ratio < 0.1) {
    findings.push({
      rule: "approved_vocabulary",
      severity: "warn",
      message: `Only ${found}/${approved.length} approved terms used. Consider incorporating more brand-aligned vocabulary.`,
    });
  }
  return {
    key: "approved_vocabulary",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

const EM_DASH_CHAR = "—";

export function validateEmDash(text: string): ValidatorResult {
  const findings: Finding[] = [];
  let count = 0;
  for (const ch of text) {
    if (ch === EM_DASH_CHAR) count++;
  }
  if (count > 0) {
    findings.push({
      rule: "em_dash",
      severity: "fail",
      message: `${count} em dash(es) found. Use commas, colons, semicolons, or restructure.`,
    });
  }
  return {
    key: "em_dash",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateItalicsMarkup(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const italicPatterns = [
    // Single-asterisk italics only. The lookbehind/lookahead exclude any `*`
    // that is part of a `**bold**` pair, so a bold phrase (a legitimate,
    // encouraged emphasis pattern in this codebase's Markdown output) is
    // never miscounted as italics. Confirmed false-positive class caught
    // during the Ses.16 WP-4 run: a body with zero italics and three bold
    // subheads reported "3 italic marker(s) found" under the prior pattern
    // (`/\*[^*\n]+\*/g`), which matches the inner `*text*` hiding inside
    // `**text**` because it does not check what is on either side of the
    // asterisks it captures.
    /(?<!\*)\*(?!\*)[^*\n]+(?<!\*)\*(?!\*)/g,
    /(?<!_)_(?!_)[^_\n]+(?<!_)_(?!_)/g,
    /<em>/gi,
    /<i>/gi,
    /font-style:\s*italic/gi,
  ];
  let total = 0;
  for (const pattern of italicPatterns) {
    const matches = text.match(pattern);
    if (matches) total += matches.length;
  }
  if (total > 0) {
    findings.push({
      rule: "italics_markup",
      severity: "fail",
      message: `${total} italic marker(s) found. Emphasis uses weight (700) and small caps (600), never italics.`,
    });
  }
  return {
    key: "italics_markup",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

export function validateOrphanWords(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed || trimmed.length < 40) continue;
    const words = trimmed.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length <= 3 && words.length > 6) {
      findings.push({
        rule: "orphan_words",
        severity: "warn",
        message: `Possible orphan word "${lastWord}" at end of paragraph. Review line breaks.`,
        location: trimmed.slice(0, 60) + "...",
      });
    }
  }
  return {
    key: "orphan_words",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateWordCount(
  text: string,
  range: [number, number]
): ValidatorResult {
  const findings: Finding[] = [];
  const words = text
    .replace(/<[^>]*>/g, "")
    .replace(/[#*_`~\[\]]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;

  if (words < range[0]) {
    findings.push({
      rule: "word_count",
      severity: "warn",
      message: `${words} words. Target range is ${range[0]}-${range[1]}. Consider expanding.`,
    });
  } else if (words > range[1]) {
    findings.push({
      rule: "word_count",
      severity: "warn",
      message: `${words} words. Target range is ${range[0]}-${range[1]}. Consider tightening.`,
    });
  }
  return {
    key: "word_count",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateRequiredSections(
  text: string,
  sections: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  for (const section of sections) {
    if (section === "five_line_brief") {
      const briefTerms = ["risk", "price", "timeline", "decision", "next step"];
      const missing = briefTerms.filter((t) => !lower.includes(t));
      if (missing.length > 2) {
        findings.push({
          rule: "required_sections",
          severity: "fail",
          message: `Five-Line Brief incomplete. Missing: ${missing.join(", ")}.`,
        });
      }
    }
  }
  return {
    key: "required_sections",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

export function validateLsoCompliance(text: string): ValidatorResult {
  const findings: Finding[] = [];

  const outcomePromises = [
    // "Guarantee" as a promise-shaped construction only, not the bare noun.
    // A bare `\bguarantee[sd]?\b` also matches "personal guarantee" and
    // "guarantee clause", real legal-instrument terms with load-bearing use
    // in real estate/commercial content (a lease's personal guarantee is
    // the subject of an already-live DRG Law article). Confirmed
    // false-positive class during the Ses.16 WP-4 run.
    /\b(we|our firm|i)\s+(can\s+|will\s+)?guarantee[sd]?\b/i,
    /\bguarantee[sd]?\s+(you|your)\b/i,
    /\b(is|are|will\s+be)\s+guaranteed\s+to\b/i,
    /\bguaranteed\s+(win|victory|result|outcome|success|results|outcomes)\b/i,
    /\bensure[sd]?\s+(you|your|the)\b/i,
    /\bwill\s+win\b/i,
    /\bwill\s+succeed\b/i,
    /\bwill\s+recover\b/i,
    /\b100%\s+(success|recovery|guarantee)\b/i,
  ];
  for (const pattern of outcomePromises) {
    if (pattern.test(text)) {
      findings.push({
        rule: "lso_compliance",
        severity: "fail",
        message: `Possible outcome promise: "${text.match(pattern)?.[0]}". LSO Rule 4.2-1 prohibits outcome guarantees.`,
      });
    }
  }

  const superlatives = [
    /\bbest\s+(lawyer|firm|attorney|legal)\b/i,
    /\btop[-\s]rated\b/i,
    // `#` is not a word character, so a leading `\b` can never match before
    // it (no word/non-word boundary exists between a space and `#`); the
    // prior `/\b#\s*1\b/i` never matched anything. Found via the regression
    // test written alongside the guarantee-pattern fix above.
    /#\s*1\b/i,
    /\bnumber\s+one\b/i,
    /\bunmatched\b/i,
    /\bunparalleled\b/i,
  ];
  for (const pattern of superlatives) {
    if (pattern.test(text)) {
      findings.push({
        rule: "lso_compliance",
        severity: "fail",
        message: `Unverifiable superlative: "${text.match(pattern)?.[0]}". LSO Rule 4.2-1 prohibits unverifiable claims.`,
      });
    }
  }

  return {
    key: "lso_compliance",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

export function validateOpeningDiscipline(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const firstParagraph = text.split(/\n{2,}/)[0]?.trim() ?? "";

  const performanceOpeners = [
    /^at\s+(drg|our|the\s+firm)/i,
    /^we\s+(are|have|pride|specialize|offer)/i,
    /^(our|the)\s+firm\s+(is|has|was|offers|provides)/i,
    /^with\s+(over|more\s+than)\s+\d+\s+years/i,
  ];
  for (const pattern of performanceOpeners) {
    if (pattern.test(firstParagraph)) {
      findings.push({
        rule: "opening_discipline",
        severity: "warn",
        message: "Opens with firm performance, not consequence. Lead with what changes for the reader.",
      });
    }
  }

  const suspenseBait = [
    /^(you won't believe|what if|imagine|picture this|here's the thing)/i,
    /^(did you know|have you ever|most people don't)/i,
  ];
  for (const pattern of suspenseBait) {
    if (pattern.test(firstParagraph)) {
      findings.push({
        rule: "opening_discipline",
        severity: "warn",
        message: "Suspense bait opening detected. Open with consequence.",
      });
    }
  }

  return {
    key: "opening_discipline",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// Ses.17 WP-5: paid_traffic_landing, review_request, and review_response
// don't use the decision_question/legal_distinction/consequence brief shape
// at all (their format_specs define an entirely different set of fields:
// testimonials, review_context, channel-specific structure). Found live
// during the WP-5 prod smoke test: a clean review_request draft failed
// validation on three fields that format was never designed around, because
// this check ran unconditionally for every format with a source_brief.
const NO_DECISION_BRIEF_FORMATS = new Set([
  "paid_traffic_landing",
  "review_request",
  "review_response",
]);

export function validateSourceIntegrity(
  sourceBrief: Record<string, unknown>,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (format && NO_DECISION_BRIEF_FORMATS.has(format)) {
    return { key: "source_integrity", status: "pass", severity: "info", findings };
  }
  const required = ["decision_question", "legal_distinction", "consequence"];
  for (const field of required) {
    const val = sourceBrief[field];
    if (!val || (typeof val === "string" && val.trim().length === 0)) {
      findings.push({
        rule: "source_integrity",
        severity: "fail",
        message: `Source brief missing required field: ${field}.`,
      });
    }
  }
  return {
    key: "source_integrity",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// Markdown-format SEO/AEO retrofit (Step 5, added 2026-07-02, SEO/AEO spec
// Section 10 step 5, operator-confirmed). Plain-text siblings of the
// structured canonical_service_page validators further down this file:
// counsel_note, checklist, and any other Markdown-generated format never
// populate body_structured/seo_metadata, so these operate on the rendered
// body_markdown string directly instead. Each is a no-op (pass, no findings)
// when the relevant source_brief field is absent, so pieces that do not use
// the new SEO/AEO fields are unaffected; runDeterministicValidators only
// calls them when the field is present (see the sourceBrief block near the
// end of that function), so they also do not add result-list noise for
// pieces that never opted in.
//
// significantWords / queryOverlapRatio / escapeRegex are shared with the
// structured validators (defined once, used by both; escapeRegex near the
// top of this file, significantWords/queryOverlapRatio further down; all are
// plain `function` declarations, so hoisting makes them usable here
// regardless of textual order).
// =============================================================================

export function validateAnswerInTop30PercentText(
  text: string,
  primaryQuery?: string,
  answerSummary?: string
): ValidatorResult {
  const findings: Finding[] = [];
  const queryTerm = primaryQuery || answerSummary;
  if (!queryTerm) {
    return { key: "answer_top_30_percent_text", status: "pass", severity: "info", findings };
  }
  const top30 = text.slice(0, Math.max(1, Math.ceil(text.length * 0.3)));
  const ratio = queryOverlapRatio(queryTerm, top30);
  if (ratio === 0) {
    findings.push({
      rule: "answer_top_30_percent_text",
      severity: "fail",
      message:
        "No content matching the primary query or answer summary appears in the first 30% of the piece. Lead with the direct answer, not a topic-scoping opener (CXL Google AI Overviews citation study: 55% of citations come from the first 30% of a page).",
    });
  } else if (ratio < 0.5) {
    findings.push({
      rule: "answer_top_30_percent_text",
      severity: "warn",
      message: `Only partial overlap (${Math.round(ratio * 100)}%) between the query/answer summary and the first 30% of the piece. Confirm the opening paragraph states the direct answer.`,
    });
  }
  return {
    key: "answer_top_30_percent_text",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validatePrimaryQueryPresenceText(
  text: string,
  primaryQuery?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!primaryQuery || !primaryQuery.trim()) {
    return { key: "primary_query_presence_text", status: "pass", severity: "info", findings };
  }
  // A Markdown piece has no separate title/H1 field the way the structured
  // format does; the first heading line plus a few lines after it is the
  // closest proxy for "title + opening".
  const lines = text.split("\n");
  const firstHeadingIndex = lines.findIndex((l) => /^#{1,2}\s/.test(l.trim()));
  const openingLines =
    firstHeadingIndex >= 0
      ? lines.slice(firstHeadingIndex, firstHeadingIndex + 6)
      : lines.slice(0, 6);
  const opening = openingLines.join(" ");
  const ratio = queryOverlapRatio(primaryQuery, opening);
  if (ratio === 0) {
    findings.push({
      rule: "primary_query_presence_text",
      severity: "fail",
      message: `Primary query "${primaryQuery}" has no overlap with the heading or opening paragraph.`,
    });
  } else if (ratio < 0.5) {
    findings.push({
      rule: "primary_query_presence_text",
      severity: "warn",
      message: `Primary query "${primaryQuery}" only partially appears (${Math.round(ratio * 100)}%) in the heading and opening paragraph.`,
    });
  }

  const exactPhrasePattern = new RegExp(escapeRegex(primaryQuery.trim()), "gi");
  const occurrences = (text.match(exactPhrasePattern) ?? []).length;
  if (occurrences >= 3) {
    findings.push({
      rule: "primary_query_presence_text",
      severity: "warn",
      message: `The exact phrase "${primaryQuery}" appears ${occurrences} times verbatim. That reads as keyword stuffing; vary the phrasing.`,
    });
  }

  return {
    key: "primary_query_presence_text",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

export function validateJurisdictionServiceAreaEarlyText(
  text: string,
  jurisdiction?: string,
  serviceArea?: string | string[]
): ValidatorResult {
  const findings: Finding[] = [];
  if (!jurisdiction && !serviceArea) {
    return { key: "jurisdiction_service_area_early_text", status: "pass", severity: "info", findings };
  }
  const lower = text.toLowerCase();
  const earlyWindow = text.slice(0, Math.max(1, Math.ceil(text.length * 0.3))).toLowerCase();

  if (jurisdiction && jurisdiction.trim()) {
    const j = jurisdiction.toLowerCase();
    if (!lower.includes(j)) {
      findings.push({
        rule: "jurisdiction_service_area_early_text",
        severity: "fail",
        message: `Jurisdiction "${jurisdiction}" does not appear anywhere in the piece.`,
      });
    } else if (!earlyWindow.includes(j)) {
      findings.push({
        rule: "jurisdiction_service_area_early_text",
        severity: "warn",
        message: `Jurisdiction "${jurisdiction}" appears in the piece but not within the first 30%.`,
      });
    }
  }

  if (serviceArea) {
    const areas = Array.isArray(serviceArea) ? serviceArea : [serviceArea];
    const missing = areas.filter((a) => a.trim() && !lower.includes(a.toLowerCase()));
    if (missing.length > 0) {
      findings.push({
        rule: "jurisdiction_service_area_early_text",
        severity: "warn",
        message: `Service area(s) not found in the piece: ${missing.join(", ")}.`,
      });
    }
  }

  return {
    key: "jurisdiction_service_area_early_text",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// =============================================================================
// Rule of three (B9 Albrighton contradiction, doctrine wins)
// Detects decorative three-item parallels separated by commas/conjunctions.
// Flags as warn (often the items are genuinely distinct); operator clears via
// per-piece acknowledged_rule_of_three flag in source_brief.
// =============================================================================
export function validateRuleOfThree(text: string): ValidatorResult {
  const findings: Finding[] = [];
  // Triple-comma parallel: "A, B, and C" or "A, B, C" where A/B/C are short noun
  // or verb phrases (under 6 words each). Allow legitimate enumerations like
  // proper noun lists by requiring the comma sequence be inside a single sentence.
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    // Skip headings and list items.
    if (/^[\s#*\-\d.]+/.test(s.trimStart()) && s.length < 80) continue;
    // Match "X, Y,? and Z" pattern with each term 1-6 words and no nested clauses.
    const m = s.match(
      /\b([a-z][a-z\s'-]{1,40}?),\s+([a-z][a-z\s'-]{1,40}?),?\s+(?:and|or)\s+([a-z][a-z\s'-]{1,40}?)(?=[.,;:!?)]|$)/i
    );
    if (m) {
      const items = [m[1], m[2], m[3]].map((t) => t.trim().split(/\s+/).length);
      // Only flag when all three are short (<=6 words) — that's the decorative shape.
      if (items.every((n) => n <= 6)) {
        findings.push({
          rule: "rule_of_three",
          severity: "warn",
          message: `Possible decorative rule-of-three: "${m[0]}". Keep only if the three items are genuinely distinct and necessary.`,
        });
      }
    }
  }
  return {
    key: "rule_of_three",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// =============================================================================
// Factual-claim blocker (B10 Castagliano + Vane; B3 anti-pattern)
// Flags specific assertions that require human verification before publish:
// named statutes, case names, statistics, dollar figures, named outcomes.
// Severity is fail (blocking) unless the piece carries a verified flag.
//
// X5 (2026-06-26): even when verified_facts = true, outcome-bearing patterns
// (won/recovered/settled-for/$X/N% success/N matters won) require the
// LSO Rule 4.2-1 past-results disclaimer to appear within the same containing
// block. C8 Rule 4.2-1 testimonial commentary; L8 landmine 8.
// =============================================================================
const OUTCOME_BEARING_PATTERNS: RegExp[] = [
  /\b(?:won|recovered|settled\s+for|obtained|secured)\s+(?:a|an|the|over|more\s+than|\$)/gi,
  /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g,
  /\b\d+(?:\.\d+)?\s*%\s*(?:success|win|recovery)/gi,
];

const PAST_RESULTS_DISCLAIMER = /past\s+results?\s+(?:are\s+)?(?:not\s+necessarily\s+|do\s+not\s+necessarily\s+)?indicat(?:e|ive)\s+(?:of\s+)?future\s+results?/i;

export function validateFactualClaim(
  text: string,
  verifiedFacts: boolean = false
): ValidatorResult {
  const findings: Finding[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["statute_citation", /\b(?:s\.|section)\s+\d+(?:\.\d+|\(\d+\))?/gi],
    ["statute_short", /\bR\.S\.O\.\s+\d{4},?\s+c\.\s*[A-Z][\w.-]*/g],
    ["regulation_short", /\bO\.?\s*Reg\.?\s+\d+\/\d+/g],
    ["percentage_claim", /\b\d+(?:\.\d+)?\s*%/g],
    ["dollar_claim", /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g],
    [
      "outcome_phrasing",
      /\b(?:won|recovered|settled\s+for|obtained|secured)\s+(?:a|an|the|over|more\s+than|\$)/gi,
    ],
    [
      "year_claim",
      /\b(?:over|more\s+than|across|with)\s+\d{1,3}\s+(?:years?|cases?|clients?|matters?)\b/gi,
    ],
  ];
  if (!verifiedFacts) {
    for (const [name, pattern] of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        const sample = matches.slice(0, 3).join(", ");
        findings.push({
          rule: "factual_claim",
          severity: "fail",
          message: `Unverified specific claim detected (${name}): ${sample}. Human verification required before publish. Set source_brief.verified_facts = true to acknowledge.`,
        });
      }
    }
  }
  // X5: when verified_facts is true, outcome-bearing figures still need the
  // past-results disclaimer for Rule 4.2-1 compliance.
  if (verifiedFacts) {
    let outcomeBearing = false;
    for (const pattern of OUTCOME_BEARING_PATTERNS) {
      if (pattern.test(text)) {
        outcomeBearing = true;
        break;
      }
    }
    if (outcomeBearing && !PAST_RESULTS_DISCLAIMER.test(text)) {
      findings.push({
        rule: "factual_claim",
        severity: "fail",
        message:
          'LSO Rule 4.2-1: a verified outcome figure (amount, percentage, won/recovered/settled-for) requires the past-results disclaimer within the same block. Add "Past results are not necessarily indicative of future results."',
      });
    }
  }
  return {
    key: "factual_claim",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// Specialist self-designation (B6 contradiction; replaces naive lso regex)
// Allows "expert witness", "expert report", legitimate uses; flags only
// firm/lawyer-as-subject self-designation, which breaches LSO Rule 4.2-1.
// =============================================================================
export function validateSpecialistSelfDesignation(text: string): ValidatorResult {
  const findings: Finding[] = [];
  // Sentence-aware: catch "we/our firm/the firm/[firm name]/[lawyer name]" + be-verb + specialist/expert/leader
  const subjectVerbDesignation =
    /\b(?:we|our\s+(?:firm|practice|lawyers?|team)|the\s+firm|DRG(?:\s+Law)?|Damaris(?:\s+\w+)*?)\s+(?:are|is|am|have\s+been|remain|stand)\s+(?:a\s+|the\s+|an\s+)?(?:specialist|specialists|expert|experts|leader|leaders|top|best|premier|elite|leading|trusted|preeminent)\b/gi;
  const matches = text.match(subjectVerbDesignation);
  if (matches) {
    for (const m of matches) {
      findings.push({
        rule: "specialist_self_designation",
        severity: "fail",
        message: `Self-designation "${m}" breaches LSO Rule 4.2-1. DRG holds no LSO specialist certification; reframe as factual capability.`,
      });
    }
  }
  // Standalone "specialist/expert" claims without LSO certification context.
  const standalone =
    /\b(?:certified\s+specialist|board[- ]certified|legal\s+specialist|LSO[- ]certified|recognized\s+expert)\b/gi;
  const cmatches = text.match(standalone);
  if (cmatches) {
    for (const m of cmatches) {
      findings.push({
        rule: "specialist_self_designation",
        severity: "fail",
        message: `"${m}" implies LSO certified specialist status. DRG holds no such designation; remove or qualify with the exact certifying body.`,
      });
    }
  }
  return {
    key: "specialist_self_designation",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// Timing-promise validator (audit catch carries forward, B5 White + B9 LSO)
// Catches every shape of "we respond within N" / "fast turnaround" / etc.
// Whitelists real legal deadlines that are factually stated.
// =============================================================================
export function validateTimingPromise(text: string): ValidatorResult {
  const findings: Finding[] = [];
  // X1 (2026-06-26): tightened with soft-phrasing variants surfaced by C5
  // ("we will reach out shortly", "we typically respond before end of day", etc).
  const patterns: RegExp[] = [
    /\bwithin\s+(?:a|the|one|two|few|several|\d+)\s+(?:minute|hour|day|business[-\s]?day|moment|second)s?\b/gi,
    /\bready\s+in\s+\d+\s+(?:day|hour|minute|business)s?\b/gi,
    /\bsame[-\s]day\s+(?:response|reply|turnaround|service)\b/gi,
    /\bnext[-\s]day\s+(?:response|reply|turnaround|service)\b/gi,
    /\bfast\s+turnaround\b/gi,
    /\bquick\s+(?:response|reply|turnaround|service)\b/gi,
    /\breplies?\s+within\b/gi,
    /\bresponds?\s+within\s+\d+/gi,
    /\b\d+[-\s](?:hour|minute|day)\s+(?:response|reply|turnaround)\b/gi,
    /\binstant\s+(?:reply|response|access|review)\b/gi,
    // MEDIUM 2 catch 2026-06-26: subject morphology broadened to cover intake
    // staff, receptionist, named lawyer, plural firm references. Codex caught
    // "our intake coordinator will respond promptly" slipping through.
    /\b(?:we|the\s+firm|drg(?:\s+law)?|(?:our|the)\s+(?:intake\s+(?:coordinator|specialist|team|staff)|team|staff|receptionist|front\s+desk|lawyer|attorney|firm's\s+team)|a\s+lawyer|an\s+attorney|damaris(?:\s+\w+){0,3})\s+(?:will\s+)?(?:reach\s+out|respond|reply|get\s+back|call\s+(?:you\s+)?back|follow\s+up)\s+(?:to\s+you\s+)?(?:shortly|promptly|right\s+away|soon|asap|immediately)\b/gi,
    /\b(?:we|the\s+firm|(?:our|the)\s+(?:intake|team|staff|receptionist|lawyer|attorney))\s+(?:typically|usually|normally|generally)\s+(?:respond|reply|reach\s+out|get\s+back|follow\s+up|call)\b/gi,
    /\bbefore\s+(?:end\s+of\s+day|the\s+end\s+of\s+the\s+day|eod)\b/gi,
    /\bturnaround\s+time\b/gi,
    /\bguaranteed?\s+(?:response|reply|turnaround)\b/gi,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        findings.push({
          rule: "timing_promise",
          severity: "fail",
          message: `Timing promise "${m}" violates LSO Rule 4.2-1 (service-quality claim requiring substantiation). Describe the service feature instead (who reads the intake, bilingual capacity).`,
        });
      }
    }
  }
  return {
    key: "timing_promise",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// Hook / Retain / Reward (B6 Hormozi)
// Short-form formats (gbp_post, linkedin_share, linkedin_post) must carry all
// three beats: a hook (specific situation, question, or surprising fact),
// retention body (the actual idea), and a reward/next-step. Warn-level.
// =============================================================================
export function validateHookRetainReward(text: string, format?: string): ValidatorResult {
  const findings: Finding[] = [];
  const shortFormFormats = new Set([
    "gbp_post",
    "gbp_photoscrim_card",
    "gbp_ad_card",
    "linkedin_share",
    "linkedin_post",
    "linkedin_article_share",
  ]);
  if (!format || !shortFormFormats.has(format)) {
    return {
      key: "hook_retain_reward",
      status: "pass",
      severity: "info",
      findings,
    };
  }
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    findings.push({
      rule: "hook_retain_reward",
      severity: "fail",
      message: "Short-form piece is empty.",
    });
    return {
      key: "hook_retain_reward",
      status: "fail",
      severity: "fail",
      findings,
    };
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  // Hook: question, specific situation marker, or surprising fact (number/contrast).
  const hasHook =
    /\?/.test(first) ||
    /\b(?:before|after|when|if|most|every|the\s+real|here is|here's|one\s+thing)\b/i.test(first) ||
    /\d/.test(first);
  if (!hasHook) {
    findings.push({
      rule: "hook_retain_reward",
      severity: "warn",
      message: `Hook missing on opening line: "${first.slice(0, 80)}". Open with a question, a specific situation, or a surprising fact.`,
    });
  }
  // Retain: at least one body line with substantive content (not just a CTA).
  const bodyLines = lines.slice(1, -1);
  const hasRetain = bodyLines.some((l) => l.split(/\s+/).length >= 8);
  if (bodyLines.length === 0 || !hasRetain) {
    findings.push({
      rule: "hook_retain_reward",
      severity: "warn",
      message: "Retain body missing or too thin. The middle of the post must deliver the idea, not bridge the hook to the CTA.",
    });
  }
  // Reward: a clear next action on the last line.
  const hasReward =
    /\b(?:submit\s+for\s+review|get\s+the\s+checklist|read\s+the\s+guide|book\s+a\s+call|reply\b|describe\s+your|see\s+how)/i.test(
      last
    ) ||
    /https?:\/\//.test(last) ||
    /drglaw\.ca/i.test(last);
  if (!hasReward) {
    findings.push({
      rule: "hook_retain_reward",
      severity: "warn",
      message: `Reward (next action) missing on closing line: "${last.slice(0, 80)}". Name what the reader does next.`,
    });
  }
  return {
    key: "hook_retain_reward",
    status: findings.some((f) => f.severity === "fail")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "pass",
    severity: findings.some((f) => f.severity === "fail")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "info",
    findings,
  };
}

// =============================================================================
// Fake-scarcity validator (B4 Hathford + B7 Albrighton anti-pattern)
// Catches countdown/urgency/limited-availability copy. Allows real legal
// deadlines if they include a date pattern (limitation period, filing date).
// =============================================================================
export function validateFakeScarcity(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const scarcityPatterns: RegExp[] = [
    /\blimited\s+time\b/gi,
    /\b(?:only|just)\s+\d+\s+(?:spots?|seats?|slots?|spaces?|left)\b/gi,
    /\bact\s+now\b/gi,
    /\bexpires?\s+(?:soon|today|tomorrow|tonight)\b/gi,
    /\bdon'?t\s+miss\s+out\b/gi,
    /\breserve\s+your\s+spot\b/gi,
    /\b(?:offer|sale|deal)\s+ends?\s+(?:soon|today|tonight)\b/gi,
    /\bhurry\b/gi,
    /\bone[-\s]time\s+(?:offer|opportunity)\b/gi,
    /\bcountdown\b/gi,
    /\bbefore\s+it'?s\s+too\s+late\b/gi,
    /\blast\s+chance\b/gi,
  ];
  for (const pattern of scarcityPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        findings.push({
          rule: "fake_scarcity",
          severity: "fail",
          message: `Manufactured urgency "${m}" violates LSO Rule 4.2-1 (unverifiable claim of urgency). Real legal deadlines (limitation periods, filing dates) may be stated as fact with a verifiable date.`,
        });
      }
    }
  }
  return {
    key: "fake_scarcity",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// Email Respect Checklist (B5 Delaney Ch 7 + Chad S. White rules 1, 41-43)
// Five gates for any email-class piece: relevant, clear value, concise (under
// ~250 words), mobile-friendly markers, easy unsubscribe (CASL identification +
// unsubscribe line present).
// =============================================================================
export function validateEmailRespect(text: string, format?: string): ValidatorResult {
  const findings: Finding[] = [];
  const emailFormats = new Set([
    "email_sequence",
    "counsel_letter",
    "welcome_email",
    "nurture_email",
    "monthly_letter",
  ]);
  if (!format || !emailFormats.has(format)) {
    return {
      key: "email_respect",
      status: "pass",
      severity: "info",
      findings,
    };
  }
  // Concise: under 250 words.
  const wordCount = text
    .replace(/<[^>]*>/g, "")
    .replace(/[#*_`~\[\]]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
  if (wordCount > 250) {
    findings.push({
      rule: "email_respect",
      severity: "warn",
      message: `Email is ${wordCount} words. Delaney's rule: a 200-word email with one useful idea beats a 1000-word email with none.`,
    });
  }
  // X2 (2026-06-26): tightened CASL identification per C5/CRTC FAQ.
  // Every CEM must carry firm name + mailing address + at least one contact
  // channel (phone, email, OR website). "On behalf of" required if the message
  // is sent on behalf of someone other than the named sender.
  const hasFirmName = /DRG\s+Law/i.test(text);
  const hasAddressMarker =
    /(?:PO\s+Box|Toronto|Ontario|M\d\w\s?\d\w\d|M4P\s*0A8)/i.test(text);
  const hasPhone = /(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|647-584-0998)/i.test(text);
  const hasEmail = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(text);
  const hasWebsite = /\b(?:drglaw\.ca|https?:\/\/[^\s]+)\b/i.test(text);
  const hasContactChannel = hasPhone || hasEmail || hasWebsite;
  if (!hasFirmName) {
    findings.push({
      rule: "email_respect",
      severity: "fail",
      message:
        "CASL identification missing firm name. Email must name DRG Law Professional Corporation explicitly.",
    });
  }
  if (!hasAddressMarker) {
    findings.push({
      rule: "email_respect",
      severity: "fail",
      message:
        "CASL identification missing mailing address. Required: PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8.",
    });
  }
  if (!hasContactChannel) {
    findings.push({
      rule: "email_respect",
      severity: "fail",
      message:
        "CASL identification missing contact channel. At least one of phone, email, or website must appear.",
    });
  }
  // Unsubscribe affordance: explicit unsubscribe/preferences language.
  const hasUnsubscribe = /\b(?:unsubscribe|opt[-\s]out|preferences|stop\s+receiving|update\s+(?:your\s+)?preferences)\b/i.test(
    text
  );
  if (!hasUnsubscribe) {
    findings.push({
      rule: "email_respect",
      severity: "fail",
      message: "CASL unsubscribe affordance missing. Add an explicit unsubscribe or preferences link (one-click per Gmail/Yahoo 2024 bulk-sender rules).",
    });
  }
  // One-idea check: warn if more than one H2/H3 (Delaney 'one idea per email').
  const subheads = (text.match(/^\s*#{2,3}\s/gm) ?? []).length;
  if (subheads > 1) {
    findings.push({
      rule: "email_respect",
      severity: "warn",
      message: `${subheads} subheadings detected. A nurture email carries one idea; split into multiple sends if it carries more.`,
    });
  }
  // Single CTA: warn if more than one approved-CTA-shaped link.
  const ctaCount = (
    text.match(/\b(?:submit\s+for\s+review|read\s+the\s+guide|book\s+a\s+call|subscribe|reply\s+with)/gi) ?? []
  ).length;
  if (ctaCount > 1) {
    findings.push({
      rule: "email_respect",
      severity: "warn",
      message: `${ctaCount} primary CTAs detected. One dominant action per email; demote the rest.`,
    });
  }
  return {
    key: "email_respect",
    status: findings.some((f) => f.severity === "fail")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "pass",
    severity: findings.some((f) => f.severity === "fail")
      ? "fail"
      : findings.length > 0
      ? "warn"
      : "info",
    findings,
  };
}

// =============================================================================
// Weasel-words validator (B9 Albrighton How to Write Clearly Ch 12)
// Doctrine-universal list of unverifiable hedges and implied-authority terms.
// The Albrighton list and the LSO Rule 4.2-1 anti-pattern list overlap heavily,
// so one validator serves both clarity and compliance.
// =============================================================================
const DOCTRINE_WEASEL_WORDS: Array<[string, RegExp]> = [
  ["up to (vague upper bound)", /\bup\s+to\s+\d/gi],
  ["as many as (vague)", /\bas\s+many\s+as\s+\d/gi],
  ["leading (implied authority)", /\b(?:we\s+are|the\s+firm\s+is|drg\s+is)\s+(?:a\s+)?leading\b/gi],
  ["helps to (substantiation dodge)", /\bhelps?\s+to\s+(?:reduce|improve|minimize|prevent|achieve)/gi],
  ["regarded as (implied authority)", /\bregarded\s+as\s+(?:one\s+of\s+the\s+)?(?:top|best|leading|finest)/gi],
  ["experts say (vague attribution)", /\bexperts?\s+say\b/gi],
  ["studies show (vague attribution)", /\bstudies\s+show\b/gi],
  ["research suggests (vague attribution)", /\bresearch\s+suggests?\b/gi],
  ["many of our clients (vague proof)", /\bmany\s+of\s+our\s+clients\b/gi],
  ["countless (vague magnitude)", /\bcountless\b/gi],
  ["myriad (vague magnitude)", /\bmyriad\b/gi],
  ["arguably (hedge claim)", /\barguably\b/gi],
  ["virtually (hedge degree)", /\bvirtually\s+\w+/gi],
];

export function validateWeaselWords(text: string): ValidatorResult {
  const findings: Finding[] = [];
  for (const [name, pattern] of DOCTRINE_WEASEL_WORDS) {
    const matches = text.match(pattern);
    if (matches) {
      const sample = matches.slice(0, 3).join(", ");
      findings.push({
        rule: "weasel_words",
        severity: "warn",
        message: `Weasel pattern "${name}" detected: ${sample}. Cite the source or cut the claim (B9 Albrighton overlap with LSO 4.2-1).`,
      });
    }
  }
  return {
    key: "weasel_words",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// =============================================================================
// Rejected-CTA validator (B7 Krawczyk + Albrighton CTA clarity)
// Flags CTA copy that fails the name-the-destination test.
// =============================================================================
export function validateRejectedCtas(
  text: string,
  rejected: string[]
): ValidatorResult {
  const findings: Finding[] = [];
  if (!rejected || rejected.length === 0) {
    return {
      key: "rejected_cta",
      status: "pass",
      severity: "info",
      findings,
    };
  }
  // Only check CTA-shaped contexts: anchor text, button-like markdown, or short
  // strong-emphasized lines. A naive global scan of "click here" inside body
  // prose would false-positive; restrict to short lines or anchor-like contexts.
  const ctaContexts: RegExp[] = [
    /\[([^\]]{2,40})\]\([^)]+\)/g, // [label](url)
    /^\s*\*\*([^*]{2,40})\*\*\s*$/gm, // standalone bold lines (button-like)
    /^\s*>\s*([^\n]{2,60})$/gm, // blockquote callouts
  ];
  const candidates: string[] = [];
  for (const ctx of ctaContexts) {
    let m;
    while ((m = ctx.exec(text)) !== null) {
      candidates.push(m[1].trim());
    }
  }
  for (const candidate of candidates) {
    for (const bad of rejected) {
      if (
        new RegExp(`^${escapeRegex(bad)}\\b`, "i").test(candidate) ||
        candidate.toLowerCase() === bad.toLowerCase()
      ) {
        findings.push({
          rule: "rejected_cta",
          severity: "fail",
          message: `CTA copy "${candidate}" fails the name-the-destination test. Rejected by voice_rules.rejected_ctas.`,
        });
      }
    }
  }
  return {
    key: "rejected_cta",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// validatePageStructure (MEDIUM 1 catch 2026-06-26)
// Checklist and landing_page formats carry page_structure (page-by-page or
// section-by-section layout sequence) instead of the long-form `structure`
// key. The prompt builder reads page_structure but the validator catalog did
// not enforce it. This adds a count-based heuristic: does the generated text
// contain at least N section markers (H1-H4 or "Page N" patterns) where N
// matches page_structure.length?
//
// Generous on purpose: rich PDF magnets may use different markup conventions.
// Severity is warn, not fail, because false negatives are likelier than false
// positives at this resolution. The doctrine validation lives in the format
// spec (format_specs.checklist.page_structure on firm_content_strategies);
// this validator is a smoke test that the generator produced something with
// the expected scaffolding.
// =============================================================================
export function validatePageStructure(
  text: string,
  pageStructure: string[],
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  const STRUCTURED_FORMATS = new Set(["checklist", "landing_page"]);
  if (!format || !STRUCTURED_FORMATS.has(format)) {
    return { key: "page_structure", status: "pass", severity: "info", findings };
  }
  if (!pageStructure || pageStructure.length === 0) {
    return { key: "page_structure", status: "pass", severity: "info", findings };
  }
  const expectedCount = pageStructure.length;
  const headingMatches = text.match(/^\s*#{1,4}\s+\S+/gm) ?? [];
  const pageMarkers = text.match(/\b(?:page|step|section)\s+\d+/gi) ?? [];
  const totalMarkers = headingMatches.length + pageMarkers.length;
  if (totalMarkers < Math.ceil(expectedCount * 0.6)) {
    findings.push({
      rule: "page_structure",
      severity: "warn",
      message: `page_structure expects ${expectedCount} sections; the draft contains ${totalMarkers} section markers (headings + page/step labels). Confirm the draft covers each page in the spec.`,
    });
  }
  return {
    key: "page_structure",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// =============================================================================
// COMPLIANCE-BLOCKING VALIDATORS (P0 delta batch 2026-06-26)
//
// Twelve new validators driven by the three-layer extraction (B + C + L) and
// the 64 flagged tactics catalogued in the L-series. Each carries the LSO,
// CASL, or Google 2026 review-policy rule it enforces.
// =============================================================================

const REVIEW_FORMATS = new Set([
  "review_request",
  "review_request_email",
  "review_request_sms",
  "review_request_closing_letter",
]);

const NEGATIVE_REVIEW_RESPONSE_FORMATS = new Set([
  "review_response",
  "review_response_negative",
  "negative_review_response",
]);

const TESTIMONIAL_FORMATS = new Set([
  "testimonial",
  "client_story",
  "anonymized_case_note",
  "gbp_review_republish",
  "website_testimonial",
]);

const LAW_LANDING_FORMATS = new Set([
  "paid_traffic_landing",
  "promotional_landing",
  "canonical_service_page",
  "landing_page",
]);

// -----------------------------------------------------------------------------
// 3.A1 validateReviewRequest
// LSO + Google 2026: same plain ask to every client, no incentive, no gating,
// no staff-name script, no on-premises capture, no content steering.
// -----------------------------------------------------------------------------
export function validateReviewRequest(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !REVIEW_FORMATS.has(format)) {
    return { key: "review_request", status: "pass", severity: "info", findings };
  }
  const gating: Array<[string, RegExp]> = [
    ["sentiment_branching_nps", /\bhow\s+likely\s+are\s+you\s+to\s+recommend\b/gi],
    ["sentiment_branching_score", /\b(?:promoter|detractor|passive)\b/gi],
    ["private_feedback_detour", /\b(?:private\s+(?:feedback|form)|internal\s+survey|reach\s+(?:out|us)\s+(?:privately|first))\b/gi],
    ["happy_clients_only", /\b(?:if|when)\s+you\s+(?:had|were)\s+(?:a\s+)?(?:good|great|positive)\s+experience\b/gi],
  ];
  const incentive: Array<[string, RegExp]> = [
    ["gift_card_for_review", /\b(?:gift\s+card|amazon\s+card|starbucks\s+card)\b/gi],
    ["discount_for_review", /\bdiscount\s+(?:for|when|after)\s+(?:a\s+)?review\b/gi],
    ["free_for_review", /\bfree\s+\w+\s+(?:for|after|when)\s+(?:leaving\s+)?(?:a\s+)?review\b/gi],
    ["payment_for_feedback", /\bwe\s+pay\s+(?:\$|cad)?\d+\s+(?:for\s+)?(?:feedback|reviews?)/gi],
    ["bonus_for_review", /\bbonus\s+(?:for|on)\s+(?:a\s+)?review\b/gi],
    ["prize_drawing", /\b(?:prize|drawing|raffle|sweepstakes)\b/gi],
  ];
  const staffNameAsk: Array<[string, RegExp]> = [
    ["staff_name_request", /\bmention\s+(?:your|the|our)\s+(?:rep|representative|attorney|lawyer|staff)\s+(?:by\s+)?name\b/gi],
    ["name_credit", /\bgive\s+(?:credit|a\s+shout-?out)\s+to\b/gi],
  ];
  const onPremises: Array<[string, RegExp]> = [
    ["onsite_capture", /\b(?:while|when)\s+you(?:'re|\s+are)\s+(?:still\s+)?(?:in\s+(?:our|the)\s+office|here|on\s+(?:our|the)\s+premises)\b/gi],
    ["tablet_kiosk", /\b(?:scan|tap)\s+(?:this|the)\s+(?:tablet|kiosk|ipad|qr\s+code\s+on\s+the\s+(?:desk|wall|counter))\b/gi],
    ["office_wifi", /\boffice\s+wi-?fi\b/gi],
  ];
  const contentSteering: Array<[string, RegExp]> = [
    ["script_request", /\b(?:please\s+)?(?:write|say|mention|include|tell\s+them)\s+(?:that|how|about)\b/gi],
    ["template_review", /\bhere\s+is\s+(?:a\s+)?(?:template|script|example)\s+(?:for\s+)?(?:your\s+)?review\b/gi],
  ];
  for (const [label, list] of [
    ["gating", gating],
    ["incentive", incentive],
    ["staff_name", staffNameAsk],
    ["on_premises", onPremises],
    ["content_steering", contentSteering],
  ] as const) {
    for (const [name, pattern] of list) {
      const matches = text.match(pattern);
      if (matches) {
        findings.push({
          rule: "review_request",
          severity: "fail",
          message: `Review-request copy contains banned ${label} pattern (${name}): "${matches[0]}". Google 2026 review policy + LSO honesty norm.`,
        });
      }
    }
  }
  return {
    key: "review_request",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// review_request CASL coverage (Codex audit F7, 2026-07-07)
//
// review_request generates a multi-channel body: an Email body and an SMS body
// (plus subject, closing-letter insert, and signature line), each under its own
// "## Heading". validateEmailRespect explicitly EXCLUDES review_request, and no
// other validator checked CASL identity/unsubscribe for it, so the review-
// request Email could ship with no firm name, no mailing address, no contact
// channel, and no unsubscribe, and the SMS with no sender identity and no STOP.
//
// This validator splits the body by the "## Heading" markers the prompt
// requires and checks each channel's CASL floor:
//   Email body  -> firm name, mailing address, a contact channel, unsubscribe
//   SMS body    -> sender identity (firm name), STOP/unsubscribe
// plus that the expected Email body and SMS body sections are present at all.
// -----------------------------------------------------------------------------
const REVIEW_REQUEST_CASL_FORMATS = new Set([
  "review_request",
  "review_request_email",
  "review_request_sms",
]);

// Split a markdown body into { headingLowercased -> sectionText } by "## " lines.
function splitByH2Sections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentHeading !== null) {
      sections.set(currentHeading, buffer.join("\n").trim());
    }
  };
  for (const line of lines) {
    const m = line.match(/^\s*#{2,3}\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentHeading = m[1].trim().toLowerCase();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function findSection(sections: Map<string, string>, needle: string): string | null {
  for (const [heading, body] of sections) {
    if (heading.includes(needle)) return body;
  }
  return null;
}

export function validateReviewRequestCasl(text: string, format?: string): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !REVIEW_REQUEST_CASL_FORMATS.has(format)) {
    return { key: "review_request_casl", status: "pass", severity: "info", findings };
  }

  const sections = splitByH2Sections(text);
  const emailBody = findSection(sections, "email body");
  const smsBody = findSection(sections, "sms body");

  if (emailBody === null) {
    findings.push({
      rule: "review_request_casl",
      severity: "fail",
      message:
        "review_request is missing an 'Email body' section (expected under a '## Email body' heading). CASL identity and unsubscribe cannot be verified.",
    });
  } else {
    const hasFirmName = /DRG\s+Law/i.test(emailBody);
    const hasAddress = /(?:PO\s+Box|M4P\s*0A8|Toronto,?\s+ON|Ontario)/i.test(emailBody);
    const hasChannel =
      /(?:\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|drglaw\.ca|https?:\/\/[^\s]+|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(
        emailBody,
      );
    const hasUnsub =
      /\b(?:unsubscribe|opt[-\s]?out|update\s+(?:your\s+)?preferences|stop\s+receiving)\b/i.test(emailBody);
    if (!hasFirmName) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message: "review_request Email body must name the firm (DRG Law) for CASL identification.",
      });
    }
    if (!hasAddress) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message:
          "review_request Email body must include the firm's mailing address (PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8) per CASL.",
      });
    }
    if (!hasChannel) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message: "review_request Email body must include at least one contact channel (phone, email, or website).",
      });
    }
    if (!hasUnsub) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message: "review_request Email body must include an unsubscribe or update-preferences affordance per CASL.",
      });
    }
  }

  if (smsBody === null) {
    findings.push({
      rule: "review_request_casl",
      severity: "fail",
      message:
        "review_request is missing an 'SMS body' section (expected under a '## SMS body' heading). Sender identity and STOP cannot be verified.",
    });
  } else {
    const hasFirmName = /DRG\s+Law/i.test(smsBody);
    const hasStop = /\bSTOP\b|\bunsubscribe\b|\bopt[-\s]?out\b/i.test(smsBody);
    if (!hasFirmName) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message: "review_request SMS body must identify the sender (DRG Law) per CASL.",
      });
    }
    if (!hasStop) {
      findings.push({
        rule: "review_request_casl",
        severity: "fail",
        message: "review_request SMS body must include STOP/unsubscribe language per CASL.",
      });
    }
  }

  return {
    key: "review_request_casl",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A2 validateNegativeReviewResponse
// LSO Rule 3.3 confidentiality: cannot confirm client relationship, cannot
// disclose case detail, no apology for the matter. TEARS adapted (L8).
// -----------------------------------------------------------------------------
export function validateNegativeReviewResponse(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !NEGATIVE_REVIEW_RESPONSE_FORMATS.has(format)) {
    return { key: "negative_review_response", status: "pass", severity: "info", findings };
  }
  const clientConfirmation = /\b(?:when\s+you\s+were\s+our\s+client|during\s+your\s+matter|in\s+your\s+case|we\s+represented\s+you|you\s+retained\s+us|your\s+file)\b/gi;
  if (clientConfirmation.test(text)) {
    findings.push({
      rule: "negative_review_response",
      severity: "fail",
      message:
        "Response confirms a client relationship (LSO Rule 3.3 breach). The firm cannot confirm the reviewer was a client. Reframe to 'professional obligations prevent a substantive response'.",
    });
  }
  const apologyForMatter = /\b(?:we\s+are\s+sorry|we\s+apologize)\s+(?:that|for)\s+(?:your\s+(?:case|matter|outcome|experience\s+with\s+(?:your|the)\s+(?:case|matter)))/gi;
  if (apologyForMatter.test(text)) {
    findings.push({
      rule: "negative_review_response",
      severity: "fail",
      message:
        "Apology references a specific case or matter. Apologize for the experience generally, not for any named matter or case detail.",
    });
  }
  const caseFactDisclosure = /\b(?:the\s+(?:fee|invoice|amount|judgment|settlement|outcome)\s+(?:was|in)|on\s+(?:the\s+)?\w+\s+\d+,?\s+\d{4})\b/gi;
  if (caseFactDisclosure.test(text)) {
    findings.push({
      rule: "negative_review_response",
      severity: "fail",
      message:
        "Response discloses case facts (fee, date, outcome, judgment). Truth is no defence under Rule 3.3; remove case-specific content.",
    });
  }
  // Ses.17 WP-5: widened after a live smoke-test false negative. The original
  // pattern only matched "call the firm" / "email the firm" literally; a
  // genuinely compliant close ("please call the office or send an email
  // directly to the firm") missed both because it said "office" not "firm"
  // for the call, and "send an email...to the firm" not "email the firm".
  // Same class of miss as the italics/guarantee validators found in Ses.16:
  // a real, compliant response failing for phrasing, not substance.
  const switchChannels =
    /\b(?:contact\s+(?:our|the)\s+office|reach\s+out\s+(?:to\s+us\s+)?(?:directly|offline)|call\s+(?:the|our)\s+(?:firm|office)|(?:send\s+(?:an?\s+)?)?email\s+(?:directly\s+)?(?:to\s+)?(?:the|our)\s+(?:firm|office))\b/gi;
  if (!switchChannels.test(text)) {
    findings.push({
      rule: "negative_review_response",
      severity: "warn",
      message:
        "Negative review response should close with a switch-channels offer (offline contact). TEARS skeleton requires the final S beat.",
    });
  }
  return {
    key: "negative_review_response",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A3 validateTestimonialContent
// LSO Rule 4.2-1 testimonial commentary: no emotional appeal, no result amount
// without disclaimer, no superiority, no aggressive-lawyer implication.
// -----------------------------------------------------------------------------
export function validateTestimonialContent(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !TESTIMONIAL_FORMATS.has(format)) {
    return { key: "testimonial_content", status: "pass", severity: "info", findings };
  }
  const emotionalAppeal: Array<[string, RegExp]> = [
    ["life_changing", /\blife[-\s]?changing\b/gi],
    ["devastated_until", /\b(?:devastated|destroyed|broken)\s+until\b/gi],
    ["saved_my_life", /\b(?:saved|changed)\s+my\s+life\b/gi],
    ["miracle", /\bmiracle\b/gi],
    ["angel", /\b(?:angel|godsend|savior)\b/gi],
    ["only_hope", /\b(?:my\s+only|the\s+only)\s+hope\b/gi],
  ];
  for (const [name, pattern] of emotionalAppeal) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "testimonial_content",
        severity: "fail",
        message: `Testimonial contains emotional appeal "${matches[0]}" (${name}). Rule 4.2-1 commentary bars emotional-appeal testimonials.`,
      });
    }
  }
  const superiority: Array<[string, RegExp]> = [
    ["only_firm", /\bthe\s+only\s+(?:firm|lawyer|attorney)\b/gi],
    ["best_at", /\bthe\s+best\s+(?:lawyer|firm|attorney)\b/gi],
    ["better_than", /\bbetter\s+than\s+(?:any\s+other|every\s+other|other)\s+(?:firm|lawyer|attorney)\b/gi],
  ];
  for (const [name, pattern] of superiority) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "testimonial_content",
        severity: "fail",
        message: `Testimonial implies qualitative superiority "${matches[0]}" (${name}). Rule 4.2-1 bars superiority claims even in testimonials.`,
      });
    }
  }
  const aggressiveLawyer: Array<[string, RegExp]> = [
    ["fight_for_you", /\b(?:they|she|he|drg)\s+(?:will\s+)?fight\s+for\s+you\b/gi],
    ["ruthless", /\bruthless\b/gi],
    ["aggressive", /\b(?:aggressive|relentless|pit\s+bull)\b/gi],
    ["take_no_prisoners", /\btake\s+no\s+prisoners\b/gi],
  ];
  for (const [name, pattern] of aggressiveLawyer) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "testimonial_content",
        severity: "fail",
        message: `Testimonial suggests aggressiveness "${matches[0]}" (${name}). Rule 4.2-1 commentary bars aggressive-lawyer implication.`,
      });
    }
  }
  // Outcome amount without past-results disclaimer.
  const outcomeMention = /(?:\$\s?\d{1,3}(?:,\d{3})+|\b\d+\s*%\s*(?:success|win|recovery)\b|\bwon\s+my\s+case\b|\brecovered\s+\$)/i;
  if (outcomeMention.test(text) && !PAST_RESULTS_DISCLAIMER.test(text)) {
    findings.push({
      rule: "testimonial_content",
      severity: "fail",
      message:
        'Testimonial states a result without the past-results disclaimer. Add "Past results are not necessarily indicative of future results."',
    });
  }
  return {
    key: "testimonial_content",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A4 validateLsoSuperlatives (extends specialist_self_designation)
// LSO commentary specifically names "best", "super", "#1" as prohibited.
// Specialist/expert allowed only when certified_specialists carries the
// lawyer + area combination.
// -----------------------------------------------------------------------------
const LSO_NAMED_SUPERLATIVES: RegExp[] = [
  /\b(?:the\s+)?best\s+(?:lawyer|firm|attorney|legal|counsel)\b/gi,
  /\bsuper\s+(?:lawyer|attorney)s?\b/gi,
  /\b#\s*1\s+(?:lawyer|firm|attorney|legal)/gi,
  /\bnumber\s+one\s+(?:lawyer|firm|attorney)\b/gi,
  /\bleading\s+(?:lawyer|firm|attorney|practice)\b/gi,
  /\bpreeminent\s+(?:lawyer|firm|attorney)\b/gi,
  /\btop[- ]rated\s+(?:lawyer|firm|attorney)\b/gi,
  /\bpremier\s+(?:lawyer|firm|attorney|practice)\b/gi,
];

export function validateLsoSuperlatives(
  text: string,
  certifiedSpecialists?: Array<{ lawyer: string; areas: string[] }>
): ValidatorResult {
  const findings: Finding[] = [];
  for (const pattern of LSO_NAMED_SUPERLATIVES) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        findings.push({
          rule: "lso_superlative",
          severity: "fail",
          message: `LSO Rule 4.2-1 commentary explicitly bars "${m}". Replace with verifiable factual claim (years, areas, languages, Law Society standing).`,
        });
      }
    }
  }
  // "Certified Specialist" allowed only when the per-lawyer-per-area flag is set.
  const certifiedClaim = /\bcertified\s+specialist\b/gi;
  const certifiedMatches = text.match(certifiedClaim);
  if (certifiedMatches) {
    const hasAnyCertified = certifiedSpecialists && certifiedSpecialists.length > 0;
    if (!hasAnyCertified) {
      findings.push({
        rule: "lso_superlative",
        severity: "fail",
        message:
          '"Certified Specialist" is the only LSO-sanctioned superiority claim and is reserved to lawyers in the Certified Specialist Program. No lawyer in this firm holds the designation per strategy_json.certified_specialists. Remove the claim.',
      });
    }
  }
  return {
    key: "lso_superlative",
    status: findings.some((f) => f.severity === "fail") ? "fail" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A5 validateReferralCopy
// LSO Fee Splitting + Referral Fees: no non-licensee fees; lawyer-to-lawyer
// only on standard form (capped 15%/5%/$25k); any firm referring-out-for-fee
// practice must be clearly and prominently disclosed.
// -----------------------------------------------------------------------------
export function validateReferralCopy(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const nonLicenseeFee: RegExp[] = [
    /\brefer\s+a\s+(?:friend|client)\s*,?\s*(?:get|receive|earn)\s+(?:\$?\d|a\s+(?:gift\s+card|discount|bonus))/gi,
    /\bwe\s+pay\s+(?:\$|cad)?\d+\s+(?:per|for|on\s+each)\s+(?:referral|referred\s+client)/gi,
    /\b(?:referral\s+(?:bonus|reward|commission|kickback)|finder'?s\s+fee)\b/gi,
    /\b(?:realtors?|mortgage\s+brokers?|accountants?|marketers?)\s+(?:receive|earn|get)\s+\$/gi,
  ];
  for (const pattern of nonLicenseeFee) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "referral_copy",
        severity: "fail",
        message: `Non-licensee referral fee or paid-referral offer "${matches[0]}". LSO Fee Splitting rules bar payment to non-licensees for client referrals.`,
      });
    }
  }
  // Lawyer-to-lawyer fee mention without standard-form context.
  const lawyerToLawyerFee = /\b(?:referral\s+fee|share\s+(?:the\s+)?fee)\s+(?:with|of|to)\s+(?:another|other|the\s+other)\s+(?:lawyer|firm|licensee)/gi;
  if (lawyerToLawyerFee.test(text)) {
    const hasStandardForm = /\b(?:lso\s+standard\s+form|standard\s+referral\s+agreement|signed\s+by\s+the\s+client)\b/i.test(text);
    if (!hasStandardForm) {
      findings.push({
        rule: "referral_copy",
        severity: "fail",
        message:
          "Lawyer-to-lawyer referral fee mentioned without the LSO standard form context. The fee is capped at 15% of first $50k and 5% above ($25k max), requires the LSO standard form signed by the client and both licensees, and must appear on the client's account.",
      });
    }
  }
  // Referring-out-for-fee practice disclosure check.
  const referOutPractice = /\b(?:we|the\s+firm)\s+(?:refer|may\s+refer)\s+(?:clients?|matters?)\s+(?:out|to\s+other\s+(?:lawyers|firms))/gi;
  if (referOutPractice.test(text)) {
    const hasDisclosure = /\b(?:referral\s+fee|paid\s+referral|fee[\s-]sharing)\s+(?:practice|arrangement|disclosure)\b/i.test(text);
    if (!hasDisclosure) {
      findings.push({
        rule: "referral_copy",
        severity: "warn",
        message:
          "Refer-out language present. If the firm refers clients out for a fee, that practice must be clearly and prominently disclosed in marketing (Rule 4.2-1).",
      });
    }
  }
  return {
    key: "referral_copy",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A7 validateNoIncentivizedReview
// Cross-surface check: gift-context output mentioning reviews, or review
// request mentioning a gift/feedback-payment. Separation rule from C8 + L8.
// -----------------------------------------------------------------------------
export function validateNoIncentivizedReview(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  const gistOfReview = /\b(?:review|google\s+review|gbp\s+review|leave\s+(?:us\s+)?a\s+(?:5|five)[-\s]?star)\b/i;
  const gistOfGift = /\b(?:gift|gift\s+card|amazon\s+card|starbucks\s+card|free\s+(?:mug|pen|water\s+bottle|t-?shirt))\b/i;
  const giftContextFormats = new Set([
    "gift_message",
    "post_close_appreciation",
    "client_gift_note",
  ]);
  if (format && giftContextFormats.has(format) && gistOfReview.test(text)) {
    findings.push({
      rule: "no_incentivized_review",
      severity: "fail",
      message:
        "Gift-context output mentions reviews. C8 separation rule: the gift moment and the review ask must be separate touches with no cross-reference.",
    });
  }
  if (format && REVIEW_FORMATS.has(format) && gistOfGift.test(text)) {
    findings.push({
      rule: "no_incentivized_review",
      severity: "fail",
      message:
        "Review-request copy mentions a gift or incentive. Google 2026 policy bans incentivized reviews; LSO bars paying or rewarding clients for marketing the firm.",
    });
  }
  // The "feedback survey" payment workaround.
  const feedbackPaymentEngineered =
    /\bwe\s+pay\s+(?:\$|cad)?\d+\s+for\s+(?:client\s+)?feedback\b/gi;
  if (feedbackPaymentEngineered.test(text)) {
    findings.push({
      rule: "no_incentivized_review",
      severity: "fail",
      message:
        "Paid-feedback workaround detected. Engineering a payment for feedback that becomes a review is an incentivized review under Google policy regardless of framing.",
    });
  }
  // The "lumpy package with the review note" pattern.
  const lumpyPackage =
    /\b(?:we\s+(?:sent|are\s+sending)\s+you\s+(?:something|a\s+(?:gift|package))\s*[,.]?\s*(?:keep\s+an\s+eye|look\s+for\s+it))\b/gi;
  if (lumpyPackage.test(text)) {
    findings.push({
      rule: "no_incentivized_review",
      severity: "fail",
      message:
        "Lumpy-package promise pattern detected. A publicly visible promise of a reward conditioned on or trained by reviews is an incentivized review.",
    });
  }
  return {
    key: "no_incentivized_review",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A8 validateNoReviewRemovalCopy
// Flags any generated copy drafting a removal-request or manufactured policy
// violation against a genuine review. L8 landmine 6 (Stickel Ch 20).
// -----------------------------------------------------------------------------
export function validateNoReviewRemovalCopy(
  text: string,
  sourceBrief?: Record<string, unknown>
): ValidatorResult {
  const findings: Finding[] = [];
  const legitimateOverride =
    !!sourceBrief &&
    (sourceBrief as Record<string, unknown>).legitimate_policy_violation === true;
  if (legitimateOverride) {
    return { key: "no_review_removal", status: "pass", severity: "info", findings };
  }
  const removalPatterns: Array<[string, RegExp]> = [
    [
      "removal_request",
      /\b(?:please\s+)?(?:remove|take\s+down|delete)\s+(?:this|the|that)\s+review\b/gi,
    ],
    [
      "platform_technicality",
      /\b(?:violates?|breaks?|breaches?)\s+(?:your|the)\s+(?:guidelines?|policy|terms)\b/gi,
    ],
    [
      "off_topic_claim",
      /\bthis\s+review\s+is\s+(?:off[-\s]topic|irrelevant|not\s+about\s+(?:our|the)\s+business)\b/gi,
    ],
    [
      "conflict_of_interest",
      /\bconflict\s+of\s+interest\s+review\b/gi,
    ],
    [
      "creativity_admission",
      /\b(?:a\s+little\s+bit\s+of\s+|some\s+)?creativity\s+to\s+(?:argue|find|spot)\b/gi,
    ],
  ];
  for (const [name, pattern] of removalPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "no_review_removal",
        severity: "fail",
        message: `Review-removal copy pattern detected (${name}): "${matches[0]}". Google policy bans soliciting removal of genuine reviews. Set source_brief.legitimate_policy_violation = true only for actual platform violations (doxxing, threats, off-topic spam, non-client).`,
      });
    }
  }
  return {
    key: "no_review_removal",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A9 validateNoFreeConsultLure
// L4 + L7: "Free Consultation" as primary CTA promise is a lure that implies
// guaranteed advice. Allow factual no-cost language in sub-copy only.
// -----------------------------------------------------------------------------
export function validateNoFreeConsultLure(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !LAW_LANDING_FORMATS.has(format)) {
    return { key: "no_free_consult_lure", status: "pass", severity: "info", findings };
  }
  // Hero/primary CTA position: bold headline-style or button-shape lines.
  const lurePatterns: RegExp[] = [
    /^\s*#{1,3}\s*free\s+consultation\b/gim, // heading
    /^\s*\*\*\s*free\s+consultation\s*\*\*\s*$/gim, // bold standalone
    /\[\s*free\s+consultation\s*\]\([^)]+\)/gi, // markdown link/button
    /^\s*>\s*free\s+consultation\b/gim, // blockquote callout
  ];
  for (const pattern of lurePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "no_free_consult_lure",
        severity: "fail",
        message: `"Free Consultation" used as primary CTA/headline: "${matches[0]}". L7 doctrine: implies guaranteed advice. Use "Submit for review" with factual no-cost description in sub-copy if applicable.`,
      });
    }
  }
  return {
    key: "no_free_consult_lure",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A10 validateNoDistressHero
// L7 Roos hero-image type one. Distress imagery (funeral, divorce papers,
// hospital, accident scene) is a tone risk on DRG's corporate/RE/estates
// surfaces. Operate on image-spec metadata, not body prose.
// -----------------------------------------------------------------------------
// MEDIUM 2 catch 2026-06-26: validateNoDistressHero rewritten with stem
// morphology (grieving, mourning) and a negation guard (skip if "not",
// "without", "no", "free of", "never", "instead of", "rather than" appears
// within 40 characters before the distress word).
const DISTRESS_NEGATION_TOKENS = /\b(?:not|without|no(?:t)?|never|free\s+of|free\s+from|instead\s+of|rather\s+than|avoid(?:ing|s)?)\b/i;

export function validateNoDistressHero(
  text: string,
  format?: string
): ValidatorResult {
  const findings: Finding[] = [];
  if (!format || !LAW_LANDING_FORMATS.has(format)) {
    return { key: "no_distress_hero", status: "pass", severity: "info", findings };
  }
  const distressKeywords: Array<[string, RegExp]> = [
    [
      "hero_funeral",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:funeral|casket|coffin|burial|mourn(?:ing|ers?)?)\b/gi,
    ],
    [
      "hero_divorce_papers",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:divorce\s+(?:papers|decree)|broken\s+(?:ring|wedding\s+band)|wedding\s+ring\s+off)\b/gi,
    ],
    [
      "hero_hospital",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:hospital\s+bed|nursing\s+home|wheelchair|er\s+room|emergency\s+room|icu)\b/gi,
    ],
    [
      "hero_accident",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:car\s+wreck|accident\s+scene|crash\s+site|wreckage|collision\s+site)\b/gi,
    ],
    [
      "hero_distress",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:crying|tears|distress|griev(?:ing|e|ed)?|grief|sobbing|despair)\b/gi,
    ],
    [
      "hero_grieving_family",
      /\b(?:hero|image|photo|picture|scene|above[-\s]?fold|background)[^\n]{0,60}(?:grieving\s+\w+|mourning\s+\w+)\b/gi,
    ],
  ];
  for (const [name, pattern] of distressKeywords) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      // Negation guard: skip if a negation token sits within 40 chars before
      // the match start. Catches "photo should feel calm, not grief-driven".
      const lookbackStart = Math.max(0, m.index - 40);
      const lookback = text.slice(lookbackStart, m.index);
      if (DISTRESS_NEGATION_TOKENS.test(lookback)) {
        continue;
      }
      findings.push({
        rule: "no_distress_hero",
        severity: "fail",
        message: `Hero-image directive references distress imagery (${name}): "${m[0]}". On DRG corporate/RE/estates surfaces this misreads the buyer and risks reading as exploitative. Use the principal photo (Damaris) or a calm, situation-neutral image.`,
      });
    }
  }
  return {
    key: "no_distress_hero",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A11 validateNoUsTrustBadges
// L7: BBB, US state bar, Verisign, US chamber of commerce on Ontario surfaces
// is misleading. Allow Law Society of Ontario reference where entitled.
// -----------------------------------------------------------------------------
export function validateNoUsTrustBadges(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const usBadges: Array<[string, RegExp]> = [
    ["bbb", /\b(?:better\s+business\s+bureau|bbb)\b/gi],
    ["verisign", /\bverisign\b/gi],
    ["us_state_bar", /\b(?:california|new\s+york|texas|florida|massachusetts|illinois)\s+(?:state\s+)?bar\b/gi],
    ["us_chamber", /\b(?:us|united\s+states)\s+chamber\s+of\s+commerce\b/gi],
    ["avvo_badge", /\bavvo[-\s]?rated\b/gi],
    ["martindale_badge", /\b(?:martindale|av\s+preeminent)\b/gi],
    ["super_lawyer_badge", /\bsuper\s+lawyers?\b/gi],
    ["best_lawyer_badge", /\bbest\s+lawyers\s+in\s+america\b/gi],
  ];
  for (const [name, pattern] of usBadges) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "no_us_trust_badge",
        severity: "fail",
        message: `US-only trust badge or rating "${matches[0]}" (${name}) on Ontario surface. Misleading under LSO Rule 4.2-1. Use Law Society of Ontario reference where entitled, or remove.`,
      });
    }
  }
  return {
    key: "no_us_trust_badge",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// 3.A12 validateNoLsaQualityClaim
// L4: Google Local Services Ads / Google Screened / Google Guaranteed attest
// licensing and insurance only. Presenting as a quality endorsement breaches
// no-unverifiable-superlative and no-misleading rules.
// -----------------------------------------------------------------------------
export function validateNoLsaQualityClaim(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const lsaContext =
    /\b(?:google\s+screened|google\s+guaranteed|local\s+services\s+ads?|lsa\s+badge)\b/i;
  if (!lsaContext.test(text)) {
    return { key: "no_lsa_quality_claim", status: "pass", severity: "info", findings };
  }
  const qualityClaim: Array<[string, RegExp]> = [
    ["best_endorsement", /\bgoogle\s+(?:screened|guaranteed)[^\n]{0,80}(?:best|top|leading|preeminent|finest)/gi],
    ["quality_assured", /\bgoogle\s+(?:screened|guaranteed)[^\n]{0,80}(?:quality|outcome|result|success)/gi],
    ["proves_we_are", /\b(?:proves|confirms|verifies)\s+(?:that\s+)?(?:we\s+are|drg\s+is)\s+(?:the\s+)?(?:best|top|leading)/gi],
  ];
  for (const [name, pattern] of qualityClaim) {
    const matches = text.match(pattern);
    if (matches) {
      findings.push({
        rule: "no_lsa_quality_claim",
        severity: "fail",
        message: `Google LSA / Screened / Guaranteed presented as a quality endorsement (${name}): "${matches[0]}". The badge attests licence and insurance only. Reframe as factual verification.`,
      });
    }
  }
  return {
    key: "no_lsa_quality_claim",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// =============================================================================
// SEO/AEO spec Sections 5, 6, 8 completion (Ses.17 WP-3). These five run
// against BOTH the Markdown battery (via runDeterministicValidators below,
// reading fields off ValidatorConfig + sourceBrief) and the
// canonical_service_page battery (via runCanonicalServicePageValidators
// further down, reading the same facts off
// CanonicalServicePageValidationContext), so a link or entity check never
// depends on which generator produced the piece.
//
// significantWords/queryOverlapRatio (defined further down, in the
// canonical-service-page section) are reused here directly: they are
// module-scope functions in this same file, not exported, so no import is
// needed. Their definitions are read below this point in the file but that
// is fine for function declarations (hoisted).
// =============================================================================

/**
 * SEO/AEO spec Section 8: every internal_link_targets URL must resolve to
 * the firm's own website host. Runs against BOTH Markdown text pieces
 * (targets pulled from sourceBrief.internal_link_targets) and
 * canonical_service_page (targets pulled from the validation context).
 * Fail severity: an internal link that leaves the firm's own site is a
 * genuine defect, not a style preference.
 */
export function validateInternalLinkDomains(
  internalLinkTargets: InternalLinkTarget[] | undefined,
  firmWebsite: string | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  const firmHost = extractHost(firmWebsite);
  if (!internalLinkTargets || internalLinkTargets.length === 0 || !firmHost) {
    return { key: "internal_link_domain_allowlist", status: "pass", severity: "info", findings };
  }
  for (const target of internalLinkTargets) {
    const host = extractHost(target.url);
    if (!host) {
      findings.push({
        rule: "internal_link_domain_allowlist",
        severity: "fail",
        message: `Internal link target "${target.url}" is not a valid absolute URL.`,
      });
      continue;
    }
    if (host !== firmHost) {
      findings.push({
        rule: "internal_link_domain_allowlist",
        severity: "fail",
        message: `Internal link target "${target.url}" does not resolve to the firm's own domain (expected ${firmHost}).`,
      });
    }
  }
  return {
    key: "internal_link_domain_allowlist",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

/**
 * SEO/AEO spec Section 5: heading-to-query coverage. Warn-only by design:
 * the spec explicitly notes some structural headings ("How the process
 * works") are legitimate even with no query match, so a low-coverage
 * heading set is a signal to review, not an automatic fail.
 */
export function validateHeadingQueryAlignment(
  text: string,
  clientQuestionVariants: string[] | undefined,
  secondaryQueries: string[] | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  const questionPool = [...(clientQuestionVariants ?? []), ...(secondaryQueries ?? [])];
  if (questionPool.length === 0) {
    return { key: "heading_query_alignment", status: "pass", severity: "info", findings };
  }
  const headings = (text.match(/^#{1,4}\s+.+$/gm) ?? []).map((h) =>
    h.replace(/^#{1,4}\s+/, "").trim()
  );
  if (headings.length === 0) {
    return { key: "heading_query_alignment", status: "pass", severity: "info", findings };
  }
  const alignedCount = headings.filter((h) =>
    questionPool.some((q) => queryOverlapRatio(q, h) > 0.5)
  ).length;
  const ratio = alignedCount / headings.length;
  if (ratio < 0.3) {
    findings.push({
      rule: "heading_query_alignment",
      severity: "warn",
      message: `Only ${alignedCount}/${headings.length} headings align with a supplied client question variant or secondary query. Some structural headings are legitimate with no match; treat this as a coverage signal, not a required fix.`,
    });
  }
  return {
    key: "heading_query_alignment",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

/**
 * SEO/AEO spec Section 5: the firm/lawyer entity appears somewhere in the
 * piece. Warn, not fail: Markdown formats have no guaranteed author-bio
 * block the way canonical_service_page does, so this is a hygiene signal.
 */
export function validateEntityPresent(
  text: string,
  entityNames: string[] | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  const names = (entityNames ?? []).filter((n): n is string => !!n && n.trim().length > 0);
  if (names.length === 0) {
    return { key: "entity_present", status: "pass", severity: "info", findings };
  }
  const lower = text.toLowerCase();
  const found = names.some((name) => lower.includes(name.toLowerCase()));
  if (!found) {
    findings.push({
      rule: "entity_present",
      severity: "warn",
      message: `Neither the firm name nor the named lawyer appears anywhere in the piece (checked: ${names.join(", ")}).`,
    });
  }
  return {
    key: "entity_present",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

/**
 * SEO/AEO spec Section 6: ratio-based secondary-query coverage, mirroring
 * validateApprovedVocabulary's warn-under-threshold pattern. Warn, not fail:
 * forcing every secondary query into the body risks keyword stuffing, which
 * the doctrine already forbids elsewhere.
 */
export function validateSecondaryQueryCoverage(
  text: string,
  secondaryQueries: string[] | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  if (!secondaryQueries || secondaryQueries.length === 0) {
    return { key: "secondary_query_coverage", status: "pass", severity: "info", findings };
  }
  const covered = secondaryQueries.filter((q) => queryOverlapRatio(q, text) > 0.5).length;
  const ratio = covered / secondaryQueries.length;
  if (ratio < 0.3) {
    findings.push({
      rule: "secondary_query_coverage",
      severity: "warn",
      message: `Only ${covered}/${secondaryQueries.length} secondary queries have meaningful overlap with the body. Confirm they belong on this piece rather than a different one.`,
    });
  }
  return {
    key: "secondary_query_coverage",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

/**
 * SEO/AEO spec Section 6: service-area language present, only runs when
 * source_brief.service_area is set (not every piece ships a service area).
 */
export function validateServiceAreaPresence(
  text: string,
  serviceArea: string | string[] | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  if (!serviceArea) {
    return { key: "service_area_presence", status: "pass", severity: "info", findings };
  }
  const areas = Array.isArray(serviceArea) ? serviceArea : [serviceArea];
  const lower = text.toLowerCase();
  const missing = areas.filter((a) => a.trim() && !lower.includes(a.toLowerCase()));
  if (missing.length > 0) {
    findings.push({
      rule: "service_area_presence",
      severity: "warn",
      message: `Service area(s) not found in the piece: ${missing.join(", ")}.`,
    });
  }
  return {
    key: "service_area_presence",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// =============================================================================
// Portuguese authoring (Ses.17 WP-4): a reduced, language-neutral battery.
// The English-pattern checks (banned vocabulary, LSO phrase regexes, opening-
// discipline phrases, the SEO/AEO text checks) all match specific English
// phrasing; running them against Portuguese text would either never match
// (a false pass pretending to be assurance) or false-positive on Portuguese
// words that happen to contain an English substring. Only the language-
// neutral structural checks (em dash, italics markup, orphan words, word
// count, rule of three) plus one new PT-specific check run here.
// =============================================================================

/**
 * Warn-only: the Portuguese text should name Ontario/Ontário somewhere, per
 * the strategy's "Jurisdiction disclosure on PT content" LSO constraint. A
 * Portuguese-reading audience should not have to assume the firm practises
 * in Ontario; the piece should say so.
 */
export function validatePtJurisdictionDisclosure(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const lower = text.toLowerCase();
  const mentionsOntario = lower.includes("ontário") || lower.includes("ontario");
  if (!mentionsOntario) {
    findings.push({
      rule: "pt_jurisdiction_disclosure",
      severity: "warn",
      message:
        "This Portuguese piece never names Ontario/Ontário. The strategy's jurisdiction-disclosure " +
        "constraint expects Portuguese content to state, in Portuguese, that it concerns Ontario law.",
    });
  }
  return {
    key: "pt_jurisdiction_disclosure",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// Abbreviations that end in a period but do not end a sentence. Guards the
// sentence splitter against "Rule 4.2-1", "s. 7", "Inc.", legal citations,
// and initials so structural_monotony's word counts stay accurate.
const SENTENCE_SPLIT_ABBR = /\b(?:Inc|No|Mr|Mrs|Ms|Dr|St|Rd|Ave|Ont|v|e\.g|i\.e|Rule|s)\.\s*$/i;

/**
 * Splits body prose into sentence strings for rhythm measurement. Excludes
 * headings (# lines), list/numbered items, blockquotes, table rows, and bold
 * standalone lines (CTAs) before splitting, since those are legitimately
 * parallel in length and are not the "AI cadence" this validator targets.
 * Guards against splitting on decimals, statute citations, and abbreviations.
 */
export function extractProseUnits(text: string): { sentences: string[]; paragraphs: string[] } {
  const rawParagraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const proseParagraphs = rawParagraphs.filter((p) => {
    if (/^#{1,6}\s/.test(p)) return false; // heading
    if (/^[-*]\s/.test(p) || /^\d+[.)]\s/.test(p)) return false; // list item
    if (/^>/.test(p)) return false; // blockquote
    if (/^\|/.test(p)) return false; // table row
    if (/^\*\*[^*]+\*\*$/.test(p)) return false; // bold-only standalone (CTA)
    return true;
  });

  const sentences: string[] = [];
  for (const para of proseParagraphs) {
    const raw = para.split(/(?<=[.?!])\s+(?=[A-Z"'“])/g);
    for (const seg of raw) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      const prev = sentences[sentences.length - 1];
      const prevEndsAbbrOrDigit =
        prev !== undefined &&
        (SENTENCE_SPLIT_ABBR.test(prev) || (/\d$/.test(prev.replace(/[.?!]+$/, "")) && /^\d/.test(trimmed)));
      if (prevEndsAbbrOrDigit) {
        sentences[sentences.length - 1] = prev + " " + trimmed;
      } else {
        sentences.push(trimmed);
      }
    }
  }
  // Drop fragments under 3 words (stray artifacts of the split, not real sentences).
  const filteredSentences = sentences.filter((s) => s.split(/\s+/).filter(Boolean).length >= 3);

  return { sentences: filteredSentences, paragraphs: proseParagraphs };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function coefficientOfVariation(lengths: number[]): number {
  const n = lengths.length;
  if (n === 0) return 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

function longestSimilarLengthRun(lengths: number[]): number {
  let best = lengths.length > 0 ? 1 : 0;
  let cur = 1;
  for (let i = 1; i < lengths.length; i++) {
    const a = lengths[i - 1];
    const b = lengths[i];
    const within = Math.abs(a - b) <= 0.2 * Math.max(a, b);
    if (within) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

/**
 * Structural-monotony check (warn-only): flags uniform sentence length,
 * long runs of near-identical sentence length, and uniform paragraph length,
 * the cadence signature the humanizeaitext.io teardown (2026-07-10) named as
 * the residual AI tell this codebase's lexical validators (banned vocab, em
 * dash, rule of three, orphan words) do not catch. The fix is human
 * restructuring, never a synonym-swap pass, so this never fails a gate.
 *
 * Thresholds calibrated (2026-07-10) against real DRG Law human-edited prose
 * (drg-law-website /about, 14 sentences: sentence CV 0.358, longest similar
 * run 3, 8 paragraphs: paragraph CV 0.281) versus a synthetically flattened
 * counterpart on the same topic (sentence CV 0.076, longest run 16,
 * paragraph CV 0.023). Thresholds sit with margin below the human floor and
 * well above the flattened ceiling; re-calibrate against a larger corpus of
 * approved live pieces as they accumulate.
 */
export function validateStructuralMonotony(text: string): ValidatorResult {
  const findings: Finding[] = [];
  const { sentences, paragraphs } = extractProseUnits(text);

  const MIN_SENTENCES = 10;
  const MIN_PARAGRAPHS = 4;
  if (sentences.length < MIN_SENTENCES || paragraphs.length < MIN_PARAGRAPHS) {
    return {
      key: "structural_monotony",
      status: "pass",
      severity: "info",
      findings: [
        {
          rule: "structural_monotony",
          severity: "info",
          message: `Sample too small to measure rhythm (${sentences.length} prose sentences, ${paragraphs.length} prose paragraphs; needs ${MIN_SENTENCES}+ and ${MIN_PARAGRAPHS}+).`,
        },
      ],
    };
  }

  const sentLens = sentences.map(wordCount);
  const paraLens = paragraphs.map(wordCount);
  const sentCv = coefficientOfVariation(sentLens);
  const paraCv = coefficientOfVariation(paraLens);
  const run = longestSimilarLengthRun(sentLens);

  const SENT_CV_FLOOR = 0.25;
  const PARA_CV_FLOOR = 0.18;
  const RUN_CEILING = 7;

  if (sentCv < SENT_CV_FLOOR) {
    findings.push({
      rule: "structural_monotony",
      severity: "warn",
      message: `Sentence rhythm is flat (length variance ${sentCv.toFixed(2)}, below the ${SENT_CV_FLOOR} floor). Mix short declaratives with longer clauses; do not synonym-swap, restructure by hand.`,
    });
  }
  if (run >= RUN_CEILING) {
    findings.push({
      rule: "structural_monotony",
      severity: "warn",
      message: `${run} consecutive sentences of near-identical length. Break the run by combining two sentences or shortening one sharply.`,
    });
  }
  if (paraCv < PARA_CV_FLOOR) {
    findings.push({
      rule: "structural_monotony",
      severity: "warn",
      message: `Paragraph length is uniform (variance ${paraCv.toFixed(2)}, below the ${PARA_CV_FLOOR} floor). Let some paragraphs run long and others land in one or two sentences.`,
    });
  }

  return {
    key: "structural_monotony",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

/**
 * Format-safe LSO / brand text-compliance floor (Codex audit F4, 2026-07-07).
 *
 * The subset of the deterministic battery that operates on raw text and is
 * meaningful for ANY prose format, including the structured
 * canonical_service_page once its blocks are flattened. Excludes the
 * Markdown-structural checks (required sections, page structure, opening
 * discipline, SEO-field checks) that assume a Markdown body or a source brief
 * shape. runDeterministicValidators still runs every one of these inline for
 * Markdown formats; this function is the shared floor the canonical branch in
 * content-studio.ts appends so the flagship format cannot bypass the LSO/brand
 * safeguards by being on a different validation branch.
 */
export function runSharedTextComplianceFloor(
  text: string,
  config: ValidatorConfig,
  sourceBrief?: Record<string, unknown>,
): ValidatorResult[] {
  const results: ValidatorResult[] = [];

  results.push(validateBannedVocabulary(text, config.banned_vocabulary));
  results.push(validateLsoCompliance(text));

  if (config.formatting_rules.no_timing_promises ?? true) {
    results.push(validateTimingPromise(text));
  }
  if (config.formatting_rules.no_specialist_language ?? true) {
    results.push(validateSpecialistSelfDesignation(text));
  }
  if (config.formatting_rules.no_factual_hallucination ?? true) {
    const verifiedFacts = sourceBrief?.verified_facts === true;
    results.push(validateFactualClaim(text, verifiedFacts));
  }
  if (config.formatting_rules.no_fake_scarcity ?? true) {
    results.push(validateFakeScarcity(text));
  }
  if (config.formatting_rules.no_weasel_words ?? true) {
    results.push(validateWeaselWords(text));
  }
  if (config.formatting_rules.no_lso_superlatives ?? true) {
    results.push(validateLsoSuperlatives(text, config.certified_specialists));
  }
  if (config.formatting_rules.no_referral_violations ?? true) {
    results.push(validateReferralCopy(text));
  }
  if (config.formatting_rules.no_review_removal_copy ?? true) {
    results.push(validateNoReviewRemovalCopy(text, sourceBrief));
  }
  if (config.formatting_rules.no_us_trust_badges ?? true) {
    results.push(validateNoUsTrustBadges(text));
  }
  if (config.formatting_rules.no_lsa_quality_claim ?? true) {
    results.push(validateNoLsaQualityClaim(text));
  }
  if (config.formatting_rules.no_structural_monotony ?? true) {
    results.push(validateStructuralMonotony(text));
  }

  return results;
}

export function runPtValidators(text: string, config: ValidatorConfig): ValidatorResult[] {
  const results: ValidatorResult[] = [];
  if (config.formatting_rules.no_em_dashes) {
    results.push(validateEmDash(text));
  }
  if (config.formatting_rules.no_italics) {
    results.push(validateItalicsMarkup(text));
  }
  if (config.formatting_rules.no_orphan_words) {
    results.push(validateOrphanWords(text));
  }
  if (config.format_spec.word_range) {
    results.push(validateWordCount(text, config.format_spec.word_range));
  }
  if (config.formatting_rules.no_rule_of_three) {
    results.push(validateRuleOfThree(text));
  }
  results.push(validatePtJurisdictionDisclosure(text));

  // Codex audit F5 (2026-07-07): the PT battery was formatting-only. Add the
  // language-NEUTRAL compliance checks that carry real LSO/CASL risk and do
  // not false-positive on Portuguese prose because they match numeric/statute
  // patterns and US brand names, not English sentence shapes: unverified
  // factual/statute/dollar/percentage claims, US trust badges, and LSA
  // ("Google Screened"/"Google Guaranteed") quality claims. English-sentence
  // validators (timing-promise phrasing, opening discipline, banned-vocab
  // English list) are still excluded because they would be noise, not
  // assurance, against Portuguese text.
  if (config.formatting_rules.no_factual_hallucination ?? true) {
    results.push(validateFactualClaim(text, false));
  }
  if (config.formatting_rules.no_us_trust_badges ?? true) {
    results.push(validateNoUsTrustBadges(text));
  }
  if (config.formatting_rules.no_lsa_quality_claim ?? true) {
    results.push(validateNoLsaQualityClaim(text));
  }
  // Punctuation-based (sentence/paragraph length), not English-phrase-based,
  // so it carries over to Portuguese prose without false-positiving on
  // sentence shape the way the English-pattern checks would.
  if (config.formatting_rules.no_structural_monotony ?? true) {
    results.push(validateStructuralMonotony(text));
  }
  return results;
}

export function runDeterministicValidators(
  text: string,
  config: ValidatorConfig,
  sourceBrief?: Record<string, unknown>
): ValidatorResult[] {
  const results: ValidatorResult[] = [];

  results.push(validateBannedVocabulary(text, config.banned_vocabulary));
  results.push(validateApprovedVocabulary(text, config.approved_vocabulary));

  if (config.formatting_rules.no_em_dashes) {
    results.push(validateEmDash(text));
  }
  if (config.formatting_rules.no_italics) {
    results.push(validateItalicsMarkup(text));
  }
  if (config.formatting_rules.no_orphan_words) {
    results.push(validateOrphanWords(text));
  }
  if (config.format_spec.word_range) {
    results.push(validateWordCount(text, config.format_spec.word_range));
  }
  if (config.format_spec.structure) {
    results.push(validateRequiredSections(text, config.format_spec.structure));
  }
  if (config.format_spec.page_structure) {
    results.push(
      validatePageStructure(text, config.format_spec.page_structure, config.format)
    );
  }

  results.push(validateLsoCompliance(text));
  results.push(validateOpeningDiscipline(text));

  if (config.formatting_rules.no_rule_of_three) {
    results.push(validateRuleOfThree(text));
  }

  // Timing-promise, specialist, and factual-claim default to true (fail-secure
  // for LSO Rule 4.2-1). Operator opts out per-piece via the source_brief flags.
  const noTiming = config.formatting_rules.no_timing_promises ?? true;
  const noSpecialist = config.formatting_rules.no_specialist_language ?? true;
  const noFactual = config.formatting_rules.no_factual_hallucination ?? true;
  const verifiedFacts =
    sourceBrief && (sourceBrief as Record<string, unknown>).verified_facts === true;

  if (noTiming) {
    results.push(validateTimingPromise(text));
  }
  if (noSpecialist) {
    results.push(validateSpecialistSelfDesignation(text));
  }
  if (noFactual) {
    // X5: validator now self-handles verified_facts to enforce the past-results
    // disclaimer when an outcome figure passes the verification gate.
    results.push(validateFactualClaim(text, !!verifiedFacts));
  }
  if (config.formatting_rules.enforce_hook_retain_reward) {
    results.push(validateHookRetainReward(text, config.format));
  }
  if (config.formatting_rules.no_fake_scarcity ?? true) {
    results.push(validateFakeScarcity(text));
  }
  if (config.formatting_rules.no_weasel_words ?? true) {
    results.push(validateWeaselWords(text));
  }
  if (config.formatting_rules.enforce_email_respect ?? true) {
    results.push(validateEmailRespect(text, config.format));
  }
  if (
    (config.formatting_rules.no_rejected_ctas ?? true) &&
    config.rejected_ctas &&
    config.rejected_ctas.length > 0
  ) {
    results.push(validateRejectedCtas(text, config.rejected_ctas));
  }

  // ─── P0 delta batch (compliance-blocking, 2026-06-26) ─────────────────────
  if (config.formatting_rules.enforce_review_request_compliance ?? true) {
    results.push(validateReviewRequest(text, config.format));
    // Codex audit F7: CASL identity + unsubscribe for the review_request
    // Email/SMS channels (validateEmailRespect excludes review_request).
    results.push(validateReviewRequestCasl(text, config.format));
  }
  if (config.formatting_rules.enforce_negative_review_response ?? true) {
    results.push(validateNegativeReviewResponse(text, config.format));
  }
  if (config.formatting_rules.enforce_testimonial_content ?? true) {
    results.push(validateTestimonialContent(text, config.format));
  }
  if (config.formatting_rules.no_lso_superlatives ?? true) {
    results.push(validateLsoSuperlatives(text, config.certified_specialists));
  }
  if (config.formatting_rules.no_referral_violations ?? true) {
    results.push(validateReferralCopy(text));
  }
  if (config.formatting_rules.no_incentivized_review ?? true) {
    results.push(validateNoIncentivizedReview(text, config.format));
  }
  if (config.formatting_rules.no_review_removal_copy ?? true) {
    results.push(validateNoReviewRemovalCopy(text, sourceBrief));
  }
  if (config.formatting_rules.no_free_consult_lure ?? true) {
    results.push(validateNoFreeConsultLure(text, config.format));
  }
  if (config.formatting_rules.no_distress_hero ?? true) {
    results.push(validateNoDistressHero(text, config.format));
  }
  if (config.formatting_rules.no_us_trust_badges ?? true) {
    results.push(validateNoUsTrustBadges(text));
  }
  if (config.formatting_rules.no_lsa_quality_claim ?? true) {
    results.push(validateNoLsaQualityClaim(text));
  }

  if (sourceBrief) {
    results.push(validateSourceIntegrity(sourceBrief, config.format));

    // SEO/AEO retrofit (Step 5). Each validator already no-ops internally
    // when its field is missing; gating the push here too so a piece that
    // never opted into the new fields does not pick up extra "pass, no
    // findings" entries cluttering the results list.
    const primaryQuery = sourceBrief.primary_query as string | undefined;
    const answerSummary = sourceBrief.answer_summary as string | undefined;
    const jurisdiction = sourceBrief.jurisdiction as string | undefined;
    const serviceArea = sourceBrief.service_area as string | string[] | undefined;

    if (primaryQuery || answerSummary) {
      results.push(validateAnswerInTop30PercentText(text, primaryQuery, answerSummary));
    }
    if (primaryQuery) {
      results.push(validatePrimaryQueryPresenceText(text, primaryQuery));
    }
    if (jurisdiction || serviceArea) {
      results.push(
        validateJurisdictionServiceAreaEarlyText(text, jurisdiction, serviceArea)
      );
    }

    // Ses.17 WP-3 additions.
    const secondaryQueries = sourceBrief.secondary_queries as string[] | undefined;
    const clientQuestionVariants = sourceBrief.client_question_variants as string[] | undefined;
    const internalLinkTargets = sourceBrief.internal_link_targets as
      | InternalLinkTarget[]
      | undefined;

    if (clientQuestionVariants?.length || secondaryQueries?.length) {
      results.push(validateHeadingQueryAlignment(text, clientQuestionVariants, secondaryQueries));
    }
    if (secondaryQueries?.length) {
      results.push(validateSecondaryQueryCoverage(text, secondaryQueries));
    }
    if (serviceArea) {
      results.push(validateServiceAreaPresence(text, serviceArea));
    }
    if (internalLinkTargets?.length) {
      results.push(validateInternalLinkDomains(internalLinkTargets, config.firm_website));
    }
  }

  if (config.entity_names?.length) {
    results.push(validateEntityPresent(text, config.entity_names));
  }
  if (config.formatting_rules.no_structural_monotony ?? true) {
    results.push(validateStructuralMonotony(text));
  }

  return results;
}

// =============================================================================
// Canonical service page: AEO + SEO validators (structured-output aware)
//
// Added 2026-07-02, SEO/AEO spec Section 10 step 3 (operator-confirmed build
// order, docs/CONTENT_STUDIO_SEO_AEO_SPEC.md). canonical_service_page is
// generated as structured output (content-studio-structured.ts), not
// Markdown, so these validators read the structured artifacts directly
// (ServicePageBlock[] and the seo_metadata object) wherever that gives a
// cleaner signal than text regex: finding a block by its format-spec key
// beats scanning for a heading pattern. flattenServicePageToPlainText is used
// only for the checks that are inherently about text position or density
// (answer placement in the first 30%, jurisdiction placement, keyword
// stuffing), matching the spec's own guidance to avoid regex-only where the
// structured object gives a cleaner signal.
//
// Not wired into runDeterministicValidators or any route in this pass. These
// are additive, exported functions plus one orchestrator
// (runCanonicalServicePageValidators); wiring into the draft or validate
// route is a deliberately separate decision, not required for this step.
// =============================================================================

const QUERY_STOP_WORDS = new Set([
  "a", "an", "the", "to", "in", "of", "for", "do", "does", "did", "is", "are",
  "i", "my", "on", "at", "and", "or", "with", "this", "that", "you", "your",
  "it", "be", "if", "not", "can", "will", "how", "what", "when", "where",
]);

// Exported (Ses.17 WP-3) so the cannibalization check in content-studio.ts's
// runAndRecordValidation (which needs a corpus query against other pieces,
// so it cannot be a pure validator here) can reuse the exact same
// significant-word extraction the query-overlap checks in this file use.
export function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !QUERY_STOP_WORDS.has(w));
}

// Fraction of the query's significant words that appear anywhere in text.
// 1 when the query is empty (nothing to fail on), 0 when none of the
// significant words appear at all.
function queryOverlapRatio(query: string, text: string): number {
  const qWords = Array.from(new Set(significantWords(query)));
  if (qWords.length === 0) return 1;
  const lowerText = text.toLowerCase();
  const hits = qWords.filter((w) => lowerText.includes(w));
  return hits.length / qWords.length;
}

function findBlockByKey(blocks: ServicePageBlock[], key: string): ServicePageBlock | undefined {
  return blocks.find((b) => b.key === key);
}

function blockText(block: ServicePageBlock | undefined): string {
  if (!block) return "";
  if (block.type === "h1") return `${block.line1} ${block.line2}`;
  if (block.type === "section") return `${block.heading ?? ""} ${block.body_markdown}`;
  if (block.type === "faq_block") return block.items.map((i) => `${i.question} ${i.answer}`).join(" ");
  return "";
}

// -----------------------------------------------------------------------------
// AEO 1: named author / entity block present.
// -----------------------------------------------------------------------------
export function validateNamedAuthorPresent(blocks: ServicePageBlock[]): ValidatorResult {
  const findings: Finding[] = [];
  const block = findBlockByKey(blocks, SERVICE_PAGE_SECTION_KEYS.authorBio);
  const body = block && block.type === "section" ? block.body_markdown : "";
  if (!body || body.trim().length < 10) {
    findings.push({
      rule: "named_author_present",
      severity: "fail",
      message:
        "No author/entity block found. canonical_service_page requires a named lawyer byline with credentials; check strategy_json.canonical_nap.lawyer_public_facing_name is populated on the active strategy.",
    });
  }
  return {
    key: "named_author_present",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// AEO 2: FAQ block present with at least 2 complete pairs.
// -----------------------------------------------------------------------------
export function validateFaqBlockPresent(blocks: ServicePageBlock[]): ValidatorResult {
  const findings: Finding[] = [];
  const block = blocks.find(
    (b): b is Extract<ServicePageBlock, { type: "faq_block" }> => b.type === "faq_block"
  );
  if (!block || block.items.length < 2) {
    findings.push({
      rule: "faq_block_present",
      severity: "fail",
      message:
        "FAQ block missing or has fewer than 2 question/answer pairs. This is a page-comprehension and AI-citation signal, not a Google rich-result requirement (FAQ rich results were removed 2026-05-07); it still matters for AEO.",
    });
  } else {
    block.items.forEach((item, i) => {
      if (!item.question?.trim() || !item.answer?.trim()) {
        findings.push({
          rule: "faq_block_present",
          severity: "fail",
          message: `FAQ item ${i} has an empty question or answer.`,
        });
      }
    });
  }
  return {
    key: "faq_block_present",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// AEO 3: direct answer appears in the first 30% of the page (by content, not
// merely by block position, since block order is fixed by construction; the
// real risk is the opening paragraph being generic filler that never states
// the answer). Pass with no findings when neither primaryQuery nor
// answerSummary was supplied; there is nothing to check the opening against.
// -----------------------------------------------------------------------------
export function validateAnswerInTop30Percent(
  blocks: ServicePageBlock[],
  primaryQuery?: string,
  answerSummary?: string
): ValidatorResult {
  const findings: Finding[] = [];
  const queryTerm = primaryQuery || answerSummary;
  if (!queryTerm) {
    return { key: "answer_top_30_percent", status: "pass", severity: "info", findings };
  }
  const flat = flattenServicePageToPlainText(blocks);
  const top30 = flat.slice(0, Math.max(1, Math.ceil(flat.length * 0.3)));
  const ratio = queryOverlapRatio(queryTerm, top30);
  if (ratio === 0) {
    findings.push({
      rule: "answer_top_30_percent",
      severity: "fail",
      message:
        "No content matching the primary query or answer summary appears in the first 30% of the page. The direct answer must lead, not appear buried later (CXL Google AI Overviews citation study: 55% of citations come from the first 30% of a page).",
    });
  } else if (ratio < 0.5) {
    findings.push({
      rule: "answer_top_30_percent",
      severity: "warn",
      message: `Only partial overlap (${Math.round(ratio * 100)}%) between the query and the first 30% of the page. Confirm the opening paragraph states the direct answer, not a related but different point.`,
    });
  }
  return {
    key: "answer_top_30_percent",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// AEO 4: last-updated date visible. The source-of-record date lives in
// seo_metadata.generated_at (structural, set by buildSeoMetadata) until a
// dedicated last_updated_at column exists on content_pieces (Phase 4,
// deferred pending Task #12). No text-marker regex needed; the structured
// field is the cleaner signal.
// -----------------------------------------------------------------------------
export function validateLastUpdatedDateVisible(
  seoMetadata: Record<string, unknown> | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  const generatedAt = seoMetadata?.generated_at;
  const parsed = typeof generatedAt === "string" ? Date.parse(generatedAt) : NaN;
  if (typeof generatedAt !== "string" || Number.isNaN(parsed)) {
    findings.push({
      rule: "last_updated_visible",
      severity: "fail",
      message:
        "No valid last-updated date found in seo_metadata.generated_at. A page without a freshness signal reads as unmaintained to both readers and AI answer engines.",
    });
  }
  return {
    key: "last_updated_visible",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// SEO 1: primary query appears naturally in H1/title/intro, and is not
// stuffed (the exact phrase repeated unnaturally often).
// -----------------------------------------------------------------------------
export function validatePrimaryQueryPresence(
  blocks: ServicePageBlock[],
  primaryQuery: string | undefined,
  title: string | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  if (!primaryQuery || !primaryQuery.trim()) {
    return { key: "primary_query_presence", status: "pass", severity: "info", findings };
  }
  const h1 = findBlockByKey(blocks, SERVICE_PAGE_SECTION_KEYS.h1);
  const firstParagraph = findBlockByKey(blocks, SERVICE_PAGE_SECTION_KEYS.firstParagraph);
  const introText = [blockText(h1), title ?? "", blockText(firstParagraph)].join(" ");
  const ratio = queryOverlapRatio(primaryQuery, introText);
  if (ratio === 0) {
    findings.push({
      rule: "primary_query_presence",
      severity: "fail",
      message: `Primary query "${primaryQuery}" has no overlap with the H1, title, or opening paragraph.`,
    });
  } else if (ratio < 0.5) {
    findings.push({
      rule: "primary_query_presence",
      severity: "warn",
      message: `Primary query "${primaryQuery}" only partially appears (${Math.round(ratio * 100)}%) across the H1, title, and opening paragraph.`,
    });
  }

  const flat = flattenServicePageToPlainText(blocks);
  const exactPhrasePattern = new RegExp(escapeRegex(primaryQuery.trim()), "gi");
  const occurrences = (flat.match(exactPhrasePattern) ?? []).length;
  if (occurrences >= 3) {
    findings.push({
      rule: "primary_query_presence",
      severity: "warn",
      message: `The exact phrase "${primaryQuery}" appears ${occurrences} times verbatim. That reads as keyword stuffing; vary the phrasing across the page.`,
    });
  }

  return {
    key: "primary_query_presence",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// SEO 2: jurisdiction and service area appear early (H1 + opening paragraph),
// not merely somewhere on the page. Jurisdiction absent entirely is a fail;
// present but late, or service area absent, is a warn (softer requirement,
// not every page ships a service area).
// -----------------------------------------------------------------------------
export function validateJurisdictionAndServiceAreaEarly(
  blocks: ServicePageBlock[],
  jurisdiction: string | undefined,
  serviceArea: string | string[] | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  if (!jurisdiction && !serviceArea) {
    return { key: "jurisdiction_service_area_early", status: "pass", severity: "info", findings };
  }
  const earlyText = flattenServicePageToPlainText(blocks.slice(0, 2)).toLowerCase();
  const fullText = flattenServicePageToPlainText(blocks).toLowerCase();

  if (jurisdiction && jurisdiction.trim()) {
    const j = jurisdiction.toLowerCase();
    if (!fullText.includes(j)) {
      findings.push({
        rule: "jurisdiction_service_area_early",
        severity: "fail",
        message: `Jurisdiction "${jurisdiction}" does not appear anywhere on the page.`,
      });
    } else if (!earlyText.includes(j)) {
      findings.push({
        rule: "jurisdiction_service_area_early",
        severity: "warn",
        message: `Jurisdiction "${jurisdiction}" appears on the page but not in the H1 or opening paragraph.`,
      });
    }
  }

  if (serviceArea) {
    const areas = Array.isArray(serviceArea) ? serviceArea : [serviceArea];
    const missing = areas.filter((a) => a.trim() && !fullText.includes(a.toLowerCase()));
    if (missing.length > 0) {
      findings.push({
        rule: "jurisdiction_service_area_early",
        severity: "warn",
        message: `Service area(s) not found on the page: ${missing.join(", ")}.`,
      });
    }
  }

  return {
    key: "jurisdiction_service_area_early",
    status: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "pass",
    severity: findings.some((f) => f.severity === "fail") ? "fail" : findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// SEO 3: internal links present if internal_link_targets were offered. Reads
// seo_metadata.internal_links_used (structured, set by buildSeoMetadata from
// the model's seo.internal_links_used field) rather than scanning body
// markdown for [label](url) patterns, since the structured field is already
// the exact set of links the model actually used.
// -----------------------------------------------------------------------------
export function validateInternalLinksPresent(
  internalLinkTargets: Array<{ url: string; anchor_text_hint?: string }> | undefined,
  seoMetadata: Record<string, unknown> | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  if (!internalLinkTargets || internalLinkTargets.length === 0) {
    return { key: "internal_links_present", status: "pass", severity: "info", findings };
  }
  const used = (seoMetadata?.internal_links_used as unknown[] | undefined) ?? [];
  if (used.length === 0) {
    findings.push({
      rule: "internal_links_present",
      severity: "warn",
      message: `${internalLinkTargets.length} internal link target(s) were offered but none were used in the draft. Confirm there was a natural place to use at least one; do not force one in if there was not.`,
    });
  }
  return {
    key: "internal_links_present",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// SEO 4: FAQ question headings are actually question-shaped. Warn-level: some
// legitimate FAQ headings are statements, so this is a signal, not a gate.
// -----------------------------------------------------------------------------
const QUESTION_START_RE =
  /^(do|does|did|is|are|can|could|will|would|should|what|when|where|why|how|who|which)\b/i;

export function validateFaqQuestionsAreQuestionShaped(blocks: ServicePageBlock[]): ValidatorResult {
  const findings: Finding[] = [];
  const block = blocks.find(
    (b): b is Extract<ServicePageBlock, { type: "faq_block" }> => b.type === "faq_block"
  );
  if (!block) {
    return { key: "faq_question_shape", status: "pass", severity: "info", findings };
  }
  block.items.forEach((item, i) => {
    const q = (item.question ?? "").trim();
    const looksLikeQuestion = q.endsWith("?") || QUESTION_START_RE.test(q);
    if (!looksLikeQuestion) {
      findings.push({
        rule: "faq_question_shape",
        severity: "warn",
        message: `FAQ item ${i} does not read as a question: "${q.slice(0, 60)}". Match it to a real client question variant.`,
      });
    }
  });
  return {
    key: "faq_question_shape",
    status: findings.length > 0 ? "warn" : "pass",
    severity: findings.length > 0 ? "warn" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// SEO 5: schema directives present in structured metadata. Object-presence
// check against seo_metadata.schema, not a text-regex; JSON-LD blocks are
// never rendered into body_markdown for this format.
// -----------------------------------------------------------------------------
const REQUIRED_SCHEMA_BLOCKS = ["legal_service", "person", "faq_page", "breadcrumb_list"];

export function validateSchemaDirectivesPresent(
  seoMetadata: Record<string, unknown> | undefined
): ValidatorResult {
  const findings: Finding[] = [];
  const schema = seoMetadata?.schema as Record<string, unknown> | undefined;
  if (!schema) {
    findings.push({
      rule: "schema_directives_present",
      severity: "fail",
      message:
        "No schema block found in seo_metadata. canonical_service_page requires LegalService, Person, FAQPage, and BreadcrumbList JSON-LD.",
    });
  } else {
    const missing = REQUIRED_SCHEMA_BLOCKS.filter((k) => !schema[k]);
    if (missing.length > 0) {
      findings.push({
        rule: "schema_directives_present",
        severity: "fail",
        message: `Missing schema block(s): ${missing.join(", ")}.`,
      });
    }
  }
  return {
    key: "schema_directives_present",
    status: findings.length > 0 ? "fail" : "pass",
    severity: findings.length > 0 ? "fail" : "info",
    findings,
  };
}

// -----------------------------------------------------------------------------
// Orchestrator. Not called from any route yet (deliberately, see file-header
// note above); callers pass the blocks and seo_metadata produced by
// content-studio-structured.ts plus a context object drawn from source_brief.
// -----------------------------------------------------------------------------
export interface CanonicalServicePageValidationContext {
  primaryQuery?: string;
  answerSummary?: string;
  jurisdiction?: string;
  serviceArea?: string | string[];
  internalLinkTargets?: Array<{ url: string; anchor_text_hint?: string; relation?: string }>;
  title?: string;
  // Ses.17 WP-3: strategy_json.canonical_nap.website, for the domain
  // allowlist check. Optional since a firm may not have it on file yet.
  firmWebsite?: string;
}

export function runCanonicalServicePageValidators(
  blocks: ServicePageBlock[],
  seoMetadata: Record<string, unknown> | undefined,
  context: CanonicalServicePageValidationContext
): ValidatorResult[] {
  return [
    validateNamedAuthorPresent(blocks),
    validateFaqBlockPresent(blocks),
    validateAnswerInTop30Percent(blocks, context.primaryQuery, context.answerSummary),
    validateLastUpdatedDateVisible(seoMetadata),
    validatePrimaryQueryPresence(
      blocks,
      context.primaryQuery,
      context.title ?? (seoMetadata?.title as string | undefined)
    ),
    validateJurisdictionAndServiceAreaEarly(blocks, context.jurisdiction, context.serviceArea),
    validateInternalLinksPresent(context.internalLinkTargets, seoMetadata),
    validateFaqQuestionsAreQuestionShaped(blocks),
    validateSchemaDirectivesPresent(seoMetadata),
    validateInternalLinkDomains(context.internalLinkTargets, context.firmWebsite),
  ];
}