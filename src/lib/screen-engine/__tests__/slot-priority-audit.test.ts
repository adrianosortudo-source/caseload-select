/**
 * Slot priority audit (Task #102) — pins the operator's product
 * judgement about invasive questions on Meta channels.
 *
 * Operator feedback 2026-05-24: "Percentage of the company: too
 * specific question. No go. Same category as asking for names. We
 * dont do that." Reviewed all 6 free_text slots in slotRegistry —
 * 4 are contact (name/phone/email/postal, required by contact-
 * doctrine DR-038), 1 is location (justified, firm needs region),
 * leaving 1 actually-invasive: ownership_percentage. The 9 dollar-
 * amount slots use chip-friendly single_select ranges with a "Not
 * sure" escape — appropriate, not demoted.
 *
 * These tests pin the demotion so a future contributor doesn't
 * silently re-promote ownership_percentage to tier='core' without
 * reading the doctrine comment in slotRegistry.ts.
 */

import { describe, it, expect } from 'vitest';
import { SLOT_REGISTRY } from '../slotRegistry';
import { getExtractableSlots } from '../llm/schema';

describe('Slot priority audit — ownership_percentage demoted', () => {
  const slot = SLOT_REGISTRY.find((s) => s.id === 'ownership_percentage');

  it('is in the registry (not deleted — retained for back-compat)', () => {
    expect(slot).toBeDefined();
  });

  it('is tier=qualification (not core) — blocked from LLM by default', () => {
    expect(slot?.tier).toBe('qualification');
  });

  it('has llm_extractable: false (belt-and-suspenders)', () => {
    expect(slot?.llm_extractable).toBe(false);
  });

  it('has priority 999 — ranked below every other slot in the selector', () => {
    expect(slot?.priority).toBe(999);
  });

  it('does NOT appear in getExtractableSlots(shareholder_dispute)', () => {
    // The LLM schema for shareholder_dispute must not include
    // ownership_percentage. Gemini never sees this slot, never
    // extracts it, never hallucinates a value.
    const slots = getExtractableSlots('shareholder_dispute');
    const ids = slots.map((s) => s.id);
    expect(ids).not.toContain('ownership_percentage');
  });

  it('stays in applies_to for shareholder_dispute (registry record only)', () => {
    // Kept in applies_to so brief generators that historically
    // consumed this slot don't error on undefined access. The slot
    // simply never gets filled now.
    expect(slot?.applies_to).toContain('shareholder_dispute');
  });
});

describe('Slot priority audit — free_text inventory', () => {
  it('the only invasive free_text slot is ownership_percentage', () => {
    // Lock the audit conclusion: out of all free_text slots, the
    // only one asking for a sensitive specific number is
    // ownership_percentage. Contact slots are required for
    // reachability; business_location asks for a city/region.
    const freeText = SLOT_REGISTRY.filter((s) => s.input_type === 'free_text');
    const ids = freeText.map((s) => s.id).sort();
    expect(ids).toEqual([
      'business_location',
      'client_email',
      'client_name',
      'client_phone',
      'client_postal_code',
      'ownership_percentage',
    ]);
  });
});
