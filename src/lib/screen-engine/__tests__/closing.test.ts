import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { buildClosingMessage } from '../closing';
import type { Channel } from '../types';

describe('channel closing acknowledgment', () => {
  it.each(['web', 'voice'] as Channel[])('leaves %s closing to the channel', channel => {
    expect(buildClosingMessage({ ...initialiseState('A matter'), channel })).toBe('');
  });
  it.each(['sms', 'gbp', 'whatsapp', 'facebook', 'instagram'] as Channel[])(
    'uses grounded English and Portuguese copy on %s', channel => {
      const state = { ...initialiseState('A matter'), channel, slots: { client_name: 'Maria Silva' } };
      const en = buildClosingMessage({ ...state, language: 'en' });
      const pt = buildClosingMessage({ ...state, language: 'pt' });
      expect(en).toContain('Thank you');
      expect(pt).toContain('Obrigado');
      expect(en).not.toMatch(/reviewing|forwarded|will be in touch|promptly/i);
      expect(pt).not.toMatch(/analisando|encaminhad|entrará em contato/i);
      if (channel === 'sms' || channel === 'gbp') {
        expect(en).not.toContain('Maria');
      } else {
        expect(en).toContain('Maria');
        expect(pt).toContain('Maria');
        expect(en).toContain('call the firm directly');
        expect(pt).toContain('diretamente com o escritório');
      }
    },
  );
});

it.each(['corporate', 'real_estate', 'employment', 'estates', 'family'] as const)(
  'does not mutate %s screening state while closing', practice_area => {
    const state = { ...initialiseState('A matter'), channel: 'whatsapp' as const, practice_area };
    const before = JSON.stringify(state);
    buildClosingMessage(state);
    expect(JSON.stringify(state)).toBe(before);
  },
);

it.each(['whatsapp', 'facebook', 'instagram'] as Channel[])(
  'uses only an available first name on %s, including out-of-scope matters', channel => {
    const state = { ...initialiseState('A matter'), channel, matter_type: 'out_of_scope' as const };
    expect(buildClosingMessage({ ...state, slots: { client_name: 'Maria Silva' } })).toContain('Thank you Maria for');
    expect(buildClosingMessage({ ...state, slots: { client_name: 'A' } })).toContain('Thank you for');
    expect(buildClosingMessage({ ...state, slots: {} })).toContain('Thank you for');
  },
);
