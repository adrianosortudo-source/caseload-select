/**
 * Lock-in tests for `renderBriefHtmlServer`.
 *
 * The renderer mirrors the sandbox's DOM-based `brief-render.ts` and powers
 * every server-built brief (voice intake, channel intakes, admin reclassify).
 * These tests pin the structural pieces that lawyers rely on for scanability:
 *
 *   - NAP block at the top (Name + Phone + Postal code + Email)
 *   - "Why this is Band X" four-axis breakdown inside the Decision section
 *     (Value · Complexity · Urgency · Readiness), each card carrying a
 *     0-10 score, a qualitative band (Low / Moderate / High), and a single
 *     lawyer-facing prose sentence. v2 rewrite (2026-06-05): the engine's
 *     raw `reasons` strings are no longer surfaced; the renderer synthesises
 *     matter-aware prose from the score band + matter family.
 *   - Commercial angle, Call preparation, Facts and reasoning sections
 *
 * If any of these silently drop out of the renderer, this test fails loud
 * before a brief reaches a lawyer's inbox.
 */
import { describe, it, expect } from 'vitest';
import { renderBriefHtmlServer } from '../screen-brief-html';
import type { LawyerReport } from '../screen-engine/types';

function buildFakeReport(overrides: Partial<LawyerReport> = {}): LawyerReport {
  const base: LawyerReport = {
    lead_id: 'L-FAKE-001',
    submitted_at: new Date('2026-05-22T12:34:56Z').toISOString(),
    matter_snapshot: 'Test matter snapshot.',
    lawyer_time_priority: 'Standard follow-up cadence',
    band: 'B',
    confidence_calibration: 'Confident on matter type; light on financials.',
    matter_type: 'wrongful_dismissal',
    practice_area: 'employment',
    four_axis: {
      value: 6,
      complexity: 4,
      urgency: 5,
      readiness: 7,
      readinessAnswered: true,
    },
    axis_reasoning: {
      value: {
        score: 6,
        reasons: ['Mid-range fee opportunity', 'Plausible Wallace bump available'],
      },
      complexity: {
        score: 4,
        reasons: ['Standard Bardal analysis', 'No multi-party structure'],
      },
      urgency: {
        score: 5,
        reasons: ['Termination date within 60 days'],
      },
      readiness: {
        score: 7,
        reasons: ['Decision-maker confirmed', 'Has separation paperwork on hand'],
      },
      readinessAnswered: true,
    },
    truth_warnings: [],
    likely_legal_services: ['Termination review', 'Severance negotiation'],
    fee_estimate: '$1,500 – $4,000 for severance review with negotiation',
    why_it_matters: 'Test why it matters.',
    cross_sell_opportunities: [],
    strategic_considerations: ['Confirm cause vs without-cause framing on the call'],
    what_to_confirm: ['Tenure', 'Age', 'Total compensation including bonus'],
    call_openers: ['Walk me through what happened on the termination day'],
    best_next_question: 'Tenure in years',
    resolved_facts_v2: [
      { label: 'Name', value: 'Smoke Test Caller', source: 'stated' },
      { label: 'Phone', value: '+1 416 555 0143', source: 'confirmed' },
    ],
    resolved_facts: {},
    inferred_signals: [],
    open_questions: ['Pension or RRSP contributions'],
    risk_flags: [],
    band_reasoning_bullets: ['Wrongful dismissal lane; standard arc'],
    contact_complete: true,
    advisory_subtrack: 'unknown',
  } as LawyerReport;
  return { ...base, ...overrides };
}

