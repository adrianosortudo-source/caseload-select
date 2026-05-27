/**
 * Voice-channel transcript repair pass.
 *
 * Lives OUTSIDE `src/lib/screen-engine/` so the engine remains
 * byte-for-byte mirrored with the sandbox (DR-033). This adapter is
 * voice-channel-only — web and Meta intakes don't have ASR noise and
 * don't carry assistant/human dialogue interleaving.
 *
 * Field-detected 2026-05-27, Damaris's test call to DRG Voice AI
 * (lead L-2026-05-27-UT5). Caller said "I'm planning a will" and
 * "estate planning"; the GHL Voice AI agent correctly interpreted
 * both ("Got it, you're planning a will") and Damaris confirmed
 * with "Yes". But the transcript captured the ASR errors literally:
 *
 *   human: I am looking for help with state planning.
 *   human: I'm planning a bill.
 *   bot:   Got it, you're planning a will. Do you own property...
 *   human: Yes.
 *
 * Our engine strips bot lines before classification (task #48 —
 * prevents the opener "we help with corporate, real estate, wills
 * and estates, employment" from polluting every call). The classifier
 * then only sees the human side: "state planning" + "planning a bill"
 * + "Yes" to "do you own property" → matched unpaid_invoice. The
 * lawyer brief came out as a payment-collection matter when the
 * caller was actually doing estate planning.
 *
 * Two repair operations:
 *
 *   1. ASR fixes (Codex pushback 2026-05-27): a small map of known
 *      speech-to-text confusions specific to legal-intake vocabulary.
 *      Tightly scoped so legitimate uses of "bill" and "state" pass
 *      through unchanged.
 *
 *   2. Confirmation preservation: when an assistant turn contains a
 *      canonical matter-area phrase + a confirmation question, and
 *      the very next human turn is affirmative, inject a neutral
 *      synthetic human line of the form:
 *
 *        Caller confirmed they are looking for help with X.
 *
 *      This keeps task #48's protection (the opener still gets
 *      stripped) while preserving the one assistant line that actually
 *      matters: the canonical matter-area readback the operator
 *      prompt instructs the bot to do (see voice-agent-prompt-template
 *      step 4 / DRG_Voice_Agent_Configuration_v2 step 4).
 *
 * Returns the normalized transcript plus an audit trail of every
 * change made so the lawyer brief can show provenance.
 */

// ─── ASR fixes ──────────────────────────────────────────────────────────

/**
 * Known speech-to-text confusions. Each entry is a regex + replacement
 * pair. Patterns are case-insensitive and tightly anchored to legal-
 * intake context to avoid false positives:
 *
 *   - `state planning` only when adjacent to "planning" (not e.g. "state
 *     filing", "state law").
 *   - `planning a bill` only when "bill" is clearly the object of
 *     "planning" or possessive ("my bill", "this bill" after planning).
 *   - `power of eternity` is always a misrecognition of "power of
 *     attorney" — there's no legal-intake context where "eternity" is
 *     correct.
 *
 * Each entry runs once globally per transcript. Adding a new fix means
 * (a) the operator has heard the same ASR error twice in the wild and
 * (b) a unit test below locks it in with a real example transcript.
 */
interface AsrFix {
  /** Regex applied (case-insensitive) to the transcript. */
  pattern: RegExp;
  /** Replacement string. May reference capture groups. */
  replacement: string;
  /** Description used in the audit trail. */
  label: string;
}

const ASR_FIXES: readonly AsrFix[] = [
  // "estate planning" → "state planning" is the most common ASR slip
  // for the wills/estates matter. We catch BOTH directions: bare
  // "state planning" and "state plan/planning my will".
  {
    pattern: /\bstate planning\b/gi,
    replacement: "estate planning",
    label: "ASR: state planning → estate planning",
  },
  // "I want to plan my state" / "planning my state" — same family.
  {
    pattern: /\b(plan|planning|planned) (?:my|the|a) state\b/gi,
    replacement: "$1 my estate",
    label: "ASR: plan(ning) my state → plan(ning) my estate",
  },
  // "planning a bill" / "planning my bill" — when "bill" is the object
  // of "planning", it's almost certainly "will". Scoped to adjacent
  // pairing so "planning to pay a bill" doesn't trip.
  {
    pattern: /\bplanning (a|my|the) bill\b/gi,
    replacement: "planning $1 will",
    label: "ASR: planning a/my/the bill → planning a/my/the will",
  },
  // Same family: "writing a bill" / "drafting a bill" in the planning
  // context. Drafting a bill is a legislative term, not a legal-intake
  // term — for our consumers (Ontario solo / 2-lawyer firms) this is
  // always a will.
  {
    pattern: /\b(writing|drafting|drawing up) (a|my|the) bill\b/gi,
    replacement: "$1 $2 will",
    label: "ASR: writing/drafting a bill → writing/drafting a will",
  },
  // "power of eternity" — only used in misrecognition of "power of
  // attorney". No false-positive risk.
  {
    pattern: /\bpower of eternity\b/gi,
    replacement: "power of attorney",
    label: "ASR: power of eternity → power of attorney",
  },
  // "wrongful determination" / "wrongful determination" → "wrongful
  // termination". Less common but seen on Call 7 transcripts.
  {
    pattern: /\bwrongful determination\b/gi,
    replacement: "wrongful termination",
    label: "ASR: wrongful determination → wrongful termination",
  },
];

