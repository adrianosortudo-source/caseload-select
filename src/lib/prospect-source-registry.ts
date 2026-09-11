import 'server-only';

import { supabaseAdmin } from '@/lib/supabase-admin';

export const PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM = 'prospecting_control_plane';
export const PROSPECTING_CONTROL_PLANE_DEFAULT_PAGE_SIZE = 25;
export const PROSPECTING_CONTROL_PLANE_MAX_PAGE_SIZE = 100;

export type ProspectingArm = 'BA' | 'AE' | 'unknown';

export type ProspectingControlPlaneSourceRecord = {
  sourceLinkId: string;
  sourceSystem: typeof PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM;
  sourceRecordKey: string;
  sourceUrl: string | null;
  sourcePayload: Record<string, unknown>;
  arm: ProspectingArm;
  historyCoverage: 'known_empty' | 'history_unknown' | 'evidenced_activity';
  executionState: {
    historyReconciled: boolean;
    displayStatus: string;
    currentStage: 'unknown';
    method: string | null;
  };
  highLevel: {
    locationId: string | null;
    contactId: string | null;
    smartListId: string | null;
    workflowIds: string[];
  };
  sourceActive: boolean;
  sourceCreatedAt: string;
  organization: {
    id: string;
    displayName: string;
    city: string | null;
    websiteUrl: string | null;
  };
  person: {
    id: string;
    displayName: string;
    primaryEmail: string | null;
    primaryPhone: string | null;
  } | null;
  conversation: {
    id: string;
    status: string;
    nextAction: string | null;
    nextActionDue: string | null;
    lastActivityAt: string | null;
    createdAt: string;
  } | null;
  contactability: {
    state: 'unknown' | 'eligible' | 'suppressed';
    reason: string | null;
    reviewedAt: string | null;
    suppressedAt: string | null;
  } | null;
  provisioningReceipt: {
    id: string;
    conversationId: string;
    provisioningBasis: string;
    idempotencyKey: string;
    provisionedByOperatorId: string;
    createdAt: string;
  } | null;
};

