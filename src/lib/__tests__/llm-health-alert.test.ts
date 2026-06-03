/**
 * Tests for the LLM-extraction-disabled operator alert (#128).
 *
 * Two pure pieces: the per-firm cooldown decision (shouldAlertLlmDisabled) and
 * the email composition (buildLlmDisabledAlertEmail). The I/O wrapper
 * (notifyOperatorOfLlmDisabled) is a thin sendEmail shell, tested via the
 * voice-intake route integration test.
 */

import { describe, it, expect } from 'vitest';
import {
  shouldAlertLlmDisabled,
  buildLlmDisabledAlertEmail,
  LLM_DISABLED_ALERT_SUPPRESSION_HOURS,
  type LlmDisabledAlertArgs,
} from '../llm-health-alert';

const NOW = new Date('2026-06-02T20:00:00Z');

describe('shouldAlertLlmDisabled — per-firm cooldown', () => {
  it('alerts when never alerted before (null)', () => {
    expect(shouldAlertLlmDisabled(null, NOW)).toBe(true);
    expect(shouldAlertLlmDisabled(undefined, NOW)).toBe(true);
  });

  it('alerts when the stored timestamp is unparseable (treat as never)', () => {
    expect(shouldAlertLlmDisabled('not-a-date', NOW)).toBe(true);
  });

  it('suppresses when the last alert is within the window', () => {
    // 1 hour ago, window is 6 hours → still suppressed.
    const oneHourAgo = new Date(NOW.getTime() - 1 * 3_600_000).toISOString();
    expect(shouldAlertLlmDisabled(oneHourAgo, NOW)).toBe(false);
  });

  it('alerts again once the window has elapsed', () => {
    // Exactly the suppression window ago → eligible again.
    const windowAgo = new Date(
      NOW.getTime() - LLM_DISABLED_ALERT_SUPPRESSION_HOURS * 3_600_000,
    ).toISOString();
    expect(shouldAlertLlmDisabled(windowAgo, NOW)).toBe(true);

    const beyondWindow = new Date(
      NOW.getTime() - (LLM_DISABLED_ALERT_SUPPRESSION_HOURS + 1) * 3_600_000,
    ).toISOString();
    expect(shouldAlertLlmDisabled(beyondWindow, NOW)).toBe(true);
  });

  it('honors a custom suppression window', () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
    expect(shouldAlertLlmDisabled(twoHoursAgo, NOW, 1)).toBe(true); // 1h window, 2h elapsed
    expect(shouldAlertLlmDisabled(twoHoursAgo, NOW, 3)).toBe(false); // 3h window, 2h elapsed
  });
});

describe('buildLlmDisabledAlertEmail', () => {
  function args(overrides: Partial<LlmDisabledAlertArgs> = {}): LlmDisabledAlertArgs {
    return {
      firmId: 'firm-abc',
      firmName: 'DRG Law',
      mode: 'disabled',
      channel: 'voice',
      callId: 'call-xyz',
      occurredAtIso: '2026-06-02T20:00:00Z',
      ...overrides,
    };
  }

  it('names the firm in the subject', () => {
    const { subject } = buildLlmDisabledAlertEmail(args());
    expect(subject).toContain('DRG Law');
    expect(subject.toLowerCase()).toContain('llm');
  });

  it('falls back to the firm id when no name', () => {
    const { subject, html } = buildLlmDisabledAlertEmail(args({ firmName: null }));
    expect(subject).toContain('firm-abc');
    expect(html).toContain('firm-abc');
  });

  it('explains the cause and the fix', () => {
    const { html } = buildLlmDisabledAlertEmail(args());
    expect(html).toContain('GEMINI_API_KEY');
    expect(html).toContain('mode=disabled');
    expect(html).toContain('regex-only');
    expect(html).toContain('Vercel');
  });

  it('surfaces the channel, mode, and call id', () => {
    const { html } = buildLlmDisabledAlertEmail(args());
    expect(html).toContain('voice');
    expect(html).toContain('disabled');
    expect(html).toContain('call-xyz');
  });

  it('states the suppression window so the operator knows repeats are throttled', () => {
    const { html } = buildLlmDisabledAlertEmail(args());
    expect(html).toContain(String(LLM_DISABLED_ALERT_SUPPRESSION_HOURS));
  });

  it('HTML-escapes a firm name to prevent injection', () => {
    const { html } = buildLlmDisabledAlertEmail(args({ firmName: '<b>x</b>' }));
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
