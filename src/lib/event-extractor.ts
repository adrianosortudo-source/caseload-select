/**
 * Event Extractor  -  Pure Detection Layer
 *
 * Detects legally-relevant events in a client's free-text message. No scoring,
 * no prioritization, no selection logic. Just: "what events are in this text,
 * and what do we know about each one?"
 *
 * Downstream: event-selector.ts consumes this output and picks the target event
 * using deterministic information-gap scoring.
 *
 * Design constraints:
 *   - Pure function. Same input, same output. No side effects.
 *   - No scoring. Never ranks events.
 *   - Detection-only. If it matches, it emits. Let the selector decide.
 *   - Stable. The shape of ExtractedEvent is a contract with the selector.
 *
 * Stage 9 changes:
 *   - marriage_to_citizen: added engaged/fiancé/spouse-is-citizen patterns.
 *   - real_estate_defect: anchored bare "water damage" (requires RE context within
 *     60 chars) and anchored "wasn't disclosed" (requires property word within 80 chars).
 *   - patternWeights: per-pattern confidence overrides for broad patterns.
 *     Broad slip_fall and mva patterns get 0.75-0.80 instead of full baseConfidence.
 *     Specific patterns in the same detector are unaffected.
 */

export interface ExtractedEvent {
  /** Canonical event type, e.g. "deportation", "mva", "termination". */
  type: string;
  /** The exact substring of the message that triggered the detection. */
  source_text: string;
  /** Normalized time expression as it appeared, or null if none found near this event. */
  time: string | null;
  /**
   * "trigger" = time resolves WHEN the event happened (e.g. "last month", "2 years ago").
   * "duration" = time describes a span, not a point (e.g. "for the past year").
   * null = no time expression attached.
   */
  time_type: "trigger" | "duration" | null;
  /** True only when time_type === "trigger". Duration does not resolve timing. */
  time_resolved: boolean;
  /** Attributes extracted from nearby text (e.g. known facts about the event). */
  attributes: { known: string[] };
  /** Detection confidence 0-1. Based on specificity of the match. */
  confidence: number;
  /** Character index of match start in the original message. Lower = earlier. Used for tie-breaking in selector. */
  position: number;
}

type Detector = {
  type: string;
  /** Patterns that must match. First match wins for source_text. */
  patterns: RegExp[];
  /**
   * Per-pattern confidence overrides, parallel to `patterns`.
   * When provided, patternWeights[i] replaces baseConfidence for patterns[i].
   * Use to assign lower confidence to broad or ambiguous patterns within a detector
   * without penalising the high-specificity patterns in the same bank.
   */
  patternWeights?: number[];
  /** Optional attribute extractors: run against the full message, push matches. */
  attributeExtractors?: Array<{ label: string; pattern: RegExp }>;
  /** Base confidence when a pattern hits. Specific phrases get higher values. */
  baseConfidence: number;
};

