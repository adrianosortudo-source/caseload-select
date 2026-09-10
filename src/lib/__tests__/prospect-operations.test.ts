import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

const h = vi.hoisted(() => {
  const results: Record<string, QueryResult> = {
    prospect_conversations: { data: [], error: null },
    prospect_activities: { data: [], error: null },
    prospect_contactability: { data: [], error: null },
  };
  const range = vi.fn((table: string, start: number, end: number) => {
    const result = results[table] ?? { data: [], error: null };
    return Promise.resolve({
      data: result.data?.slice(start, end + 1) ?? null,
      error: result.error,
    });
  });
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      range: (start: number, end: number) => range(table, start, end),
    })),
  }));
  return { results, supabaseAdmin: { from }, from, range };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: h.supabaseAdmin }));

import {
  getProspectContactReport,
  validateActivityInput,
  validateIdentityAdjudicationInput,
  validateProvisionProspectSourceRecordInput,
  validateProspectConversationContactControlsInput,
} from '@/lib/prospect-operations';

beforeEach(() => {
  h.from.mockClear();
  h.range.mockClear();
  h.results.prospect_conversations = { data: [], error: null };
  h.results.prospect_activities = { data: [], error: null };
  h.results.prospect_contactability = { data: [], error: null };
});

describe('validateActivityInput', () => {
  const conversationId = '11111111-1111-1111-1111-111111111111';
  const valid = {
    conversation_id: conversationId,
    idempotency_key: 'gmail:message-123',
    kind: 'message_sent',
    channel: 'email',
    to_endpoints: ['susana@example.ca'],
  };

  it('requires an idempotency key and controlled enum values', () => {
    expect(validateActivityInput({ ...valid, conversation_id: 'conversation-1' })).toBeNull();
    expect(validateActivityInput({ ...valid, idempotency_key: '' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'reply' })).toBeNull();
    expect(validateActivityInput({ ...valid, channel: 'gmail' })).toBeNull();
    expect(validateActivityInput({ ...valid, delivery_status: 'opened' })).toBeNull();
    expect(validateActivityInput({ ...valid, response_kind: 'positive' })).toBeNull();
    expect(validateActivityInput({ ...valid, reply_disposition: 'automated' })).toBeNull();
  });

  it('rejects invalid timestamps and malformed endpoint lists', () => {
    expect(validateActivityInput({ ...valid, occurred_at: 'not-a-date' })).toBeNull();
    expect(validateActivityInput({ ...valid, to_endpoints: ['valid@example.ca', 42] })).toBeNull();
    expect(validateActivityInput({ ...valid, to_endpoints: ['   '] })).toBeNull();
    expect(validateActivityInput({ ...valid, to_endpoints: ['x'.repeat(321)] })).toBeNull();
  });

  it('rejects contradictory event classifications', () => {
    expect(validateActivityInput({ ...valid, kind: 'message_sent', response_kind: 'human' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'message_sent', delivery_status: 'bounced' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'message_sent', delivery_status: 'failed' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'human_reply', response_kind: 'automated' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'bounce', delivery_status: 'delivered' })).toBeNull();
    expect(validateActivityInput({ ...valid, kind: 'automated_reply', reply_disposition: 'positive' })).toBeNull();
  });

  it('trims identifiers, endpoints, and message text without inventing evidence', () => {
    expect(validateActivityInput({
      ...valid,
      conversation_id: ` ${conversationId} `,
      idempotency_key: ' gmail:message-123 ',
      subject: ' Hello ',
      body: ' Body ',
      to_endpoints: [' susana@example.ca '],
    })).toMatchObject({
      conversation_id: conversationId,
      idempotency_key: 'gmail:message-123',
      subject: 'Hello',
      body: 'Body',
      to_endpoints: ['susana@example.ca'],
    });
  });
});

describe('validateIdentityAdjudicationInput', () => {
  const sourceLinkId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const personId = '33333333-3333-4333-8333-333333333333';
  const valid = {
    source_link_id: sourceLinkId,
    decision: 'confirmed_link',
    canonical_organization_id: organizationId,
    canonical_person_id: personId,
    adjudication_basis: 'The linked public bio identifies the same person and firm.',
    evidence_url: 'https://example.test/bio',
    idempotency_key: 'operator:identity:1',
  };

  it('requires explicit IDs, an allowed decision, a rationale, and a safe evidence URL', () => {
    expect(validateIdentityAdjudicationInput({ ...valid, source_link_id: 'source-1' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, canonical_organization_id: 'firm-1' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, canonical_person_id: 'person-1' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, decision: 'auto_merge' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, adjudication_basis: ' ' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, evidence_url: 'mailto:person@example.test' })).toBeNull();
    expect(validateIdentityAdjudicationInput({ ...valid, idempotency_key: '' })).toBeNull();
  });

  it('normalizes explicit input but does not derive an identity from a name or email', () => {
    expect(validateIdentityAdjudicationInput({
      ...valid,
      adjudication_basis: ' Source-backed review. ',
      evidence_url: 'https://example.test/bio',
      canonical_person_id: null,
    })).toMatchObject({
      source_link_id: sourceLinkId,
      canonical_organization_id: organizationId,
      canonical_person_id: null,
      adjudication_basis: 'Source-backed review.',
    });
    expect(validateIdentityAdjudicationInput({
      source_link_id: sourceLinkId,
      decision: 'confirmed_link',
      canonical_organization_id: organizationId,
      adjudication_basis: 'Name and email happened to match.',
      idempotency_key: 'operator:identity:2',
    })).toBeTruthy();
  });
});

