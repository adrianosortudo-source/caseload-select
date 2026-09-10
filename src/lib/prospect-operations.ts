import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  isProspectActivityChannel,
  isProspectActivityKind,
  isProspectContactabilityState,
  isProspectDeliveryStatus,
  isProspectIdentityAdjudicationDecision,
  isProspectOperationsUuid,
  isProspectReplyDisposition,
  isProspectResponseKind,
  type CreateProspectActivityInput,
  type CreateProspectIdentityAdjudicationInput,
  type ProspectActivity,
  type ProspectActivityDirection,
  type ProspectActivityKind,
  type ProspectContactReport,
  type ProspectConversationContactControls,
  type ProspectConversation,
  type ProspectConversationSummary,
  type ProspectIdentityAdjudication,
  type ProspectIdentityResolution,
  type ProspectSourceProvisionResult,
  type ProspectSourceContactState,
  type ProvisionProspectSourceRecordInput,
  type UpdateProspectConversationContactControlsInput,
} from '@/lib/prospect-operations-types';

export * from '@/lib/prospect-operations-types';

type SourceLinkRow = {
  id: string;
  organization_id: string | null;
  person_id: string | null;
  history_coverage: ProspectConversationSummary['history_coverage'];
};

function directionFor(kind: ProspectActivityKind): ProspectActivityDirection {
  if (kind === 'message_sent' || kind === 'call') return 'outbound';
  if (kind === 'human_reply' || kind === 'automated_reply' || kind === 'bounce') return 'inbound';
  return 'internal';
}

function defaultsFor(kind: ProspectActivityKind) {
  if (kind === 'message_sent') return { delivery_status: 'sent' as const, response_kind: 'none' as const };
  if (kind === 'bounce') return { delivery_status: 'bounced' as const, response_kind: 'none' as const };
  if (kind === 'human_reply') return { delivery_status: 'unknown' as const, response_kind: 'human' as const };
  if (kind === 'automated_reply') return { delivery_status: 'unknown' as const, response_kind: 'automated' as const };
  return { delivery_status: 'unknown' as const, response_kind: 'none' as const };
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateActivityInput(value: unknown): CreateProspectActivityInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!isProspectOperationsUuid(row.conversation_id)) return null;
  if (typeof row.idempotency_key !== 'string' || !row.idempotency_key.trim() || row.idempotency_key.length > 500) return null;
  if (!isProspectActivityKind(row.kind) || !isProspectActivityChannel(row.channel)) return null;
  if (row.delivery_status !== undefined && !isProspectDeliveryStatus(row.delivery_status)) return null;
  if (row.response_kind !== undefined && !isProspectResponseKind(row.response_kind)) return null;
  if (row.reply_disposition !== undefined && !isProspectReplyDisposition(row.reply_disposition)) return null;
  if (row.occurred_at !== undefined && (typeof row.occurred_at !== 'string' || Number.isNaN(Date.parse(row.occurred_at)))) return null;
  if (row.to_endpoints !== undefined && (
    !Array.isArray(row.to_endpoints)
    || row.to_endpoints.length > 50
    || row.to_endpoints.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 320)
  )) return null;
  if (row.kind === 'message_sent' && row.response_kind !== undefined && row.response_kind !== 'none') return null;
  if (row.kind === 'message_sent' && row.delivery_status !== undefined && !['unknown', 'sent', 'delivered'].includes(row.delivery_status as string)) return null;
  if (row.kind === 'message_sent' && row.reply_disposition !== undefined && row.reply_disposition !== 'unknown') return null;
  if (row.kind === 'human_reply' && row.response_kind !== undefined && row.response_kind !== 'human') return null;
  if (row.kind === 'automated_reply' && row.response_kind !== undefined && row.response_kind !== 'automated') return null;
  if (row.kind === 'automated_reply' && row.reply_disposition !== undefined && row.reply_disposition !== 'unknown') return null;
  if (row.kind === 'bounce' && row.delivery_status !== undefined && !['bounced', 'failed'].includes(row.delivery_status as string)) return null;
  if (row.kind === 'bounce' && row.response_kind !== undefined && row.response_kind !== 'none') return null;
  if (['call', 'meeting', 'note'].includes(row.kind) && row.response_kind !== undefined && row.response_kind !== 'none') return null;
  if (row.kind !== 'human_reply' && row.reply_disposition !== undefined && row.reply_disposition !== 'unknown') return null;
  for (const field of ['subject', 'body', 'from_endpoint', 'meeting_outcome', 'external_event_id'] as const) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') return null;
  }
  return {
    conversation_id: row.conversation_id.trim(),
    kind: row.kind,
    channel: row.channel,
    occurred_at: typeof row.occurred_at === 'string' ? row.occurred_at : undefined,
    subject: cleanText(row.subject as string | null | undefined, 1000),
    body: cleanText(row.body as string | null | undefined, 20000),
    from_endpoint: cleanText(row.from_endpoint as string | null | undefined, 320),
    to_endpoints: Array.isArray(row.to_endpoints) ? row.to_endpoints.map((item) => item.trim()).filter(Boolean) : [],
    delivery_status: row.delivery_status,
    response_kind: row.response_kind,
    reply_disposition: row.reply_disposition,
    meeting_outcome: cleanText(row.meeting_outcome as string | null | undefined, 2000),
    external_event_id: cleanText(row.external_event_id as string | null | undefined, 500),
    idempotency_key: row.idempotency_key.trim(),
  };
}

