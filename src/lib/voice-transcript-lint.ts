/**
 * Deterministic post-call linter for Voice AI transcripts.
 *
 * WHY THIS EXISTS
 *
 * The voice agent's behaviour is governed by a ~7k-token system prompt with
 * numbered hard rules. Empirically the hard rules are followed most of the
 * time and the softer discovery guidance is not: the 2026-07-28 DRG call had
 * three of four discovery turns asking two questions at once, one of which
 * lost the readiness answer entirely and scored the lead a full axis short.
 * That class of defect had been "fixed" in the prompt several times and kept
 * coming back.
 *
 * Prompt edits lower the rate. They do not drive it to zero, because the
 * model is the thing being asked to comply. So instead of trusting
 * compliance, we measure it: every call is linted here, on our side, with
 * plain deterministic string logic and no model in the loop. A regression
 * announces itself on the first bad call instead of surviving until someone
 * happens to place a test call and notice.
 *
 * DESIGN CONSTRAINTS
 *
 *   1. Pure. No I/O, no network, no Supabase. Trivially unit-testable and
 *      safe to call inside a request path.
 *   2. High precision over high recall. A noisy linter gets ignored, which
 *      is the exact failure mode we are trying to escape. Every check below
 *      is written to fire on the real defect and stay quiet otherwise.
 *      Caller barge-in, for instance, is normal in voice and is NOT flagged
 *      on its own; only a question visibly split across the interruption is.
 *   3. No caller PII in findings. Excerpts are taken from agent turns.
 *      The one caller-side check quotes only the short pushback phrase that
 *      matched, never surrounding content.
 *
 * The findings are advisory. This module never blocks a lead from being
 * persisted; a flawed call still produces a lead, it just produces a lead
 * with flags attached.
 */

/** Transcript speakers as they appear in the GHL Voice AI transcript format. */
export type VoiceTurnSpeaker = 'bot' | 'human';

export interface VoiceTurn {
  speaker: VoiceTurnSpeaker;
  text: string;
  /** Zero-based index across all turns, both speakers. */
  index: number;
}

export type VoiceLintSeverity = 'high' | 'medium' | 'low';

export type VoiceLintCode =
  | 'compound_question'
  | 'split_question'
  | 'caller_pushback'
  | 'readiness_unanswered'
  | 'missing_caller_name'
  | 'missing_callback_number'
  | 'double_close';

export interface VoiceLintFinding {
  code: VoiceLintCode;
  severity: VoiceLintSeverity;
  /** Human-readable statement of what is wrong, safe to put in an email. */
  detail: string;
  /** Turn index the finding anchors to, when it comes from the transcript. */
  turnIndex?: number;
  /** Short quote for context. Agent speech, or a matched pushback phrase. */
  excerpt?: string;
}

export interface VoiceLintReport {
  findings: VoiceLintFinding[];
  counts: Record<VoiceLintSeverity, number>;
  turnCount: { bot: number; human: number };
  /** True when nothing at all was flagged. The number we want to stay at 1. */
  clean: boolean;
}

export interface VoiceLintInput {
  /**
   * Raw transcript in the GHL Voice AI shape, i.e. newline-separated
   * `bot:...` / `human:...` lines. Empty or missing is tolerated: the
   * transcript-derived checks are simply skipped.
   */
  transcript?: string | null;
  /**
   * From the scoring pass. `false` means the readiness axis went uncaptured,
   * which costs the lead a scoring axis and can suppress its band.
   */
  readinessAnswered?: boolean | null;
  /** Resolved caller name, post-fallback. Blank means capture failed. */
  callerName?: string | null;
  /** Resolved caller phone, post-fallback. Blank means no callback path. */
  callerPhone?: string | null;
}

const MAX_EXCERPT = 140;

/**
 * Names GHL substitutes when a contact has no real name, plus the generic
 * placeholders seen in the field. Treated as "no name captured".
 */
const PLACEHOLDER_NAME_RE =
  /^(?:guest\s*visitor\s*\d*|unknown|unnamed|null|undefined|n\/?a|\+?\d[\d\s()\-.]*)$/i;

