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
 * Per operator direction: do NOT overclaim. The label "Confirmed by caller"
 * is reserved for the readback-detection code path. Code that promotes a
 * later candidate value without true readback detection MUST emit
 * 'explicit_from_caller' (which renders as "Stated during call"), not the
 * stronger 'confirmed_by_caller_after_readback'.
 */
const FACT_SOURCE_LABEL: Record<string, string> = {
  // Locked 2026-06-02 taxonomy
  confirmed_by_caller_after_readback: 'Confirmed by caller',
  spelled_by_caller: 'Spelled by caller',
  explicit_from_caller: 'Stated during call',
  system_metadata: 'System metadata',
  inferred_from_transcript: 'Inferred from transcript',
  unknown: 'Not confirmed',
  // Legacy DB-row backward-compat
  stated: 'Stated during call',
  confirmed: 'Confirmed by caller',
  inferred: 'Inferred from transcript',
};

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

function bullets(items: readonly string[]): string {
  if (!items || items.length === 0) {
    return `<p class="section-body muted">None confirmed</p>`;
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

function factsWithProvenance(facts: ResolvedFact[]): string {
  if (!facts || facts.length === 0) {
    return `<p class="section-body muted">No confirmed facts yet.</p>`;
  }
  const rows = facts
    .map(
      (f) => `
      <li class="fact-row">
        <span class="fact-label">${esc(f.label)}</span>
        <span class="fact-value">${esc(f.value)}</span>
        <span class="fact-source ${FACT_SOURCE_CLASS[f.source] ?? ''}">${esc(FACT_SOURCE_LABEL[f.source] ?? f.source)}</span>
      </li>`,
    )
    .join('');
  return `<ul class="fact-list">${rows}</ul>`;
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

function napBlock(facts: ResolvedFact[]): string {
  // Index facts by label for fast lookup
  const byLabel = new Map<string, ResolvedFact>();
  for (const f of facts ?? []) {
    if (f && f.label) byLabel.set(f.label, f);
  }
  const cells = NAP_FIELD_ORDER.map(({ label, key }) => {
    const fact = byLabel.get(key);
    if (fact) {
      return `
        <div class="nap-cell">
          <p class="nap-label">${esc(label)}</p>
          <p class="nap-value">${esc(fact.value)}</p>
          <p class="nap-source ${FACT_SOURCE_CLASS[fact.source] ?? ''}">${esc(FACT_SOURCE_LABEL[fact.source] ?? fact.source)}</p>
        </div>`;
    }
    return `
      <div class="nap-cell nap-cell-missing">
        <p class="nap-label">${esc(label)}</p>
        <p class="nap-value nap-value-missing">Not captured</p>
        <p class="nap-source nap-source-missing">Follow up on the call</p>
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
  return `
    <div class="axis-block axis-block-${esc(kind)}" data-axis="${esc(axis)}">
      <div class="axis-block-head">
        <span class="axis-block-name">${esc(name)}</span>
        <span class="axis-block-score">${score}/10</span>
      </div>
      <p class="axis-block-band"><span class="axis-block-band-label">${esc(band)}</span></p>
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
 * Render the report-area HTML for a server-built brief.
 *
 * The portal's brief view wraps this output in its own header strip, so we
 * mirror only what the sandbox's `fillReportArea` produces — the meta
 * header (lead strip + channel chip + notice), then the band / sections.
 *
 * `channel` is passed separately so we don't need to plumb the full
 * EngineState into the renderer.
 */
export function renderBriefHtmlServer(
  report: LawyerReport,
  channel: Channel,
  intakeLanguage?: string | null,
  timezone: string = DEFAULT_FIRM_TIMEZONE,
  matterType?: string | null,
  practiceArea?: string | null,
): string {
  const isOOS = report.band == null; // OOS reports do not band-rank
  const sections: string[] = [];

  // Meta header
  sections.push(`
    <div class="brief-meta-header">
      <div class="brief-lead-strip">
        <span class="brief-lead-id">${esc(report.lead_id)}</span>
        <span class="brief-lead-time">${esc(formatTime(report.submitted_at, timezone))}</span>
      </div>
      ${channelChipHtml(channel)}
      <p class="brief-notice">Internal lawyer-facing reference. Not legal advice provided to the lead. The screen organises the lead's description into a triage brief; a lawyer must independently confirm facts and exercise professional judgment before contacting the lead.</p>
    </div>
  `);

  sections.push(languageCalloutHtml(intakeLanguage));
  sections.push(truthWarningsHtml(report.truth_warnings));

  // Band row
  sections.push(`
    <div class="brief-band">
      <span class="band-badge band-${esc(report.band)}">Band ${esc(report.band)}</span>
      <span class="brief-priority">${esc(report.lawyer_time_priority)}</span>
    </div>
  `);

  if (!isOOS && report.confidence_calibration) {
    sections.push(`<p class="brief-calibration">${esc(report.confidence_calibration)}</p>`);
  }

  // NAP block — prominent contact strip at the top of every brief
  // (both in-scope and OOS). The lawyer's first scan answers "can I
  // reach this person back?"; surfacing name + phone + postal code +
  // email here removes the scroll-to-the-bottom step that the
  // pre-2026-05-21 layout forced.
  sections.push(napBlock(report.resolved_facts_v2));

  if (isOOS) {
    sections.push(`
      <section class="brief-group" data-group="routing">
        <h3 class="brief-group-title">Routing note</h3>
        <div class="section"><p class="section-title">Matter detected</p>${textBlock(report.matter_snapshot)}</div>
        <div class="section"><p class="section-title">Action required</p>${textBlock(report.why_it_matters)}</div>
        <div class="section"><p class="section-title">Suggested steps</p>${bullets(report.what_to_confirm)}</div>
      </section>
    `);
  } else {
    sections.push(`
      <section class="brief-group" data-group="headline">
        <h3 class="brief-group-title">Decision</h3>
        <div class="section"><p class="section-title">Matter snapshot</p>${textBlock(report.matter_snapshot)}</div>
        <div class="section"><p class="section-title">Why this matters</p>${textBlock(report.why_it_matters)}</div>
        <div class="section"><p class="section-title">Why this is Band ${esc(report.band)}</p>${axisBreakdown(report.axis_reasoning, matterType, practiceArea)}</div>
      </section>

      <section class="brief-group" data-group="commercial">
        <h3 class="brief-group-title">Commercial angle</h3>
        <div class="section"><p class="section-title">Likely legal services</p>${bullets(report.likely_legal_services)}</div>
        <div class="section"><p class="section-title">Estimated fee opportunity</p>${feeBlock(report.fee_estimate)}</div>
        <div class="section"><p class="section-title">Cross-sell or follow-up opportunities</p>${bullets(report.cross_sell_opportunities)}</div>
      </section>

      <section class="brief-group" data-group="callprep">
        <h3 class="brief-group-title">Call preparation</h3>
        <div class="section"><p class="section-title">Strategic considerations for the call</p>${bullets(report.strategic_considerations)}</div>
        <div class="section"><p class="section-title">Suggested call openers</p>${bullets(report.call_openers)}</div>
        <div class="section"><p class="section-title">What to confirm before quoting</p>${bullets(report.what_to_confirm)}</div>
      </section>

      <section class="brief-group" data-group="facts">
        <h3 class="brief-group-title">Facts and reasoning</h3>
        <div class="section"><p class="section-title">Resolved facts</p>${factsWithProvenance(report.resolved_facts_v2)}</div>
        <div class="section"><p class="section-title">Inferred signals</p>${bullets(report.inferred_signals)}</div>
        <div class="section"><p class="section-title">Open questions</p>${bullets(report.open_questions)}</div>
        <div class="section"><p class="section-title">Risk flags</p>${riskFlagsBlock(report.risk_flags)}</div>
      </section>
    `);
  }

  return sections.join('\n');
}