/**
 * Validates an explicit, source-backed identity decision. It intentionally
 * contains no matching heuristic: name, inbox, domain, and address matches
 * cannot turn into a link without an operator decision.
 */
export function validateIdentityAdjudicationInput(value: unknown): CreateProspectIdentityAdjudicationInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!isProspectOperationsUuid(row.source_link_id) || !isProspectOperationsUuid(row.canonical_organization_id)) return null;
  if (row.canonical_person_id !== undefined && row.canonical_person_id !== null && !isProspectOperationsUuid(row.canonical_person_id)) return null;
  if (!isProspectIdentityAdjudicationDecision(row.decision)) return null;
  if (typeof row.adjudication_basis !== 'string') return null;
  const adjudicationBasis = cleanText(row.adjudication_basis, 5_000);
  if (!adjudicationBasis) return null;
  if (row.evidence_url !== undefined && row.evidence_url !== null && typeof row.evidence_url !== 'string') return null;
  const evidenceUrl = row.evidence_url === undefined || row.evidence_url === null
    ? null
    : cleanHttpUrl(row.evidence_url);
  if (row.evidence_url !== undefined && row.evidence_url !== null && !evidenceUrl) return null;
  if (typeof row.idempotency_key !== 'string' || !row.idempotency_key.trim() || row.idempotency_key.trim().length > 500) return null;
  return {
    source_link_id: row.source_link_id,
    decision: row.decision,
    canonical_organization_id: row.canonical_organization_id,
    canonical_person_id: row.canonical_person_id ?? null,
    adjudication_basis: adjudicationBasis,
    evidence_url: evidenceUrl,
    idempotency_key: row.idempotency_key.trim(),
  };
}

/** Validates contact controls without permitting direct status/outcome edits. */
export function validateProspectConversationContactControlsInput(
  value: unknown,
): UpdateProspectConversationContactControlsInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const has = (field: string) => Object.prototype.hasOwnProperty.call(row, field);
  if (!has('contactability') && !has('next_action') && !has('next_action_due') && !has('suppression_reason')) return null;
  if (has('contactability') && !isProspectContactabilityState(row.contactability)) return null;
  if (has('suppression_reason') && row.suppression_reason !== null && typeof row.suppression_reason !== 'string') return null;
  if (has('next_action') && row.next_action !== null && typeof row.next_action !== 'string') return null;
  if (has('next_action_due') && row.next_action_due !== null
    && (typeof row.next_action_due !== 'string' || Number.isNaN(Date.parse(row.next_action_due)))) return null;

  const suppressionReason = has('suppression_reason')
    ? cleanText(row.suppression_reason as string | null | undefined, 2_000)
    : undefined;
  if (row.contactability === 'suppressed' && !suppressionReason) return null;
  if (has('suppression_reason') && row.contactability !== 'suppressed') return null;

  const normalized: UpdateProspectConversationContactControlsInput = {};
  if (isProspectContactabilityState(row.contactability)) normalized.contactability = row.contactability;
  if (has('suppression_reason')) normalized.suppression_reason = suppressionReason ?? null;
  if (has('next_action')) normalized.next_action = cleanText(row.next_action as string | null | undefined, 2_000);
  if (has('next_action_due')) {
    normalized.next_action_due = row.next_action_due === null ? null : new Date(row.next_action_due as string).toISOString();
  }
  return normalized;
}

