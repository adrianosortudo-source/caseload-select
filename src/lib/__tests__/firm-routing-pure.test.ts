/**
 * Tests for firm-routing-pure.ts — the shared lead-resolution + validation
 * used by both the live take path (matter-stage) and the operator routing UI.
 * Resolution semantics here are load-bearing: they must match what a real
 * Band A take produces.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMatterLead,
  resolveMatterLeadWithSource,
  resolveMatterAssignees,
  validateRoutingConfig,
  ROUTING_PRACTICE_AREAS,
  type RoutingConfigDraft,
} from '../firm-routing-pure';

const LEAD_EMP = 'lawyer-emp';
const LEAD_FALLBACK = 'lawyer-fallback';

describe('resolveMatterLead — matches the take-path resolution order', () => {
  const config = {
    default_lead_by_practice_area: { employment: LEAD_EMP },
    default_lead_id: LEAD_FALLBACK,
    default_assignees: [],
  };

  it('uses the practice-area default when one is set for the area', () => {
    expect(resolveMatterLead(config, 'employment')).toBe(LEAD_EMP);
  });

  it('falls back to default_lead_id when the area has no specific default', () => {
    expect(resolveMatterLead(config, 'corporate')).toBe(LEAD_FALLBACK);
  });

  it('returns null when neither a PA default nor a fallback exists', () => {
    expect(resolveMatterLead({ default_lead_by_practice_area: {}, default_lead_id: null }, 'corporate')).toBeNull();
  });

  it('handles null / undefined config and practice area', () => {
    expect(resolveMatterLead(null, 'employment')).toBeNull();
    expect(resolveMatterLead(undefined, null)).toBeNull();
    expect(resolveMatterLead(config, null)).toBe(LEAD_FALLBACK); // no PA -> fallback
  });
});

describe('resolveMatterLeadWithSource — for the honest "what happens now" preview', () => {
  const config = {
    default_lead_by_practice_area: { employment: LEAD_EMP },
    default_lead_id: LEAD_FALLBACK,
  };

  it('reports practice_area source for a PA-specific match', () => {
    expect(resolveMatterLeadWithSource(config, 'employment')).toEqual({
      leadId: LEAD_EMP,
      source: 'practice_area',
    });
  });

  it('reports firm_fallback source when falling through', () => {
    expect(resolveMatterLeadWithSource(config, 'real_estate')).toEqual({
      leadId: LEAD_FALLBACK,
      source: 'firm_fallback',
    });
  });

  it('reports none when nothing resolves', () => {
    expect(
      resolveMatterLeadWithSource({ default_lead_by_practice_area: {}, default_lead_id: null }, 'real_estate'),
    ).toEqual({ leadId: null, source: 'none' });
  });
});

describe('resolveMatterAssignees', () => {
  it('returns the array as-is', () => {
    expect(resolveMatterAssignees({ default_assignees: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  it('returns [] for null / non-array', () => {
    expect(resolveMatterAssignees({ default_assignees: null })).toEqual([]);
    expect(resolveMatterAssignees(null)).toEqual([]);
    expect(resolveMatterAssignees({})).toEqual([]);
  });
});

describe('validateRoutingConfig', () => {
  const valid = new Set([LEAD_EMP, LEAD_FALLBACK, 'a', 'b']);

  function draft(over: Partial<RoutingConfigDraft> = {}): RoutingConfigDraft {
    return {
      default_lead_by_practice_area: {},
      default_lead_id: null,
      default_assignees: [],
      ...over,
    };
  }

  it('accepts a fully valid config and normalizes it', () => {
    const res = validateRoutingConfig(
      draft({
        default_lead_by_practice_area: { employment: LEAD_EMP },
        default_lead_id: LEAD_FALLBACK,
        default_assignees: ['a', 'b'],
      }),
      valid,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.normalized.default_lead_by_practice_area).toEqual({ employment: LEAD_EMP });
      expect(res.normalized.default_lead_id).toBe(LEAD_FALLBACK);
      expect(res.normalized.default_assignees).toEqual(['a', 'b']);
    }
  });

  it('drops blank practice-area defaults from the normalized map', () => {
    const res = validateRoutingConfig(
      draft({ default_lead_by_practice_area: { employment: LEAD_EMP, corporate: '', estates: '  ' } }),
      valid,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.normalized.default_lead_by_practice_area).toEqual({ employment: LEAD_EMP });
    }
  });

  it('de-duplicates assignees', () => {
    const res = validateRoutingConfig(draft({ default_assignees: ['a', 'a', 'b', 'b'] }), valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.normalized.default_assignees).toEqual(['a', 'b']);
  });

  it('treats blank default_lead_id as null', () => {
    const res = validateRoutingConfig(draft({ default_lead_id: '   ' }), valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.normalized.default_lead_id).toBeNull();
  });

  it('rejects a practice-area lead that is not a firm lawyer', () => {
    const res = validateRoutingConfig(
      draft({ default_lead_by_practice_area: { employment: 'stranger' } }),
      valid,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/employment/);
  });

  it('rejects a fallback lead that is not a firm lawyer', () => {
    const res = validateRoutingConfig(draft({ default_lead_id: 'stranger' }), valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/fallback/i);
  });

  it('rejects an assignee that is not a firm lawyer', () => {
    const res = validateRoutingConfig(draft({ default_assignees: ['a', 'stranger'] }), valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/assignee/i);
  });

  it('rejects an unknown practice-area key', () => {
    const res = validateRoutingConfig(
      draft({ default_lead_by_practice_area: { not_a_real_area: LEAD_EMP } }),
      valid,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toMatch(/Unknown practice area/i);
  });

  it('de-dupes identical error messages', () => {
    const res = validateRoutingConfig(
      draft({ default_assignees: ['x', 'y'] }), // both invalid -> same message
      valid,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const assigneeErrors = res.errors.filter((e) => /assignee/i.test(e));
      expect(assigneeErrors.length).toBe(1);
    }
  });
});

describe('ROUTING_PRACTICE_AREAS', () => {
  it('covers the real practice areas and excludes the unknown catch-all', () => {
    expect(ROUTING_PRACTICE_AREAS).toContain('employment');
    expect(ROUTING_PRACTICE_AREAS).toContain('estates');
    expect(ROUTING_PRACTICE_AREAS).not.toContain('unknown');
  });
});
