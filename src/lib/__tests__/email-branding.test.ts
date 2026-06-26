/**
 * Per-firm email branding resolver: null for un-themed firms, solid-hex output
 * (never rgba) for themed firms, correct alpha blend, and wordmark split.
 */
import { describe, it, expect } from 'vitest';
import { resolveEmailBranding } from '@/lib/email-branding';
import { DRG_WIDGET_THEME } from '@/lib/widget-theme';

describe('resolveEmailBranding', () => {
  it('returns null when the firm has no theme', () => {
    expect(resolveEmailBranding(null)).toBeNull();
    expect(resolveEmailBranding(undefined)).toBeNull();
    expect(resolveEmailBranding({})).toBeNull();
    expect(resolveEmailBranding({ firm_name: 'X', theme: null })).toBeNull();
  });

  it('resolves DRG tokens to solid hex with no rgba anywhere', () => {
    const b = resolveEmailBranding({
      firm_name: 'DRG Law Professional Corporation',
      theme: DRG_WIDGET_THEME,
    });
    expect(b).not.toBeNull();
    expect(Object.values(b!).join(' ')).not.toContain('rgba');
    expect(b!.paper).toBe('#EFE9DD');
    expect(b!.surface).toBe('#FFFCF6');
    expect(b!.ink).toBe('#1A1410');
    expect(b!.oxblood).toBe('#6E2C2C');
    expect(b!.oxbloodText).toBe('#FFFCF6');
    expect(b!.brass).toBe('#B8956A');
  });

  it('alpha-blends the rgba muted token over the paper ground', () => {
    const b = resolveEmailBranding({
      firm_name: 'DRG Law Professional Corporation',
      theme: DRG_WIDGET_THEME,
    })!;
    // rgba(26,20,16,0.62) over #EFE9DD resolves to #6b655e.
    expect(b.inkMuted.toLowerCase()).toBe('#6b655e');
    expect(b.inkMuted).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('splits the wordmark from the corporate suffix', () => {
    const b = resolveEmailBranding({
      firm_name: 'DRG Law Professional Corporation',
      theme: DRG_WIDGET_THEME,
    })!;
    expect(b.wordmark).toBe('DRG Law');
    expect(b.wordmarkSub).toBe('Professional Corporation');
  });

  it('keeps a plain firm name whole with no sub line', () => {
    const b = resolveEmailBranding({
      firm_name: 'Smith Legal',
      theme: DRG_WIDGET_THEME,
    })!;
    expect(b.wordmark).toBe('Smith Legal');
    expect(b.wordmarkSub).toBe('');
  });

  it('uses an email-safe serif stack, not the widget next/font variable', () => {
    const b = resolveEmailBranding({
      firm_name: 'DRG Law Professional Corporation',
      theme: DRG_WIDGET_THEME,
    })!;
    expect(b.fontStack).toContain('Source Serif 4');
    expect(b.fontStack).toContain('Georgia');
    expect(b.fontStack).not.toContain('var(');
  });
});
