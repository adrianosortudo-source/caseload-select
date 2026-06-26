/**
 * Email correspondence shell: the rendered output must stay email-safe (no
 * box-shadow, rgba, flex, grid, positioned layout, or gradient), keep the
 * 600px table shell with the Outlook conditional, carry the firm tokens, and
 * escape caller-supplied chrome. The forbidden-pattern scan here is the
 * in-code email-safety check for every shelled email.
 */
import { describe, it, expect } from 'vitest';
import { resolveEmailBranding } from '@/lib/email-branding';
import { renderEmailShell } from '@/lib/email-shell';
import { DRG_WIDGET_THEME } from '@/lib/widget-theme';

const branding = resolveEmailBranding({
  firm_name: 'DRG Law Professional Corporation',
  theme: DRG_WIDGET_THEME,
})!;

const FORBIDDEN = [
  'box-shadow',
  'rgba(',
  'display:flex',
  'display: flex',
  'display:grid',
  'display: grid',
  'position:absolute',
  'position: absolute',
  'position:fixed',
  'position: fixed',
  'linear-gradient',
];

const fullHtml = renderEmailShell({
  branding,
  preheader: 'Preview text',
  eyebrow: 'Welcome',
  title: 'Your matter is open',
  bodyHtml: '<p>Hi Sam,</p><ol><li>One</li><li>Two</li></ol>',
  detailRows: [
    { label: 'File', value: 'M-123' },
    { label: 'Lawyer', value: 'Damaris Guimaraes' },
  ],
  cta: { label: 'Open portal', url: 'https://example.com/p' },
  footerHtml: 'DRG Law Professional Corporation',
});

describe('renderEmailShell', () => {
  it('emits no email-unsafe CSS', () => {
    const lower = fullHtml.toLowerCase();
    for (const bad of FORBIDDEN) {
      expect(lower, `unexpected ${bad}`).not.toContain(bad);
    }
  });

  it('is a 600px table shell with an Outlook conditional wrapper', () => {
    expect(fullHtml).toContain('max-width:600px');
    expect(fullHtml).toContain('<!--[if mso]>');
    expect(fullHtml).toContain('role="presentation"');
    expect(fullHtml).toContain('<!doctype html>');
  });

  it('carries the DRG correspondence tokens and the supplied content', () => {
    expect(fullHtml).toContain('#EFE9DD'); // paper
    expect(fullHtml).toContain('#FFFCF6'); // surface
    expect(fullHtml).toContain('#6E2C2C'); // oxblood
    expect(fullHtml).toContain('Source Serif 4');
    expect(fullHtml).toContain('DRG Law'); // wordmark
    expect(fullHtml).toContain('Professional Corporation'); // wordmark sub
    expect(fullHtml).toContain('Your matter is open');
    expect(fullHtml).toContain('Open portal');
    expect(fullHtml).toContain('https://example.com/p');
    expect(fullHtml).toContain('File');
    expect(fullHtml).toContain('M-123');
  });

  it('escapes caller-supplied title and CTA, not the trusted body', () => {
    const h = renderEmailShell({
      branding,
      title: '<script>x</script>',
      bodyHtml: '<p>kept</p>',
      cta: { label: '<b>go</b>', url: 'https://x.test/"onmouseover="alert(1)' },
    });
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).not.toContain('<b>go</b>');
    expect(h).toContain('<p>kept</p>'); // trusted body passes through
  });

  it('renders with no optional slots', () => {
    const h = renderEmailShell({ branding, bodyHtml: '<p>Just a line.</p>' });
    expect(h).toContain('Just a line.');
    expect(h).toContain('max-width:600px');
    const lower = h.toLowerCase();
    for (const bad of FORBIDDEN) expect(lower).not.toContain(bad);
  });
});