/**
 * Validates first-party source data for an independent source bridge. It does
 * not accept existing organization/person IDs, because provisioning must never
 * match or reuse an identity automatically.
 */
export function validateProvisionProspectSourceRecordInput(value: unknown): ProvisionProspectSourceRecordInput | null {
  if (!isPlainObject(value)) return null;
  const allowedFields = new Set([
    'source_system', 'source_record_key', 'source_url', 'source_payload',
    'organization', 'person', 'basis', 'idempotency_key',
  ]);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) return null;
  const sourceSystem = typeof value.source_system === 'string' ? value.source_system.trim() : '';
  const sourceRecordKey = typeof value.source_record_key === 'string' ? value.source_record_key.trim() : '';
  const sourceUrl = typeof value.source_url === 'string' ? cleanHttpUrl(value.source_url) : null;
  if (!/^[a-z][a-z0-9_]{0,119}$/.test(sourceSystem) || !sourceRecordKey || sourceRecordKey.length > 300 || !sourceUrl) return null;
  if (!isPlainObject(value.source_payload)) return null;
  try {
    if (JSON.stringify(value.source_payload).length > 50_000) return null;
  } catch {
    return null;
  }
  if (!isPlainObject(value.organization) || typeof value.organization.display_name !== 'string') return null;
  const organizationName = cleanText(value.organization.display_name, 300);
  if (!organizationName) return null;
  const cityValue = value.organization.city;
  if (cityValue !== undefined && cityValue !== null && typeof cityValue !== 'string') return null;
  const city = cleanText(cityValue as string | null | undefined, 120);
  const websiteValue = value.organization.website_url;
  if (websiteValue !== undefined && websiteValue !== null && typeof websiteValue !== 'string') return null;
  const websiteUrl = websiteValue === undefined || websiteValue === null ? null : cleanHttpUrl(websiteValue);
  if (typeof websiteValue === 'string' && websiteValue.trim() && !websiteUrl) return null;

  let person: ProvisionProspectSourceRecordInput['person'] = null;
  if (value.person !== undefined && value.person !== null) {
    if (!isPlainObject(value.person) || typeof value.person.display_name !== 'string') return null;
    const personName = cleanText(value.person.display_name, 300);
    if (!personName) return null;
    const emailValue = value.person.primary_email;
    const phoneValue = value.person.primary_phone;
    const roleValue = value.person.role_title;
    if ((emailValue !== undefined && emailValue !== null && typeof emailValue !== 'string')
      || (phoneValue !== undefined && phoneValue !== null && typeof phoneValue !== 'string')
      || (roleValue !== undefined && roleValue !== null && typeof roleValue !== 'string')) return null;
    const email = cleanText(emailValue as string | null | undefined, 320);
    const phone = cleanText(phoneValue as string | null | undefined, 80);
    const roleTitle = cleanText(roleValue as string | null | undefined, 200);
    if ((emailValue && !email) || (phoneValue && !phone) || (roleValue && !roleTitle)) return null;
    person = { display_name: personName, primary_email: email, primary_phone: phone, role_title: roleTitle };
  }
  if (typeof value.basis !== 'string' || typeof value.idempotency_key !== 'string') return null;
  const basis = cleanText(value.basis, 5_000);
  const idempotencyKey = cleanText(value.idempotency_key, 500);
  if (!basis || !idempotencyKey) return null;
  return {
    source_system: sourceSystem,
    source_record_key: sourceRecordKey,
    source_url: sourceUrl,
    source_payload: value.source_payload,
    organization: { display_name: organizationName, city, website_url: websiteUrl },
    person,
    basis,
    idempotency_key: idempotencyKey,
  };
}

