import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sanitizeMessageHtml } from '../message-html-sanitize';

describe('sanitizeMessageHtml', () => {
  it('drops a script tag and its contents', () => {
    const out = sanitizeMessageHtml('hello<script>alert(1)</script> world');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('drops an img with an onerror handler (the canonical stored-XSS payload)', () => {
    const out = sanitizeMessageHtml('<img src=x onerror="fetch(\'//evil\')">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('<img');
  });

  it('encodes a stray "<" in plain text instead of dropping it', () => {
    const out = sanitizeMessageHtml('cost < $500 for a < b');
    expect(out).toContain('&lt;');
    expect(out).toContain('$500');
    // no literal unencoded tag-opening remains
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it('preserves the small rich subset used by welcome sends', () => {
    const out = sanitizeMessageHtml('<p>Hi <strong>there</strong>, see <a href="https://x.ca">link</a></p>');
    expect(out).toContain('<strong>there</strong>');
    expect(out).toContain('<a href="https://x.ca">');
    expect(out).toContain('<p>');
  });

  it('strips a javascript: href', () => {
    const out = sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('returns empty string for null/empty input', () => {
    expect(sanitizeMessageHtml(null)).toBe('');
    expect(sanitizeMessageHtml('   ')).toBe('');
  });

  it('preserves newlines in plain text (rendered as line breaks downstream)', () => {
    expect(sanitizeMessageHtml('line one\nline two')).toContain('\n');
  });
});
