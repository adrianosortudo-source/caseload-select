/**
 * Tests for the M1 canonical-model dual-write helpers (crm-dual-write.ts).
 * These are the write side of crm-dual-read.ts's already-shipped fallback
 * read layer: once these writes land, reads prefer the canonical rows with
 * no read-side changes needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => ({ insert: (row: unknown) => insertMock(table, row) }) },
}));

import { writePrimaryParty, writeActivity } from '@/lib/crm-dual-write';

describe('writePrimaryParty', () => {
  beforeEach(() => insertMock.mockReset());

  it('inserts a primary client party for the matter', async () => {
    insertMock.mockResolvedValue({ error: null });
    await writePrimaryParty({
      matterId: 'matter-1', firmId: 'firm-1', fullName: 'Ana Santos', email: 'ana@example.com', phone: '+14165551234',
    });
    expect(insertMock).toHaveBeenCalledWith('parties', expect.objectContaining({
      matter_id: 'matter-1', firm_id: 'firm-1', full_name: 'Ana Santos', email: 'ana@example.com', phone: '+14165551234',
      party_role: 'client', is_primary: true,
    }));
  });

  it('defaults party_role to client when not provided, honours an override', async () => {
    insertMock.mockResolvedValue({ error: null });
    await writePrimaryParty({ matterId: 'm', firmId: 'f', fullName: null, email: null, phone: null, partyRole: 'lawyer' });
    expect(insertMock.mock.calls[0][1].party_role).toBe('lawyer');
  });

  it('silently accepts a unique-violation (idempotent re-run)', async () => {
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(writePrimaryParty({ matterId: 'm', firmId: 'f', fullName: null, email: null, phone: null })).resolves.toBeUndefined();
  });

});

describe('writeActivity', () => {
  beforeEach(() => insertMock.mockReset());

  it('inserts an activity row with the given fields', async () => {
    insertMock.mockResolvedValue({ error: null });
    await writeActivity({
      matterId: 'matter-1', firmId: 'firm-1', activityType: 'stage_change',
      title: 'Stage: intake to retainer_pending', actorRole: 'staff',
      metadata: { from_stage: 'intake', to_stage: 'retainer_pending' },
    });
    expect(insertMock).toHaveBeenCalledWith('activities', expect.objectContaining({
      matter_id: 'matter-1', firm_id: 'firm-1', activity_type: 'stage_change',
      title: 'Stage: intake to retainer_pending', actor_role: 'staff',
      metadata: { from_stage: 'intake', to_stage: 'retainer_pending' },
    }));
  });

  it('defaults actor_role to system and occurred_at to now when omitted', async () => {
    insertMock.mockResolvedValue({ error: null });
    await writeActivity({ matterId: 'm', firmId: 'f', activityType: 'promotion', title: 'Matter created' });
    const row = insertMock.mock.calls[0][1];
    expect(row.actor_role).toBe('system');
    expect(row.body).toBeNull();
    expect(row.metadata).toBeNull();
    expect(typeof row.occurred_at).toBe('string');
  });

  it('never throws when the insert returns an error object', async () => {
    insertMock.mockResolvedValue({ error: { message: 'boom' } });
    await expect(writeActivity({ matterId: 'm', firmId: 'f', activityType: 'message', title: 't' })).resolves.toBeUndefined();
  });
});
