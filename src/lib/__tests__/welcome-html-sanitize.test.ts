/**
 * Tests for the welcome-draft HTML sanitizer (S8 Phase 2).
 *
 * Two jobs: (1) strip anything dangerous before the firm's HTML reaches a
 * client's rendered portal, and (2) leave the generated draft + the narrow
 * editor tag set untouched so saved-output compatibility holds.
 */

import { describe, it, expect, vi } from 'vitest';

// welcome-html-sanitize imports 'server-only', which throws under vitest's
// node env; neutralize it (the module is pure JS otherwise).
vi.mock('server-only', () => ({}));

import { sanitizeWelcomeHtml } from '../welcome-html-sanitize';
import { buildWelcomeDraft } from '../welcome-draft-pure';

describe('sanitizeWelcomeHtml — allowed formatting survives', () => {
  it('keeps the welcome tag set', () => {
    const html =
      '<p>Hi <strong>Jane</strong>, here is <em>what</em> to <u>do</u>:</p><ol><li>One</li><li>Two</li></ol><ul><li>a</li></ul><p>Line<br>break</p>';
    const out = sanitizeWelcomeHtml(html);
    expect(out).toContain('<p>');
    expect(out).toContain('<strong>Jane</strong>');
    expect(out).toContain('<em>what</em>');
    expect(out).toContain('<u>do</u>');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>One</li>');
    expect(out).toContain('<ul>');
    expect(out).toMatch(/<br\s*\/?>/);
  });

  it('keeps http / https / mailto links with their href', () => {
    expect(sanitizeWelcomeHtml('<a href="https://x.test/p">portal</a>')).toContain(
      'href="https://x.test/p"',
    );
    expect(sanitizeWelcomeHtml('<a href="mailto:a@b.test">mail</a>')).toContain(
      'href="mailto:a@b.test"',
    );
  });
});

describe('sanitizeWelcomeHtml — dangerous content stripped', () => {
  it('removes <script> AND its body', () => {
    const out = sanitizeWelcomeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips event-handler attributes', () => {
    const out = sanitizeWelcomeHtml('<p onclick="steal()">hi</p>');
    expect(out).toContain('hi');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('steal');
  });

  it('drops javascript: and data: hrefs but keeps the link text', () => {
    const js = sanitizeWelcomeHtml('<a href="javascript:alert(1)">click</a>');
    expect(js).not.toContain('javascript:');
    expect(js).toContain('click');
    const data = sanitizeWelcomeHtml('<a href="data:text/html,<script>">x</a>');
    expect(data).not.toContain('data:');
  });

  it('removes <style> and <iframe> with their content', () => {
    const out = sanitizeWelcomeHtml(
      '<style>body{display:none}</style><p>keep</p><iframe src="https://evil.test"></iframe>',
    );
    expect(out).toContain('<p>keep</p>');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('display:none');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('evil.test');
  });

  it('unwraps disallowed tags but keeps their text', () => {
    const out = sanitizeWelcomeHtml('<div class="x"><h1>Title</h1><span>body</span></div>');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<span');
    expect(out).not.toContain('class=');
    expect(out).toContain('Title');
    expect(out).toContain('body');
  });

  it('strips class / id / style attributes from allowed tags', () => {
    const out = sanitizeWelcomeHtml('<p class="a" id="b" style="color:red">hi</p>');
    expect(out).toContain('hi');
    expect(out).not.toContain('class=');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('style=');
  });

  it('returns empty string for null / empty input', () => {
    expect(sanitizeWelcomeHtml(null)).toBe('');
    expect(sanitizeWelcomeHtml(undefined)).toBe('');
    expect(sanitizeWelcomeHtml('   ')).toBe('');
  });
});

describe('sanitizeWelcomeHtml — generated draft round-trips (compatibility)', () => {
  it('preserves the buildWelcomeDraft output structure + portal link', () => {
    const draft = buildWelcomeDraft({
      primary_name: 'Jane Doe',
      matter_type: 'will_drafting',
      practice_area: 'estates',
      firm_name: 'DRG Law',
      lead_lawyer_display_name: 'Damaris G.',
      lead_lawyer_title: 'Principal',
      portal_url: 'https://app.caseloadselect.ca/portal/abc',
    });
    const out = sanitizeWelcomeHtml(draft.html);
    // Every structural element of the generated draft survives.
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>');
    expect(out).toContain('href="https://app.caseloadselect.ca/portal/abc"');
    expect(out).toMatch(/<p>Hi Jane,/);
    expect(out).toMatch(/<br\s*\/?>/);
    // Nothing dangerous was present, so nothing was dropped: the signature and
    // body text survive intact.
    expect(out).toContain('Damaris G., Principal');
    expect(out).toContain('DRG Law');
  });
});