describe('renderBriefHtmlServer — four-axis breakdown', () => {
  it('emits the NAP block before the Decision section so contact is the first scan', () => {
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    const napIdx = html.indexOf('brief-group-nap');
    const decisionIdx = html.indexOf('data-group="headline"');
    expect(napIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(napIdx).toBeLessThan(decisionIdx);
  });

  it('renders the "Why this is Band X" subsection inside Decision', () => {
    const html = renderBriefHtmlServer(buildFakeReport({ band: 'B' }), 'web', 'en');
    expect(html).toContain('Why this is Band B');
    expect(html).toContain('axis-breakdown');
  });

  it('renders four axis cards: Value, Complexity, Urgency, Readiness', () => {
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    expect(html).toContain('>Value<');
    expect(html).toContain('>Complexity<');
    expect(html).toContain('>Urgency<');
    expect(html).toContain('>Readiness<');
    // The v1 "Simplicity" rename is gone — the brief now shows raw Complexity.
    expect(html).not.toContain('>Simplicity<');
  });

  it('shows the raw complexity score (no longer inverted to simplicity)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({
        axis_reasoning: {
          value: { score: 5, reasons: [] },
          complexity: { score: 9, reasons: ['Multi-party'] },
          urgency: { score: 5, reasons: [] },
          readiness: { score: 5, reasons: [] },
          readinessAnswered: true,
        },
      }),
      'web',
      'en',
    );
    // Complexity 9/10 (raw, no inversion). And the v1 "1/10" inversion never appears.
    // The /10 denominator sits in its own span as of 2026-06-07 (CSS sizes it
    // smaller than the numerator); the regex tolerates tags between the score
    // and the denominator.
    expect(html).toMatch(/Complexity[\s\S]*?9[\s\S]*?\/10/);
    expect(html).not.toMatch(/Simplicity[\s\S]*?1[\s\S]*?\/10/);
  });

  it('marks a high-complexity axis as drag (red-ish border)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({
        axis_reasoning: {
          value: { score: 5, reasons: [] },
          complexity: { score: 9, reasons: ['Multi-party'] }, // complexity High → drag
          urgency: { score: 5, reasons: [] },
          readiness: { score: 5, reasons: [] },
          readinessAnswered: true,
        },
      }),
      'web',
      'en',
    );
    expect(html).toContain('axis-block-drag');
  });

  it('marks a low-complexity axis as positive (favourable border)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({
        axis_reasoning: {
          value: { score: 5, reasons: [] },
          complexity: { score: 2, reasons: [] }, // complexity Low → positive
          urgency: { score: 5, reasons: [] },
          readiness: { score: 5, reasons: [] },
          readinessAnswered: true,
        },
      }),
      'web',
      'en',
    );
    // The Complexity card must carry the positive border class.
    expect(html).toMatch(/axis-block-positive[\s\S]*?Complexity/);
  });

  it('marks an unanswered Readiness axis as pending (dashed border)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({
        axis_reasoning: {
          value: { score: 5, reasons: [] },
          complexity: { score: 5, reasons: [] },
          urgency: { score: 5, reasons: [] },
          readiness: { score: 3, reasons: [] },
          readinessAnswered: false,
        },
      }),
      'web',
      'en',
    );
    // The class attribute precedes the axis name inside the card markup:
    //   <div class="axis-block axis-block-pending">...<span>Readiness</span>...
    expect(html).toMatch(/axis-block-pending[\s\S]*?Readiness/);
  });

  it('does NOT leak the engine raw reason strings into the brief', () => {
    // The v1 renderer passed engine reasons (e.g. "Baseline complexity signal
    // from answered standing, standing, standing slots.") through verbatim.
    // The v2 renderer must NOT do this — those strings are internal ontology
    // and read as debug output to a lawyer. Source-of-truth fix:
    // 2026-06-05 brief regression flagged by operator.
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    expect(html).not.toContain('Mid-range fee opportunity');
    expect(html).not.toContain('Standard Bardal analysis');
    expect(html).not.toContain('Termination date within 60 days');
    expect(html).not.toContain('Decision-maker confirmed');
    expect(html).not.toContain('Baseline value signal');
    expect(html).not.toContain('Baseline complexity signal');
    expect(html).not.toContain('answered ');
    expect(html).not.toContain(' slots.');
  });

  it('emits the raw axis score as N/10 for each axis (Complexity no longer inverted)', () => {
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    // Each axis renders a raw 0-10 score inside its own card. As of the
    // 2026-06-07 scan-speed pass, the renderer wraps the "/10"
    // denominator in its own span (.axis-block-score-denom) so the CSS
    // can size it smaller than the numerator. The score number and the
    // /10 are therefore not adjacent in the raw HTML; we match each
    // axis name followed by the score number followed by /10 with
    // arbitrary tags in between.
    expect(html).toMatch(/Value[\s\S]*?6[\s\S]*?\/10/);
    expect(html).toMatch(/Complexity[\s\S]*?4[\s\S]*?\/10/);
    expect(html).toMatch(/Urgency[\s\S]*?5[\s\S]*?\/10/);
    expect(html).toMatch(/Readiness[\s\S]*?7[\s\S]*?\/10/);
  });

  it('renders a qualitative band label (Low / Moderate / High) per axis card', () => {
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    // Value 6 → Moderate, Complexity 4 → Moderate, Urgency 5 → Moderate, Readiness 7 → High
    expect(html).toMatch(/data-axis="value"[\s\S]*?Moderate/);
    expect(html).toMatch(/data-axis="complexity"[\s\S]*?Moderate/);
    expect(html).toMatch(/data-axis="urgency"[\s\S]*?Moderate/);
    expect(html).toMatch(/data-axis="readiness"[\s\S]*?High/);
  });

  it('renders matter-aware prose for an employment matter (value)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport(),
      'web',
      'en',
      undefined,
      'wrongful_dismissal',
      'employment',
    );
    // The Value card must carry an employment-family sentence at the Moderate band.
    expect(html).toMatch(/data-axis="value"[\s\S]*?employment matter/i);
  });

  it('renders matter-aware prose for an estates matter (value)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport(),
      'web',
      'en',
      undefined,
      'will_drafting',
      'estates',
    );
    // The Value card must carry an estate-planning-family sentence.
    expect(html).toMatch(/data-axis="value"[\s\S]*?estate-planning/);
  });

  it('falls back to family-agnostic prose when matter_type is not provided', () => {
    const html = renderBriefHtmlServer(buildFakeReport(), 'web', 'en');
    // With no family hook, the renderer uses generic prose — never the old
    // engine-reasons garble.
    expect(html).toMatch(/data-axis="value"[\s\S]*?Moderate value signal/i);
  });

  it('omits the axis breakdown for out-of-scope reports (no band)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({ band: null as unknown as 'A' }),
      'web',
      'en',
    );
    expect(html).not.toContain('axis-breakdown');
    expect(html).not.toContain('Why this is Band');
  });
});