/** Returns every recorded decision; rejected candidates never erase a prior confirmed resolution. */
export async function listProspectIdentityAdjudications(sourceLinkId: string): Promise<ProspectIdentityAdjudication[]> {
  if (!isProspectOperationsUuid(sourceLinkId)) throw new Error('Invalid source link id');
  const { data, error } = await supabase
    .from('prospect_identity_adjudications')
    .select('*')
    .eq('source_link_id', sourceLinkId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProspectIdentityAdjudication[];
}

/**
 * Returns only the most recent explicit confirmation. It does not infer a
 * relationship and it never mutates the immutable source link or history.
 */
export async function getProspectIdentityResolution(sourceLinkId: string): Promise<ProspectIdentityResolution | null> {
  if (!isProspectOperationsUuid(sourceLinkId)) throw new Error('Invalid source link id');
  const { data, error } = await supabase
    .from('prospect_identity_adjudications')
    .select('id, source_link_id, canonical_organization_id, canonical_person_id, created_at')
    .eq('source_link_id', sourceLinkId)
    .eq('decision', 'confirmed_link')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    source_link_id: data.source_link_id,
    adjudication_id: data.id,
    canonical_organization_id: data.canonical_organization_id,
    canonical_person_id: data.canonical_person_id,
    confirmed_at: data.created_at,
  } as ProspectIdentityResolution;
}

/**
 * Creates one auditable operator decision. The database validates the target
 * relationship and prevents a conflicting re-link after contact history.
 */
