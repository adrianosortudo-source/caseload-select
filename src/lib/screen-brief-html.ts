/**
 * Server-side brief HTML renderer.
 *
 * The sandbox's `brief-render.ts` uses the DOM (`document.createElement`).
 * That doesn't work in Next.js server routes. This renderer produces the
 * same logical sections as plain HTML strings, using the same CSS class
 * names the portal already styles via `brief.css`.
 *
 * Used by `/api/voice-intake` to populate `screened_leads.brief_html`,
 * which the portal renders verbatim. The structure (status strip omitted,
 * brief body sections present) matches what the portal expects from a
 * Screen 2.0 submission.
 *
 * The channel chip is included so the lawyer reads thin voice briefs as
 * channel-shape, not lead-shape (DR-026).
 */

import type { AxisReasoning, Channel, LawyerReport, ResolvedFact } from './screen-engine/types';
import { getI18n } from './screen-engine/i18n/loader';
import { getChannelChipData } from './screen-engine/i18n/display';
import { intakeLanguageLabel } from './intake-language-label';
import { DEFAULT_FIRM_TIMEZONE } from './firm-timezone';

/**
 * Lawyer-facing labels for the 6 locked provenance values (2026-06-02 taxonomy)
 * plus the 3 legacy keys still present in older DB rows.
 *
 * Channel-aware (2026-06-05): voice-shape phrases ("Stated during call",
 * "Inferred from transcript") were previously global defaults. They are
 * categorically wrong for web-widget, Messenger, Instagram, WhatsApp, SMS,
 * and GBP intake — those leads are typed in a form or thread, not spoken on
 * a call. Per operator direction the renderer now picks phrasing based on
 * the inbound channel. Voice keeps its existing language; every other
 * channel gets a channel-specific phrase. Missing channel falls back to web
 * (the product's default channel; voice/Meta intake paths always set it
 * explicitly, so a missing value means the SPA widget didn't include it).
 *
 * Per operator direction: do NOT overclaim. The label "Confirmed by caller"
 * is reserved for the voice readback-detection code path. Non-voice channels
 * degrade 'confirmed_by_caller_after_readback' and 'spelled_by_caller' to
 * the channel-appropriate "Provided in {channel}" phrasing — they are voice-
 * only concepts and should never appear on a non-voice brief, but the
 * renderer is defensive in case engine state drifts.
 */
const CHANNEL_PROVENANCE_PHRASE: Record<
  string,
  { stated: string; inferred: string }
> = {
  voice:     { stated: 'Stated during call',           inferred: 'Inferred from transcript' },
  web:       { stated: 'Provided in web intake',       inferred: 'Inferred from web intake' },
  facebook:  { stated: 'Provided in Messenger thread', inferred: 'Inferred from Messenger thread' },
  instagram: { stated: 'Provided in Instagram DM',     inferred: 'Inferred from Instagram DM' },
  whatsapp:  { stated: 'Provided in WhatsApp thread',  inferred: 'Inferred from WhatsApp thread' },
  sms:       { stated: 'Provided in SMS thread',       inferred: 'Inferred from SMS thread' },
  gbp:       { stated: 'Provided in GBP chat',         inferred: 'Inferred from GBP chat' },
};

const FALLBACK_PROVENANCE_PHRASE = {
  stated: 'Provided in intake',
  inferred: 'Inferred from intake',
};

function provenancePhraseFor(channel: string | null | undefined): {
  stated: string;
  inferred: string;
} {
  const c = (channel ?? 'web').toLowerCase();
  return CHANNEL_PROVENANCE_PHRASE[c] ?? FALLBACK_PROVENANCE_PHRASE;
}

function factSourceLabel(source: string, channel: string | null | undefined): string {
  const phrase = provenancePhraseFor(channel);
  const isVoice = (channel ?? 'web').toLowerCase() === 'voice';
  switch (source) {
    case 'confirmed_by_caller_after_readback':
    case 'confirmed':
      // Voice-only "Confirmed by caller" via readback detector. On any other
      // channel, degrade to the channel-appropriate stated phrase — we never
      // overclaim a readback confirmation outside voice.
      return isVoice ? 'Confirmed by caller' : phrase.stated;
    case 'spelled_by_caller':
      // Voice-only too (caller spells the surname). Degrade off-voice.
      return isVoice ? 'Spelled by caller' : phrase.stated;
    case 'explicit_from_caller':
    case 'stated':
      return phrase.stated;
    case 'system_metadata':
      return 'System metadata';
    case 'inferred_from_transcript':
    case 'inferred':
      return phrase.inferred;
    case 'llm_inferred':
      // 2026-06-07 provenance split: LLM-derived values carry their own
      // label so the lawyer never reads "Provided in web intake" for a
      // fact the lead never typed. We piggyback on the channel-aware
      // inferred phrase for now; once the engine gates LLM inferences
      // out of "answered" state, the brief surface this only as a hint.
      return phrase.inferred;
    case 'unknown':
      return 'Not confirmed';
    default:
      return source;
  }
}

const FACT_SOURCE_CLASS: Record<string, string> = {
  // Locked 2026-06-02 taxonomy
  confirmed_by_caller_after_readback: 'src-confirmed',
  spelled_by_caller: 'src-confirmed',
  explicit_from_caller: 'src-stated',
  system_metadata: 'src-confirmed',
  inferred_from_transcript: 'src-inferred',
  unknown: 'src-unknown',
  // Legacy DB-row backward-compat
  stated: 'src-stated',
  confirmed: 'src-confirmed',
  inferred: 'src-inferred',
};

/**
 * Lawyer-facing text for the NAP block's "field not captured" chip.
 *
 * The previous default ("Follow up on the call") assumed voice. For widget,
 * Meta, SMS, and GBP intakes the follow-up channel may differ, and even when
 * the lawyer plans to call back the lead never had a call. "Confirm on
 * follow-up" is neutral, accurate across all six channels, and never implies
 * a phone call took place.
 */
