/**
 * DR-112. buildReport carries lead_intent, and the matter snapshot is
 * prefixed with a plain, one-time acknowledgment when the lead opened by
 * asking to speak with a lawyer rather than describing a matter.
 */
import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { applyClarifyChoice } from '../control';
import { buildReport } from '../report';

describe('buildReport lead_intent (DR-112)', () => {
  it('carries lead_intent=contact_request through to the report', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'corporate_general');
    const report = buildReport(routed);
    expect(report.lead_intent).toBe('contact_request');
  });

  it('carries lead_intent=unknown for a normal case description', () => {
    const state = initialiseState('I got fired last week and have no severance offer');
    const report = buildReport(state);
    expect(report.lead_intent).toBe('unknown');
  });

  it('defaults a legacy state missing lead_intent to unknown on the report, not a crash', () => {
    const state = initialiseState('I got fired last week');
    const { lead_intent: _drop, ...legacy } = state;
    void _drop;
    const report = buildReport(legacy as typeof state);
    expect(report.lead_intent).toBe('unknown');
  });

  it('prefixes matter_snapshot with the contact-request acknowledgment when lead_intent=contact_request', () => {
    const state = initialiseState('i want to speak to a lawyer');
    const routed = applyClarifyChoice(state, 'employment_general');
    const report = buildReport(routed);
    expect(report.matter_snapshot).toMatch(/^The lead opened by asking to speak with a lawyer/);
    // The underlying matter snapshot for the chosen lane still follows the prefix.
    expect(report.matter_snapshot).toContain('Employment matter');
  });

  it('does not prefix matter_snapshot for a normal case description', () => {
    const state = initialiseState('I got fired last week and have no severance offer');
    const report = buildReport(state);
    expect(report.matter_snapshot).not.toContain('asking to speak with a lawyer');
  });
});
