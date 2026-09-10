#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const BASE_URL = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'xXhW340nWLAJhOPzLbAA';
const SINCE_DEFAULT = '2026-08-26T00:00:00.000Z';
const WORKFLOW_IDS = Object.freeze({
  BA: 'e7ec222c-01fb-468a-841d-4ad0165ba4de',
  AE: 'e7da7580-884a-4584-a58f-044e52c6006f',
});
const PROVISION_MANIFEST_SCHEMA = 'prospecting-control-plane-provision-manifest-v1';
const DEFAULT_OUTPUT_DIR = String.raw`D:\00_Work\01_CaseLoad_Select\09_Internal\SIGN_Working_2026-08-14\Cold_Prospecting_Experiment_2026-08-17\00_Shared_Infrastructure\03_Prospect_Control_Plane\agent-scratch\live-readback-2026-09-10`;

function parseArgs(argv) {
  const args = {
    manifest: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    since: SINCE_DEFAULT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--manifest') args.manifest = argv[++index];
    else if (flag === '--output-dir') args.outputDir = argv[++index];
    else if (flag === '--since') args.since = argv[++index];
    else if (flag === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  assert(args.help || args.manifest, '--manifest is required and must name the canonical provisioning manifest.');
  return args;
}

function usage() {
  return [
    'GET-only HighLevel evidence extractor for the CaseLoad Select BA/AE cohort.',
    '',
    'Environment:',
    '  GHL_CASELOAD_SELECT_TOKEN   required; never written to output',
    '',
    'Options:',
    '  --manifest <path>           canonical 100-record provisioning manifest (required)',
    '  --output-dir <path>         must not already exist',
    '  --since <ISO timestamp>     default 2026-08-26T00:00:00.000Z',
  ].join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function redactSecrets(value, token) {
  let text = String(value ?? '');
  if (token) text = text.split(token).join('[REDACTED_TOKEN]');
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .slice(0, 2_000);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickMessageDate(message) {
  return message.dateAdded ?? message.createdAt ?? message.updatedAt ?? null;
}

function dateAtOrAfter(value, threshold) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= threshold;
}

function flattenStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenStrings(item, output));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      output.push(key);
      flattenStrings(item, output);
    });
  }
  return output;
}

function classifyInbound(message) {
  if (String(message.direction ?? '').toLowerCase() !== 'inbound') return null;

  const body = String(message.body ?? message.message ?? '');
  const subject = String(message.subject ?? message.meta?.email?.subject ?? '');
  const from = String(message.from ?? message.meta?.email?.from ?? '');
  const metadataText = flattenStrings(message.meta ?? {}).join(' ');
  const evidenceText = `${subject}\n${body}\n${from}\n${metadataText}`.toLowerCase();

  const indicators = [
    ['mailer-daemon', /mailer-daemon|mail delivery subsystem|postmaster@/i],
    ['delivery-failure', /delivery status notification|undeliverable|delivery failed|could not be delivered|message not delivered/i],
    ['automatic-reply', /automatic reply|auto[- ]?reply|autoreply|auto[- ]?response/i],
    ['out-of-office', /out of (?:the )?office|away from (?:the )?office|vacation (?:reply|response)/i],
    ['auto-submitted-metadata', /auto[-_ ]?submitted|auto[-_ ]?generated|autoresponder/i],
  ].filter(([, pattern]) => pattern.test(evidenceText)).map(([name]) => name);

  if (indicators.length > 0) {
    return {
      classification: 'automated',
      confidence: 'explicit_indicator',
      indicators,
    };
  }

  if (body.trim() || subject.trim()) {
    return {
      classification: 'human_candidate',
      confidence: 'requires_human_review',
      indicators: ['message-content-present-no-explicit-automation-indicator'],
    };
  }

  return {
    classification: 'unclassified',
    confidence: 'insufficient_content',
    indicators: ['no-body-or-subject'],
  };
}