/**
 * Caller phrases that indicate the agent asked for something the caller had
 * already volunteered. Deliberately narrow: bare "I said" is excluded
 * because it appears in ordinary speech, so every pattern requires an
 * explicit already/just/as-I marker.
 */
const PUSHBACK_PATTERNS: readonly RegExp[] = [
  /\bI just told you\b/i,
  /\bI already told you\b/i,
  /\bI just said\b/i,
  /\bI already said\b/i,
  /\b(?:as|like) I (?:said|mentioned|told you)\b/i,
  /\bI (?:already |just )?mentioned (?:that|this)\b/i,
];

/**
 * The approved closing lines all share this stem (sections 3A.5, 3B.5,
 * 3C.6). H7 says the close is said exactly once and ends the call, so two
 * matching turns is a hard-rule violation.
 */
const CLOSING_RE = /\bpass (?:this|it|your message|these)\s+along\b/i;

/** Terminal punctuation a completed spoken turn should end on. */
const TERMINAL_RE = /[.?!…]["')\]]?$/;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_EXCERPT ? flat : `${flat.slice(0, MAX_EXCERPT - 1)}…`;
}

/**
 * Excerpt for a severed question. The informative part is the seam, so this
 * keeps the END of the interrupted turn and the START of the resumption.
 * Truncating from the front instead would cut off the resumption and make
 * the finding unreadable, which defeats the point of reporting it.
 */
function excerptSeam(before: string, after: string): string {
  const b = before.replace(/\s+/g, ' ').trim();
  const a = after.replace(/\s+/g, ' ').trim();
  const half = Math.floor((MAX_EXCERPT - 3) / 2);
  const head = b.length <= half ? b : `…${b.slice(b.length - (half - 1))}`;
  const tail = a.length <= half ? a : `${a.slice(0, half - 1)}…`;
  return `${head} → ${tail}`;
}

/**
 * Parses the `speaker:text` transcript format into turns.
 *
 * Continuation lines (ones that do not start with a known speaker prefix)
 * are appended to the current turn, so a multi-line utterance stays one
 * turn rather than fragmenting into phantom turns.
 */
export function parseVoiceTranscript(transcript: string): VoiceTurn[] {
  const turns: VoiceTurn[] = [];
  const lines = transcript.split(/\r?\n/);

  for (const line of lines) {
    const match = /^\s*(bot|human|assistant|user)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const rawSpeaker = match[1].toLowerCase();
      const speaker: VoiceTurnSpeaker =
        rawSpeaker === 'bot' || rawSpeaker === 'assistant' ? 'bot' : 'human';
      turns.push({ speaker, text: match[2].trim(), index: turns.length });
      continue;
    }
    const trailing = line.trim();
    if (trailing && turns.length > 0) {
      const last = turns[turns.length - 1];
      last.text = `${last.text} ${trailing}`.trim();
    }
  }

  return turns.filter((t) => t.text.length > 0);
}

/** Counts sentence-ending question marks in a turn. */
function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/**
 * Runs every check and returns a report.
 *
 * Severity rationale:
 *   high   - directly costs captured data or breaks a numbered hard rule
 *   medium - degrades the call but the data usually survives
 *   low    - hygiene
 */
