/**
 * Readback / spelling confirmation detection (#137 phase 2).
 *
 * The honest-provenance work needs to know, for a captured contact value,
 * whether the transcript shows the caller actually CONFIRMING it (not just
 * the value appearing once). Two confirmation signals, mapped to the locked
 * FactSource taxonomy (see screen-engine/types.ts):
 *
 *   - bot reads the value back + caller affirms  -> confirmed_after_readback
 *       (FactSource rank 5: confirmed_by_caller_after_readback)
 *   - caller spells the value out letter-by-letter -> spelled_by_caller
 *       (FactSource rank 4: spelled_by_caller)
 *   - neither                                      -> none
 *
 * This module is the interpretation-heavy CORE. It is intentionally pure
 * and standalone (no I/O, no engine state) so it can be wired into the
 * provenance pipeline in whichever way is chosen (extend SlotMetaSource,
 * carry a confirmed flag on slot_meta, or promote in the report layer).
 * Each wiring option consumes this same detector.
 *
 * NOT in src/lib/screen-engine/ on purpose: keeping it outside the
 * sandbox-mirrored engine dir avoids DR-033 coupling. App code may import
 * engine code, but this stays dependency-free so the import graph never
 * forces the sandbox to carry it.
 *
 * Pattern knowledge mirrors the bot-confirmation + affirmative patterns
 * already used by screen-engine/extractor.ts (AFFIRMATIVE_RE,
 * BOT_NAME_CONFIRMATION_PATTERNS, the correction-marker guards). It is
 * re-stated here rather than imported to keep this file standalone; if
 * the extractor's patterns change materially, mirror the change here and
 * the tests will pin the behaviour.
 */

export type ReadbackKind =
  | 'confirmed_after_readback'
  | 'spelled_by_caller'
  | 'none';

export interface ReadbackResult {
  kind: ReadbackKind;
  /**
   * The bot/human turn text that produced the signal, for audit/debug.
   * Empty when kind === 'none'.
   */
  evidence: string;
}

// Bot lines that constitute a readback CUE: the bot is asking the caller
// to confirm a value it just stated. Mirrors the canonical readback shapes
// in the v3.0 voice prompt (PROMPT_RUNTIME.txt STEP 3A.1/3A.2/3A.5).
const READBACK_CUE_RE =
  /(is that correct|is that right|let me (?:make sure|read that back|confirm)|did i get that right|have your name right|have that right)\b/i;

// Caller's next-turn affirmative. Anchored at the start; a stray "yes" deep
// in a long sentence does not qualify (the bot's readback asks for a clean
// yes/no). Kept in sync with extractor.ts AFFIRMATIVE_RE.
const AFFIRMATIVE_RE =
  /^(yes|yeah|yep|yup|right|correct|that(?:(?:'|’)?s| is) (?:right|correct)|exactly|uh ?huh|mm ?hmm|sure|that(?:(?:'|’)?s| is) it|perfect)\b/i;