describe('renderBriefHtmlServer — channel-aware provenance labels (2026-06-05)', () => {
  // Bug history: the renderer's provenance label map was voice-shaped
  // ("Stated during call", "Inferred from transcript"). A website-widget
  // submission flowed through the same renderer and surfaced as
  //   "STATED DURING CALL"
  // chips for fields the lead TYPED in the form. The fix made the label
  // function channel-aware. Voice keeps its phrasing; every other channel
  // gets channel-appropriate wording.
  //
  // These tests are the contract for the rendering layer: no matter what
  // channel a brief is built for, the lawyer must never read text that
  // implies a call happened when it didn't.

  // A report with the four canonical provenance sources actually emitted
  // by the engine pipeline: explicit_from_caller (stated), confirmed,
  // spelled, inferred. We also add a system_metadata fact since voice
  // intakes carry that for the GHL-provided caller_phone.
  function reportWithAllProvenances(): LawyerReport {
    return buildFakeReport({
      resolved_facts_v2: [
        { label: 'Name', value: 'Casey Lee', source: 'explicit_from_caller' },
        { label: 'Phone', value: '+1 416 555 0143', source: 'confirmed_by_caller_after_readback' },
        { label: 'Surname spelling', value: 'L-E-E', source: 'spelled_by_caller' },
        { label: 'Termination date', value: '2026-04-30', source: 'inferred_from_transcript' },
        { label: 'Caller-ID phone', value: '+1 647 555 0199', source: 'system_metadata' },
      ],
    });
  }

  it('voice brief uses call-language provenance ("Stated during call", "Confirmed by caller", "Inferred from transcript")', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'voice', 'en');
    expect(html).toContain('Stated during call');
    expect(html).toContain('Confirmed by caller');
    expect(html).toContain('Spelled by caller');
    expect(html).toContain('Inferred from transcript');
    expect(html).toContain('System metadata');
  });

  it('web brief never uses call-language provenance — uses "Provided in web intake" instead', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'web', 'en');
    // The lawyer must NOT read anything implying a phone call happened.
    expect(html).not.toContain('Stated during call');
    expect(html).not.toContain('Confirmed by caller');
    expect(html).not.toContain('Spelled by caller');
    expect(html).not.toContain('Inferred from transcript');
    expect(html).not.toContain('Follow up on the call');
    // Instead, channel-appropriate phrasing.
    expect(html).toContain('Provided in web intake');
    expect(html).toContain('Inferred from web intake');
    // system_metadata is channel-agnostic.
    expect(html).toContain('System metadata');
  });

  it('facebook (Messenger) brief uses Messenger-thread phrasing, not call-language', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'facebook', 'en');
    expect(html).not.toContain('Stated during call');
    expect(html).not.toContain('Confirmed by caller');
    expect(html).not.toContain('Inferred from transcript');
    expect(html).toContain('Provided in Messenger thread');
    expect(html).toContain('Inferred from Messenger thread');
  });

  it('instagram brief uses Instagram-DM phrasing', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'instagram', 'en');
    expect(html).not.toContain('Stated during call');
    expect(html).toContain('Provided in Instagram DM');
    expect(html).toContain('Inferred from Instagram DM');
  });

  it('whatsapp brief uses WhatsApp-thread phrasing', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'whatsapp', 'en');
    expect(html).not.toContain('Stated during call');
    expect(html).toContain('Provided in WhatsApp thread');
    expect(html).toContain('Inferred from WhatsApp thread');
  });

  it('sms brief uses SMS-thread phrasing', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'sms', 'en');
    expect(html).not.toContain('Stated during call');
    expect(html).toContain('Provided in SMS thread');
    expect(html).toContain('Inferred from SMS thread');
  });

  it('gbp brief uses GBP-chat phrasing', () => {
    const html = renderBriefHtmlServer(reportWithAllProvenances(), 'gbp', 'en');
    expect(html).not.toContain('Stated during call');
    expect(html).toContain('Provided in GBP chat');
    expect(html).toContain('Inferred from GBP chat');
  });

  it('profile_metadata facts render channel-aware "From {channel} profile (unconfirmed)" labels (2026-06-08 #169)', () => {
    // Field repro: a WhatsApp profile-derived name "A D" rendered as
    // "Provided in WhatsApp thread" inside the NAP cell (overclaim).
    // The renderer must surface honest provenance for profile_metadata
    // values inside the NAP cell, showing "From {channel} profile
    // (unconfirmed)" instead. The brief footer's channel-default
    // counter line is a separate surface that describes what the
    // default chip WOULD be for an unflagged row (not a claim about
    // a specific fact); we don't gate that here.
    const report = buildFakeReport({
      resolved_facts_v2: [
        { label: 'Name', value: 'A D', source: 'profile_metadata' },
        { label: 'Phone', value: '+1 647 555 0199', source: 'system_metadata' },
      ],
    });

    function napOf(channel: 'whatsapp' | 'facebook' | 'instagram' | 'voice') {
      const html = renderBriefHtmlServer(report, channel, 'en');
      const match = html.match(/<section class="brief-group brief-group-nap"[\s\S]*?<\/section>/);
      if (!match) throw new Error(`NAP block not found in ${channel} brief`);
      return match[0];
    }

    const waNap = napOf('whatsapp');
    expect(waNap).toContain('From WhatsApp profile (unconfirmed)');
    // The NAP block, where the chip sits next to "A D", must NOT
    // overclaim that the lead typed the name in the thread.
    expect(waNap).not.toContain('Provided in WhatsApp thread');
    // Phone in the same NAP block keeps system_metadata phrasing
    // (carrier-verified).
    expect(waNap).toContain('System metadata');

    expect(napOf('facebook')).toContain('From Messenger profile (unconfirmed)');
    expect(napOf('facebook')).not.toContain('Provided in Messenger thread');

    expect(napOf('instagram')).toContain('From Instagram profile (unconfirmed)');
    expect(napOf('instagram')).not.toContain('Provided in Instagram DM');

    expect(napOf('voice')).toContain('From caller profile (unconfirmed)');
    expect(napOf('voice')).not.toContain('Stated during call');
  });

  it('legacy provenance keys ("stated", "confirmed", "inferred") still render channel-aware', () => {
    // Older screened_leads rows carry the legacy values in resolved_facts_v2.
    // The renderer maps them via the same channel-aware function.
    const html = renderBriefHtmlServer(
      buildFakeReport({
        resolved_facts_v2: [
          { label: 'Name', value: 'Casey Lee', source: 'stated' },
          { label: 'Phone', value: '+1 416 555 0143', source: 'confirmed' },
          { label: 'Termination date', value: '2026-04-30', source: 'inferred' },
        ],
      }),
      'web',
      'en',
    );
    // No call language.
    expect(html).not.toContain('Stated during call');
    expect(html).not.toContain('Confirmed by caller');
    expect(html).not.toContain('Inferred from transcript');
    // Web phrasing.
    expect(html).toContain('Provided in web intake');
    expect(html).toContain('Inferred from web intake');
  });

  it('NAP block missing-field chip is channel-agnostic ("Confirm on follow-up", not "Follow up on the call")', () => {
    // Build a report with NO Name in resolved_facts_v2 so the NAP cell
    // renders the missing chip.
    const html = renderBriefHtmlServer(
      buildFakeReport({
        resolved_facts_v2: [
          { label: 'Phone', value: '+1 416 555 0143', source: 'explicit_from_caller' },
        ],
      }),
      'web',
      'en',
    );
    // The missing-chip wording must not imply a call.
    expect(html).not.toContain('Follow up on the call');
    expect(html).toContain('Confirm on follow-up');
    expect(html).toContain('Not captured');
  });
});