export function lintVoiceTranscript(input: VoiceLintInput): VoiceLintReport {
  const findings: VoiceLintFinding[] = [];
  const transcript = (input.transcript ?? '').trim();
  const turns = transcript ? parseVoiceTranscript(transcript) : [];
  const botTurns = turns.filter((t) => t.speaker === 'bot');

  // ── 1. Two questions in one turn ────────────────────────────────────────
  // The core defect. The caller answers one and the other is silently lost.
  for (const turn of botTurns) {
    if (questionMarkCount(turn.text) >= 2) {
      findings.push({
        code: 'compound_question',
        severity: 'high',
        detail:
          'Agent asked more than one question in a single turn. The caller typically answers only one, and the other goes uncaptured.',
        turnIndex: turn.index,
        excerpt: truncate(turn.text),
      });
    }
  }

  // ── 2. A question split across a caller interruption ────────────────────
  // Barge-in alone is normal and not flagged. This fires only on the
  // signature of a genuinely severed sentence: an agent turn that stops
  // without terminal punctuation, whose next agent turn resumes in
  // lowercase, i.e. mid-sentence.
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.speaker !== 'bot') continue;
    if (TERMINAL_RE.test(turn.text)) continue;

    const nextBot = turns.slice(i + 1).find((t) => t.speaker === 'bot');
    if (!nextBot) continue;
    if (!/^[a-z]/.test(nextBot.text)) continue;

    findings.push({
      code: 'split_question',
      severity: 'medium',
      detail:
        'An agent question was cut in half by the caller and resumed afterwards, so the caller answered only the first fragment.',
      turnIndex: turn.index,
      excerpt: excerptSeam(turn.text, nextBot.text),
    });
  }

  // ── 3. Caller says they already answered ────────────────────────────────
  // The clearest possible signal, because the caller is the one complaining.
  for (const turn of turns) {
    if (turn.speaker !== 'human') continue;
    for (const pattern of PUSHBACK_PATTERNS) {
      const hit = pattern.exec(turn.text);
      if (hit) {
        findings.push({
          code: 'caller_pushback',
          severity: 'high',
          detail:
            'Caller indicated the agent asked for something they had already said. Discovery is re-asking instead of reading the opening description.',
          turnIndex: turn.index,
          excerpt: truncate(hit[0]),
        });
        break;
      }
    }
  }

  // ── 4. Closing line said more than once (H7) ────────────────────────────
  const closingTurns = botTurns.filter((t) => CLOSING_RE.test(t.text));
  if (closingTurns.length > 1) {
    findings.push({
      code: 'double_close',
      severity: 'medium',
      detail: `Approved closing line was said ${closingTurns.length} times. Hard rule H7 requires exactly once, after which the agent produces no further output.`,
      turnIndex: closingTurns[closingTurns.length - 1].index,
      excerpt: truncate(closingTurns[closingTurns.length - 1].text),
    });
  }

  // ── 5. Scoring and capture gaps, from resolved fields ───────────────────
  if (input.readinessAnswered === false) {
    findings.push({
      code: 'readiness_unanswered',
      severity: 'high',
      detail:
        'Readiness was never answered, so the readiness axis scored zero and may have suppressed the band.',
    });
  }

  const name = (input.callerName ?? '').trim();
  if (!name || PLACEHOLDER_NAME_RE.test(name)) {
    findings.push({
      code: 'missing_caller_name',
      severity: 'high',
      detail:
        'No caller name was captured. The agent asks for it, so this usually means there is no write-back action storing the answer.',
    });
  }

  const phone = (input.callerPhone ?? '').replace(/\D/g, '');
  if (phone.length < 10) {
    findings.push({
      code: 'missing_callback_number',
      severity: 'high',
      detail: 'No usable callback number was captured, so the lead may be unreachable.',
    });
  }

  const counts: Record<VoiceLintSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return {
    findings,
    counts,
    turnCount: { bot: botTurns.length, human: turns.length - botTurns.length },
    clean: findings.length === 0,
  };
}

/**
 * One-line summary for logs and the operator notification email.
 * Returns null when the call is clean, so callers can skip the section.
 */
export function summariseVoiceLint(report: VoiceLintReport): string | null {
  if (report.clean) return null;
  const order: VoiceLintCode[] = [
    'caller_pushback',
    'compound_question',
    'readiness_unanswered',
    'missing_caller_name',
    'missing_callback_number',
    'split_question',
    'double_close',
  ];
  const tally = new Map<VoiceLintCode, number>();
  for (const f of report.findings) tally.set(f.code, (tally.get(f.code) ?? 0) + 1);

  const parts = order
    .filter((code) => tally.has(code))
    .map((code) => {
      const n = tally.get(code) as number;
      return n > 1 ? `${code} x${n}` : code;
    });

  return `${report.counts.high} high, ${report.counts.medium} medium: ${parts.join(', ')}`;
}