// Correction markers that DISQUALIFY an otherwise-affirmative line. Codex
// pushback 2026-05-27: "Yes, but actually it's Domingues" starts with "yes"
// but the caller is correcting, not confirming. Kept in sync with
// extractor.ts CORRECTION markers.
const CORRECTION_MARKER_RE =
  /\b(but|actually|no[, ]|instead|wrong|not (?:quite|right)|it(?:'|’)?s actually|change|correction|the last letter|spelled?)\b/i;

/**
 * Split a transcript into ordered { speaker, text } turns.
 *
 * Accepts the GHL voice transcript shape used across the codebase:
 *   "bot: ...\nhuman: ...\nbot: ..."
 * Lines without a recognised speaker prefix attach to the previous turn
 * (multi-line bot utterances). Lines before any prefix are ignored.
 */
interface Turn {
  speaker: 'bot' | 'human';
  text: string;
}

export function parseTranscriptTurns(transcript: string): Turn[] {
  if (!transcript || typeof transcript !== 'string') return [];
  const turns: Turn[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(bot|human|assistant|user|agent|caller)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const role = m[1].toLowerCase();
      const speaker: 'bot' | 'human' =
        role === 'bot' || role === 'assistant' || role === 'agent' ? 'bot' : 'human';
      turns.push({ speaker, text: m[2].trim() });
    } else if (turns.length > 0) {
      // Continuation of the previous turn.
      turns[turns.length - 1].text += ' ' + line;
    }
  }
  return turns;
}

/**
 * Normalise a value for loose containment matching: lowercase, collapse
 * whitespace, strip surrounding punctuation. So "Adriano Dominguez." in a
 * bot line matches the captured value "Adriano Dominguez".
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:"'’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `haystack` contain `needle` as a loose substring (normalised)?
 */
function looseContains(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (!n) return false;
  return h.includes(n);
}

/**
 * Detect whether the caller spelled `value` out letter-by-letter anywhere
 * in their turns. Two spelling shapes:
 *   - separated letters: "D O M I N G U E S" / "D-O-M-I-N-G-U-E-S"
 *   - phonetic: "D as in David, O as in Oscar, ..."
 *
 * We require at least 4 consecutive spelled letters that match the start
 * of `value`'s letters, to avoid false positives on incidental initialisms.
 */
function detectSpelling(humanTurns: Turn[], value: string): string | null {
  const wholeLetters = value.toLowerCase().replace(/[^a-z]/g, '');
  if (wholeLetters.length < 4) return null;

  // Candidate letter-strings the spelling may match: the whole value AND
  // each whitespace-delimited token. A caller commonly spells just the
  // SURNAME ("D O M I N G U E S") while the captured value is the full
  // name ("Adriano Domingues") -- the surname token must match.
  const candidates = new Set<string>([wholeLetters]);
  for (const tok of value.toLowerCase().split(/\s+/)) {
    const letters = tok.replace(/[^a-z]/g, '');
    if (letters.length >= 4) candidates.add(letters);
  }

  const matches = (spelled: string): boolean => {
    if (spelled.length < 4) return false;
    for (const cand of candidates) {
      // Exact, or one is a prefix of the other (partial spelling / value
      // carries extra tokens). Both directions covered.
      if (cand === spelled || cand.startsWith(spelled) || spelled.startsWith(cand)) {
        return true;
      }
    }
    return false;
  };

  for (const turn of humanTurns) {
    const text = turn.text;

    // Phonetic: "D as in David, O as in Oscar"
    const phonetic = [...text.matchAll(/\b([a-z])\s+as in\s+\w+/gi)].map((m) =>
      m[1].toLowerCase(),
    );
    if (phonetic.length >= 4 && matches(phonetic.join(''))) {
      return turn.text;
    }

    // Separated letters: "D O M I N G U E S" or "D-O-M-I-N-G-U-E-S".
    // Find runs of single letters separated by spaces/hyphens.
    const sepRun = /\b([a-z](?:[\s-]+[a-z]){3,})\b/i.exec(text);
    if (sepRun) {
      const spelled = sepRun[1].toLowerCase().replace(/[^a-z]/g, '');
      if (matches(spelled)) return turn.text;
    }
  }
  return null;
}

/**
 * Detect bot-readback + caller-affirmative confirmation of `value`.
 *
 * Walks the turns. For each BOT turn that (a) contains `value` and (b)
 * carries a readback cue ("is that correct?"), checks the NEXT human turn:
 * if it is a clean affirmative with no correction marker, that's a
 * confirmed readback.
 *
 * Returns the confirming bot turn text, or null.
 */
function detectBotReadbackConfirmation(turns: Turn[], value: string): string | null {
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.speaker !== 'bot') continue;
    if (!READBACK_CUE_RE.test(turn.text)) continue;
    if (!looseContains(turn.text, value)) continue;

    // Find the next human turn.
    const next = turns.slice(i + 1).find((t) => t.speaker === 'human');
    if (!next) continue;
    if (!AFFIRMATIVE_RE.test(next.text.trim())) continue;
    // A "yes, but actually..." correction disqualifies the confirmation.
    if (CORRECTION_MARKER_RE.test(next.text)) continue;
    return turn.text;
  }
  return null;
}

/**
 * Top-level: classify how strongly the transcript confirms `value`.
 *
 * Precedence (returns the strongest signal found):
 *   1. confirmed_after_readback  (bot read it back, caller affirmed cleanly)
 *   2. spelled_by_caller         (caller spelled it out)
 *   3. none
 *
 * `value` is the captured contact value (name / email / phone string).
 * For phone numbers, pass the spoken/displayed form; digit-by-digit
 * readback confirmation is detected the same way (the cue + affirmative).
 */
export function detectReadbackConfirmation(
  transcript: string,
  value: string,
): ReadbackResult {
  if (!transcript || !value || !value.trim()) {
    return { kind: 'none', evidence: '' };
  }
  const turns = parseTranscriptTurns(transcript);
  if (turns.length === 0) return { kind: 'none', evidence: '' };

  const readback = detectBotReadbackConfirmation(turns, value);
  if (readback) {
    return { kind: 'confirmed_after_readback', evidence: readback };
  }

  const humanTurns = turns.filter((t) => t.speaker === 'human');
  const spelled = detectSpelling(humanTurns, value);
  if (spelled) {
    return { kind: 'spelled_by_caller', evidence: spelled };
  }

  return { kind: 'none', evidence: '' };
}