export type ProspectingControlPlaneSourcePage = {
  records: ProspectingControlPlaneSourceRecord[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

type SourceLinkRow = {
  id: string;
  source_system: string;
  source_record_key: string;
  organization_id: string;
  person_id: string | null;
  source_url: string | null;
  source_payload: unknown;
  history_coverage: ProspectingControlPlaneSourceRecord['historyCoverage'];
  active: boolean;
  created_at: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textCandidate(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function displayTextCandidate(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function highLevelIdentityFromSourcePayload(value: unknown): ProspectingControlPlaneSourceRecord['highLevel'] {
  const payload = asObject(value);
  const provided = asObject(payload.providedSourcePayload);
  const effectivePayload = Object.keys(provided).length > 0 ? provided : payload;
  const highLevel = asObject(effectivePayload.highlevel);
  return {
    locationId: displayTextCandidate(highLevel.location_id),
    contactId: displayTextCandidate(highLevel.contact_id),
    smartListId: displayTextCandidate(highLevel.smart_list_id),
    workflowIds: Array.isArray(highLevel.workflow_ids)
      ? highLevel.workflow_ids.map(displayTextCandidate).filter((item): item is string => item !== null)
      : [],
  };
}

function methodFromSourcePayload(value: unknown): string | null {
  const payload = asObject(value);
  const provided = asObject(payload.providedSourcePayload);
  return displayTextCandidate(provided.method) ?? displayTextCandidate(payload.method);
}

export function executionStateForSource(
  sourcePayload: unknown,
  historyCoverage: ProspectingControlPlaneSourceRecord['historyCoverage'],
  conversationStatus: string | null,
): ProspectingControlPlaneSourceRecord['executionState'] {
  const historyReconciled = historyCoverage === 'evidenced_activity';
  return {
    historyReconciled,
    displayStatus: historyReconciled && conversationStatus ? conversationStatus : 'history_not_reconciled',
    currentStage: 'unknown',
    method: methodFromSourcePayload(sourcePayload),
  };
}

/**
 * Reads only explicit arm labels carried by the source payload. It never
 * derives an arm from a firm name, domain, email address, or source key.
 */
export function prospectingArmFromSourcePayload(value: unknown): ProspectingArm {
  const payload = asObject(value);
  const provided = asObject(payload.providedSourcePayload);
  const candidates = [
    provided.arm,
    provided.experiment_arm,
    provided.experimentArm,
    provided.method,
    provided.prospecting_method,
    payload.arm,
    payload.experiment_arm,
    payload.experimentArm,
    payload.method,
    payload.prospecting_method,
  ].map(textCandidate).filter((candidate): candidate is string => candidate !== null);

  for (const candidate of candidates) {
    if (['ba', 'beyond_agency', 'beyond agency'].includes(candidate)) return 'BA';
    if (['ae', 'adam_erhart', 'adam erhart'].includes(candidate)) return 'AE';
  }
  return 'unknown';
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listProspectingControlPlaneSources(input: {
  page?: number;
  pageSize?: number;
} = {}): Promise<ProspectingControlPlaneSourcePage> {
  const page = Number.isInteger(input.page) && (input.page ?? 0) >= 1 ? input.page! : 1;
  const pageSize = Number.isInteger(input.pageSize)
    ? Math.min(Math.max(input.pageSize!, 1), PROSPECTING_CONTROL_PLANE_MAX_PAGE_SIZE)
    : PROSPECTING_CONTROL_PLANE_DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const { data: sourceData, error: sourceError, count } = await supabaseAdmin
    .from('prospect_source_links')
    .select('id, source_system, source_record_key, organization_id, person_id, source_url, source_payload, history_coverage, active, created_at', { count: 'exact' })
    .eq('source_system', PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM)
    .order('source_record_key', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (sourceError) throw new Error(sourceError.message);

  const sources = (sourceData ?? []) as SourceLinkRow[];
  const total = count ?? 0;
  if (sources.length === 0) {
    return { records: [], page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  }

  const sourceIds = sources.map((source) => source.id);
  const organizationIds = unique(sources.map((source) => source.organization_id));
  const personIds = unique(sources.map((source) => source.person_id));

  const [organizationsResult, peopleResult, associationsResult, receiptsResult] = await Promise.all([
    supabaseAdmin.from('prospect_organizations').select('id, display_name, city, website_url').in('id', organizationIds),
    personIds.length > 0
      ? supabaseAdmin.from('prospect_people').select('id, display_name, primary_email, primary_phone').in('id', personIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from('prospect_conversation_sources').select('conversation_id, source_link_id, is_primary').in('source_link_id', sourceIds),
    supabaseAdmin.from('prospect_source_provisioning_events').select('id, source_link_id, conversation_id, provisioning_basis, idempotency_key, provisioned_by_operator_id, created_at').in('source_link_id', sourceIds),
  ]);
  for (const result of [organizationsResult, peopleResult, associationsResult, receiptsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const associations = (associationsResult.data ?? []) as Array<{ conversation_id: string; source_link_id: string; is_primary: boolean }>;
  const primaryAssociationBySource = new Map(
    associations
      .filter((association) => association.is_primary)
      .map((association) => [association.source_link_id, association]),
  );
  const conversationIds = unique(associations.map((association) => association.conversation_id));
  const [conversationsResult, contactabilityResult] = conversationIds.length > 0
    ? await Promise.all([
      supabaseAdmin.from('prospect_conversations').select('id, status, next_action, next_action_due, last_activity_at, created_at').in('id', conversationIds),
      supabaseAdmin.from('prospect_contactability').select('conversation_id, state, reason, reviewed_at, suppressed_at').in('conversation_id', conversationIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (conversationsResult.error) throw new Error(conversationsResult.error.message);
  if (contactabilityResult.error) throw new Error(contactabilityResult.error.message);

  const organizations = indexById((organizationsResult.data ?? []) as Array<{ id: string; display_name: string; city: string | null; website_url: string | null }>);
  const people = indexById((peopleResult.data ?? []) as Array<{ id: string; display_name: string; primary_email: string | null; primary_phone: string | null }>);
  const conversations = indexById((conversationsResult.data ?? []) as Array<{ id: string; status: string; next_action: string | null; next_action_due: string | null; last_activity_at: string | null; created_at: string }>);
  const contactabilityByConversation = new Map(((contactabilityResult.data ?? []) as Array<{ conversation_id: string; state: 'unknown' | 'eligible' | 'suppressed'; reason: string | null; reviewed_at: string | null; suppressed_at: string | null }>).map((row) => [row.conversation_id, row]));
  const receiptBySource = new Map(((receiptsResult.data ?? []) as Array<{ id: string; source_link_id: string; conversation_id: string; provisioning_basis: string; idempotency_key: string; provisioned_by_operator_id: string; created_at: string }>).map((row) => [row.source_link_id, row]));

  const records = sources.map((source): ProspectingControlPlaneSourceRecord => {
    const organization = organizations.get(source.organization_id);
    if (!organization) throw new Error(`Prospect source ${source.source_record_key} has no organization`);
    const person = source.person_id ? people.get(source.person_id) ?? null : null;
    const association = primaryAssociationBySource.get(source.id) ?? null;
    const conversation = association ? conversations.get(association.conversation_id) ?? null : null;
    const contactability = conversation ? contactabilityByConversation.get(conversation.id) ?? null : null;
    const receipt = receiptBySource.get(source.id) ?? null;
    const sourcePayload = asObject(source.source_payload);

    return {
      sourceLinkId: source.id,
      sourceSystem: PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM,
      sourceRecordKey: source.source_record_key,
      sourceUrl: source.source_url,
      sourcePayload,
      arm: prospectingArmFromSourcePayload(sourcePayload),
      historyCoverage: source.history_coverage,
      executionState: executionStateForSource(sourcePayload, source.history_coverage, conversation?.status ?? null),
      highLevel: highLevelIdentityFromSourcePayload(sourcePayload),
      sourceActive: source.active,
      sourceCreatedAt: source.created_at,
      organization: {
        id: organization.id,
        displayName: organization.display_name,
        city: organization.city,
        websiteUrl: organization.website_url,
      },
      person: person ? {
        id: person.id,
        displayName: person.display_name,
        primaryEmail: person.primary_email,
        primaryPhone: person.primary_phone,
      } : null,
      conversation: conversation ? {
        id: conversation.id,
        status: conversation.status,
        nextAction: conversation.next_action,
        nextActionDue: conversation.next_action_due,
        lastActivityAt: conversation.last_activity_at,
        createdAt: conversation.created_at,
      } : null,
      contactability: contactability ? {
        state: contactability.state,
        reason: contactability.reason,
        reviewedAt: contactability.reviewed_at,
        suppressedAt: contactability.suppressed_at,
      } : null,
      provisioningReceipt: receipt ? {
        id: receipt.id,
        conversationId: receipt.conversation_id,
        provisioningBasis: receipt.provisioning_basis,
        idempotencyKey: receipt.idempotency_key,
        provisionedByOperatorId: receipt.provisioned_by_operator_id,
        createdAt: receipt.created_at,
      } : null,
    };
  });

  return {
    records,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
