/**
 * Tests for the explainer-article HTML sanitizer (S8 Phase 2). Broader than the
 * welcome allowlist (adds h2-h4 + blockquote) but the same XSS posture: nothing
 * dangerous reaches the client portal where body_html is rendered.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { sanitizeExplainerHtml } from '../explainer-html-sanitize';

describe('sanitizeExplainerHtml — article formatting survives', () => {
  it('keeps headings, blockquote, lists, emphasis, and links', () => {
    const html =
      '<h2>Heading</h2><h3>Sub</h3><h4>Sub-sub</h4>' +
      '<p>A <strong>bold</strong> <em>idea</em>.</p>' +
      '<blockquote>Quoted</blockquote>' +
      '<ul><li>one</li></ul><ol><li>two</li></ol>' +
      '<p><a href="https://x.test/a">link</a></p>';
    const out = sanitizeExplainerHtml(html);
    expect(out).toContain('<h2>Heading</h2>');
    expect(out).toContain('<h3>Sub</h3>');
    expect(out).toContain('<h4>Sub-sub</h4>');
    expect(out).toContain('<blockquote>Quoted</blockquote>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out).toContain('href="https://x.test/a"');
  });

  it('unwraps h1 to text (page chrome owns the title)', () => {
    const out = sanitizeExplainerHtml('<h1>Title</h1><p>body</p>');
    expect(out).not.toContain('<h1');
    expect(out).toContain('Title');
    expect(out).toContain('<p>body</p>');
  });
});

describe('sanitizeExplainerHtml — dangerous content stripped', () => {
  it('removes script/style/iframe with their content', () => {
    const out = sanitizeExplainerHtml(
      '<script>evil()</script><style>x{}</style><p>keep</p><iframe src="https://e.test"></iframe>',
    );
    expect(out).toBe('<p>keep</p>');
  });

  it('strips event handlers and disallowed schemes', () => {
    expect(sanitizeExplainerHtml('<p onclick="x()">hi</p>')).not.toContain('onclick');
    expect(sanitizeExplainerHtml('<a href="javascript:alert(1)">c</a>')).not.toContain('javascript:');
  });

  it('strips class / id / style attributes', () => {
    const out = sanitizeExplainerHtml('<h2 class="a" id="b" style="color:red">H</h2>');
    expect(out).toContain('H');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('style=');
  });

  it('returns empty string for null / empty input', () => {
    expect(sanitizeExplainerHtml(null)).toBe('');
    expect(sanitizeExplainerHtml('')).toBe('');
    expect(sanitizeExplainerHtml('   ')).toBe('');
  });
});
