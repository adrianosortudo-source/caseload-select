/**
 * H1 axis-input manifest: the "tested" half. Three guards (spec section 6):
 *   1. drift: re-deriving from band.ts equals the committed manifest.
 *   2. exists: every manifest slotId is a real slot in slotRegistry.
 *   3. missing: a fixture lead's missing-field list equals its unanswered
 *      manifest slots (and answered slots are excluded).
 * Plus a coverage check that every in-scope matter type has an entry.
 *
 * To regenerate the committed manifest after a scorer change, the derive
 * helper is the single source of truth (axis-input-manifest-derive.ts).
 */
import { describe, it, expect } from 'vitest';
import { deriveAxisInputManifest } from './axis-input-manifest-derive';
import {
  AXIS_INPUT_MANIFEST,
  UNIVERSAL_CONTACT_SLOT_IDS,
  manifestSlotsForMatter,
  missingSlotsForMatter,
  type SlotRef,
} from '@/lib/scoring-axis-manifest';
import { SLOT_REGISTRY, IN_SCOPE_MATTER_TYPES } from '@/lib/screen-engine/slotRegistry';
import type { EngineState, MatterType } from '@/lib/screen-engine/types';

function allManifestRefs(): SlotRef[] {
  return Object.values(AXIS_INPUT_MANIFEST).flatMap((entry) => [
    ...entry!.value,
    ...entry!.complexity,
    ...entry!.urgency,
    ...entry!.readiness,
  ]);
}

/** Minimal EngineState for the consumer: it only reads matter_type + slots. */
function fixtureState(matterType: MatterType, slots: Record<string, string>): EngineState {
  return { matter_type: matterType, slots } as unknown as EngineState;
}

describe('axis-input manifest: drift guard', () => {
  it('re-deriving from band.ts equals the committed manifest', () => {
    expect(deriveAxisInputManifest()).toEqual(AXIS_INPUT_MANIFEST);
  });
});

describe('axis-input manifest: slot existence', () => {
  const registryById = new Map(SLOT_REGISTRY.map((s) => [s.id, s]));

  it('every manifest slot exists in slotRegistry with a matching label', () => {
    for (const ref of allManifestRefs()) {
      const slot = registryById.get(ref.slotId);
      expect(slot, `slot ${ref.slotId} missing from registry`).toBeDefined();
      expect(ref.label).toBe(slot!.question);
    }
  });

  it('the universal contact slots all exist', () => {
    for (const id of UNIVERSAL_CONTACT_SLOT_IDS) {
      expect(registryById.has(id), `contact slot ${id} missing from registry`).toBe(true);
    }
    expect(UNIVERSAL_CONTACT_SLOT_IDS.length).toBeGreaterThan(0);
  });
});

describe('axis-input manifest: coverage', () => {
  it('every in-scope matter type has a manifest entry with all four axes', () => {
    for (const matter of IN_SCOPE_MATTER_TYPES) {
      const entry = AXIS_INPUT_MANIFEST[matter];
      expect(entry, `no manifest entry for ${matter}`).toBeDefined();
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('complexity');
      expect(entry).toHaveProperty('urgency');
      expect(entry).toHaveProperty('readiness');
    }
  });

  it('binds the value axis to matter-specific slots, not the legacy estimated_value', () => {
    // The exact H1 risk: employment value comes from salary_band, not estimated_value.
    const wd = manifestSlotsForMatter('wrongful_dismissal').map((r) => r.slotId);
    expect(wd).toContain('salary_band');
    expect(wd).not.toContain('estimated_value');
  });
});

describe('axis-input manifest: missing fields == unanswered manifest slots', () => {
  it('excludes answered slots and lists the rest (wrongful_dismissal)', () => {
    const answered = { salary_band: 'Over $150,000', client_name: 'Sarah Example' };
    const state = fixtureState('wrongful_dismissal', answered);

    const all = manifestSlotsForMatter('wrongful_dismissal').map((r) => r.slotId);
    const missing = missingSlotsForMatter(state).map((r) => r.slotId);
    const expected = all.filter((id) => !(id in answered));

    expect(new Set(missing)).toEqual(new Set(expected));
    // answered slots are not asked again
    expect(missing).not.toContain('salary_band');
    expect(missing).not.toContain('client_name');
    // representative unanswered slots are surfaced
    expect(missing).toContain('tenure_band');
    expect(missing).toContain('client_email');
  });

  it('an all-empty lead is missing every manifest slot', () => {
    const state = fixtureState('commercial_real_estate', {});
    const all = manifestSlotsForMatter('commercial_real_estate').map((r) => r.slotId).sort();
    const missing = missingSlotsForMatter(state).map((r) => r.slotId).sort();
    expect(missing).toEqual(all);
  });

  it('treats whitespace-only answers as unanswered', () => {
    const state = fixtureState('commercial_real_estate', { commercial_re_amount: '   ' });
    const missing = missingSlotsForMatter(state).map((r) => r.slotId);
    expect(missing).toContain('commercial_re_amount');
  });
});
