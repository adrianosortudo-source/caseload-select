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
    expect(html).toMatch(/Complexity[\s\S]*?9\/10/);
    expect(html).not.toMatch(/Simplicity[\s\S]*?1\/10/);
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
    // Each axis renders a raw 0-10 score inside its own card.
    expect(html).toMatch(/Value[\s\S]*?6\/10/);
    expect(html).toMatch(/Complexity[\s\S]*?4\/10/);
    expect(html).toMatch(/Urgency[\s\S]*?5\/10/);
    expect(html).toMatch(/Readiness[\s\S]*?7\/10/);
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