describe('renderBriefHtmlServer — timezone rendering (#138)', () => {
  // Reproduces the exact bug from the 2026-06-02 voice smoke test: a call
  // placed at 4:55 PM Eastern was stored UTC (20:55Z) and rendered as
  // "8:55 PM" in the lawyer brief because formatTime had no timeZone.
  const ISO_455PM_EASTERN = '2026-06-02T20:55:00Z'; // 16:55 America/Toronto (EDT, UTC-4)

  it('renders the arrival time in America/Toronto by default (4:55 PM, not 8:55 PM)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({ submitted_at: ISO_455PM_EASTERN }),
      'voice',
      'en',
      // no explicit timezone -> default America/Toronto
    );
    // en-CA short time renders as "4:55 p.m." (lowercase with periods on
    // some ICU builds) or "4:55 PM". Assert the hour:minute, and that it is
    // NOT the unconverted UTC 8:55.
    expect(html).toContain('4:55');
    expect(html).not.toContain('8:55');
  });

  it('honors an explicit firm timezone (Vancouver renders 1:55 PM for the same instant)', () => {
    const html = renderBriefHtmlServer(
      buildFakeReport({ submitted_at: ISO_455PM_EASTERN }),
      'voice',
      'en',
      'America/Vancouver', // UTC-7 PDT -> 13:55
    );
    expect(html).toContain('1:55');
    expect(html).not.toContain('8:55');
    expect(html).not.toContain('4:55');
  });
});
