/**
 * The earned-versus-claimed classifier (WEBSITE_AUTHORITY_SIGNAL_MODULE.md
 * "The earned-versus-claimed classifier (the core mechanic)"). Pure, no
 * I/O, so it is directly unit-testable against fixture strings.
 *
 * Runs in the two parts the module specifies: a lexical scan for
 * self-designation/superlative hits (Part 1), then a proximity-of-proof
 * check per hit (Part 2). Part 3 (the LSO compliance overlay) is applied
 * by the caller (dimensions/authority.ts), since it changes what a hit
 * MEANS (naked vs proof-backed) rather than how hits are found.
 *
 * Evidence detection here is text-pattern based only (credential words,
 * dated numbers, named associations). The module also counts a "linked
 * published source" as proof, which needs the raw anchor/href structure,
 * not the plain-text innerText this scanner runs against; that signal is
 * deliberately not approximated here; see dimensions/authority.ts for
 * where the DOM-level author/link signals are checked directly instead.
 */

export type LexiconCategory = "prohibited" | "self_designation" | "superlative" | "law_marketing";

export interface LexiconTerm {
  term: string;
  pattern: RegExp;
  category: LexiconCategory;
  /** Gated back on by on-page evidence per module Part 3 (specialist
   * requires a certified_specialist signal; award-winning requires a named,
   * dated basis nearby, which the general proof window already covers). */
  gatable: boolean;
}

// Module Part 1, verbatim term list. Word-boundary matched, case-insensitive.
export const SELF_DESIGNATION_LEXICON: LexiconTerm[] = [
  { term: "best", pattern: /\bbest\b/i, category: "prohibited", gatable: false },
  { term: "super", pattern: /\bsuper\b/i, category: "prohibited", gatable: false },
  { term: "#1", pattern: /#\s*1\b/, category: "prohibited", gatable: false },
  { term: "number one", pattern: /\bnumber\s+one\b/i, category: "prohibited", gatable: false },
  { term: "expert", pattern: /\bexperts?\b/i, category: "self_designation", gatable: true },
  { term: "specialist", pattern: /\bspecialists?\b/i, category: "self_designation", gatable: true },
  { term: "leader", pattern: /\bleaders?\b/i, category: "self_designation", gatable: false },
  { term: "leading", pattern: /\bleading\b/i, category: "self_designation", gatable: false },
  { term: "top-rated", pattern: /\btop[\s-]rated\b/i, category: "self_designation", gatable: false },
  { term: "premier", pattern: /\bpremier\b/i, category: "self_designation", gatable: false },
  { term: "elite", pattern: /\belite\b/i, category: "self_designation", gatable: false },
  { term: "guarantee", pattern: /\bguarantees?d?\b/i, category: "self_designation", gatable: false },
  { term: "world-class", pattern: /\bworld[\s-]class\b/i, category: "superlative", gatable: false },
  { term: "award-winning", pattern: /\baward[\s-]winning\b/i, category: "superlative", gatable: true },
  { term: "trusted", pattern: /\btrusted\b/i, category: "superlative", gatable: false },
  { term: "renowned", pattern: /\brenowned\b/i, category: "superlative", gatable: false },
  { term: "unrivalled", pattern: /\bunrivall?ed\b/i, category: "superlative", gatable: false },
  { term: "unmatched", pattern: /\bunmatched\b/i, category: "superlative", gatable: false },
  { term: "seamless", pattern: /\bseamless(ly)?\b/i, category: "superlative", gatable: false },
  { term: "dominate", pattern: /\bdominat(e|es|ed|ing|ion)\b/i, category: "law_marketing", gatable: false },
  { term: "best choice", pattern: /\bbest choice\b/i, category: "law_marketing", gatable: false },
  { term: "pit bull", pattern: /\bpit[\s-]bull\b/i, category: "law_marketing", gatable: false },
];

/** Text-pattern signals that count as "verifiable evidence nearby" per
 * module Part 2: named credentials, dated third-party proof, named
 * associations. Not exhaustive; see module note above re: linked sources. */
const PROOF_EVIDENCE_PATTERNS: RegExp[] = [
  /certified specialist/i,
  /law society of ontario/i,
  /\blso\b/i,
  /call(?:ed)? to the bar/i,
  /\b\d{4}\b/, // a year, the "dated" half of "named, dated" proof
  /\b\d+(\.\d+)?\s*(stars?|reviews?|out of 5)\b/i,
  /\bassociation of\b|\bbar association\b|\binstitute of\b/i,
  /\bcertified by\b|\baccredited by\b|\bmember of\b/i,
];

export interface LexiconHit {
  term: string;
  category: LexiconCategory;
  gatable: boolean;
  /** Plain-text snippet surrounding the hit, for the report. */
  context: string;
  /** True when a verifiable-evidence pattern appears within the proof
   * window around this hit (module Part 2: "same section or component",
   * approximated here as a fixed character window either side). */
  hasAdjacentProof: boolean;
}

const PROOF_WINDOW_CHARS = 220;

/**
 * Scans firm-voiced text for lexicon hits and classifies each as
 * proof-backed or naked. Module Part 2: "Claim with adjacent verifiable
 * proof: neutral to positive. Claim with no adjacent proof: negative."
 */
export function scanForLexiconHits(firmVoicedText: string): LexiconHit[] {
  const hits: LexiconHit[] = [];
  for (const entry of SELF_DESIGNATION_LEXICON) {
    const globalPattern = new RegExp(entry.pattern.source, entry.pattern.flags.includes("g") ? entry.pattern.flags : entry.pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(firmVoicedText)) !== null) {
      const start = Math.max(0, match.index - PROOF_WINDOW_CHARS);
      const end = Math.min(firmVoicedText.length, match.index + match[0].length + PROOF_WINDOW_CHARS);
      const window = firmVoicedText.slice(start, end);
      const hasAdjacentProof = PROOF_EVIDENCE_PATTERNS.some((p) => p.test(window));
      hits.push({
        term: entry.term,
        category: entry.category,
        gatable: entry.gatable,
        context: firmVoicedText.slice(Math.max(0, match.index - 40), Math.min(firmVoicedText.length, match.index + match[0].length + 40)).trim(),
        hasAdjacentProof,
      });
      // Avoid pathological infinite loop on zero-width matches.
      if (match[0].length === 0) globalPattern.lastIndex++;
    }
  }
  return hits;
}

export interface ClaimIntegrityResult {
  /** 0-100. Starts at 100, loses points per naked hit, per module §Scoring. */
  score: number;
  nakedHits: LexiconHit[];
  proofBackedHits: LexiconHit[];
}

const POINTS_LOST_PER_NAKED_HIT = 15;

/**
 * Claim integrity sub-score (module weight 12 of the dimension's internal
 * 100). "Starts at 100 and loses points for each naked self-designation
 * ... High self-designation density with low proof density drives this
 * sub-score toward zero."
 */
export function scoreClaimIntegrity(hits: LexiconHit[]): ClaimIntegrityResult {
  const nakedHits = hits.filter((h) => !h.hasAdjacentProof);
  const proofBackedHits = hits.filter((h) => h.hasAdjacentProof);
  const score = Math.max(0, 100 - nakedHits.length * POINTS_LOST_PER_NAKED_HIT);
  return { score, nakedHits, proofBackedHits };
}