// ─── Confirmation preservation ──────────────────────────────────────────

/**
 * Canonical matter-area phrases the bot may use in a readback. When
 * the bot's question contains one of these (case-insensitively) AND
 * the next human turn is affirmative, we inject a neutral synthetic
 * human line containing the canonical phrase. The engine's classifier
 * then sees clean canonical text from the human side, even though
 * what the human actually said was just "Yes".
 *
 * The canonical strings here are deliberately the same phrases the
 * voice-agent-prompt-template instructs the bot to use in step 4:
 *
 *   "will and estate planning"
 *   "wrongful dismissal"
 *   "shareholder dispute"
 *   "residential purchase"
 *   ... etc.
 *
 * Two-direction match: we look for the canonical phrase IN the bot's
 * line, and inject the same phrase into the synthetic human line.
 * Adding a new matter area means adding it here AND in the prompt
 * template's example list.
 */
const CANONICAL_MATTER_AREAS: readonly string[] = [
  // Estates
  "will and estate planning",
  "estate planning",
  "wills and estates",
  "power of attorney",
  "probate",
  "estate dispute",
  // Employment
  "wrongful dismissal",
  "wrongful termination",
  "severance review",
  "workplace harassment",
  "wage recovery",
  "employment contract review",
  // Corporate
  "shareholder dispute",
  "business partner dispute",
  "unpaid invoice",
  "contract dispute",
  "vendor dispute",
  "supplier dispute",
  "business setup",
  // Real estate
  "residential purchase",
  "residential sale",
  "commercial real estate",
  "real estate litigation",
  "landlord and tenant",
  "construction lien",
  "pre-construction condo",
  "mortgage dispute",
];

/**
 * Regex matching common confirmation-question shapes the bot uses at
 * the end of a readback turn. Examples:
 *
 *   "...is that correct?"
 *   "...is that right?"
 *   "...am I right?"
 *   "...correct?"
 *   "...right?"
 *
 * Required so we don't inject a confirmation for arbitrary bot lines
 * that happen to mention "estate planning" — we want the readback
 * shape specifically.
 */
const CONFIRMATION_QUESTION_RE = /\b(is that (right|correct)|am i (right|correct)|right\??|correct\??)\s*\??\s*$/i;

/**
 * Patterns indicating the human's next turn is an affirmative
 * confirmation. Anchored to the start of the line so a mid-line
 * "yes" in a longer sentence doesn't qualify (the bot's readback
 * asks for a clean yes/no, the canonical response shape is short).
 */
const AFFIRMATIVE_RE = /^(yes|yeah|yep|yup|right|correct|that(?:'|’)?s (?:right|correct)|exactly|uh ?huh|mm ?hmm|sure|that(?:'|’)?s it)\b/i;

/**
 * Correction markers that disqualify an otherwise-affirmative line.
 * Codex pushback 2026-05-27: "Yes, but actually probate" starts with
 * "yes" but the caller is correcting the bot's understanding — we
 * must NOT inject the prior readback's matter phrase as a
 * confirmation. Same for "Yes, no — it's an estate dispute" or
 * "Yes, but instead a will". The trailing clause carries the actual
 * answer.
 *
 * When the affirmative line contains any of these markers, we skip
 * the confirmation injection. The next bot turn (which the operator
 * prompt instructs to listen + readback the correction) gets its
 * own readback + injection chance.
 */
const CORRECTION_MARKER_RE = /\b(but|actually|not|instead|nope|no|except|however|wait|rather)\b/i;

// ─── Line parsing ───────────────────────────────────────────────────────

