import { describe, it, expect } from 'vitest';
import { checkStageGate, type GateMatterInput } from '@/lib/matter-stage-gate';

function matter(overrides: Partial<GateMatterInput> = {}): GateMatterInput {
  return {
    id: 'm-1',
    source_screened_lead_id: 'sl-1',
    primary_name: 'Jane Doe',
    primary_email: 'jane@example.com',
    primary_phone: null,
    ...overrides,
  };
}

describe('checkStageGate: retainer_pending contact gate', () => {
  it('full contact (name + email): allowed', async () => {
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('name + phone only (no email): allowed', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: '416-555-0001' }), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('name + email only (no phone): allowed', async () => {
    const r = await checkStageGate(matter({ primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('missing primary_name: blocked (missing_contact_info)', async () => {
    const r = await checkStageGate(matter({ primary_name: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('whitespace-only primary_name: blocked', async () => {
    const r = await checkStageGate(matter({ primary_name: '   ' }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('name present but no email and no phone: blocked', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('name present, whitespace email and null phone: blocked', async () => {
    const r = await checkStageGate(matter({ primary_email: '   ', primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });
});

describe('checkStageGate: stages without contact gate', () => {
  it('retainer_pending -> active: no contact check, allowed even without contact', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: null }), 'active');
    expect(r.allowed).toBe(true);
  });

  it('active -> closing: allowed', async () => {
    const r = await checkStageGate(matter(), 'closing');
    expect(r.allowed).toBe(true);
  });

  it('closing -> closed: allowed', async () => {
    const r = await checkStageGate(matter(), 'closed');
    expect(r.allowed).toBe(true);
  });

  it('intake stage (should not normally be a target): allowed (no gate defined)', async () => {
    const r = await checkStageGate(matter(), 'intake');
    expect(r.allowed).toBe(true);
  });
});

describe('checkStageGate: stub gates return allowed', () => {
  it('conflict and consent stubs pass through', async () => {
    // No conflict or consent data available; both stubs return allowed.
    const r = await checkStageGate(matter({ source_screened_lead_id: null }), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });
});