describe('source provisioning and contact controls', () => {
  const provision = {
    source_system: 'brazilian_owner_cohort',
    source_record_key: 'BAO-P-000123',
    source_url: 'https://example.test/team/person',
    source_payload: { public_name: 'Example Person', language: 'Portuguese' },
    organization: { display_name: 'Example Law', city: 'Toronto', website_url: 'https://example.test' },
    person: { display_name: 'Example Person', primary_email: 'person@example.test', role_title: 'Founder' },
    basis: 'The first-party team page identifies this person and organization.',
    idempotency_key: 'operator:provision:bao-p-000123',
  };

  it('requires source-backed raw data and creates no implicit link target', () => {
    expect(validateProvisionProspectSourceRecordInput(provision)).toMatchObject({
      source_system: 'brazilian_owner_cohort',
      source_record_key: 'BAO-P-000123',
      organization: { display_name: 'Example Law' },
    });
    expect(validateProvisionProspectSourceRecordInput({ ...provision, source_url: 'mailto:person@example.test' })).toBeNull();
    expect(validateProvisionProspectSourceRecordInput({ ...provision, source_payload: {} })).toBeTruthy();
    expect(validateProvisionProspectSourceRecordInput({ ...provision, organization: { display_name: '' } })).toBeNull();
    expect(validateProvisionProspectSourceRecordInput({ ...provision, canonical_person_id: '33333333-3333-4333-8333-333333333333' })).toBeNull();
  });

  it('allows controls but never a direct conversation status or unreasoned suppression', () => {
    expect(validateProspectConversationContactControlsInput({ next_action: 'Follow up Friday' })).toEqual({ next_action: 'Follow up Friday' });
    expect(validateProspectConversationContactControlsInput({ contactability: 'suppressed' })).toBeNull();
    expect(validateProspectConversationContactControlsInput({ contactability: 'eligible', suppression_reason: 'no' })).toBeNull();
    expect(validateProspectConversationContactControlsInput({ status: 'completed' })).toBeNull();
  });
});

describe('getProspectContactReport', () => {
  it('reads past the PostgREST 1,000-row response boundary', async () => {
    h.results.prospect_conversations = {
      data: Array.from({ length: 1_001 }, (_, index) => ({
        id: `conversation-${index}`,
        status: 'not_contacted',
        organization_id: `firm-${index}`,
        person_id: null,
      })),
      error: null,
    };

    const report = await getProspectContactReport();

    expect(report.conversations).toBe(1_001);
    expect(report.not_contacted).toBe(1_001);
    expect(report.unique_firms).toBe(1_001);
    expect(h.range).toHaveBeenCalledWith('prospect_conversations', 0, 999);
    expect(h.range).toHaveBeenCalledWith('prospect_conversations', 1_000, 1_999);
  });

  it('keeps human and automated replies, bounces, and event totals separate', async () => {
    h.results.prospect_conversations = {
      data: [
        { id: 'c-1', status: 'replied', organization_id: 'firm-1', person_id: 'person-1' },
        { id: 'c-2', status: 'awaiting_reply', organization_id: 'firm-1', person_id: 'person-2' },
        { id: 'c-3', status: 'unreachable', organization_id: 'firm-2', person_id: null },
      ],
      error: null,
    };
    h.results.prospect_activities = {
      data: [
        { kind: 'message_sent' },
        { kind: 'message_sent' },
        { kind: 'human_reply' },
        { kind: 'automated_reply' },
        { kind: 'automated_reply' },
        { kind: 'bounce' },
        { kind: 'meeting' },
      ],
      error: null,
    };
    h.results.prospect_contactability = {
      data: [
        { conversation_id: 'c-1', state: 'eligible' },
        { conversation_id: 'c-2', state: 'eligible' },
        { conversation_id: 'c-3', state: 'suppressed' },
      ],
      error: null,
    };

    const report = await getProspectContactReport();

    expect(report).toMatchObject({
      conversations: 3,
      unique_firms: 2,
      unique_people: 2,
      eligible_conversations: 2,
      suppressed_conversations: 1,
      unknown_contactability: 0,
      replied: 1,
      awaiting_reply: 1,
      unreachable: 1,
      messages_sent: 2,
      human_replies: 1,
      automated_replies: 2,
      bounces: 1,
      meetings: 1,
    });
    expect(report.human_replies).not.toBe(report.human_replies + report.automated_replies);
  });
});