const DETECTORS: Detector[] = [
  {
    type: "deportation",
    patterns: [
      /\b(?:was|were|got|been)\s+deported\b/i,
      /\bdeportation\s+(?:order|notice)\b/i,
      /\bremoval\s+order\b/i,
    ],
    baseConfidence: 0.95,
  },
  {
    type: "marriage_to_citizen",
    patterns: [
      // Original patterns
      /\bmarry(?:ing)?\s+(?:a\s+)?canadian(?:\s+citizen)?\b/i,
      /\b(?:married|marriage)\s+(?:to\s+)?(?:a\s+)?canadian(?:\s+citizen)?\b/i,
      /\bspous(?:e|al)\s+sponsorship\b/i,
      // Stage 9: engaged / fiancé / spouse-is-citizen variants
      /\bengag(?:ed|ing)\s+to\s+(?:a\s+)?canadian(?:\s+citizen)?\b/i,
      /\bfianc[eé]e?\s+is\s+(?:a\s+)?canadian(?:\s+citizen)?\b/i,
      /\b(?:my\s+)?(?:spouse|partner|common.?law\s+(?:partner|spouse)|husband|wife)\s+is\s+(?:a\s+)?canadian(?:\s+citizen)?\b/i,
    ],
    baseConfidence: 0.9,
  },
  {
    type: "termination",
    patterns: [
      /\b(?:was|were|got|been)\s+fired\b/i,
      /\b(?:was|were|got|been)\s+terminated\b/i,
      /\b(?:was|were|got)\s+laid\s+off\b/i,
      /\blost\s+my\s+job\b/i,
      /\bwrongful\s+dismissal\b/i,
    ],
    baseConfidence: 0.9,
  },
  {
    type: "unpaid_overtime",
    patterns: [
      /\bunpaid\s+overtime\b/i,
      /\bovertime\s+(?:pay|wages)\s+(?:not|never|wasn[''']t)\s+paid\b/i,
      /\bnot\s+paid\s+(?:for\s+)?overtime\b/i,
      /\b(?:hasn[''']?t|haven[''']?t|didn[''']?t|never)\s+(?:been\s+)?paid\s+(?:me\s+)?(?:for\s+)?overtime\b/i,
    ],
    baseConfidence: 0.9,
  },
  {
    type: "mva",
    patterns: [
      /\bcar\s+accident\b/i,                                          // 0 — specific
      /\bmotor\s+vehicle\s+accident\b/i,                              // 1 — specific
      /\brear.?ended\b/i,                                             // 2 — specific
      /\bt.?boned\b/i,                                                // 3 — specific
      /\bcollision\b/i,                                               // 4 — broad: "collision course", figurative use
      /\bhit\s+by\s+(?:a\s+)?(?:car|truck|vehicle|driver)\b/i,       // 5 — specific
    ],
    // patternWeights[4]: collision is broad — lower its floor, time/attribute bonuses still apply
    patternWeights: [0.90, 0.90, 0.90, 0.90, 0.78, 0.90],
    attributeExtractors: [
      { label: "other_driver_fault", pattern: /\b(?:other\s+driver|they)\s+(?:ran\s+(?:a|the)\s+red\s+light|ran\s+(?:a|the)\s+stop\s+sign|was\s+speeding|failed\s+to\s+yield)\b/i },
      { label: "ran_red_light", pattern: /\bran\s+(?:a|the)\s+red\s+light\b/i },
    ],
    baseConfidence: 0.9,
  },
  {
    type: "slip_fall",
    patterns: [
      /\bslip(?:ped)?\s+and\s+fell\b/i,                              // 0 — specific compound
      /\bslip\s+and\s+fall\b/i,                                       // 1 — specific legal phrase
      /\bfell\s+(?:on|at|in)\b/i,                                     // 2 — broad: "fell on hard times"
      /\btripped\s+(?:on|over)\b/i,                                   // 3 — moderate: "tripped over myself"
      /\bslipped\s+(?:on|at|in|while|and)\b/i,                       // 4 — moderate (Walmart fix)
    ],
    // patternWeights[2-4]: broad/moderate patterns get lower floors
    patternWeights: [0.85, 0.85, 0.75, 0.78, 0.80],
    baseConfidence: 0.85,
  },
  {
    type: "debt_owed",
    patterns: [
      /\bloaned\s+money\b/i,
      /\blent\s+(?:\$?\d|money)\b/i,
      /\bwon[''']t\s+repay\b/i,
      /\brefuses?\s+to\s+(?:re)?pay\b/i,
      /\bowes?\s+me\s+money\b/i,
    ],
    baseConfidence: 0.9,
  },
  // ── Corporate incorporation / business formation ────────────────────────
  // Covers new incorporations, business setup, and entity formation intents.
  // NOTE: Do NOT add general "start a business" patterns that could overlap with
  // employment or landlord-tenant contexts. Keep them specific to entity formation.
  {
    type: "corp_formation",
    patterns: [
      /\b(?:want\s+to\s+)?incorporat(?:e|ion|ing)\b/i,                           // "incorporate", "incorporation", "incorporating"
      /\bopen(?:ing)?\s+a\s+(?:corporation|company|corp\b)/i,                    // "open a corporation/company"
      /\bstart(?:ing)?\s+a\s+(?:corporation|company|corp\b|business\b.*incorp)/i, // "starting a corporation", "starting a business and incorporate"
      /\bform(?:ing)?\s+(?:a\s+)?(?:corporation|company|corp\b|llc\b|inc\b)/i,   // "forming a corporation/company"
      /\bregist(?:er|ering|ration)\s+(?:a\s+)?(?:corporation|company|business\s+entity)\b/i, // "registering a corporation/company"
      /\bbusiness\s+incorporat/i,                                                  // "business incorporation"
      /\bset\s+up\s+(?:a\s+)?(?:corporation|company|corp\b)/i,                   // "set up a corporation/company"
    ],
    baseConfidence: 0.90,
  },

  {
    type: "real_estate_defect",
    patterns: [
      // Stage 9: "water damage" alone is too broad (false positives on maintenance/repair).
      // Require a real estate anchor word within 60 chars (forward or backward).
      /\bwater\s+damage\b.{0,60}\b(?:seller|closing|bought|purchased|defect|disclosed)\b/i,   // 0 — forward
      /\b(?:disclosed|disclosure|seller|closing|closed|bought|purchased)\b.{0,60}\bwater\s+damage\b/i,  // 1 — backward
      /\b(?:hidden|undisclosed)\s+defect\b/i,                                                   // 2 — unchanged, specific
      /\bafter\s+closing\b/i,                                                                    // 3 — unchanged, specific
      // Stage 9: "wasn't disclosed" anchored to property context. Avoids false positives
      // in medical, employment, or landlord-tenant "won't disclose" phrasing.
      /\b(?:property|home|house|condo|purchase|closing|seller|bought|purchased)\b.{0,80}\b(?:wasn[''']?t|was\s+not|never)\s+disclosed\b/i,  // 4 — anchored
      /\blatent\s+defect\b/i,                                                                    // 5 — unchanged, specific legal term
    ],
    baseConfidence: 0.85,
  },
];

