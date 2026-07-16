import { describe, it, expect } from 'vitest';
import { sanitizeAnswerHtml } from '../answer-html-sanitize';

describe('sanitizeAnswerHtml', () => {
  it('returns an empty string for null/undefined/blank input', () => {
    expect(sanitizeAnswerHtml(null)).toBe('');
    expect(sanitizeAnswerHtml(undefined)).toBe('');
    expect(sanitizeAnswerHtml('   ')).toBe('');
  });

  it('strips disallowed tags but keeps their text', () => {
    expect(sanitizeAnswerHtml('<p>Safe</p><script>alert(1)</script>')).toBe('<p>Safe</p>');
  });

  it('keeps an <a href> when no host allow-list is given (unchanged prior behavior)', () => {
    const html = '<p>See <a href="https://anywhere.example/x">this</a>.</p>';
    expect(sanitizeAnswerHtml(html)).toContain('<a href="https://anywhere.example/x">');
  });

  describe('with allowedHosts (Ses.18 audit F6b)', () => {
    it('keeps a link whose host is in the allow-list', () => {
      const html = '<p>See <a href="https://drglaw.ca/faq">the FAQ</a>.</p>';
      const result = sanitizeAnswerHtml(html, ['drglaw.ca']);
      expect(result).toContain('<a href="https://drglaw.ca/faq">');
      expect(result).toContain('the FAQ');
    });

    it('unwraps a link whose host is not in the allow-list, keeping its text', () => {
      const html = '<p>See <a href="https://evil.example/steal">this</a>.</p>';
      const result = sanitizeAnswerHtml(html, ['drglaw.ca']);
      expect(result).not.toContain('<a ');
      expect(result).not.toContain('evil.example');
      expect(result).toContain('this');
    });

    it('unwraps a link with a malformed href', () => {
      const html = '<p><a href="not a url">broken</a></p>';
      const result = sanitizeAnswerHtml(html, ['drglaw.ca']);
      expect(result).not.toContain('<a ');
      expect(result).toContain('broken');
    });

    it('is case-insensitive on host matching', () => {
      const html = '<a href="https://DRGLaw.ca/faq">FAQ</a>';
      const result = sanitizeAnswerHtml(html, ['drglaw.ca']);
      expect(result).toContain('<a href="https://DRGLaw.ca/faq">');
    });

    it('an empty allow-list unwraps every link', () => {
      const html = '<a href="https://drglaw.ca/faq">FAQ</a>';
      const result = sanitizeAnswerHtml(html, []);
      expect(result).not.toContain('<a ');
      expect(result).toContain('FAQ');
    });
  });
});