function napMissingFollowupLabel(_channel: string | null | undefined): string {
  return 'Confirm on follow-up';
}


function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format the lead-arrival timestamp for the brief header.
 *
 * Bug fix 2026-06-02 (#138): the previous implementation called
 * `toLocaleString` with NO `timeZone`, so on Vercel (server runs UTC) a
 * call placed at 4:55 PM Eastern rendered as "8:55 PM" in the lawyer
 * brief and email. Timestamps are stored UTC; we now render on read in
 * the firm's timezone. Default is America/Toronto (the entire current
 * client base), overridable per firm via the `timezone` param threaded
 * from the caller (resolveFirmTimezone).
 */
function formatTime(iso: string, timezone: string = DEFAULT_FIRM_TIMEZONE): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function textBlock(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return `<p class="section-body muted">Not yet established</p>`;
  return `<p class="section-body">${esc(t)}</p>`;
}

function bullets(items: readonly string[], emptyText: string = 'None confirmed'): string {
  if (!items || items.length === 0) {
    return `<p class="section-body muted">${esc(emptyText)}</p>`;
  }
  return `<ul class="bullet-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function feeBlock(text: string): string {
  const t = text ?? '';
  const match = t.match(/\$[\d,]+(?:\s*[–—-]\s*\$[\d,]+\+?)?/);
  if (!match) {
    return `<div class="fee-block"><p class="section-body">${esc(t)}</p></div>`;
  }
  const range = match[0];
  const rest = t.replace(range, '').replace(/^\s*[.,]?\s*/, '').trim();
  let html = `<div class="fee-block"><p class="fee-range">${esc(range)}</p>`;
  if (rest) html += `<p class="fee-supporting">${esc(rest)}</p>`;
  html += `</div>`;
  return html;
}

/**
 * Provenance noise reduction (2026-06-06 cover-layout v2).
 *
 * The previous renderer emitted a source chip on every fact row, which meant
 * the channel-default phrase (e.g. "Provided in web intake") repeated for
 * every row in a typical brief. On a 9-fact brief, the same chip appeared
 * nine times — drowning the actual signal, which is the EXCEPTION
 * provenances (Inferred, Confirmed by caller, System metadata, Not confirmed)
 * that the lawyer needs to flag.
 *
 * `isDefaultProvenance` returns true for the channel-default sources
 * (`stated` / `explicit_from_caller`). The renderer suppresses the chip for
 * those rows and emits chips only for exception provenances. The provenance
 * legend in the facts-counter line restates the channel default so the
 * lawyer can still see where the bulk of the facts came from.
 */
function isDefaultProvenance(source: string): boolean {
  // The chip is suppressed only for default channel-stated provenance.
  // LLM-inferred is NEVER suppressed: the lawyer must see the chip so it
  // is visually distinct from facts the user actually stated. This is
  // the brief-surface half of the 2026-06-07 provenance rule.
  if (source === 'llm_inferred') return false;
  return source === 'stated' || source === 'explicit_from_caller';
}

/**
 * Cluster a fact's label into one of four operational buckets so the
 * Resolved facts section reads as a grouped list instead of a flat one.
 * The buckets are matter / family / timing / contact: the eye finds
 * Family-related info under Family, Timing-related info under Timing, etc.
 *
 * Conservative heuristic: contact labels are the four NAP fields (already
 * surfaced at the top of the brief but kept here for the audit trail);
 * family covers marital / children / executor / relationship slots;
 * timing covers hiring_timeline / deadline / urgency / dates. Everything
 * else falls into the matter bucket. The bucket is presentational only,
 * so a miss-cluster is a UX nit, not a correctness defect.
 */
type FactCluster = 'matter' | 'family' | 'timing' | 'contact';

function categorizeFact(label: string): FactCluster {
  const l = (label ?? '').toLowerCase().trim();
  if (
    l === 'name' ||
    l === 'phone' ||
    l === 'email' ||
    l === 'postal code' ||
    l.includes('caller-id') ||
    l.includes('caller id') ||
    l === 'surname spelling'
  ) {
    return 'contact';
  }
  if (
    l.includes('marital') ||
    l.includes('children') ||
    l.includes('dependant') ||
    l.includes('spouse') ||
    l.includes('relationship') ||
    l.includes('executor') ||
    l.includes('beneficiar') ||
    l.includes('estate trustee')
  ) {
    return 'family';
  }
  if (
    l.includes('timeline') ||
    l.includes('deadline') ||
    l.includes('urgency') ||
    l.includes('date') ||
    l.includes('hiring') ||
    l.includes('closing') ||
    l.includes('how soon') ||
    l.includes('window')
  ) {
    return 'timing';
  }
  return 'matter';
}

const CLUSTER_LABELS: Record<FactCluster, string> = {
  matter: 'Matter',
  family: 'Family',
  timing: 'Timing',
  contact: 'Contact',
};

/**
 * Render the Resolved facts list grouped into matter / family / timing /
 * contact clusters with a small kicker subhead per group. Falls back to
 * the flat rendering when there are fewer than 3 facts (clustering one or
 * two items adds friction without benefit).
 */
function clusteredFacts(facts: ResolvedFact[], channel: string | null | undefined): string {
  if (!facts || facts.length === 0) {
    return `<p class="section-body muted">No confirmed facts yet.</p>`;
  }
  if (facts.length < 3) {
    return factsWithProvenance(facts, channel);
  }
  const buckets: Record<FactCluster, ResolvedFact[]> = {
    matter: [],
    family: [],
    timing: [],
    contact: [],
  };
  for (const f of facts) {
    if (!f || !f.label) continue;
    buckets[categorizeFact(f.label)].push(f);
  }
  const order: FactCluster[] = ['matter', 'family', 'timing', 'contact'];
  const blocks = order
    .filter((k) => buckets[k].length > 0)
    .map(
      (k) => `
        <div class="fact-cluster" data-cluster="${esc(k)}">
          <p class="kicker">${esc(CLUSTER_LABELS[k])}</p>
          ${factsWithProvenance(buckets[k], channel)}
        </div>`,
    )
    .join('');
  return `<div class="fact-clusters">${blocks}</div>`;
}

function factsWithProvenance(facts: ResolvedFact[], channel: string | null | undefined): string {
  if (!facts || facts.length === 0) {
    return `<p class="section-body muted">No confirmed facts yet.</p>`;
  }
  const rows = facts
    .map((f) => {
      const showChip = !isDefaultProvenance(f.source);
      const chip = showChip
        ? `<span class="fact-source ${FACT_SOURCE_CLASS[f.source] ?? ''}">${esc(factSourceLabel(f.source, channel))}</span>`
        : `<span class="fact-source-spacer" aria-hidden="true"></span>`;
      return `
        <li class="fact-row">
          <span class="fact-label">${esc(f.label)}</span>
          <span class="fact-value">${esc(f.value)}</span>
          ${chip}
        </li>`;
    })
    .join('');
  return `<ul class="fact-list">${rows}</ul>`;
}

/**
 * Brand terminal-square mark on canonical headlines (Brand Book 6.18).
 * The mark is the gold inline SVG square, always; we do NOT use the text
 * character U+25AA because that inherits the headline color (typically
 * white on a dark cover) and the brand spec is gold-on-anything.
 *
 * Behaviour: strips a trailing period if present, then appends the SVG.
 * Headlines ending in ? or ! keep their punctuation and skip the square.
 * Idempotent on a previously-appended text-char square (legacy).
 *
 * Returns HTML, not plain text. Callers MUST NOT wrap with esc() because
 * the SVG markup is already safe by construction. The headline text is
 * escaped internally.
 */
const TERMINAL_SQUARE_SVG = '<svg viewBox="0 0 6 6" aria-hidden="true" style="width:0.22em;height:0.22em;margin-left:0.12em;vertical-align:top;display:inline-block;position:relative;top:0.1em;flex-shrink:0;"><rect width="6" height="6" fill="#C4B49A"/></svg>';

function withTerminalSquare(text: string): string {
  let t = (text ?? '').trim();
  if (!t) return '';
  // Strip a previously-appended text-char square (legacy / idempotency).
  if (t.endsWith('▪')) t = t.slice(0, -1).trimEnd();
  if (t.endsWith('?') || t.endsWith('!')) return esc(t);
  if (t.endsWith('.')) t = t.slice(0, -1);
  return esc(t) + TERMINAL_SQUARE_SVG;
}

/**
 * Humanize a snake_case matter type into a title-case display label.
 * "business_setup_advisory" → "Business Setup Advisory". Falls back to
 * "Lawyer brief" for empty / unknown inputs.
 */
function humanizeMatterType(matterType: string | null | undefined): string {
  const m = (matterType ?? '').trim();
  if (!m) return 'Lawyer brief';
  return m
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/**
 * Format the decision-window length at the moment of submission. This is the
 * STATIC value baked into the rendered brief HTML so a non-JS reader still
 * sees a sensible value. The live-timer hydrator (BriefLiveTimers.tsx)
 * replaces the displayed text with the running countdown at view time —
 * the data-deadline-iso + data-submitted-at attributes carry the truth.
 */
function formatWindowAtSubmit(deadlineIso: string, submittedAtIso: string): string {
  try {
    const deadline = new Date(deadlineIso).getTime();
    const submit = new Date(submittedAtIso).getTime();
    const ms = deadline - submit;
    if (!Number.isFinite(ms) || ms <= 0) return 'Window set';
    const totalMin = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours >= 1) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return 'Window set';
  }
}

/**
 * Emit a live-timer placeholder span. The element carries data attributes
 * that `BriefLiveTimers` reads on mount to replace the inner text with the
 * running countdown. Variant controls the CSS treatment (cover band vs
 * sidebar row).
 */
function liveTimerSpan(
  deadlineIso: string | null | undefined,
  submittedAtIso: string,
  variant: 'cover' | 'sidebar' = 'sidebar',
): string {
  if (!deadlineIso) {
    return `<span class="brief-timer-static">Not set</span>`;
  }
  const initial = formatWindowAtSubmit(deadlineIso, submittedAtIso);
  return `<span class="brief-live-timer brief-live-timer-${variant}" data-deadline-iso="${esc(deadlineIso)}" data-submitted-at="${esc(submittedAtIso)}">${esc(initial)}</span>`;
}

/**
 * The navy callout panel inside Call preparation that frames the callback as
 * scope-and-quote, not problem rediscovery. Numbered steps make the structure
 * scannable. Per brand: no em dashes, no banned vocabulary, terminal square
 * on the canonical h4.
 */
function callStructureCallout(): string {
  return `
    <div class="call-structure-callout">
      <p class="callout-eyebrow">Lead call structure</p>
      <h4 class="callout-title">${withTerminalSquare('Use the callback to scope, not to rediscover the problem')}</h4>
      <ol class="callout-steps">
        <li><span class="step-num">1</span><span class="step-body">Confirm names, postal code, and how they found the firm.</span></li>
        <li><span class="step-num">2</span><span class="step-body">Walk through the open questions in order. The brief flags what is still unresolved.</span></li>
        <li><span class="step-num">3</span><span class="step-body">Quote the fee range once the watchpoints are cleared, then confirm next steps before ending the call.</span></li>
      </ol>
    </div>`;
}

/**
 * Channel-default provenance phrase for the facts-counter line. The renderer
 * suppresses per-row chips for default provenances; this is the human-readable
 * restatement so the lawyer still sees where the bulk of facts came from.
 */
function defaultProvenancePhraseFor(channel: string | null | undefined): string {
  return provenancePhraseFor(channel).stated;
}

// ─── NAP block (top-of-brief contact strip) ────────────────────────────────
//
// Renders Name + Phone + Postal code + Email as a prominent four-cell strip
// at the top of every brief. Pulled from resolved_facts_v2 (which carries
// provenance source chips). Missing fields render "Not captured" so the
// gap is visible to the lawyer at a glance.
//
// Why this section exists: the lawyer's first read on a brief is "can I
// call this person back?". Hiding name/phone/postal code 800px down the
// page (in Facts and reasoning) forced an extra scroll to verify. The
// NAP block surfaces that first.
//
// Note: this block COMPLEMENTS the bottom "Resolved facts" section — it
// doesn't replace it. The bottom section still shows the full set of
// extracted facts including matter-specific slots; this top block is the
// contact triad only.
const NAP_FIELD_ORDER: { label: string; key: string }[] = [
  { label: 'Name', key: 'Name' },
  { label: 'Phone', key: 'Phone' },
  { label: 'Postal code', key: 'Postal code' },
  { label: 'Email', key: 'Email' },
];

function napBlock(facts: ResolvedFact[], channel: string | null | undefined): string {
  // Index facts by label for fast lookup
  const byLabel = new Map<string, ResolvedFact>();
  for (const f of facts ?? []) {
    if (f && f.label) byLabel.set(f.label, f);
  }
  const followupLabel = napMissingFollowupLabel(channel);
  const cells = NAP_FIELD_ORDER.map(({ label, key }) => {
    const fact = byLabel.get(key);
    if (fact) {
      return `
        <div class="nap-cell">
          <p class="nap-label">${esc(label)}</p>
          <p class="nap-value">${esc(fact.value)}</p>
          <p class="nap-source ${FACT_SOURCE_CLASS[fact.source] ?? ''}">${esc(factSourceLabel(fact.source, channel))}</p>
        </div>`;
    }
    return `
      <div class="nap-cell nap-cell-missing">
        <p class="nap-label">${esc(label)}</p>
        <p class="nap-value nap-value-missing">Not captured</p>
        <p class="nap-source nap-source-missing">${esc(followupLabel)}</p>
      </div>`;
  }).join('');
  return `
    <section class="brief-group brief-group-nap" data-group="contact">
      <h3 class="brief-group-title">Contact (NAP)</h3>
      <div class="nap-grid">${cells}</div>
    </section>`;
}

// ─── Four-axis breakdown (Why this is Band X) ──────────────────────────────
//
// Renders the four-axis scorer's output (Value · Complexity · Urgency ·
// Readiness) as four cards inside the Decision section, each with a 0-10
// score, a qualitative band (Low / Moderate / High), and a single prose
// sentence explaining what the score means for THIS matter — not how the
// scoring engine computed it.
//
// Rewrite history (2026-06-05): the previous renderer passed the engine's
// raw `reasons` strings through verbatim. Those reasons are generated by
// `band.ts` by joining slot `question_group` names (e.g. "Baseline complexity
// signal from answered standing, standing, standing slots"), which leaks
// internal ontology into the lawyer-facing surface. Per operator direction,
// the rendering layer now translates internal scoring dimensions into
// professional, decision-oriented prose. The engine's raw reasons remain
// available on `report.axis_reasoning.<axis>.reasons` for debug/dev use
// (preserved in `brief_json`) but are not surfaced in the brief HTML.
//
// Also renamed: the v1 renderer presented "Complexity" to the lawyer as
// "Simplicity" with the score flipped (10 - complexity.score) so all four
// axes read "higher = better". That label confused lawyers (who think in
// terms of complexity, not simplicity) and inverted the score they actually
// see in `brief_json`. v2 shows **Complexity** with the raw engine score
// (higher = more complex), and uses the card border colour to signal whether
// the score helps or hurts the matter (low complexity → positive border,
// high complexity → drag border).
//
// Card border colour (kind), unchanged:
//   - positive → navy/gold confidence
//   - pending  → dashed gold, "signal not yet conclusive"
//   - drag     → red-ish for axes that hurt the band
//
// CSS lives in `src/app/portal/[firmId]/triage/[leadId]/brief.css`. The
// classes are unchanged; this renderer just emits new HTML inside them.

type AxisName = 'value' | 'complexity' | 'urgency' | 'readiness';
type AxisBand = 'Low' | 'Moderate' | 'High';
type MatterFamily =
  | 'estates'
  | 'employment'
  | 'real_estate'
  | 'corporate'
  | 'litigation'
  | 'general';

function bandOf(score: number): AxisBand {
  if (score >= 7) return 'High';
  if (score >= 4) return 'Moderate';
  return 'Low';
}

/**
 * Map matter_type / practice_area to a family used for prose selection.
 *
 * Conservative: if neither field is set or recognisable, returns 'general'
 * and the renderer falls back to family-agnostic prose. Never throws.
 */
function matterFamily(
  matterType: string | null | undefined,
  practiceArea: string | null | undefined,
): MatterFamily {
  const m = (matterType ?? '').toLowerCase();
  const p = (practiceArea ?? '').toLowerCase();
  if (
    p === 'estates' ||
    m.startsWith('will_') ||
    m.startsWith('estate_') ||
    m === 'probate' ||
    m === 'power_of_attorney'
  )
    return 'estates';
  if (
    p === 'employment' ||
    m.startsWith('wrongful_') ||
    m.startsWith('severance_') ||
    m.startsWith('harassment_') ||
    m.startsWith('wage_') ||
    m === 'employment_contract_review'
  )
    return 'employment';
  if (
    p === 'real_estate' ||
    m.startsWith('residential_') ||
    m.startsWith('commercial_real') ||
    m.startsWith('real_estate') ||
    m === 'construction_lien' ||
    m === 'mortgage_dispute' ||
    m === 'preconstruction_condo' ||
    m === 'landlord_tenant'
  )
    return 'real_estate';
  if (
    p === 'corporate' ||
    p === 'business' ||
    m.startsWith('corporate_') ||
    m.startsWith('business_') ||
    m.startsWith('shareholder_') ||
    m === 'contract_dispute' ||
    m === 'unpaid_invoice'
  )
    return 'corporate';
  if (p === 'litigation') return 'litigation';
  return 'general';
}

/**
 * Professional prose for a given axis × band × matter family.
 *
 * Goals: explain what the score means for this matter, not how the engine
 * computed it. Keep it concise (one or two sentences). Use plain language
 * a triaging lawyer can scan in three seconds. Never make outcome promises
 * (LSO 4.2-1) and never imply that the score is a recommendation; the
 * lawyer decides.
 */
function axisProse(
  axis: AxisName,
  band: AxisBand,
  family: MatterFamily,
  readinessAnswered: boolean,
): string {
  if (axis === 'value') {
    if (band === 'Low') {
      switch (family) {
        case 'estates':
          return 'Baseline estate-planning engagement. Final scope depends on assets, family structure, and whether other documents are needed.';
        case 'employment':
          return 'Baseline employment matter. Final scope depends on tenure, what was agreed in writing, and what relief is being sought.';
        case 'real_estate':
          return 'Baseline real estate matter. Final scope depends on the property type and the transaction shape.';
        case 'corporate':
          return 'Baseline business or commercial matter. Final scope depends on what services are needed.';
        case 'litigation':
          return 'Baseline litigation file. Final scope depends on the stage of the matter and the relief being sought.';
        default:
          return 'Baseline value signal. Final scope depends on what the callback confirms.';
      }
    }
    if (band === 'Moderate') {
      switch (family) {
        case 'estates':
          return 'Likely a paid estate-planning engagement. Final scope depends on assets, family structure, and whether other documents (powers of attorney, trusts) are needed.';
        case 'employment':
          return 'Likely a real employment matter. Severance review and possible damages may be in scope; tenure, written agreements, and what was offered still to confirm.';
        case 'real_estate':
          return 'Likely a standard transaction or dispute. Scope depends on the property type and timeline.';
        case 'corporate':
          return 'Likely a business advisory or commercial matter. Scope depends on entity choice and what services are needed.';
        case 'litigation':
          return 'Likely a real litigation file. Scope depends on the stage of the matter and the relief being sought.';
        default:
          return 'Moderate value signal. Final scope depends on what the callback confirms.';
      }
    }
    // High
    switch (family) {
      case 'estates':
        return 'Strong estate-planning engagement signal. Likely involves multiple documents and possibly trust planning.';
      case 'employment':
        return 'Strong wrongful dismissal or severance signal. Likely a paid mandate with real exposure.';
      case 'real_estate':
        return 'Strong transaction or contested-matter signal. Likely a meaningful engagement in scope.';
      case 'corporate':
        return 'Strong commercial engagement signal. Likely a meaningful scoped mandate.';
      case 'litigation':
        return 'Strong litigation signal. Likely a paid mandate with real exposure.';
      default:
        return 'Strong value signal. This looks like a meaningful engagement.';
    }
  }

  if (axis === 'complexity') {
    if (band === 'Low') {
      switch (family) {
        case 'estates':
          return 'Current facts suggest a standard will-planning matter rather than a contested or urgent estate issue.';
        case 'employment':
          return 'Current facts suggest a standard severance review rather than a contested or multi-issue matter.';
        case 'real_estate':
          return 'Current facts suggest a standard transaction rather than a contested or multi-issue matter.';
        case 'corporate':
          return 'Current facts suggest a standard advisory matter rather than a contested or multi-party file.';
        case 'litigation':
          return 'Current facts suggest a clean fact pattern rather than a multi-party or jurisdictionally complex file.';
        default:
          return 'Current facts suggest a standard matter rather than a contested or complex one.';
      }
    }
    if (band === 'Moderate') {
      return 'Mixed signals. The matter could stay scoped, or it could expand depending on facts still to be confirmed on the callback.';
    }
    return 'Likely a complex matter. Expect multiple moving parts and risk areas.';
  }

  if (axis === 'urgency') {
    if (band === 'Low')
      return 'No immediate deadline or emergency signal was captured. Standard callback cadence.';
    if (band === 'Moderate')
      return 'Some time-sensitivity was signaled. Worth a same-day callback.';
    return 'Urgent. Deadline, hearing, or emergency signal present. Call back immediately.';
  }

  // readiness
  if (!readinessAnswered) {
    return 'Readiness questions have not been asked yet. Several scope-defining facts still need to be confirmed.';
  }
  if (band === 'Low')
    return 'Limited readiness signal. Several scope-defining facts still need to be confirmed on the callback.';
  if (band === 'Moderate')
    return 'Enough captured for a callback, but several scope-defining facts still need to be confirmed.';
  return 'Strong readiness. The lead has thought through their situation.';
}

/**
 * Card border colour. Preserved from v1 for value / urgency / readiness; for
 * complexity (no longer shown as "simplicity"), low complexity reads as
 * positive (easy file to run) and high complexity reads as drag.
 */
function axisKind(
  axis: AxisName,
  score: number,
  readinessAnswered: boolean,
): 'positive' | 'pending' | 'drag' {
  if (axis === 'complexity') {
    const b = bandOf(score);
    if (b === 'Low') return 'positive';
    if (b === 'Moderate') return 'pending';
    return 'drag';
  }
  if (axis === 'readiness') {
    return readinessAnswered ? 'positive' : 'pending';
  }
  // value, urgency
  return 'positive';
}

function axisCard(
  axis: AxisName,
  name: string,
  score: number,
  band: AxisBand,
  prose: string,
  kind: 'positive' | 'pending' | 'drag',
): string {
  // 2026-06-07 hierarchy pass: score becomes the primary visual element,
  // axis name retreats to a small kicker, band label sits next to it, and
  // the matter-aware prose carries the explanation. The CSS does the heavy
  // lifting; this template just sets the structural anchors.
  return `
    <div class="axis-block axis-block-${esc(kind)}" data-axis="${esc(axis)}">
      <div class="axis-block-head">
        <div class="axis-block-meta">
          <span class="axis-block-name">${esc(name)}</span>
          <span class="axis-block-band-label">${esc(band)}</span>
        </div>
        <span class="axis-block-score">${score}<span class="axis-block-score-denom">/10</span></span>
      </div>
      <p class="axis-block-prose">${esc(prose)}</p>
    </div>`;
}

function axisBreakdown(
  reasoning: AxisReasoning,
  matterType: string | null | undefined,
  practiceArea: string | null | undefined,
): string {
  const family = matterFamily(matterType, practiceArea);
  const cards: string[] = [];

  // Value
  {
    const score = reasoning.value.score;
    const band = bandOf(score);
    cards.push(
      axisCard(
        'value',
        'Value',
        score,
        band,
        axisProse('value', band, family, reasoning.readinessAnswered),
        axisKind('value', score, reasoning.readinessAnswered),
      ),
    );
  }

  // Complexity (renamed from "Simplicity" — show raw score)
  {
    const score = reasoning.complexity.score;
    const band = bandOf(score);
    cards.push(
      axisCard(
        'complexity',
        'Complexity',
        score,
        band,
        axisProse('complexity', band, family, reasoning.readinessAnswered),
        axisKind('complexity', score, reasoning.readinessAnswered),
      ),
    );
  }

  // Urgency
  {
    const score = reasoning.urgency.score;
    const band = bandOf(score);
    cards.push(
      axisCard(
        'urgency',
        'Urgency',
        score,
        band,
        axisProse('urgency', band, family, reasoning.readinessAnswered),
        axisKind('urgency', score, reasoning.readinessAnswered),
      ),
    );
  }

  // Readiness
  {
    const score = reasoning.readiness.score;
    const band = bandOf(score);
    cards.push(
      axisCard(
        'readiness',
        'Readiness',
        score,
        band,
        axisProse('readiness', band, family, reasoning.readinessAnswered),
        axisKind('readiness', score, reasoning.readinessAnswered),
      ),
    );
  }

  return `<div class="axis-breakdown">${cards.join('')}</div>`;
}

function riskFlagsBlock(flags: readonly string[]): string {
  if (!flags || flags.length === 0) {
    return `<p class="section-body muted">No risk flags raised based on what has been shared so far.</p>`;
  }
  return `<div class="tag-row">${flags
    .map((f) => `<span class="tag tag-risk">${esc(f)}</span>`)
    .join('')}</div>`;
}

function channelChipHtml(channel: Channel | undefined): string {
  const i18n = getI18n('en');
  const meta = getChannelChipData(channel ?? 'web', 'en', i18n);
  if (!meta) return '';
  return `
    <div class="brief-channel ${meta.cls}">
      <span class="brief-channel-tag">Channel: ${esc(meta.name)}</span>
      <span class="brief-channel-note">${esc(meta.note)}</span>
    </div>`;
}

function languageCalloutHtml(code: string | null | undefined): string {
  const label = intakeLanguageLabel(code);
  if (!label) return '';
  return `
    <div class="brief-language-callout">
      <span class="brief-language-label">Lead communicated in: <strong>${esc(label)}</strong></span>
      <span class="brief-language-note">The brief above is translated to English. The original-language text is preserved in the raw transcript for audit reference.</span>
    </div>`;
}

function truthWarningsHtml(warnings: readonly string[]): string {
  if (!warnings || warnings.length === 0) return '';
  const items = warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  return `
    <div class="brief-truth-warnings">
      <p class="brief-truth-title">What this brief deliberately does not assert</p>
      <ul class="brief-truth-list">${items}</ul>
    </div>`;
}

/**
 * Optional cover-layout extras (2026-06-06 prototype adoption).
 *
 * The renderer accepts a single optional opts object so the legacy positional
 * signature stays callable from tests and ad-hoc spots. When the caller knows
 * the decision deadline, subtrack, whale flag, recording URL, or inbound
 * context, it threads them through here and the cover + sidebar render the
 * full layout. When the caller passes nothing, those affordances degrade
 * gracefully — the brief still renders end-to-end.
 */
export interface BriefRenderOptions {
  /** ISO timestamp of the decision deadline. Drives the live timer attrs on
   *  the cover decision band and the sidebar Queue posture row. */
  decisionDeadlineIso?: string | null;
  /** Band C subtrack label (already resolved to display form). */
  subtrack?: string | null;
  /** Whether the engine flagged this lead as a whale-nurture candidate. */
  whaleNurture?: boolean;
  /** Voice channel only: GHL recording URL for inline "Listen to recording". */
  recordingUrl?: string | null;
  /** Web channel only: rendered "Day, Time · Source · 'Term'" inbound context. */
  inboundContextText?: string | null;
}

/**
 * Render the lawyer-facing brief HTML.
 *
 * Layout v2 (2026-06-06):
 *
 *   [ Brief cover — black hero | Decision band aside ]
 *   [ Notice strip ]
 *   [ Language callout (non-EN intakes) ]
 *   [ Truth warnings (rare) ]
 *   [ Contact strip — 4-cell NAP grid ]
 *   [ Main grid 1.7fr / 0.95fr
 *       Left: Decision / Commercial / Call prep / Resolved facts
 *       Right: Queue posture / Watchpoints / Open questions / Inferred signals
 *   ]
 *
 * The cover headline derives from `matterType` (humanised). The decision band
 * uses the band chip + lawyer_time_priority + a live-timer placeholder span
 * (BriefLiveTimers hydrates on mount). The right sidebar collapses meta info
 * out of the page chrome and into the always-visible scroll pane.
 *
 * The brief HTML is stored verbatim at intake time; the live timer reads its
 * data attributes at view time so the countdown is accurate even when the
 * lawyer opens the brief hours later.
 *
 * OOS reports skip the band chip and the four-axis grid; they get a slim
 * "Routing note" group inside the left column.
 */
export function renderBriefHtmlServer(
  report: LawyerReport,
  channel: Channel,
  intakeLanguage?: string | null,
  timezone: string = DEFAULT_FIRM_TIMEZONE,
  matterType?: string | null,
  practiceArea?: string | null,
  options: BriefRenderOptions = {},
): string {
  const isOOS = report.band == null;
  const {
    decisionDeadlineIso = null,
    subtrack = null,
    whaleNurture = false,
    recordingUrl = null,
    inboundContextText = null,
  } = options;

  const matterTitle = humanizeMatterType(matterType);
  const headlineWithSquare = withTerminalSquare(matterTitle);
  const submittedDisplay = formatTime(report.submitted_at, timezone);
  const i18n = getI18n('en');
  const channelMeta = getChannelChipData(channel ?? 'web', 'en', i18n);
  const channelDisplay = channelMeta ? channelMeta.name : 'Web intake';
  const defaultProvenance = defaultProvenancePhraseFor(channel);

  // ─── Brief cover (black hero + decision band aside) ─────────────────────
  const decisionBand = isOOS
    ? `
        <aside class="brief-decision-band">
          <div class="decision-band-row">
            <span class="band-badge band-D">Refer eligible</span>
            <span class="decision-priority">${esc(report.lawyer_time_priority)}</span>
          </div>
          <div class="decision-band-timer">
            <span class="timer-label">Decision window</span>
            ${liveTimerSpan(decisionDeadlineIso, report.submitted_at, 'cover')}
          </div>
        </aside>`
    : `
        <aside class="brief-decision-band">
          <div class="decision-band-row">
            <span class="band-badge band-${esc(report.band)}">Band ${esc(report.band)}</span>
            <span class="decision-priority">${esc(report.lawyer_time_priority)}</span>
          </div>
          <div class="decision-band-timer">
            <span class="timer-label">Decision window</span>
            ${liveTimerSpan(decisionDeadlineIso, report.submitted_at, 'cover')}
          </div>
        </aside>`;

  const cover = `
    <section class="brief-cover">
      <div class="brief-cover-left">
        <p class="cover-eyebrow">CaseLoad Select · Lawyer triage</p>
        <h1 class="cover-headline">${headlineWithSquare}</h1>
        ${report.confidence_calibration ? `<p class="cover-summary">${esc(report.confidence_calibration)}</p>` : ''}
      </div>
      ${decisionBand}
    </section>
  `;

  // ─── Notice strip ────────────────────────────────────────────────────────
  const noticeStrip = `
    <div class="brief-notice-bar">
      <p class="brief-notice">Internal lawyer-facing reference. Not legal advice provided to the lead. The screen organises the lead's description into a triage brief; a lawyer must independently confirm facts and exercise professional judgment before contacting the lead.</p>
    </div>
  `;

  // ─── Contact strip (4-cell NAP grid) ─────────────────────────────────────
  const contactStrip = napBlock(report.resolved_facts_v2, channel);

  // ─── Sidebar cards ───────────────────────────────────────────────────────
  const subtrackRow = subtrack
    ? `<div class="sidebar-meta-row"><dt>Subtrack</dt><dd>${esc(subtrack)}</dd></div>`
    : '';
  const whaleRow = whaleNurture
    ? `<div class="sidebar-meta-row sidebar-meta-row-whale"><dt>Whale nurture</dt><dd>Long-game cadence active</dd></div>`
    : '';
  const recordingRow = recordingUrl
    ? `<div class="sidebar-meta-row"><dt>Recording</dt><dd><a class="sidebar-meta-link" href="${esc(recordingUrl)}" target="_blank" rel="noopener noreferrer">Listen</a></dd></div>`
    : '';
  const inboundRow = inboundContextText
    ? `<div class="sidebar-meta-row sidebar-meta-row-inbound-detail"><dt>Detail</dt><dd>${esc(inboundContextText)}</dd></div>`
    : '';

  const posturedCard = `
    <section class="sidebar-card sidebar-card-posture">
      <h4 class="sidebar-title">Queue posture</h4>
      <dl class="sidebar-meta-list">
        <div class="sidebar-meta-row">
          <dt>Decision window</dt>
          <dd>${liveTimerSpan(decisionDeadlineIso, report.submitted_at, 'sidebar')}</dd>
        </div>
        <div class="sidebar-meta-row">
          <dt>Lead ID</dt>
          <dd class="sidebar-meta-mono">${esc(report.lead_id)}</dd>
        </div>
        <div class="sidebar-meta-row">
          <dt>Inbound</dt>
          <dd>${esc(channelDisplay)}</dd>
        </div>
        ${recordingRow}
        ${inboundRow}
        <div class="sidebar-meta-row">
          <dt>Submitted</dt>
          <dd>${esc(submittedDisplay)}</dd>
        </div>
        ${subtrackRow}
        ${whaleRow}
      </dl>
    </section>`;

  const watchpointsCard = !isOOS
    ? `
      <section class="sidebar-card sidebar-card-watchpoints">
        <h4 class="sidebar-title">Standing watchpoints for this matter type</h4>
        ${riskFlagsBlock(report.risk_flags)}
      </section>`
    : '';

  const questionsCard = !isOOS
    ? `
      <section class="sidebar-card sidebar-card-questions">
        <h4 class="sidebar-title">Open questions</h4>
        ${bullets(report.open_questions, 'No specific open questions auto-generated. The callback will surface them.')}
      </section>`
    : '';

  const signalsCard = !isOOS
    ? `
      <section class="sidebar-card sidebar-card-signals">
        <h4 class="sidebar-title">Inferred signals</h4>
        ${bullets(report.inferred_signals, 'No additional inferred signals.')}
      </section>`
    : '';

  const sidebar = `
    <aside class="brief-main-right">
      ${posturedCard}
      ${watchpointsCard}
      ${questionsCard}
      ${signalsCard}
    </aside>
  `;

  // ─── Left column body ────────────────────────────────────────────────────
  let leftBody: string;
  if (isOOS) {
    leftBody = `
      <section class="brief-group" data-group="routing">
        <h3 class="brief-group-title">Routing note</h3>
        <div class="section"><p class="section-title">Matter detected</p>${textBlock(report.matter_snapshot)}</div>
        <div class="section"><p class="section-title">Action required</p>${textBlock(report.why_it_matters)}</div>
        <div class="section"><p class="section-title">Suggested steps</p>${bullets(report.what_to_confirm)}</div>
      </section>
    `;
  } else {
    // Facts counter line restates the provenance phrase the renderer
    // suppressed at the row level (chip noise reduction). Capitalised so the
    // phrase reads as it would on a chip — e.g. "Provided in web intake" —
    // not "provided in web intake".
    const factsCounterLine = report.confidence_calibration
      ? `<p class="facts-counter">${esc(report.confidence_calibration)} Channel default for unflagged rows: ${esc(defaultProvenance)}.</p>`
      : `<p class="facts-counter">Channel default for unflagged rows: ${esc(defaultProvenance)}.</p>`;

    // 2026-06-07 hierarchy + scan-speed pass: the Decision block compresses
    // matter snapshot + why-it-matters into a tight pair, then surfaces the
    // 3 most important scope checks as a compact grid (no nested section
    // subtitles). The axis grid sits directly below as the "why this band"
    // block, with its own internal hierarchy.
    const scopeItems = (report.strategic_considerations ?? []).slice(0, 3);
    const scopeGrid =
      scopeItems.length > 0
        ? `<div class="callback-scope-grid">${scopeItems.map((s) => `<div class="callback-scope-item">${esc(s)}</div>`).join('')}</div>`
        : `<p class="section-body muted">No specific scope questions flagged. Confirm the standard onboarding facts on the callback.</p>`;

    // Commercial Angle: fee remains prominent, services split into Primary
    // (the first 2 items, treated as the most likely engagement shape) and
    // Add-ons (the rest of likely_legal_services plus cross_sell_opportunities,
    // both capped so the second column stays scannable, not a wall).
    const primaryWork = (report.likely_legal_services ?? []).slice(0, 2);
    const addOns = [
      ...((report.likely_legal_services ?? []).slice(2)),
      ...((report.cross_sell_opportunities ?? [])),
    ].slice(0, 5);
    const commercialServices = `
      <div class="commercial-services">
        ${
          primaryWork.length > 0
            ? `<div class="commercial-block">
                <p class="kicker">Primary likely work</p>
                <ul class="checklist">${primaryWork.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
              </div>`
            : ''
        }
        ${
          addOns.length > 0
            ? `<div class="commercial-block">
                <p class="kicker">Likely add-ons</p>
                <ul class="checklist">${addOns.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
              </div>`
            : ''
        }
      </div>`;

    // Call Preparation: the navy callout is replaced by a 3-up checklist.
    // Open with -> the call openers. Confirm next -> the strategic checks
    // (the same items that drive the Decision scope grid; useful here as a
    // callback walkthrough). Do not quote until -> the what-to-confirm
    // gates that protect the fee quote from being premature.
    const openWith = (report.call_openers ?? []).slice(0, 3);
    const confirmNext = (report.strategic_considerations ?? []).slice(0, 4);
    const doNotQuote = (report.what_to_confirm ?? []).slice(0, 4);
    const callPrepGrid = `
      <div class="callprep-grid">
        <div class="callprep-block">
          <p class="kicker">Open with</p>
          ${
            openWith.length > 0
              ? `<ul class="checklist">${openWith.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
              : '<p class="section-body muted">No openers flagged.</p>'
          }
        </div>
        <div class="callprep-block">
          <p class="kicker">Confirm next</p>
          ${
            confirmNext.length > 0
              ? `<ul class="checklist">${confirmNext.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
              : '<p class="section-body muted">No specific confirms flagged.</p>'
          }
        </div>
        <div class="callprep-block">
          <p class="kicker">Do not quote until</p>
          ${
            doNotQuote.length > 0
              ? `<ul class="checklist">${doNotQuote.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
              : '<p class="section-body muted">No quote-gating checks flagged.</p>'
          }
        </div>
      </div>`;

    leftBody = `
      <section class="brief-group" data-group="headline">
        <h3 class="brief-group-title">Decision</h3>
        <p class="decision-snapshot">${esc((report.matter_snapshot ?? '').trim())}</p>
        ${report.why_it_matters ? `<p class="decision-why">${esc(report.why_it_matters.trim())}</p>` : ''}
        <p class="kicker">Next call should confirm</p>
        ${scopeGrid}
        <div class="decision-axis">
          <p class="kicker">Why this is Band ${esc(report.band)}</p>
          <div class="axis-grid">${axisBreakdown(report.axis_reasoning, matterType, practiceArea)}</div>
        </div>
      </section>

      <section class="brief-group" data-group="commercial">
        <h3 class="brief-group-title">Commercial angle</h3>
        <div class="commercial-layout">
          <div class="commercial-fee">
            <p class="kicker">Fee range</p>
            ${feeBlock(report.fee_estimate)}
          </div>
          ${commercialServices}
        </div>
      </section>

      <section class="brief-group" data-group="callprep">
        <h3 class="brief-group-title">Call preparation</h3>
        ${callPrepGrid}
      </section>

      <section class="brief-group" data-group="facts">
        <h3 class="brief-group-title">Resolved facts</h3>
        ${factsCounterLine}
        ${clusteredFacts(report.resolved_facts_v2, channel)}
      </section>
    `;
  }

  // ─── Assemble final layout ───────────────────────────────────────────────
  const mainGrid = `
    <div class="brief-main-grid">
      <div class="brief-main-left">${leftBody}</div>
      ${sidebar}
    </div>
  `;

  return [
    cover,
    noticeStrip,
    languageCalloutHtml(intakeLanguage),
    truthWarningsHtml(report.truth_warnings),
    contactStrip,
    mainGrid,
  ].join('\n');
}
