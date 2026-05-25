/**
 * Tests for post-finalization-followup.ts message builder.
 *
 * Pins the secretary-style copy for a returning lead whose intake
 * has already finalized. Field case 2026-05-25: lead asked
 * "when is she calling me?" after their shareholder_dispute brief
 * landed; the bot should answer warmly, not restart the intake.
 */

import { describe, it, expect } from 'vitest';
import { buildPostFinalizationFollowUpMessage } from '../post-finalization-followup';
import type { EngineState } from '../screen-engine/types';

function finalizedState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    lead_id: 'L-2026-05-25-2KI',
    input: 'shareholder dispute about buyout',
    matter_type: 'shareholder_dispute',
    practice_area: 'corporate',
    intent_family: 'business_dispute',
    language: 'en',
    channel: 'facebook',
    slots: {
      client_name: 'Sarah Patel',
      client_email: 'sarah.patel.test@example.com',
      client_phone: '+16475559999',
    },
    slot_meta: {},
    slot_evidence: {},
    submitted_at: new Date('2026-05-25T16:00:00Z').toISOString(),
    ...overrides,
  } as EngineState;
}

describe('buildPostFinalizationFollowUpMessage', () => {
  it('uses the lead\'s first name when client_name is set', () => {
    const text = buildPostFinalizationFollowUpMessage(finalizedState());
    expect(text).toContain('Hi Sarah');
    expect(text).toContain('a lawyer is reviewing your matter');
    expect(text).toContain('they\'ll reach out to you directly');
  });

  it('uses only the FIRST name even when client_name is multi-token', () => {
    const text = buildPostFinalizationFollowUpMessage(
      finalizedState({ slots: { client_name: 'Sarah Patel' } }),
    );
    expect(text).toContain('Hi Sarah —');
    expect(text).not.toContain('Hi Sarah Patel');
  });

  it('falls back to "Hi —" when client_name is missing (defensive)', () => {
    const text = buildPostFinalizationFollowUpMessage(
      finalizedState({ slots: {} }),
    );
    expect(text.startsWith('Hi —')).toBe(true);
  });

  it('falls back to "Hi —" when client_name is empty string', () => {
    const text = buildPostFinalizationFollowUpMessage(
      finalizedState({ slots: { client_name: '' } }),
    );
    expect(text.startsWith('Hi —')).toBe(true);
  });

  it('encourages calling the firm directly for time-sensitive matters', () => {
    const text = buildPostFinalizationFollowUpMessage(finalizedState());
    expect(text).toContain('time-sensitive');
    expect(text).toContain('call the firm directly');
  });

  it('does not invent details — only mentions the lawyer is reviewing', () => {
    // No specific time, no specific lawyer name, no specific firm details
    // baked into the template. Safe to ship across all firms.
    const text = buildPostFinalizationFollowUpMessage(finalizedState());
    expect(text).not.toContain('Tuesday');
    expect(text).not.toContain('Damaris');
    expect(text).not.toContain('Adriano');
    expect(text).not.toMatch(/by \d/);
  });

  it('warmth signals: "thanks for following up", "patience"', () => {
    const text = buildPostFinalizationFollowUpMessage(finalizedState());
    expect(text).toContain('thanks for following up');
    expect(text).toContain('patience');
  });
});
