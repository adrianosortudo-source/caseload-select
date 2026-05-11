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

import type { Channel, LawyerReport, ResolvedFact } from './screen-engine/types';
import { getI18n } from './screen-engine/i18n/loader';
import { getChannelChipData } from './screen-engine/i18n/display';

const FACT_SOURCE_LABEL: Record<string, string> = {
  stated: 'Stated in description',
  confirmed: 'Confirmed by lead',
  inferred: 'Inferred from context',
  unknown: 'Unconfirmed',
};

const FACT_SOURCE_CLASS: Record<string, string> = {
  stated: 'src-stated',
  confirmed: 'src-confirmed',
  inferred: 'src-inferred',
  unknown: 'src-unknown',
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

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
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
export function renderBriefHtmlServer(report: LawyerReport, channel: Channel): string {
  const isOOS = report.band == null; // OOS reports do not band-rank
  const sections: string[] = [];

  // Meta header
  sections.push(`
    <div class="brief-meta-header">
      <div class="brief-lead-strip">
        <span class="brief-lead-id">${esc(report.lead_id)}</span>
        <span class="brief-lead-time">${esc(formatTime(report.submitted_at))}</span>
      </div>
      ${channelChipHtml(channel)}
      <p class="brief-notice">Internal lawyer-facing reference. Not legal advice provided to the lead. The screen organises the lead's description into a triage brief; a lawyer must independently confirm facts and exercise professional judgment before contacting the lead.</p>
    </div>
  `);

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