export async function createProspectIdentityAdjudication(
  input: CreateProspectIdentityAdjudicationInput,
  reviewedByOperatorId: string,
): Promise<ProspectIdentityAdjudication> {
  if (!isProspectOperationsUuid(reviewedByOperatorId)) throw new Error('Invalid operator identity');
  const { data, error } = await supabase
    .from('prospect_identity_adjudications')
    .insert({
      source_link_id: input.source_link_id,
      decision: input.decision,
      canonical_organization_id: input.canonical_organization_id,
      canonical_person_id: input.canonical_person_id ?? null,
      adjudication_basis: input.adjudication_basis,
      evidence_url: input.evidence_url ?? null,
      idempotency_key: input.idempotency_key,
      reviewed_by_operator_id: reviewedByOperatorId,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ProspectIdentityAdjudication;
}

/**
 * Updates scheduling and contactability controls only. Conversation status is
 * intentionally not writable here: it remains derived from logged activity.
 */
export async function updateProspectConversationContactControls(
  conversationId: string,
  input: UpdateProspectConversationContactControlsInput,
  reviewedByOperatorId: string,
): Promise<ProspectConversationContactControls> {
  if (!isProspectOperationsUuid(conversationId)) throw new Error('Invalid conversation id');
  if (!isProspectOperationsUuid(reviewedByOperatorId)) throw new Error('Invalid operator identity');
  const [{ data: currentConversation, error: conversationReadError }, { data: currentContactability, error: contactabilityReadError }] = await Promise.all([
    supabase.from('prospect_conversations').select('*').eq('id', conversationId).maybeSingle(),
    supabase.from('prospect_contactability')
      .select('state, reason, suppressed_at, suppressed_by_operator_id, reviewed_at')
      .eq('conversation_id', conversationId)
      .maybeSingle(),
  ]);
  if (conversationReadError) throw new Error(conversationReadError.message);
  if (contactabilityReadError) throw new Error(contactabilityReadError.message);
  if (!currentConversation) throw new Error('Prospect conversation not found');
  if (!currentContactability) throw new Error('Prospect contactability record not found');

  const now = new Date().toISOString();
  const hasNextAction = input.next_action !== undefined;
  const hasNextActionDue = input.next_action_due !== undefined;
  const conversationPromise = hasNextAction || hasNextActionDue
    ? supabase
      .from('prospect_conversations')
      .update({
        ...(hasNextAction ? { next_action: input.next_action } : {}),
        ...(hasNextActionDue ? { next_action_due: input.next_action_due } : {}),
        updated_at: now,
      })
      .eq('id', conversationId)
      .select('*')
      .single()
    : Promise.resolve({ data: currentConversation, error: null });

  const contactabilityPromise = input.contactability !== undefined
    ? (() => {
      if (input.contactability === 'suppressed') {
        if (currentContactability.state === 'suppressed'
          && input.suppression_reason !== currentContactability.reason) {
          throw new Error('Active suppression provenance cannot be edited');
        }
        return supabase
          .from('prospect_contactability')
          .update({
            state: 'suppressed',
            ...(currentContactability.state === 'suppressed' ? {} : {
              reason: input.suppression_reason,
              suppressed_at: now,
              suppressed_by_operator_id: reviewedByOperatorId,
            }),
            reviewed_at: now,
            updated_at: now,
          })
          .eq('conversation_id', conversationId)
          .select('state, reason, suppressed_at, suppressed_by_operator_id, reviewed_at')
          .single();
      }
      return supabase
        .from('prospect_contactability')
        .update({ state: input.contactability, reviewed_at: now, updated_at: now })
        .eq('conversation_id', conversationId)
        .select('state, reason, suppressed_at, suppressed_by_operator_id, reviewed_at')
        .single();
    })()
    : Promise.resolve({ data: currentContactability, error: null });

  const [{ data: conversation, error: conversationError }, { data: contactability, error: contactabilityError }] = await Promise.all([
    conversationPromise,
    contactabilityPromise,
  ]);
  if (conversationError) throw new Error(conversationError.message);
  if (contactabilityError) throw new Error(contactabilityError.message);
  return {
    conversation: conversation as ProspectConversation,
    contactability: contactability as ProspectConversationContactControls['contactability'],
  };
}

/**
 * Atomically provisions one source record using first-party data. The database
 * function creates fresh organization/person rows, so this endpoint cannot
 * merge by a coincidental name, email address, domain, or location.
 */
export async function provisionProspectSourceRecord(
  input: ProvisionProspectSourceRecordInput,
  operatorId: string,
): Promise<ProspectSourceProvisionResult> {
  if (!isProspectOperationsUuid(operatorId)) throw new Error('Invalid operator identity');
  const { data, error } = await supabase.rpc('provision_prospect_source_record', {
    p_source_system: input.source_system,
    p_source_record_key: input.source_record_key,
    p_source_url: input.source_url,
    p_source_payload: input.source_payload,
    p_organization_display_name: input.organization.display_name,
    p_organization_city: input.organization.city ?? null,
    p_organization_website_url: input.organization.website_url ?? null,
    p_person_display_name: input.person?.display_name ?? null,
    p_person_email: input.person?.primary_email ?? null,
    p_person_phone: input.person?.primary_phone ?? null,
    p_person_role_title: input.person?.role_title ?? null,
    p_provisioning_basis: input.basis,
    p_idempotency_key: input.idempotency_key,
    p_operator_id: operatorId,
  }).single();
  if (error) throw new Error(error.message);
  return data as ProspectSourceProvisionResult;
}

/**
 * Reads one source record's own conversation and activities. It deliberately
 * follows the immutable source link rather than any identity adjudication, so
 * a confirmed cross-source identity can never silently reattribute history.
 */
export async function getProspectSourceConversation(
  sourceSystem: string,
  sourceRecordKey: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ProspectConversationSummary | null> {
  const normalizedSystem = sourceSystem.trim();
  const normalizedKey = sourceRecordKey.trim();
  if (!normalizedSystem || normalizedSystem.length > 120 || !normalizedKey || normalizedKey.length > 300) {
    throw new Error('Invalid source identifier');
  }
  const activityLimit = Number.isInteger(options.limit) && options.limit! >= 1 && options.limit! <= 100 ? options.limit! : 50;
  const activityOffset = Number.isInteger(options.offset) && options.offset! >= 0 && options.offset! <= 100_000 ? options.offset! : 0;
  const { data: source, error: sourceError } = await supabase
    .from('prospect_source_links')
    .select('id, organization_id, person_id, history_coverage')
    .eq('source_system', normalizedSystem)
    .eq('source_record_key', normalizedKey)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) return null;
  const typedSource = source as SourceLinkRow;

  const { data: association, error: associationError } = await supabase
    .from('prospect_conversation_sources')
    .select('conversation_id')
    .eq('source_link_id', typedSource.id)
    .maybeSingle();
  if (associationError) throw new Error(associationError.message);
  if (!association) return null;

  const activitiesQuery = supabase
    .from('prospect_activities')
    .select('*')
    .eq('conversation_id', association.conversation_id)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false });
  const [{ data: conversation, error: conversationError }, { data: organization, error: organizationError }, { data: person, error: personError }, { data: contactability, error: contactabilityError }, { data: activities, error: activitiesError }] = await Promise.all([
    supabase.from('prospect_conversations').select('*').eq('id', association.conversation_id).single(),
    typedSource.organization_id ? supabase.from('prospect_organizations').select('display_name').eq('id', typedSource.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    typedSource.person_id ? supabase.from('prospect_people').select('display_name, primary_email').eq('id', typedSource.person_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('prospect_contactability').select('state, reason').eq('conversation_id', association.conversation_id).maybeSingle(),
    activitiesQuery.range(activityOffset, activityOffset + activityLimit - 1),
  ]);
  if (conversationError) throw new Error(conversationError.message);
  if (organizationError) throw new Error(organizationError.message);
  if (personError) throw new Error(personError.message);
  if (contactabilityError) throw new Error(contactabilityError.message);
  if (activitiesError) throw new Error(activitiesError.message);
  const c = conversation as ProspectConversation;
  return {
    ...c,
    organization_name: organization?.display_name ?? 'Unresolved source record',
    person_name: person?.display_name ?? null,
    person_email: person?.primary_email ?? null,
    contactability: contactability?.state ?? 'unknown',
    suppression_reason: contactability?.reason ?? null,
    history_coverage: typedSource.history_coverage,
    activities: (activities ?? []) as ProspectActivity[],
  };
}

export async function getAgencyProspectConversation(agencyProspectId: string): Promise<ProspectConversationSummary | null> {
  if (!isProspectOperationsUuid(agencyProspectId)) throw new Error('Invalid agency prospect id');
  return getProspectSourceConversation('agency_crm', agencyProspectId);
}

export async function listProspectSourceContactStates(
  sourceSystem: string,
  sourceRecordKeys: readonly string[],
): Promise<ProspectSourceContactState[]> {
  const keys = [...new Set(sourceRecordKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 100);
  if (!sourceSystem.trim() || keys.length === 0) return [];
  const { data: sources, error: sourceError } = await supabase
    .from('prospect_source_links')
    .select('id, source_system, source_record_key, history_coverage')
    .eq('source_system', sourceSystem.trim())
    .in('source_record_key', keys);
  if (sourceError) throw new Error(sourceError.message);
  const sourceRows = sources ?? [];
  if (sourceRows.length === 0) return [];

  const sourceIds = sourceRows.map((source) => source.id);
  const { data: associations, error: associationError } = await supabase
    .from('prospect_conversation_sources')
    .select('conversation_id, source_link_id')
    .in('source_link_id', sourceIds);
  if (associationError) throw new Error(associationError.message);
  const associationRows = associations ?? [];
  const conversationIds = [...new Set(associationRows.map((association) => association.conversation_id))];
  if (conversationIds.length === 0) return [];

  const [{ data: conversations, error: conversationError }, { data: contactability, error: contactabilityError }] = await Promise.all([
    supabase.from('prospect_conversations').select('id, status, last_activity_at, next_action, next_action_due').in('id', conversationIds),
    supabase.from('prospect_contactability').select('conversation_id, state').in('conversation_id', conversationIds),
  ]);
  if (conversationError) throw new Error(conversationError.message);
  if (contactabilityError) throw new Error(contactabilityError.message);
  const conversationsById = new Map((conversations ?? []).map((conversation) => [conversation.id, conversation]));
  const contactabilityById = new Map((contactability ?? []).map((row) => [row.conversation_id, row.state]));
  const associationBySource = new Map(associationRows.map((association) => [association.source_link_id, association.conversation_id]));

  return sourceRows.flatMap((source) => {
    const conversationId = associationBySource.get(source.id);
    const conversation = conversationId ? conversationsById.get(conversationId) : null;
    if (!conversationId || !conversation) return [];
    return [{
      source_system: source.source_system,
      source_record_key: source.source_record_key,
      conversation_id: conversationId,
      status: conversation.status,
      contactability: contactabilityById.get(conversationId) ?? 'unknown',
      last_activity_at: conversation.last_activity_at,
      next_action: conversation.next_action,
      next_action_due: conversation.next_action_due,
      history_coverage: source.history_coverage,
    } as ProspectSourceContactState];
  });
}

/** Logs operator-entered evidence only. It does not send, deliver, or sync a message. */
export async function createProspectActivity(
  input: CreateProspectActivityInput,
  createdByOperatorId: string,
): Promise<ProspectActivity> {
  if (!isProspectOperationsUuid(createdByOperatorId)) throw new Error('Invalid operator identity');
  const defaults = defaultsFor(input.kind);
  const [{ data: conversation, error: conversationError }, { data: sourceAssociation, error: sourceError }] = await Promise.all([
    supabase.from('prospect_conversations').select('organization_id, person_id').eq('id', input.conversation_id).single(),
    supabase.from('prospect_conversation_sources').select('source_link_id').eq('conversation_id', input.conversation_id).eq('is_primary', true).single(),
  ]);
  if (conversationError) throw new Error(conversationError.message);
  if (sourceError) throw new Error(sourceError.message);
  const { data, error } = await supabase
    .from('prospect_activities')
    .insert({
      conversation_id: input.conversation_id,
      organization_id: conversation.organization_id,
      person_id: conversation.person_id,
      source_link_id: sourceAssociation.source_link_id,
      kind: input.kind,
      channel: input.channel,
      direction: directionFor(input.kind),
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      subject: input.subject ?? null,
      body: input.body ?? null,
      from_endpoint: input.from_endpoint ?? null,
      to_endpoints: input.to_endpoints ?? [],
      delivery_status: input.delivery_status ?? defaults.delivery_status,
      response_kind: input.response_kind ?? defaults.response_kind,
      reply_disposition: input.reply_disposition ?? 'unknown',
      meeting_outcome: input.meeting_outcome ?? null,
      external_event_id: input.external_event_id ?? null,
      idempotency_key: input.idempotency_key,
      created_by_operator_id: createdByOperatorId,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ProspectActivity;
}

async function listAllReportRows(table: string, columns: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 50000; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/**
 * Counts conversations and explicitly logged events. This is intentionally not
 * a response-rate claim: automated replies and bounced mail remain separate.
 */
export async function getProspectContactReport(): Promise<ProspectContactReport> {
  const [conversations, activities, contactability] = await Promise.all([
    listAllReportRows('prospect_conversations', 'id, status, organization_id, person_id'),
    listAllReportRows('prospect_activities', 'kind'),
    listAllReportRows('prospect_contactability', 'conversation_id, state'),
  ]);
  const report: ProspectContactReport = {
    as_of: new Date().toISOString(), conversations: 0, unique_firms: 0, unique_people: 0,
    eligible_conversations: 0, suppressed_conversations: 0, unknown_contactability: 0, not_contacted: 0,
    awaiting_reply: 0, replied: 0, unreachable: 0, declined: 0,
    meeting_scheduled: 0, completed: 0, messages_sent: 0, human_replies: 0,
    automated_replies: 0, bounces: 0, meetings: 0,
  };
  const firms = new Set<string>();
  const people = new Set<string>();
  const contactabilityByConversation = new Map(contactability.flatMap((row) => (
    typeof row.conversation_id === 'string' && typeof row.state === 'string'
      ? [[row.conversation_id, row.state] as const]
      : []
  )));
  for (const conversation of conversations) {
    report.conversations += 1;
    if (typeof conversation.organization_id === 'string') firms.add(conversation.organization_id);
    if (typeof conversation.person_id === 'string') people.add(conversation.person_id);
    const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
    const contactabilityState = contactabilityByConversation.get(conversationId) ?? 'unknown';
    if (contactabilityState === 'eligible') report.eligible_conversations += 1;
    else if (contactabilityState === 'suppressed') report.suppressed_conversations += 1;
    else report.unknown_contactability += 1;
    if (typeof conversation.status === 'string' && conversation.status in report) {
      report[conversation.status as keyof Pick<ProspectContactReport,
        'not_contacted' | 'awaiting_reply' | 'replied' | 'unreachable' | 'declined' | 'meeting_scheduled' | 'completed'
      >] += 1;
    }
  }
  report.unique_firms = firms.size;
  report.unique_people = people.size;
  for (const activity of activities) {
    if (activity.kind === 'message_sent') report.messages_sent += 1;
    if (activity.kind === 'human_reply') report.human_replies += 1;
    if (activity.kind === 'automated_reply') report.automated_replies += 1;
    if (activity.kind === 'bounce') report.bounces += 1;
    if (activity.kind === 'meeting') report.meetings += 1;
  }
  return report;
}
