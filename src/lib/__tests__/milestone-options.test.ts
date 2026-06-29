import { describe, it, expect } from 'vitest';
import { getMilestoneOptions, MILESTONE_OPTIONS, CUSTOM_MILESTONE_OPTION } from '../milestone-options';

describe('getMilestoneOptions', () => {
  it('returns real_estate milestones for real_estate', () => {
    const opts = getMilestoneOptions('real_estate');
    expect(opts).toBe(MILESTONE_OPTIONS['real_estate']);
    expect(opts).toContain('Conditions waived');
  });

  it('is case-insensitive and normalizes spaces to underscores', () => {
    expect(getMilestoneOptions('Real Estate')).toBe(MILESTONE_OPTIONS['real_estate']);
    expect(getMilestoneOptions('real-estate')).toBe(MILESTONE_OPTIONS['real_estate']);
  });

  it('returns employment milestones for employment', () => {
    expect(getMilestoneOptions('employment')).toBe(MILESTONE_OPTIONS['employment']);
  });

  it('returns estates milestones for estates', () => {
    expect(getMilestoneOptions('estates')).toBe(MILESTONE_OPTIONS['estates']);
  });

  it('falls back to general for unknown practice area', () => {
    expect(getMilestoneOptions('maritime_law')).toBe(MILESTONE_OPTIONS['general']);
    expect(getMilestoneOptions('')).toBe(MILESTONE_OPTIONS['general']);
  });

  it('returns non-empty arrays for all defined areas', () => {
    for (const [area, opts] of Object.entries(MILESTONE_OPTIONS)) {
      expect(opts.length, `${area} has no milestones`).toBeGreaterThan(0);
    }
  });

  it('CUSTOM_MILESTONE_OPTION is a non-empty string', () => {
    expect(typeof CUSTOM_MILESTONE_OPTION).toBe('string');
    expect(CUSTOM_MILESTONE_OPTION.length).toBeGreaterThan(0);
  });
});