/**
 * Identifies whether a transcript line is a bot/assistant turn or a
 * human turn. The DRG GHL Voice AI agent writes transcripts in the
 * form "bot:..." / "human:..." (with case variants). Other prefixes
 * we've seen in the wild: "assistant:", "agent:", "user:", "caller:".
 *
 * Lines that don't match either side are treated as continuation of
 * the previous turn (multi-line response).
 */
type TurnSide = "bot" | "human" | "unknown";

const BOT_PREFIX_RE = /^\s*(bot|assistant|agent|ai)\s*:\s*/i;
const HUMAN_PREFIX_RE = /^\s*(human|user|caller)\s*:\s*/i;

function classifyLine(line: string): { side: TurnSide; body: string } {
  if (BOT_PREFIX_RE.test(line)) {
    return { side: "bot", body: line.replace(BOT_PREFIX_RE, "") };
  }
  if (HUMAN_PREFIX_RE.test(line)) {
    return { side: "human", body: line.replace(HUMAN_PREFIX_RE, "") };
  }
  return { side: "unknown", body: line };
}

/** Find the first canonical matter-area phrase that appears in a bot line. */
function detectMatterPhrase(body: string): string | null {
  const lower = body.toLowerCase();
  // Longest match wins so "will and estate planning" beats "estate planning".
  let best: string | null = null;
  for (const phrase of CANONICAL_MATTER_AREAS) {
    if (lower.includes(phrase) && (!best || phrase.length > best.length)) {
      best = phrase;
    }
  }
  return best;
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface NormalizationChange {
  kind: "asr_fix" | "confirmation_injection";
  /** What was matched / where the change applies. */
  detail: string;
}

export interface NormalizationResult {
  /** The transcript after both repair passes. Always a string. */
  normalized: string;
  /** Audit trail for the lawyer brief / debug logs. Empty when no changes were made. */
  changes: NormalizationChange[];
}

/**
 * Apply ASR fixes + confirmation preservation to a voice transcript.
 * Pure function. Order:
 *   1. ASR fixes (string-level, simple regex substitution).
 *   2. Confirmation preservation (line-aware, may inject synthetic lines).
 *
 * The ASR pass runs first so the canonical-phrase detection in step 2
 * sees the corrected text (e.g. "state planning" is fixed to "estate
 * planning" before the canonical match runs).
 */
export function normalizeVoiceTranscript(transcript: string): NormalizationResult {
  if (!transcript || typeof transcript !== "string") {
    return { normalized: transcript ?? "", changes: [] };
  }

  const changes: NormalizationChange[] = [];

  // ── Step 1: ASR fixes ─────────────────────────────────────────────────
  let current = transcript;
  for (const fix of ASR_FIXES) {
    const before = current;
    current = current.replace(fix.pattern, fix.replacement);
    if (current !== before) {
      changes.push({ kind: "asr_fix", detail: fix.label });
    }
  }

  // ── Step 2: Confirmation preservation ────────────────────────────────
  const lines = current.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const classified = classifyLine(line);
    if (classified.side !== "bot") continue;
    // Bot line — does it carry a canonical matter phrase + confirmation
    // question shape?
    const phrase = detectMatterPhrase(classified.body);
    if (!phrase) continue;
    if (!CONFIRMATION_QUESTION_RE.test(classified.body.trim())) continue;

    // Find the next non-blank line. If it's a human affirmative,
    // inject a synthetic confirmation line right after it.
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") {
      out.push(lines[j]);
      j++;
    }
    if (j >= lines.length) continue;
    const nextClassified = classifyLine(lines[j]);
    if (nextClassified.side !== "human") continue;
    const nextBody = nextClassified.body.trim();
    if (!AFFIRMATIVE_RE.test(nextBody)) continue;
    // Codex pushback 2026-05-27: "Yes, but actually probate" starts
    // affirmative but the caller is correcting the bot. Skip the
    // injection so the prior readback's matter phrase doesn't get
    // promoted on what is actually a No-with-correction.
    if (CORRECTION_MARKER_RE.test(nextBody)) continue;

    // Push the human affirmative through unchanged, then inject the
    // synthetic confirmation line.
    out.push(lines[j]);
    out.push(`human: Caller confirmed they are looking for help with ${phrase}.`);
    changes.push({
      kind: "confirmation_injection",
      detail: `bot readback + human affirmative → injected confirmation for "${phrase}"`,
    });
    // Advance past the human turn we just consumed.
    i = j;
  }

  return {
    normalized: out.join("\n"),
    changes,
  };
}