/** Time expressions attached to an event. Order matters: more specific first. */
const TIME_PATTERNS: Array<{ pattern: RegExp; type: "trigger" | "duration" }> = [
  // Duration patterns first (they're more specific about span)
  { pattern: /\bfor\s+the\s+past\s+\d+\s+(?:days?|weeks?|months?|years?)\b/i, type: "duration" },
  { pattern: /\bfor\s+the\s+past\s+(?:year|month|week|day)\b/i, type: "duration" },
  { pattern: /\bfor\s+\d+\s+(?:days?|weeks?|months?|years?)\b/i, type: "duration" },
  { pattern: /\bover\s+the\s+(?:past|last)\s+\d+\s+(?:days?|weeks?|months?|years?)\b/i, type: "duration" },

  // Trigger patterns (resolve WHEN)
  { pattern: /\b\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b/i, type: "trigger" },
  { pattern: /\b(?:yesterday|today|last\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i, type: "trigger" },
  { pattern: /\bin\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?\b/i, type: "trigger" },
  { pattern: /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i, type: "trigger" },
  { pattern: /\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, type: "trigger" },
  { pattern: /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i, type: "trigger" },
];

/**
 * Find the time expression nearest to (and most plausibly associated with) a match.
 * Strategy: search within a window (±80 chars) around the event match; prefer ones
 * that follow the event verb. If nothing in window, return null — do NOT reach
 * across the whole message, because that creates cross-event time bleed.
 */
function findTimeNear(message: string, matchStart: number, matchEnd: number): { time: string; type: "trigger" | "duration" } | null {
  // Hard cap at ±80 chars, then tighten to the current clause by stopping at
  // clause-breaking conjunctions. Prevents time expressions from a neighbouring
  // event (e.g. "...but I was deported 2 years ago") bleeding into this one.
  let windowStart = Math.max(0, matchStart - 80);
  let windowEnd = Math.min(message.length, matchEnd + 80);

  const CLAUSE_BREAKS = /\s+(?:but|however|although|though|while|whereas)\s+|[.;]/gi;

  // Tighten backward: find last clause break before matchStart, clip window after it.
  const before = message.slice(windowStart, matchStart);
  let lastBreakEnd = -1;
  let m: RegExpExecArray | null;
  const beforeRe = new RegExp(CLAUSE_BREAKS.source, "gi");
  while ((m = beforeRe.exec(before)) !== null) {
    lastBreakEnd = m.index + m[0].length;
  }
  if (lastBreakEnd >= 0) windowStart = windowStart + lastBreakEnd;

  // Tighten forward: find first clause break after matchEnd, clip window before it.
  const after = message.slice(matchEnd, windowEnd);
  const afterRe = new RegExp(CLAUSE_BREAKS.source, "gi");
  const afterMatch = afterRe.exec(after);
  if (afterMatch) windowEnd = matchEnd + afterMatch.index;

  const window = message.slice(windowStart, windowEnd);

  for (const { pattern, type } of TIME_PATTERNS) {
    const m = window.match(pattern);
    if (m) {
      return { time: m[0], type };
    }
  }
  return null;
}

/**
 * Negation check. If an event match is preceded (within ~15 chars) by a
 * negator, we discard it. Detector regexes already block immediate negation
 * like "was not fired" (because they require "was fired" adjacent), but this
 * catches outer-scope negation like "I never got fired" or "I was not in a
 * car accident".
 */
const NEGATORS = /\b(?:not|never|no|didn[''']?t|wasn[''']?t|weren[''']?t|isn[''']?t|haven[''']?t|hadn[''']?t|won[''']?t|don[''']?t|doesn[''']?t)\b/i;

function isNegated(message: string, matchStart: number): boolean {
  const windowStart = Math.max(0, matchStart - 20);
  const lookback = message.slice(windowStart, matchStart);
  return NEGATORS.test(lookback);
}

/** Promote a detector pattern to global so matchAll works. */
function toGlobal(pattern: RegExp): RegExp {
  return pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, pattern.flags + "g");
}

/**
 * Extract all legally-relevant events from a client's free-text message.
 * Pure function. Detection-only. No scoring, no selection.
 *
 * Contract:
 *   - Multiple instances of the same event type ARE emitted separately
 *     (e.g. "fired last year and fired again last week" → 2 termination events).
 *   - Duplicate matches (same type + same source_text + same position) are deduped.
 *   - Negated matches are dropped.
 */
export function extractEvents(message: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  if (!message || message.trim().length === 0) return events;

  // Dedupe key: type + start + source_text. Prevents two patterns on the same
  // detector from emitting the same phrase twice, and prevents cross-pattern
  // overlap on identical spans.
  const seen = new Set<string>();

  for (const detector of DETECTORS) {
    for (let pi = 0; pi < detector.patterns.length; pi++) {
      const pattern = detector.patterns[pi];
      // Per-pattern confidence override. Falls back to detector baseConfidence
      // when patternWeights is absent or has no entry for this index.
      const patternBase = detector.patternWeights?.[pi] ?? detector.baseConfidence;

      const iter = message.matchAll(toGlobal(pattern));
      for (const match of iter) {
        if (match.index === undefined) continue;

        const source_text = match[0];
        const matchStart = match.index;
        const matchEnd = matchStart + source_text.length;

        if (isNegated(message, matchStart)) continue;

        const dedupeKey = `${detector.type}|${matchStart}|${source_text.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const timeInfo = findTimeNear(message, matchStart, matchEnd);

        const known: string[] = [];
        if (detector.attributeExtractors) {
          for (const extractor of detector.attributeExtractors) {
            if (extractor.pattern.test(message)) {
              known.push(extractor.label);
            }
          }
        }

        const confidence = Math.min(
          1,
          patternBase + (timeInfo ? 0.05 : 0) + (known.length > 0 ? 0.05 : 0),
        );

        events.push({
          type: detector.type,
          source_text,
          time: timeInfo?.time ?? null,
          time_type: timeInfo?.type ?? null,
          time_resolved: timeInfo?.type === "trigger",
          attributes: { known },
          confidence,
          position: matchStart,
        });
      }
    }
  }

  return events;
}
