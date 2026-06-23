/**
 * Tests for transitionMatterStage (launch-audit fix H3).
 *
 * The DR-049 cadence map used to fire triggerSequence with the
 * screened_leads UUID, which the send processor resolved against the
 * legacy leads table, so every scheduled email_sequences row was skipped
 * and the cadences silently delivered nothing. Stage transitions now
 * enqueue a matter_stage_changed GHL webhook through the outbox path.
 *
 * Coverage:
 *   - each forward transition enqueues the webhook with the right action,
 *     idempotency key, and DR-049 cadence trigger
 *   - webhook failure (delivery, enqueue, throw) never blocks the stage
 *     write; enqueue failures are loud (console.error with the matter id)
 *   - no email_sequences insert happens and triggerSequence is never called
 *
 * We mock supabase-admin and ghl-webhook (delivery only); the payload
 * builder is the real ghl-webhook-pure implementation so the asserted
 * payloads are the production shapes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MatterStage } from '../types';

vi.mock('server-only', () => ({}));

const MATTER_ID = '7c0a4e9b-2f31-4d55-9be2-6f6f1f1d2ab3';
const FIRM_ID = '1f5a2391-85d8-45a2-b427-90441e78a93c';
const SOURCE_UUID = 'f37b1d80-9a51-4f3c-8a44-1f9adfe1c001';

interface MockMatterRow {
  id: string;
  firm_id: string;
  matter_stage: MatterStage;
  source_screened_lead_id: string | null;
  matter_type: string;
  practice_area: string;
  primary_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}

interface MockState {
  matterRow: MockMatterRow | null;
  matterFetchError: { message: string } | null;
  updateError: { message: string } | null;
  eventInsertError: { message: string } | null;
  sourceLeadRow: { lead_id: string; intake_language: string | null } | null;
  inserts: Array<{ table: string; values: unknown }>;
}

const state: MockState = {
  matterRow: null,
  matterFetchError: null,
  updateError: null,
  eventInsertError: null,
  sourceLeadRow: null,
  inserts: [],
};

const deliverWebhookMock = vi.hoisted(() => vi.fn());
const triggerSequenceMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (_cols: string) => {
        const chain = {
          eq: () => chain,
          maybeSingle: () => {
            if (table === 'client_matters') {
              return Promise.resolve({ data: state.matterRow, error: state.matterFetchError });
            }
            if (table === 'screened_leads') {
              return Promise.resolve({ data: state.sourceLeadRow, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
      update: (_patch: unknown) => {
        // Supports the guarded shape update().eq('id').eq('matter_stage').select('id')
        // as well as a bare awaited update().eq().
        const result = {
          data: state.updateError ? null : [{ id: MATTER_ID }],
          error: state.updateError,
        };
        const chain: {
          eq: () => typeof chain;
          select: () => Promise<typeof result>;
          then: (onF: (v: typeof result) => unknown, onR?: (e: unknown) => unknown) => Promise<unknown>;
        } = {
          eq: () => chain,
          select: () => Promise.resolve(result),
          then: (onF, onR) => Promise.resolve(result).then(onF, onR),
        };
        return chain;
      },
      insert: (values: unknown) => {
        state.inserts.push({ table, values });
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: state.eventInsertError ? null : { id: 'event-1' },
                error: state.eventInsertError,
              }),
          }),
        };
      },
    }),
  },
}));

vi.mock('@/lib/ghl-webhook', () => ({
  deliverWebhook: deliverWebhookMock,
}));

// matter-stage.ts no longer imports sequence-engine at all; this mock
// exists so a regression that reintroduces the dead triggerSequence path
// fails the not-called assertion instead of hitting the real module.
vi.mock('@/lib/sequence-engine', () => ({
  triggerSequence: triggerSequenceMock,
}));

import { transitionMatterStage } from '../matter-stage';
import type { MatterStageChangedPayload } from '../ghl-webhook-pure';

function matterRow(overrides: Partial<MockMatterRow> = {}): MockMatterRow {
  return {
    id: MATTER_ID,
    firm_id: FIRM_ID,
    matter_stage: 'intake',
    source_screened_lead_id: SOURCE_UUID,
    matter_type: 'shareholder_dispute',
    practice_area: 'corporate',
    primary_name: 'Jordan Reyes',
    primary_email: 'jreyes@example.com',
    primary_phone: '+14165550000',
    ...overrides,
  };
}

function transition(to: MatterStage) {
  return transitionMatterStage({
    matter_id: MATTER_ID,
    to,
    actor_role: 'admin',
    actor_id: 'lawyer-1',
    note: null,
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.matterRow = null;
  state.matterFetchError = null;
  state.updateError = null;
  state.eventInsertError = null;
  state.sourceLeadRow = { lead_id: 'L-2026-05-22-SX4', intake_language: 'pt' };
  state.inserts = [];
  deliverWebhookMock.mockReset();
  deliverWebhookMock.mockResolvedValue({ fired: true, outbox_id: 'ob-1', already_in_flight: false });
  triggerSequenceMock.mockReset();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('transitionMatterStage: webhook enqueue (H3)', () => {
  it('enqueues matter_stage_changed with the right key + trigger on intake to retainer_pending', async () => {
    state.matterRow = matterRow();
    const result = await transition('retainer_pending');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe('intake');
    expect(result.to).toBe('retainer_pending');
    expect(result.webhook).toEqual({ enqueued: true, delivered: true, reason: null });

    expect(deliverWebhookMock).toHaveBeenCalledTimes(1);
    const payload = deliverWebhookMock.mock.calls[0][0] as MatterStageChangedPayload;
    expect(payload.action).toBe('matter_stage_changed');
    expect(payload.idempotency_key).toBe(`${MATTER_ID}:stage:retainer_pending`);
    expect(payload.firm_id).toBe(FIRM_ID);
    expect(payload.lead_id).toBe('L-2026-05-22-SX4');
    expect(payload.intake_language).toBe('pt');
    expect(payload.matter_stage_changed.cadence_trigger).toBe('retainer_awaiting');
    expect(payload.matter_stage_changed.source_screened_lead_id).toBe(SOURCE_UUID);
    expect(payload.matter_stage_changed.actor_role).toBe('admin');
    expect(payload.matter_stage_changed.primary_name).toBe('Jordan Reyes');
  });

  it('maps every forward transition to its DR-049 cadence trigger', async () => {
    const cases: Array<{ from: MatterStage; to: MatterStage; trigger: string }> = [
      { from: 'intake', to: 'retainer_pending', trigger: 'retainer_awaiting' },
      { from: 'retainer_pending', to: 'active', trigger: 'client_won' },
      { from: 'active', to: 'closing', trigger: 'review_request' },
      { from: 'closing', to: 'closed', trigger: 'relationship_milestone' },
    ];
    for (const c of cases) {
      deliverWebhookMock.mockClear();
      state.matterRow = matterRow({ matter_stage: c.from });
      const result = await transition(c.to);
      expect(result.ok).toBe(true);
      expect(deliverWebhookMock).toHaveBeenCalledTimes(1);
      const payload = deliverWebhookMock.mock.calls[0][0] as MatterStageChangedPayload;
      expect(payload.matter_stage_changed.cadence_trigger).toBe(c.trigger);
      expect(payload.idempotency_key).toBe(`${MATTER_ID}:stage:${c.to}`);
    }
  });

  it('never calls triggerSequence and never inserts email_sequences rows', async () => {
    state.matterRow = matterRow();
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    expect(triggerSequenceMock).not.toHaveBeenCalled();
    expect(state.inserts.map((i) => i.table)).not.toContain('email_sequences');
    // The audit event still lands.
    expect(state.inserts.map((i) => i.table)).toContain('matter_stage_events');
  });

  it('falls back to the matter UUID + en when the source lead row is missing', async () => {
    state.matterRow = matterRow();
    state.sourceLeadRow = null;
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    const payload = deliverWebhookMock.mock.calls[0][0] as MatterStageChangedPayload;
    expect(payload.lead_id).toBe(MATTER_ID);
    expect(payload.intake_language).toBe('en');
    expect(payload.matter_stage_changed.source_screened_lead_id).toBe(SOURCE_UUID);
  });

  it('webhook delivery failure with an outbox row does not block the transition and is not loud', async () => {
    state.matterRow = matterRow();
    deliverWebhookMock.mockResolvedValue({ fired: false, reason: 'http 500', outbox_id: 'ob-1' });
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.webhook).toEqual({ enqueued: true, delivered: false, reason: 'http 500' });
    // Outbox retry owns delivery; nothing to escalate.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('enqueue failure (no outbox row) does not block the transition but console.errors with the matter id', async () => {
    state.matterRow = matterRow();
    deliverWebhookMock.mockResolvedValue({ fired: false, reason: 'outbox enqueue failed' });
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.webhook).toEqual({ enqueued: false, delivered: false, reason: 'outbox enqueue failed' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain(MATTER_ID);
  });

  it('an unconfigured webhook URL is the documented skip-silently case (no console.error)', async () => {
    state.matterRow = matterRow();
    deliverWebhookMock.mockResolvedValue({ fired: false, reason: 'ghl_webhook_url not configured' });
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.webhook).toEqual({
      enqueued: false,
      delivered: false,
      reason: 'ghl_webhook_url not configured',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a deliverWebhook throw does not roll back the stage write', async () => {
    state.matterRow = matterRow();
    deliverWebhookMock.mockRejectedValue(new Error('boom'));
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe('intake');
    expect(result.to).toBe('retainer_pending');
    expect(result.webhook).toEqual({ enqueued: false, delivered: false, reason: 'boom' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain(MATTER_ID);
  });
});

describe('transitionMatterStage: guards fire no webhook', () => {
  it('invalid transition: no webhook, no sequence', async () => {
    state.matterRow = matterRow({ matter_stage: 'intake' });
    const result = await transition('closed');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_transition');
    expect(deliverWebhookMock).not.toHaveBeenCalled();
    expect(triggerSequenceMock).not.toHaveBeenCalled();
  });

  it('matter not found: no webhook', async () => {
    state.matterRow = null;
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_found');
    expect(deliverWebhookMock).not.toHaveBeenCalled();
  });

  it('stage update failure: no webhook (DB write comes first)', async () => {
    state.matterRow = matterRow();
    state.updateError = { message: 'write failed' };
    const result = await transition('retainer_pending');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('db_error');
    expect(deliverWebhookMock).not.toHaveBeenCalled();
  });
});
