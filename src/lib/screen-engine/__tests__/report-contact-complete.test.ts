/**
 * Engine report — contact_complete field.
 *
 * Verifies that buildReport correctly derives `contact_complete` from
 * the engine state's contact slots.
 */

import { describe, it, expect } from 'vitest';
import { initialiseState } from '../extractor';
import { buildReport } from '../report';
import type { EngineState } from '../types';

function withSlot(state: EngineState, slotId: string, value: string | null): EngineState {
  return {
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: {
      ...state.slot_meta,
      [slotId]: { source: 'answered', confidence: 1.0 },
    },
  };
}

describe('buildReport contact_complete', () => {
  it('is false when no contact slots are populated', () => {
    const state = initialiseState('I need help with a shareholder dispute');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(false);
  });

  it('is false when only name is populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_name', 'Alex Lee');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(false);
  });

  it('is false when only email is populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_email', 'alex@example.com');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(false);
  });

  it('is false when only phone is populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_phone', '+1 416 555 0143');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(false);
  });

  it('is true when name + email are populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_name', 'Alex Lee');
    state = withSlot(state, 'client_email', 'alex@example.com');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(true);
  });

  it('is true when name + phone are populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_name', 'Alex Lee');
    state = withSlot(state, 'client_phone', '+1 416 555 0143');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(true);
  });

  it('is true when all three are populated', () => {
    let state = initialiseState('I need help with a shareholder dispute');
    state = withSlot(state, 'client_name', 'Alex Lee');
    state = withSlot(state, 'client_email', 'alex@example.com');
    state = withSlot(state, 'client_phone', '+1 416 555 0143');
    const report = buildReport(state);
    expect(report.contact_complete).toBe(true);
  });
});
