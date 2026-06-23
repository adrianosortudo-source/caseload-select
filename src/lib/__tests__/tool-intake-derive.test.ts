import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        not: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

import {
  toolSlugToMatterType,
  practiceSlugToArea,
  generateToolLeadId,
  deriveToolAxes,
  deriveToolBand,
} from '../tool-intake-derive';
import { sanitizeBriefHtml } from '../intake-v2-security';

// ─── DRG tool slug contract ──────────────────────────────────────────────────
// Every toolSlug emitted by a DRG PA landing or standalone tool page must
// resolve to a known matter type. If this test fails after adding a new tool
// page on DRG, add the slug to TOOL_TO_MATTER_TYPE in tool-intake-derive.ts.

const DRG_TOOL_SLUGS: Array<{ slug: string; expectedMatterType: string }> = [
  { slug: 'ontario-ltt-calculator', expectedMatterType: 'residential_purchase' },
  { slug: 'personal-guarantee-estimator', expectedMatterType: 'commercial_lease' },
  { slug: 'new-business-structure-check', expectedMatterType: 'business_setup_advisory' },
  { slug: 'founders-ownership-worksheet', expectedMatterType: 'business_setup_advisory' },
  { slug: 'succession-readiness-check', expectedMatterType: 'will_drafting' },
  { slug: 'retainer-vs-per-matter-calculator', expectedMatterType: 'general_counsel_advisory' },
  { slug: 'minute-book-readiness-check', expectedMatterType: 'corporate_maintenance' },
  { slug: 'notary-scope-confirmation', expectedMatterType: 'notary_services' },
  { slug: 'severance-range-estimator', expectedMatterType: 'severance_review' },
  { slug: 'business-legal-readiness-score', expectedMatterType: 'business_setup_advisory' },
  { slug: 'closing-cash-to-close', expectedMatterType: 'residential_purchase' },
];

describe('toolSlugToMatterType', () => {
  it.each(DRG_TOOL_SLUGS)(
    'maps "$slug" to "$expectedMatterType"',
    ({ slug, expectedMatterType }) => {
      expect(toolSlugToMatterType(slug)).toBe(expectedMatterType);
    },
  );

  it('returns "unknown" for unrecognised slugs', () => {
    expect(toolSlugToMatterType('nonexistent-tool')).toBe('unknown');
    expect(toolSlugToMatterType('')).toBe('unknown');
  });
});

// ─── DRG practice slug contract ──────────────────────────────────────────────

const DRG_PRACTICE_SLUGS: Array<{ slug: string; expectedArea: string }> = [
  { slug: 'corporate', expectedArea: 'corporate' },
  { slug: 'real-estate', expectedArea: 'real_estate' },
  { slug: 'employment', expectedArea: 'employment' },
  { slug: 'estates', expectedArea: 'estates' },
  { slug: 'succession', expectedArea: 'estates' },
  { slug: 'fractional-counsel', expectedArea: 'corporate' },
  { slug: 'contract-review', expectedArea: 'corporate' },
  { slug: 'records-upkeep', expectedArea: 'corporate' },
  { slug: 'notary', expectedArea: 'corporate' },
];

describe('practiceSlugToArea', () => {
  it.each(DRG_PRACTICE_SLUGS)(
    'maps "$slug" to "$expectedArea"',
    ({ slug, expectedArea }) => {
      expect(practiceSlugToArea(slug)).toBe(expectedArea);
    },
  );

  it('strips leading slash before lookup', () => {
    expect(practiceSlugToArea('/corporate')).toBe('corporate');
    expect(practiceSlugToArea('/real-estate')).toBe('real_estate');
    expect(practiceSlugToArea('/succession')).toBe('estates');
  });

  it('returns "unknown" for unrecognised slugs', () => {
    expect(practiceSlugToArea('immigration')).toBe('unknown');
    expect(practiceSlugToArea('')).toBe('unknown');
  });
});

// ─── Lead ID format ──────────────────────────────────────────────────────────

describe('generateToolLeadId', () => {
  const ID_RE = /^T-\d{4}-\d{2}-\d{2}-[0-9A-F]{4}$/;

  it('matches T-YYYY-MM-DD-XXXX format', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateToolLeadId()).toMatch(ID_RE);
    }
  });

  it('starts with T- prefix (distinguishable from L- standard leads)', () => {
    expect(generateToolLeadId().startsWith('T-')).toBe(true);
  });

  it('hex suffix is exactly 4 characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateToolLeadId();
      const suffix = id.split('-').pop()!;
      expect(suffix).toHaveLength(4);
    }
  });
});

// ─── Axis derivation + banding ───────────────────────────────────────────────

describe('deriveToolAxes', () => {
  it('returns conservative axes for tool leads', () => {
    const axes = deriveToolAxes();
    expect(axes.readiness).toBeLessThanOrEqual(3);
    expect(axes.urgency).toBeLessThanOrEqual(3);
  });
});

describe('deriveToolBand', () => {
  it('never returns Band A for tool leads', () => {
    const axes = deriveToolAxes();
    const band = deriveToolBand(axes);
    expect(['B', 'C']).toContain(band);
    expect(band).not.toBe('A');
  });
});

// ─── Sanitizer marker preservation ───────────────────────────────────────────

describe('stripHtmlComments (via sanitizeBriefHtml)', () => {
  it('preserves the ACTION_RAIL_SLOT marker', () => {
    const html = '<div>Brief content</div><!-- ACTION_RAIL_SLOT --><div>More</div>';
    const result = sanitizeBriefHtml(html);
    expect(result).toContain('<!-- ACTION_RAIL_SLOT -->');
  });

  it('strips other HTML comments', () => {
    const html = '<div>Brief</div><!-- some debug info --><div>More</div>';
    const result = sanitizeBriefHtml(html);
    expect(result).not.toContain('<!-- some debug info -->');
    expect(result).toContain('Brief');
  });

  it('preserves ACTION_RAIL_SLOT while stripping other comments in the same string', () => {
    const html =
      '<!-- remove this --><div>Brief</div><!-- ACTION_RAIL_SLOT --><!-- also remove -->';
    const result = sanitizeBriefHtml(html);
    expect(result).toContain('<!-- ACTION_RAIL_SLOT -->');
    expect(result).not.toContain('<!-- remove this -->');
    expect(result).not.toContain('<!-- also remove -->');
  });
});
