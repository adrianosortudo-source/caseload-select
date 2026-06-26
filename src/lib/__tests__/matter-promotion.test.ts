/**
 * Tests for matter-promotion.ts logPromotionEvent helper.
 *
 * The function is a best-effort DB write: it should never throw, and should
 * return null (not throw) on supabase failures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Supabase admin mock ---
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      insert: mockInsert,
    }),
  },
}));

// Wire the mock chain: insert(...).select('id').single()
function setInsertResult(result: { data: { id: string } | null; error: { message: string } | null }) {
  mockInsert.mockReturnValue({
    select: () => ({
      single: () => Promise.resolve(result),
    }),
  });
}

import { logPromotionEvent } from '@/lib/matter-promotion';

beforeEach(() => {
  vi.clearAllMocks();
});

const BASE = {
  screened_lead_id: 'sl-1',
  firm_id: 'f-1',
  lawyer_id: 'l-1',
};

describe('logPromotionEvent', () => {
  it('returns the inserted row id on success', async () => {
    setInsertResult({ data: { id: 'evt-1' }, error: null });
    const id = await logPromotionEvent({ ...BASE, event_type: 'take_recorded' });
    expect(id).toBe('evt-1');
  });

  it('returns null on supabase error (does not throw)', async () => {
    setInsertResult({ data: null, error: { message: 'insert failed' } });
    const id = await logPromotionEvent({ ...BASE, event_type: 'matter_failed', error_text: 'db error' });
    expect(id).toBeNull();
  });

  it('returns null when supabase throws unexpectedly (does not throw)', async () => {
    mockInsert.mockImplementation(() => { throw new Error('network'); });
    const id = await logPromotionEvent({ ...BASE, event_type: 'take_recorded' });
    expect(id).toBeNull();
  });

  it('passes matter_id through for matter_created events', async () => {
    setInsertResult({ data: { id: 'evt-2' }, error: null });
    await logPromotionEvent({ ...BASE, event_type: 'matter_created', matter_id: 'm-1' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ matter_id: 'm-1', event_type: 'matter_created' }),
    );
  });

  it('passes null matter_id for take_recorded (before matter exists)', async () => {
    setInsertResult({ data: { id: 'evt-3' }, error: null });
    await logPromotionEvent({ ...BASE, event_type: 'take_recorded' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ matter_id: null, event_type: 'take_recorded' }),
    );
  });

  it('passes error_text for matter_failed events', async () => {
    setInsertResult({ data: { id: 'evt-4' }, error: null });
    await logPromotionEvent({ ...BASE, event_type: 'matter_failed', error_text: 'unique constraint' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ error_text: 'unique constraint' }),
    );
  });
});