function isBounce(message) {
  const status = String(message.status ?? '').toLowerCase();
  const direction = String(message.direction ?? '').toLowerCase();
  const error = String(message.error ?? '');
  const inbound = classifyInbound(message);
  return (
    (direction === 'outbound' && ['failed', 'bounced', 'undelivered', 'error'].includes(status)) ||
    Boolean(error.trim()) ||
    inbound?.indicators?.some((item) => item === 'mailer-daemon' || item === 'delivery-failure')
  );
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\r\n') + '\r\n';
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function locationMismatches(value, pathLabel = '$', output = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => locationMismatches(item, `${pathLabel}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'locationId' || key === 'location_id') && typeof item === 'string' && item && item !== LOCATION_ID) {
        output.push(`${pathLabel}.${key}=${item}`);
      }
      locationMismatches(item, `${pathLabel}.${key}`, output);
    }
  }
  return output;
}

function canonicalReadbackRecords(manifest) {
  assert(manifest?.schema_version === PROVISION_MANIFEST_SCHEMA, `Manifest schema_version must be ${PROVISION_MANIFEST_SCHEMA}.`);
  assert(Array.isArray(manifest.records), 'Manifest records must be an array.');
  assert(manifest.records.length === 100, `Expected 100 records, found ${manifest.records.length}.`);
  assert(manifest.records.filter((item) => item.arm === 'BA').length === 50, 'Expected exactly 50 BA records.');
  assert(manifest.records.filter((item) => item.arm === 'AE').length === 50, 'Expected exactly 50 AE records.');
  assert(manifest.records.every((item) => ['BA', 'AE'].includes(item.arm)), 'Manifest contains a non-BA/AE record; KS freeze enforced.');
  assert(new Set(manifest.records.map((item) => item.cls_record_id)).size === 100, 'cls_record_id values are not unique.');

  const records = manifest.records.map((record) => {
    const highlevel = record?.source_payload?.highlevel;
    const contactRoute = record?.source_payload?.contact_route;
    assert(highlevel && typeof highlevel === 'object', `${record.cls_record_id}: source_payload.highlevel is required.`);
    assert(highlevel.location_id === LOCATION_ID, `${record.cls_record_id}: HighLevel location must be ${LOCATION_ID}.`);
    assert(typeof highlevel.contact_id === 'string' && highlevel.contact_id.trim(), `${record.cls_record_id}: non-null HighLevel contact_id is required.`);
    assert(contactRoute && typeof contactRoute.email === 'string' && contactRoute.email.trim(), `${record.cls_record_id}: source_payload.contact_route.email is required.`);
    return {
      record_id: record.cls_record_id,
      arm: record.arm,
      firm: record.organization?.display_name ?? null,
      person: record.person?.display_name ?? null,
      email: contactRoute.email,
      ghl_contact_id: highlevel.contact_id.trim(),
      ghl_location_id: highlevel.location_id,
      ghl_smart_list_id: highlevel.smart_list_id ?? null,
      ghl_workflow_ids: Array.isArray(highlevel.workflow_ids) ? highlevel.workflow_ids : [],
    };
  });
  assert(new Set(records.map((item) => item.ghl_contact_id)).size === 100, 'HighLevel contact_id values are not unique.');
  return records;
}

function normalizeMessages(payload) {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (Array.isArray(payload?.messages?.messages)) return payload.messages.messages;
  return [];
}

function summarizeDnd(contact) {
  const settings = contact?.dndSettings ?? {};
  const email = settings.email ?? null;
  const emailStatus = typeof email === 'object' ? email.status ?? null : email;
  return {
    global_dnd: contact?.dnd ?? null,
    email_status: emailStatus,
    email_message: typeof email === 'object' ? email.message ?? null : null,
    dnd_settings: settings,
    inbound_dnd_settings: contact?.inboundDndSettings ?? null,
  };
}

function deriveOperationalState(messages, appointments) {
  const inbound = messages.map(classifyInbound).filter(Boolean);
  const humanCandidates = inbound.filter((item) => item.classification === 'human_candidate').length;
  const automated = inbound.filter((item) => item.classification === 'automated').length;
  const bounces = messages.filter(isBounce).length;
  const outbound = messages.filter((item) => String(item.direction ?? '').toLowerCase() === 'outbound').length;
  const futureOrCurrentAppointments = appointments.filter((item) => !['cancelled', 'invalid'].includes(String(item.status ?? '').toLowerCase())).length;

  if (humanCandidates > 0) return { stage: 'human_reply_candidate', next_step: 'Human-review the inbound content before any reply.' };
  if (futureOrCurrentAppointments > 0) return { stage: 'appointment_present', next_step: 'Verify the appointment context and owner before action.' };
  if (bounces > 0) return { stage: 'delivery_problem', next_step: 'Review delivery evidence and re-verify the public contact route.' };
  if (automated > 0) return { stage: 'automated_inbound_only', next_step: 'Keep waiting unless the automated message requires manual handling.' };
  if (outbound > 0) return { stage: 'outbound_present_waiting', next_step: 'No human reply evidenced; follow the approved journey policy only.' };
  return { stage: 'no_message_evidence', next_step: 'Do not infer delivery or journey position from missing provider evidence.' };
}

function minimalContact(contact) {
  if (!contact) return null;
  return {
    id: contact.id ?? null,
    locationId: contact.locationId ?? null,
    name: contact.name ?? null,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    companyName: contact.companyName ?? null,
    source: contact.source ?? null,
    dateAdded: contact.dateAdded ?? null,
    dateUpdated: contact.dateUpdated ?? null,
    tags: contact.tags ?? [],
    customFields: contact.customFields ?? [],
    dnd: contact.dnd ?? null,
    dndSettings: contact.dndSettings ?? null,
    inboundDndSettings: contact.inboundDndSettings ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const token = process.env.GHL_CASELOAD_SELECT_TOKEN;
  assert(token, 'GHL_CASELOAD_SELECT_TOKEN is required.');
  const sinceMs = Date.parse(args.since);
  assert(Number.isFinite(sinceMs), '--since must be a valid ISO timestamp.');

  const manifestRaw = await readFile(args.manifest, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const readbackRecords = canonicalReadbackRecords(manifest);

  const apiCalls = [];
  let earliestNextRequest = 0;

  async function ghGet({ category, recordId = null, resource, version = '2021-07-28' }) {
    assert(resource.startsWith('/'), 'HighLevel resource must be an absolute API path.');
    const url = `${BASE_URL}${resource}`;
    let finalResult = null;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const waitMs = Math.max(0, earliestNextRequest - Date.now());
      if (waitMs > 0) await delay(waitMs);
      earliestNextRequest = Date.now() + 130;

      const startedAt = new Date().toISOString();
      let response;
      let bodyText = '';
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            Version: version,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
        bodyText = await response.text();
      } catch (error) {
        finalResult = {
          ok: false,
          status: 0,
          statusText: 'network_error',
          data: null,
          error: redactSecrets(error instanceof Error ? error.message : error, token),
          attempts: attempt,
        };
        if (attempt < 4) {
          await delay(500 * 2 ** (attempt - 1));
          continue;
        }
        break;
      }

      const parsed = bodyText ? safeJsonParse(bodyText) : null;
      const mismatches = response.ok ? locationMismatches(parsed) : [];
      if (mismatches.length > 0) {
        throw new Error(`HighLevel returned data for a different location: ${mismatches.slice(0, 3).join(', ')}`);
      }
      finalResult = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: parsed,
        error: response.ok ? null : redactSecrets(parsed?.message ?? parsed?.error ?? bodyText, token),
        attempts: attempt,
      };

      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 750 * 2 ** (attempt - 1));
    }

    apiCalls.push({
      category,
      record_id: recordId,
      method: 'GET',
      resource,
      requested_at: new Date().toISOString(),
      status: finalResult.status,
      status_text: finalResult.statusText,
      ok: finalResult.ok,
      attempts: finalResult.attempts,
      error: finalResult.error,
    });
    return finalResult;
  }

  // Preflight one authoritative contact before any cohort sweep.
  const known = readbackRecords[0];
  const preflight = await ghGet({
    category: 'preflight_contact',
    recordId: known.record_id,
    resource: `/contacts/${encodeURIComponent(known.ghl_contact_id)}`,
  });
  if (!preflight.ok) {
    const blocked = {
      schema_version: 'ghl-ba-ae-readback-blocker.v1',
      generated_at: new Date().toISOString(),
      state: 'blocked_at_authenticated_get_only_preflight',
      boundary: {
        highlevel_location_id: LOCATION_ID,
        cohort: 'BA/AE only',
        ks_frozen: true,
        communications_created_or_modified: 0,
        allowed_http_methods: ['GET'],
      },
      authority: {
        manifest_path: args.manifest,
        manifest_sha256: sha256(manifestRaw),
        manifest_counts: { total: 100, BA: 50, AE: 50 },
      },
      blocker: {
        endpoint: `/contacts/${known.ghl_contact_id}`,
        http_status: preflight.status,
        status_text: preflight.statusText,
        provider_error: preflight.error,
        interpretation: 'The supplied bearer token is authenticated but does not authorize this HighLevel location. No cohort sweep was attempted.',
      },
      api_call_ledger: apiCalls,
    };
    const blockedJson = `${JSON.stringify(blocked, null, 2)}\n`;
    const blockedReport = [
      '# BA/AE HighLevel Live Read-back Blocker',
      '',
      `Generated: ${blocked.generated_at}`,
      '',
      `The GET-only preflight for \`${known.record_id}\` stopped with HTTP ${preflight.status}: ${preflight.error ?? preflight.statusText}.`,
      '',
      '- The token did not authorize the required HighLevel location.',
      '- No remaining contact, conversation, message, appointment, or workflow requests were attempted.',
      '- No HighLevel data was created, updated, enrolled, scheduled, activated, or sent.',
      '- KS remained frozen and was not queried.',
      '',
    ].join('\n');
    await mkdir(args.outputDir, { recursive: false });
    const blockedFiles = [
      ['GHL_BA_AE_LIVE_READBACK_BLOCKER_v1.0.json', blockedJson],
      ['GHL_BA_AE_LIVE_READBACK_BLOCKER_v1.0.md', blockedReport],
    ];
    for (const [name, contents] of blockedFiles) {
      await writeFile(path.join(args.outputDir, name), contents, { encoding: 'utf8', flag: 'wx' });
    }
    await writeFile(
      path.join(args.outputDir, 'SHA256SUMS.txt'),
      `${blockedFiles.map(([name, contents]) => `${sha256(contents)}  ${name}`).join('\n')}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    throw new Error(`Preflight contact failed with HTTP ${preflight.status}; blocker evidence written to ${args.outputDir}.`);
  }
  const preflightContact = preflight.data?.contact ?? preflight.data;
  assert(preflightContact?.id === known.ghl_contact_id, 'Preflight returned a different contact ID.');
  assert(preflightContact?.locationId === LOCATION_ID, 'Preflight contact is not in the authorized HighLevel location.');

  const contactsById = new Map();
  for (const record of readbackRecords) {
    const result = record.ghl_contact_id === known.ghl_contact_id
      ? preflight
      : await ghGet({
          category: 'contact',
          recordId: record.record_id,
          resource: `/contacts/${encodeURIComponent(record.ghl_contact_id)}`,
        });
    contactsById.set(record.ghl_contact_id, result);
  }

  const conversationsByContact = new Map();
  for (const record of readbackRecords) {
    const query = new URLSearchParams({
      locationId: LOCATION_ID,
      contactId: record.ghl_contact_id,
      limit: '100',
      sort: 'desc',
      status: 'all',
    });
    const result = await ghGet({
      category: 'conversations',
      recordId: record.record_id,
      resource: `/conversations/search?${query}`,
      version: '2021-04-15',
    });
    conversationsByContact.set(record.ghl_contact_id, result);
  }

  const exportedMessages = [];
  let messageExportState = { ok: true, pages: 0, terminal_status: 200, limitation: null };
  let cursor = null;
  do {
    const query = new URLSearchParams({
      locationId: LOCATION_ID,
      channel: 'Email',
      limit: '1000',
      sortBy: 'createdAt',
      sortOrder: 'asc',
      startDate: args.since,
    });
    if (cursor) query.set('cursor', cursor);
    const result = await ghGet({
      category: 'message_export',
      resource: `/conversations/messages/export?${query}`,
      version: '2021-04-15',
    });
    messageExportState.pages += 1;
    messageExportState.terminal_status = result.status;
    if (!result.ok) {
      messageExportState.ok = false;
      messageExportState.limitation = `Email export unavailable: HTTP ${result.status}. Per-conversation fallback attempted.`;
      break;
    }
    exportedMessages.push(...normalizeMessages(result.data));
    cursor = result.data?.nextCursor ?? result.data?.messages?.nextCursor ?? null;
  } while (cursor);

  const cohortContactIds = new Set(readbackRecords.map((record) => record.ghl_contact_id));
  let cohortMessages = exportedMessages.filter((message) => cohortContactIds.has(message.contactId) && dateAtOrAfter(pickMessageDate(message), sinceMs));

  if (!messageExportState.ok) {
    const seenConversations = new Set();
    for (const record of readbackRecords) {
      const conversationResult = conversationsByContact.get(record.ghl_contact_id);
      const conversations = Array.isArray(conversationResult?.data?.conversations)
        ? conversationResult.data.conversations
        : [];
      for (const conversation of conversations) {
        if (!conversation?.id || seenConversations.has(conversation.id)) continue;
        seenConversations.add(conversation.id);
        let lastMessageId = null;
        do {
          const query = new URLSearchParams({ limit: '100', type: 'TYPE_EMAIL' });
          if (lastMessageId) query.set('lastMessageId', lastMessageId);
          const result = await ghGet({
            category: 'conversation_messages',
            recordId: record.record_id,
            resource: `/conversations/${encodeURIComponent(conversation.id)}/messages?${query}`,
            version: '2021-04-15',
          });
          if (!result.ok) break;
          const pageMessages = normalizeMessages(result.data);
          cohortMessages.push(...pageMessages.filter((message) => cohortContactIds.has(message.contactId) && dateAtOrAfter(pickMessageDate(message), sinceMs)));
          const envelope = result.data?.messages ?? result.data;
          lastMessageId = envelope?.nextPage ? envelope.lastMessageId ?? null : null;
        } while (lastMessageId);
      }
    }
  }

  // De-duplicate export/fallback overlap without inventing an ID for provider records.
  const messageMap = new Map();
  cohortMessages.forEach((message, index) => {
    const key = message.id ?? `${message.contactId ?? ''}|${pickMessageDate(message) ?? ''}|${message.direction ?? ''}|${index}`;
    if (!messageMap.has(key)) messageMap.set(key, message);
  });
  cohortMessages = [...messageMap.values()];

  const appointmentsByContact = new Map();
  for (const record of readbackRecords) {
    const result = await ghGet({
      category: 'appointments',
      recordId: record.record_id,
      resource: `/contacts/${encodeURIComponent(record.ghl_contact_id)}/appointments`,
    });
    appointmentsByContact.set(record.ghl_contact_id, result);
  }

  const workflowsResult = await ghGet({
    category: 'workflows',
    resource: `/workflows/?${new URLSearchParams({ locationId: LOCATION_ID })}`,
  });
  const allWorkflows = Array.isArray(workflowsResult.data?.workflows) ? workflowsResult.data.workflows : [];
  const workflows = Object.entries(WORKFLOW_IDS).map(([arm, id]) => {
    const workflow = allWorkflows.find((item) => item.id === id) ?? null;
    return { arm, expected_id: id, found: Boolean(workflow), workflow };
  });

  const records = readbackRecords.map((manifestRecord) => {
    const contactResult = contactsById.get(manifestRecord.ghl_contact_id);
    const contact = minimalContact(contactResult?.data?.contact ?? contactResult?.data);
    const conversationResult = conversationsByContact.get(manifestRecord.ghl_contact_id);
    const conversations = Array.isArray(conversationResult?.data?.conversations)
      ? conversationResult.data.conversations
      : [];
    const messages = cohortMessages
      .filter((message) => message.contactId === manifestRecord.ghl_contact_id)
      .sort((left, right) => Date.parse(pickMessageDate(left) ?? 0) - Date.parse(pickMessageDate(right) ?? 0))
      .map((message) => ({
        ...message,
        inbound_classification: classifyInbound(message),
        bounce_or_delivery_failure: isBounce(message),
      }));
    const appointmentResult = appointmentsByContact.get(manifestRecord.ghl_contact_id);
    const appointments = Array.isArray(appointmentResult?.data?.events) ? appointmentResult.data.events : [];
    const currentState = deriveOperationalState(messages, appointments);
    const contactIdentityMatch = Boolean(
      contact &&
      contact.id === manifestRecord.ghl_contact_id &&
      contact.locationId === LOCATION_ID &&
      canonicalEmail(contact.email) === canonicalEmail(manifestRecord.email)
    );

    return {
      record_id: manifestRecord.record_id,
      arm: manifestRecord.arm,
      firm: manifestRecord.firm,
      person: manifestRecord.person,
      expected_email: manifestRecord.email,
      expected_ghl_contact_id: manifestRecord.ghl_contact_id,
      expected_workflow_id: WORKFLOW_IDS[manifestRecord.arm],
      identity: {
        exact_match: contactIdentityMatch,
        contact_id_match: contact?.id === manifestRecord.ghl_contact_id,
        location_match: contact?.locationId === LOCATION_ID,
        email_match: canonicalEmail(contact?.email) === canonicalEmail(manifestRecord.email),
      },
      contact_read: {
        http_status: contactResult?.status ?? null,
        contact,
        dnd: summarizeDnd(contact),
      },
      conversation_read: {
        http_status: conversationResult?.status ?? null,
        total: conversationResult?.data?.total ?? conversations.length,
        conversations,
      },
      messages_since: args.since,
      messages,
      appointments_read: {
        http_status: appointmentResult?.status ?? null,
        events: appointments,
      },
      operational_state_from_provider_evidence: currentState,
    };
  });

  const summary = {
    cohort_records: records.length,
    ba_records: records.filter((record) => record.arm === 'BA').length,
    ae_records: records.filter((record) => record.arm === 'AE').length,
    exact_identity_matches: records.filter((record) => record.identity.exact_match).length,
    missing_or_failed_contact_reads: records.filter((record) => record.contact_read.http_status !== 200).length,
    contact_email_mismatches: records.filter((record) => !record.identity.email_match).length,
    global_dnd_true: records.filter((record) => record.contact_read.dnd.global_dnd === true).length,
    email_dnd_active: records.filter((record) => String(record.contact_read.dnd.email_status).toLowerCase() === 'active').length,
    conversations: records.reduce((sum, record) => sum + record.conversation_read.conversations.length, 0),
    email_messages_since: cohortMessages.length,
    outbound_email_messages: cohortMessages.filter((message) => String(message.direction ?? '').toLowerCase() === 'outbound').length,
    inbound_email_messages: cohortMessages.filter((message) => String(message.direction ?? '').toLowerCase() === 'inbound').length,
    human_reply_candidates: records.reduce((sum, record) => sum + record.messages.filter((message) => message.inbound_classification?.classification === 'human_candidate').length, 0),
    automated_inbound: records.reduce((sum, record) => sum + record.messages.filter((message) => message.inbound_classification?.classification === 'automated').length, 0),
    unclassified_inbound: records.reduce((sum, record) => sum + record.messages.filter((message) => message.inbound_classification?.classification === 'unclassified').length, 0),
    bounce_or_delivery_failure_messages: records.reduce((sum, record) => sum + record.messages.filter((message) => message.bounce_or_delivery_failure).length, 0),
    appointments: records.reduce((sum, record) => sum + record.appointments_read.events.length, 0),
    workflows_found: workflows.filter((item) => item.found).length,
  };

  const httpStatusCounts = apiCalls.reduce((counts, call) => {
    const key = String(call.status);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  const output = {
    schema_version: 'ghl-ba-ae-readback.v1',
    generated_at: new Date().toISOString(),
    state: 'authenticated_get_only_provider_evidence',
    boundary: {
      highlevel_location_id: LOCATION_ID,
      cohort: 'BA/AE only',
      ks_frozen: true,
      communications_created_or_modified: 0,
      allowed_http_methods: ['GET'],
      since: args.since,
    },
    authority: {
      manifest_path: args.manifest,
      manifest_sha256: sha256(manifestRaw),
      manifest_schema_version: PROVISION_MANIFEST_SCHEMA,
      record_key: 'cls_record_id',
      highlevel_key: 'source_payload.highlevel.contact_id',
    },
    preflight: {
      record_id: known.record_id,
      contact_id: known.ghl_contact_id,
      http_status: preflight.status,
      exact_contact_id: preflightContact.id === known.ghl_contact_id,
      exact_location_id: preflightContact.locationId === LOCATION_ID,
    },
    summary,
    message_export: messageExportState,
    http_status_counts: httpStatusCounts,
    workflows,
    records,
    api_call_ledger: apiCalls,
    classification_note: 'human_candidate means content exists and no explicit automation indicator was found; it still requires human review. Workflow exits are never used as reply evidence.',
  };

  const csvRows = records.map((record) => {
    const inbound = record.messages.filter((message) => String(message.direction ?? '').toLowerCase() === 'inbound');
    const outbound = record.messages.filter((message) => String(message.direction ?? '').toLowerCase() === 'outbound');
    const latest = record.messages.at(-1) ?? null;
    return {
      record_id: record.record_id,
      arm: record.arm,
      firm: record.firm,
      person: record.person,
      expected_email: record.expected_email,
      ghl_contact_id: record.expected_ghl_contact_id,
      contact_http_status: record.contact_read.http_status,
      exact_identity_match: record.identity.exact_match,
      global_dnd: record.contact_read.dnd.global_dnd,
      email_dnd_status: record.contact_read.dnd.email_status,
      conversations: record.conversation_read.conversations.length,
      outbound_emails_since: outbound.length,
      inbound_emails_since: inbound.length,
      human_reply_candidates: inbound.filter((message) => message.inbound_classification?.classification === 'human_candidate').length,
      automated_inbound: inbound.filter((message) => message.inbound_classification?.classification === 'automated').length,
      delivery_failures: record.messages.filter((message) => message.bounce_or_delivery_failure).length,
      appointments: record.appointments_read.events.length,
      latest_message_at: latest ? pickMessageDate(latest) : null,
      latest_message_direction: latest?.direction ?? null,
      latest_message_status: latest?.status ?? null,
      evidence_stage: record.operational_state_from_provider_evidence.stage,
      next_step: record.operational_state_from_provider_evidence.next_step,
    };
  });

  const reportLines = [
    '# BA/AE HighLevel Live Read-back',
    '',
    `Generated: ${output.generated_at}`,
    '',
    '## Safety boundary',
    '',
    `- Location: \`${LOCATION_ID}\``,
    '- Cohort: 50 BA + 50 AE; KS was excluded and frozen.',
    '- HTTP method: GET only.',
    '- Created, updated, enrolled, scheduled, activated, or sent: 0.',
    `- Evidence window: ${args.since} onward.`,
    '',
    '## Results',
    '',
    `- Exact contact identity matches: ${summary.exact_identity_matches}/100`,
    `- Contact read failures: ${summary.missing_or_failed_contact_reads}`,
    `- Contact email mismatches: ${summary.contact_email_mismatches}`,
    `- Global DND true: ${summary.global_dnd_true}`,
    `- Email DND active: ${summary.email_dnd_active}`,
    `- Conversations: ${summary.conversations}`,
    `- Email messages since window start: ${summary.email_messages_since}`,
    `- Outbound email messages: ${summary.outbound_email_messages}`,
    `- Inbound email messages: ${summary.inbound_email_messages}`,
    `- Human reply candidates requiring review: ${summary.human_reply_candidates}`,
    `- Automated inbound messages: ${summary.automated_inbound}`,
    `- Unclassified inbound messages: ${summary.unclassified_inbound}`,
    `- Bounce or delivery-failure messages: ${summary.bounce_or_delivery_failure_messages}`,
    `- Appointments: ${summary.appointments}`,
    `- Expected workflows found: ${summary.workflows_found}/2`,
    '',
    '## Workflow read-back',
    '',
    '| Arm | Expected ID | Found | Status | Name |',
    '| --- | --- | --- | --- | --- |',
    ...workflows.map((item) => `| ${item.arm} | \`${item.expected_id}\` | ${item.found ? 'yes' : 'no'} | ${item.workflow?.status ?? 'unknown'} | ${String(item.workflow?.name ?? '').replaceAll('|', '\\|')} |`),
    '',
    '## API evidence limitations',
    '',
    `- Message export: ${messageExportState.ok ? `available (${messageExportState.pages} page(s))` : messageExportState.limitation}`,
    `- HTTP status distribution: ${Object.entries(httpStatusCounts).map(([status, count]) => `${status}: ${count}`).join(', ')}`,
    '- A human reply candidate is not treated as confirmed-human until its actual content is reviewed.',
    '- Workflow exits are not used as reply evidence.',
    '- Opens and clicks are not inferred when the provider response does not expose them.',
    '',
    'See the normalized JSON for exact provider IDs, timestamps, statuses, errors, DND fields, message content/metadata, appointments, and the GET-only API call ledger.',
    '',
  ];

  await mkdir(args.outputDir, { recursive: false });
  const jsonText = `${JSON.stringify(output, null, 2)}\n`;
  const csvText = toCsv(csvRows);
  const reportText = reportLines.join('\n');
  const files = [
    ['GHL_BA_AE_LIVE_READBACK_v1.0.json', jsonText],
    ['GHL_BA_AE_LIVE_READBACK_INDEX_v1.0.csv', csvText],
    ['GHL_BA_AE_LIVE_READBACK_REPORT_v1.0.md', reportText],
  ];
  for (const [name, contents] of files) {
    await writeFile(path.join(args.outputDir, name), contents, { encoding: 'utf8', flag: 'wx' });
  }
  const hashes = files.map(([name, contents]) => `${sha256(contents)}  ${name}`).join('\n') + '\n';
  await writeFile(path.join(args.outputDir, 'SHA256SUMS.txt'), hashes, { encoding: 'utf8', flag: 'wx' });

  process.stdout.write(JSON.stringify({
    ok: true,
    output_dir: args.outputDir,
    summary,
    http_status_counts: httpStatusCounts,
  }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`Read-back failed: ${redactSecrets(error instanceof Error ? error.message : error, process.env.GHL_CASELOAD_SELECT_TOKEN)}\n`);
  process.exitCode = 1;
});
