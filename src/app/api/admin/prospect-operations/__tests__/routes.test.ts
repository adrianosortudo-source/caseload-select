import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const state: {
    session: { role: 'operator'; firm_id: string; lawyer_id: string; exp: number } | null;
    validated: unknown;
    activity: unknown;
    conversation: unknown;
    report: unknown;
  } = {
    session: null,
    validated: null,
    activity: { id: 'activity-1' },
    conversation: { id: 'conversation-1' },
    report: { conversations: 0 },
  };
  const fns = {
    isProspectOperationsUuid: vi.fn((value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)),
    validateActivityInput: vi.fn(() => state.validated),
    createProspectActivity: vi.fn(() => Promise.resolve(state.activity)),
    getAgencyProspectConversation: vi.fn(() => Promise.resolve(state.conversation)),
    getProspectContactReport: vi.fn(() => Promise.resolve(state.report)),
  };
  return { state, fns };
});

vi.mock('@/lib/portal-auth', () => ({
  getOperatorSession: () => Promise.resolve(h.state.session),
}));
vi.mock('@/lib/prospect-operations', () => h.fns);

import { POST as activityPOST } from '../activities/route';
import { GET as conversationGET } from '../conversations/agency/[id]/route';
import { GET as reportGET } from '../report/route';

const BASE = 'https://admin.caseloadselect.ca/api/admin/prospect-operations';
const OPERATOR_FIRM_ID = '11111111-1111-1111-1111-111111111111';
const OPERATOR_ID = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';
const AGENCY_PROSPECT_ID = '33333333-3333-3333-3333-333333333333';

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
}

function rawRequest(path: string, body: string): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function asOperator() {
  h.state.session = { role: 'operator', firm_id: OPERATOR_FIRM_ID, lawyer_id: OPERATOR_ID, exp: Date.now() + 60_000 };
}

beforeEach(() => {
  h.state.session = null;
  h.state.validated = {
    conversation_id: CONVERSATION_ID,
    idempotency_key: 'manual:test-1',
    kind: 'message_sent',
    channel: 'email',
  };
  h.state.activity = { id: 'activity-1' };
  h.state.conversation = { id: CONVERSATION_ID };
  h.state.report = { conversations: 0 };
  for (const fn of Object.values(h.fns)) fn.mockClear();
});

describe('prospect operations operator guard', () => {
  it('returns 401 before every data-layer call', async () => {
    const responses = await Promise.all([
      activityPOST(request('/activities', 'POST', {
        conversation_id: CONVERSATION_ID,
        idempotency_key: 'manual:test-1',
        kind: 'message_sent',
        channel: 'email',
      })),
      conversationGET(request(`/conversations/agency/${AGENCY_PROSPECT_ID}`), params(AGENCY_PROSPECT_ID)),
      reportGET(),
    ]);

    for (const response of responses) expect(response.status).toBe(401);
    expect(h.fns.validateActivityInput).not.toHaveBeenCalled();
    expect(h.fns.createProspectActivity).not.toHaveBeenCalled();
    expect(h.fns.getAgencyProspectConversation).not.toHaveBeenCalled();
    expect(h.fns.getProspectContactReport).not.toHaveBeenCalled();
  });
});

describe('prospect activity route', () => {
  beforeEach(asOperator);

  it('returns 400 for invalid JSON before validation', async () => {
    const response = await activityPOST(rawRequest('/activities', '{'));
    expect(response.status).toBe(400);
    expect(h.fns.validateActivityInput).not.toHaveBeenCalled();
    expect(h.fns.createProspectActivity).not.toHaveBeenCalled();
  });

  it('returns 400 when activity validation fails', async () => {
    h.state.validated = null;
    const response = await activityPOST(request('/activities', 'POST', { kind: 'reply' }));
    expect(response.status).toBe(400);
    expect(h.fns.createProspectActivity).not.toHaveBeenCalled();
  });

  it('maps an idempotency collision to 409', async () => {
    h.fns.createProspectActivity.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint prospect_activities_idempotency_unique'),
    );
    const response = await activityPOST(request('/activities', 'POST', {
      conversation_id: CONVERSATION_ID,
      idempotency_key: 'manual:test-1',
      kind: 'message_sent',
      channel: 'email',
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/idempotency|duplicate key/i);
  });

  it('creates only the normalized input returned by the validator', async () => {
    const normalized = {
      conversation_id: CONVERSATION_ID,
      idempotency_key: 'manual:test-1',
      kind: 'message_sent',
      channel: 'email',
      to_endpoints: ['susana@example.ca'],
    };
    h.state.validated = normalized;
    const response = await activityPOST(request('/activities', 'POST', {
      ...normalized,
      body: 'untrusted raw value',
    }));
    expect(response.status).toBe(201);
    expect(h.fns.createProspectActivity).toHaveBeenCalledWith(normalized, OPERATOR_ID);
  });
});

describe('prospect conversation and report routes', () => {
  beforeEach(asOperator);

  it('returns 400 before lookup when the agency prospect id is not a UUID', async () => {
    const response = await conversationGET(
      request('/conversations/agency/not-a-uuid'),
      params('not-a-uuid'),
    );
    expect(response.status).toBe(400);
    expect(h.fns.getAgencyProspectConversation).not.toHaveBeenCalled();
  });

  it('returns 404 for an agency prospect without an operational conversation', async () => {
    h.state.conversation = null;
    const response = await conversationGET(
      request(`/conversations/agency/${AGENCY_PROSPECT_ID}`),
      params(AGENCY_PROSPECT_ID),
    );
    expect(response.status).toBe(404);
  });

  it('returns the report without reclassifying automated replies', async () => {
    h.state.report = {
      conversations: 2,
      messages_sent: 2,
      human_replies: 1,
      automated_replies: 3,
      bounces: 1,
    };
    const response = await reportGET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report: h.state.report });
  });
});
