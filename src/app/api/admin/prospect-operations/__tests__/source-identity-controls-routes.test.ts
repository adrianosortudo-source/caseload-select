import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const state: {
    session: { role: 'operator'; firm_id: string; lawyer_id: string; exp: number } | null;
    identityInput: unknown;
    controlsInput: unknown;
    sourceConversation: unknown;
  } = {
    session: null,
    identityInput: null,
    controlsInput: null,
    sourceConversation: { id: '22222222-2222-4222-8222-222222222222' },
  };
  const fns = {
    isProspectOperationsUuid: vi.fn((value: unknown) => typeof value === 'string' && value.startsWith('2')),
    validateIdentityAdjudicationInput: vi.fn(() => state.identityInput),
    createProspectIdentityAdjudication: vi.fn(() => Promise.resolve({ id: 'identity-1' })),
    listProspectIdentityAdjudications: vi.fn(() => Promise.resolve([])),
    getProspectIdentityResolution: vi.fn(() => Promise.resolve(null)),
    listProspectSourceContactStates: vi.fn(() => Promise.resolve([{ source_record_key: 'record-1' }])),
    getProspectSourceConversation: vi.fn(() => Promise.resolve(state.sourceConversation)),
    validateProspectConversationContactControlsInput: vi.fn(() => state.controlsInput),
    updateProspectConversationContactControls: vi.fn(() => Promise.resolve({
      conversation: { id: '22222222-2222-4222-8222-222222222222' },
      contactability: { state: 'suppressed' },
    })),
    validateProvisionProspectSourceRecordInput: vi.fn(() => ({ source_system: 'brazilian_owner_cohort' })),
    provisionProspectSourceRecord: vi.fn(() => Promise.resolve({ source_link_id: 'source-1', conversation_id: 'conversation-1' })),
  };
  return { state, fns };
});

vi.mock('@/lib/portal-auth', () => ({ getOperatorSession: () => Promise.resolve(h.state.session) }));
vi.mock('@/lib/prospect-operations', () => h.fns);

import { GET as identityGET, POST as identityPOST } from '../identity-adjudications/route';
import { POST as sourceStatesPOST } from '../source-states/route';
import { GET as sourceGET, PATCH as sourcePATCH } from '../conversations/source/route';
import { PATCH as conversationPATCH } from '../conversations/[conversation_id]/route';
import { POST as sourceProvisionPOST } from '../sources/provision/route';

const BASE = 'https://admin.caseloadselect.ca/api/admin/prospect-operations';
const SOURCE_LINK_ID = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

function asOperator() {
  h.state.session = { role: 'operator', firm_id: 'firm-1', lawyer_id: OPERATOR_ID, exp: Date.now() + 60_000 };
}

beforeEach(() => {
  h.state.session = null;
  h.state.identityInput = { source_link_id: SOURCE_LINK_ID, idempotency_key: 'identity:1' };
  h.state.controlsInput = { contactability: 'suppressed', suppression_reason: 'Requested no contact.' };
  h.state.sourceConversation = { id: SOURCE_LINK_ID };
  for (const fn of Object.values(h.fns)) fn.mockClear();
});

describe('source-state and source-conversation routes', () => {
  it('rejects unauthenticated reads before touching the data layer', async () => {
    const responses = await Promise.all([
      sourceStatesPOST(request('/source-states', 'POST', { source_system: 'agency_crm', source_record_keys: ['record-1'] })),
      sourceGET(request('/conversations/source?source_system=agency_crm&source_record_key=record-1')),
      identityGET(request(`/identity-adjudications?source_link_id=${SOURCE_LINK_ID}`)),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    expect(h.fns.listProspectSourceContactStates).not.toHaveBeenCalled();
    expect(h.fns.getProspectSourceConversation).not.toHaveBeenCalled();
    expect(h.fns.listProspectIdentityAdjudications).not.toHaveBeenCalled();
  });

  it('returns generic source states and its own source conversation', async () => {
    asOperator();
    const stateResponse = await sourceStatesPOST(request('/source-states', 'POST', {
      source_system: 'agency_crm', source_record_keys: ['record-1'],
    }));
    const conversationResponse = await sourceGET(request('/conversations/source?source_system=agency_crm&source_record_key=record-1&limit=50&offset=0'));
    expect(stateResponse.status).toBe(200);
    expect(await stateResponse.json()).toEqual({ states: [{ source_record_key: 'record-1' }] });
    expect(conversationResponse.status).toBe(200);
    expect(h.fns.getProspectSourceConversation).toHaveBeenCalledWith('agency_crm', 'record-1', { limit: 50, offset: 0 });
  });
});

describe('identity and contact-control writes', () => {
  it('records an explicit identity decision with the revalidated operator id', async () => {
    asOperator();
    const response = await identityPOST(request('/identity-adjudications', 'POST', { ignored: true }));
    expect(response.status).toBe(201);
    expect(h.fns.createProspectIdentityAdjudication).toHaveBeenCalledWith(h.state.identityInput, OPERATOR_ID);
  });

  it('provisions a fresh source only through the normalized first-party payload', async () => {
    asOperator();
    const response = await sourceProvisionPOST(request('/sources/provision', 'POST', { ignored: true }));
    expect(response.status).toBe(201);
    expect(h.fns.provisionProspectSourceRecord).toHaveBeenCalledWith(
      { source_system: 'brazilian_owner_cohort' },
      OPERATOR_ID,
    );
  });

  it('requires a valid UUID and validated controls for a direct conversation patch', async () => {
    asOperator();
    const invalid = await conversationPATCH(request('/conversations/not-a-uuid', 'PATCH', { contactability: 'eligible' }), {
      params: Promise.resolve({ conversation_id: 'not-a-uuid' }),
    });
    expect(invalid.status).toBe(400);

    const response = await conversationPATCH(request(`/conversations/${SOURCE_LINK_ID}`, 'PATCH', { contactability: 'suppressed' }), {
      params: Promise.resolve({ conversation_id: SOURCE_LINK_ID }),
    });
    expect(response.status).toBe(200);
    expect(h.fns.updateProspectConversationContactControls).toHaveBeenCalledWith(SOURCE_LINK_ID, h.state.controlsInput, OPERATOR_ID);
  });

  it('resolves the source before applying controls and returns 404 when it has no conversation', async () => {
    asOperator();
    h.state.sourceConversation = null;
    const response = await sourcePATCH(request('/conversations/source', 'PATCH', {
      source_system: 'agency_crm', source_record_key: 'record-1', contactability: 'suppressed', suppression_reason: 'Requested no contact.',
    }));
    expect(response.status).toBe(404);
    expect(h.fns.updateProspectConversationContactControls).not.toHaveBeenCalled();
  });
});
