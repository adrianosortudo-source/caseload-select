import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../supabase-admin', () => ({ supabaseAdmin: {} }));
import { mintScreenFirmContext, verifyScreenFirmContext, projectPublicIntakeCriteria } from '../screen-firm-context';

describe('firm intake criteria capability', () => {
  const firm = 'b1c2d3e4-f5a6-7890-bcde-f12345678901';
  const secret = 'a'.repeat(48);
  it('enforces scope, signature and expiry', () => {
    const token = mintScreenFirmContext(firm, secret, 1_000)!;
    expect(verifyScreenFirmContext(token, secret, 2_000)).toBe(firm);
    expect(verifyScreenFirmContext(token, 'b'.repeat(48), 2_000)).toBeUndefined();
    expect(verifyScreenFirmContext(`${token}x`, secret, 2_000)).toBeUndefined();
    expect(verifyScreenFirmContext(`${token.split('.')[0]}.${'é'.repeat(43)}`, secret, 2_000)).toBeUndefined();
    expect(verifyScreenFirmContext(token, secret, 1_000 + 2 * 60 * 60 * 1000)).toBeUndefined();
    expect(mintScreenFirmContext(firm, 'weak')).toBeUndefined();
    expect(mintScreenFirmContext('fictional', secret)).toBeUndefined();
  });

  it('exposes only visitor question text and area labels to the interpreter', () => {
    const projected = projectPublicIntakeCriteria({
      practice_areas: [{ label: 'Family', classification: 'primary', internalNote: 'secret note' }],
      question_sets: { family: { questions: [{ text: 'What would you like help with?', extraction_hints: ['private hint'] }],
        high_value_signals: ['private score'], red_flags: ['private flag'] } },
    });
    expect(projected).toEqual({ practiceAreas: [{ label: 'Family', classification: 'primary' }],
      questions: [{ area: 'family', text: 'What would you like help with?' }] });
    expect(JSON.stringify(projected)).not.toContain('private');
  });
});
