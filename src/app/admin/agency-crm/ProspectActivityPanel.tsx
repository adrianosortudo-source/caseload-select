'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PROSPECT_ACTIVITY_CHANNELS,
  PROSPECT_ACTIVITY_KINDS,
  PROSPECT_DELIVERY_STATUSES,
  PROSPECT_REPLY_DISPOSITIONS,
  type ProspectActivity,
  type ProspectActivityChannel,
  type ProspectActivityKind,
  type ProspectConversationSummary,
  type ProspectDeliveryStatus,
  type ProspectReplyDisposition,
} from '@/lib/prospect-operations-types';
import { notifyProspectOperationsChanged } from './prospect-operations-events';

type ActivityPanelProps = {
  prospectId: string;
  sourceSystem?: string;
  sourceRecordKey?: string;
  initialContactability?: 'unknown' | 'eligible' | 'suppressed';
  initialNextAction?: string | null;
  initialNextActionDue?: string | null;
  sourceUrl?: string | null;
  sourcePayload?: Record<string, unknown> | null;
  provisioningBasis?: string;
  provisionedPersonEmail?: string | null;
  firmName: string;
  contactName: string | null;
  contactEmail: string | null;
  open: boolean;
  onClose: () => void;
  onActivitySaved?: () => void;
  onConversationUpdated?: () => void;
};

const KIND_LABELS: Record<ProspectActivityKind, string> = {
  message_sent: 'Message sent',
  human_reply: 'Human reply',
  automated_reply: 'Automated reply',
  bounce: 'Bounce',
  call: 'Call',
  meeting: 'Meeting',
  note: 'Note',
};

const CHANNEL_LABELS: Record<ProspectActivityChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  phone: 'Phone',
  video: 'Video call',
  other: 'Other',
};

const DELIVERY_LABELS: Record<ProspectDeliveryStatus, string> = {
  unknown: 'Unknown', sent: 'Sent', delivered: 'Delivered', bounced: 'Bounced', failed: 'Failed',
};
const MESSAGE_DELIVERY_STATUSES = PROSPECT_DELIVERY_STATUSES.filter(
  (status): status is 'unknown' | 'sent' | 'delivered' => status !== 'bounced' && status !== 'failed',
);

const REPLY_LABELS: Record<ProspectReplyDisposition, string> = {
  unknown: 'Unknown', positive: 'Positive', neutral: 'Neutral', declined: 'Declined',
};
const HISTORY_PAGE_SIZE = 50;

function localDateTimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function activityLabel(activity: ProspectActivity): string {
  return `${KIND_LABELS[activity.kind] ?? activity.kind} via ${CHANNEL_LABELS[activity.channel] ?? activity.channel}`;
}

export default function ProspectActivityPanel({
  prospectId,
  sourceSystem,
  sourceRecordKey,
  initialContactability = 'unknown',
  initialNextAction,
  initialNextActionDue,
  sourceUrl,
  sourcePayload,
  provisioningBasis = 'Operator-confirmed source record; no identity match was inferred.',
  provisionedPersonEmail = null,
  firmName,
  contactName,
  contactEmail,
  open,
  onClose,
  onActivitySaved,
  onConversationUpdated,
}: ActivityPanelProps) {
  const [conversation, setConversation] = useState<ProspectConversationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProspectActivityKind>('message_sent');
  const [channel, setChannel] = useState<ProspectActivityChannel>('email');
  const [occurredAt, setOccurredAt] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fromEndpoint, setFromEndpoint] = useState('');
  const [toEndpoints, setToEndpoints] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<ProspectDeliveryStatus>('unknown');
  const [replyDisposition, setReplyDisposition] = useState<ProspectReplyDisposition>('unknown');
  const [meetingOutcome, setMeetingOutcome] = useState('');
  const [contactability, setContactability] = useState<'unknown' | 'eligible' | 'suppressed'>(initialContactability);
  const [suppressionReason, setSuppressionReason] = useState('');
  const [nextAction, setNextAction] = useState(initialNextAction ?? '');
  const [nextActionDue, setNextActionDue] = useState(initialNextActionDue ? initialNextActionDue.slice(0, 16) : '');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [needsProvisioning, setNeedsProvisioning] = useState(false);

  const isReply = kind === 'human_reply';
  const isMeeting = kind === 'meeting';
  const isSourceBacked = Boolean(sourceSystem && sourceRecordKey);
  const canProvisionSource = Boolean(sourceUrl && firmName.trim());
  const contactLabel = useMemo(() => contactName || contactEmail || 'No named contact', [contactEmail, contactName]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConversation(null);
    setNeedsProvisioning(false);
    setOccurredAt(localDateTimeValue());
    setContactability(initialContactability);
    setNextAction(initialNextAction ?? '');
    setNextActionDue(initialNextActionDue ? initialNextActionDue.slice(0, 16) : '');
    const conversationUrl = isSourceBacked
      ? `/api/admin/prospect-operations/conversations/source?source_system=${encodeURIComponent(sourceSystem ?? '')}&source_record_key=${encodeURIComponent(sourceRecordKey ?? '')}&limit=${HISTORY_PAGE_SIZE}&offset=0`
      : `/api/admin/prospect-operations/conversations/agency/${encodeURIComponent(prospectId)}?limit=${HISTORY_PAGE_SIZE}&offset=0`;
    fetch(conversationUrl)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (isSourceBacked && response.status === 404) {
            if (!cancelled) setNeedsProvisioning(true);
            return {} as { conversation?: ProspectConversationSummary };
          }
          throw new Error(payload.error || `Could not load contact history (${response.status})`);
        }
        return payload as { conversation?: ProspectConversationSummary };
      })
      .then((payload) => {
        if (cancelled) return;
        const loadedConversation = payload.conversation ?? null;
        setConversation(loadedConversation);
        if (loadedConversation) {
          setContactability(loadedConversation.contactability);
          setSuppressionReason(loadedConversation.suppression_reason ?? '');
          setNextAction(loadedConversation.next_action ?? '');
          setNextActionDue(loadedConversation.next_action_due ? loadedConversation.next_action_due.slice(0, 16) : '');
        }
      })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialContactability, initialNextAction, initialNextActionDue, isSourceBacked, open, prospectId, sourceRecordKey, sourceSystem]);

  if (!open) return null;

  async function saveActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || saving) return;
    setSaving(true);
    setError(null);
    const normalizedChannel = kind === 'bounce' ? 'email' : kind === 'meeting' ? 'video' : channel;
    const normalizedDeliveryStatus = kind === 'bounce' ? 'bounced' : kind === 'message_sent' ? deliveryStatus : 'unknown';
    const normalizedResponseKind = isReply ? 'human' : kind === 'automated_reply' ? 'automated' : 'none';
    try {
      const response = await fetch('/api/admin/prospect-operations/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversation.id,
          kind,
          channel: normalizedChannel,
          occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          subject: subject.trim() || null,
          body: body.trim() || null,
          from_endpoint: fromEndpoint.trim() || null,
          to_endpoints: toEndpoints.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
          delivery_status: normalizedDeliveryStatus,
          response_kind: normalizedResponseKind,
          reply_disposition: isReply ? replyDisposition : 'unknown',
          meeting_outcome: isMeeting ? meetingOutcome.trim() || null : null,
          idempotency_key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `operator-${Date.now()}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not save activity (${response.status})`);
      setSubject(''); setBody(''); setFromEndpoint(''); setToEndpoints(''); setMeetingOutcome('');
      setConversation((current) => current ? { ...current, activities: payload.activity ? [payload.activity, ...current.activities] : current.activities } : current);
      notifyProspectOperationsChanged();
      onActivitySaved?.();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveConversationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || settingsSaving) return;
    setSettingsSaving(true);
    setError(null);
    try {
      const settingsUrl = isSourceBacked
        ? '/api/admin/prospect-operations/conversations/source'
        : `/api/admin/prospect-operations/conversations/${encodeURIComponent(conversation.id)}`;
      const payload = isSourceBacked
        ? { source_system: sourceSystem, source_record_key: sourceRecordKey, contactability, suppression_reason: contactability === 'suppressed' ? suppressionReason.trim() || null : null, next_action: nextAction.trim() || null, next_action_due: nextActionDue ? new Date(nextActionDue).toISOString() : null }
        : { contactability, suppression_reason: contactability === 'suppressed' ? suppressionReason.trim() || null : null, next_action: nextAction.trim() || null, next_action_due: nextActionDue ? new Date(nextActionDue).toISOString() : null };
      const response = await fetch(settingsUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responsePayload.error || `Could not save contact controls (${response.status})`);
      setConversation((current) => current ? { ...current, next_action: nextAction.trim() || null, next_action_due: nextActionDue ? new Date(nextActionDue).toISOString() : null } : current);
      notifyProspectOperationsChanged();
      onConversationUpdated?.();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function provisionSourceRecord() {
    if (!isSourceBacked || !sourceSystem || !sourceRecordKey || !canProvisionSource || provisioning) return;
    setProvisioning(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/prospect-operations/sources/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_system: sourceSystem,
          source_record_key: sourceRecordKey,
          organization: { display_name: firmName, website_url: sourceUrl ?? null },
          person: contactName ? { display_name: contactName, primary_email: provisionedPersonEmail } : null,
          source_url: sourceUrl ?? null,
          source_payload: sourcePayload ?? {},
          basis: provisioningBasis,
          idempotency_key: `provision:${sourceSystem}:${sourceRecordKey}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Could not provision contact record (${response.status})`);
      const conversationResponse = await fetch(
        `/api/admin/prospect-operations/conversations/source?source_system=${encodeURIComponent(sourceSystem)}&source_record_key=${encodeURIComponent(sourceRecordKey)}&limit=${HISTORY_PAGE_SIZE}&offset=0`,
      );
      const conversationPayload = await conversationResponse.json().catch(() => ({}));
      if (!conversationResponse.ok || !conversationPayload.conversation) {
        throw new Error(conversationPayload.error || 'The contact record was provisioned but could not be reloaded.');
      }
      setConversation(conversationPayload.conversation);
      setNeedsProvisioning(false);
      notifyProspectOperationsChanged();
      onConversationUpdated?.();
    } catch (provisionError) {
      setError((provisionError as Error).message);
    } finally {
      setProvisioning(false);
    }
  }

  return (
    <section className="bg-white border border-black/10 shadow-sm" role="dialog" aria-modal="false" aria-labelledby="prospect-activity-title" data-ui-component-content="prospect-activity-panel">
      <div className="border-b border-black/10 px-4 py-4 sm:px-5 flex items-start justify-between gap-4">
        <div data-ui-component-content="prospect-activity-heading" className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-gold" data-ui-copy="supporting">Contact history</p>
          <h2 id="prospect-activity-title" className="text-xl font-semibold text-navy mt-1" data-ui-copy="heading">{firmName}</h2>
          <p className="text-sm text-black/55 mt-1" data-ui-copy="body">{contactLabel}{contactEmail && contactName ? ` · ${contactEmail}` : ''}</p>
        </div>
        <button type="button" onClick={onClose} className="border border-black/15 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-parchment shrink-0">Close</button>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div data-ui-component-content="prospect-activity-history">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-xs uppercase tracking-[0.14em] font-semibold text-navy" data-ui-copy="heading">History</h3>
            {conversation && <span className="text-xs text-black/50">{conversation.activities.length} {conversation.activities.length === 1 ? 'entry' : 'entries'}</span>}
          </div>
          {loading && <p className="text-sm text-black/50" data-ui-copy="body">Loading contact history...</p>}
          {!loading && error && <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-ui-copy="body">{error}</p>}
          {!loading && !error && conversation?.history_coverage === 'history_unknown' && conversation.activities.length === 0 && <p className="border border-black/10 bg-parchment px-3 py-3 text-sm text-black/60" data-ui-copy="body">Earlier contact history has not been reviewed. Add the first confirmed activity below.</p>}
          {!loading && !error && conversation?.history_coverage === 'known_empty' && conversation.activities.length === 0 && <p className="border border-black/10 bg-parchment px-3 py-3 text-sm text-black/60" data-ui-copy="body">No contact history has been recorded yet.</p>}
          {!loading && !error && needsProvisioning && <div className="border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950" data-ui-component-content="prospect-source-provisioning">
            <p data-ui-copy="body">This source record has no operational contact record yet. Provision it only after reviewing the public firm and person details below.</p>
            <p className="mt-2 text-xs text-amber-900" data-ui-copy="supporting">No identity match will be inferred. Provisioning creates a source-linked record for operator follow-up.</p>
            {!sourceUrl && <p className="mt-2 text-xs text-red-700" data-ui-copy="supporting">A first-party source URL is required before this record can be provisioned.</p>}
            <button type="button" onClick={provisionSourceRecord} className="mt-3 rounded bg-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={provisioning || !canProvisionSource}>{provisioning ? 'Provisioning record' : 'Provision contact record'}</button>
          </div>}
          {!loading && !error && conversation && conversation.activities.length > 0 && (
            <ol className="space-y-3">
              {conversation.activities.map((activity) => (
                <li key={activity.id} className="border-l-2 border-gold pl-3" data-ui-component-content="prospect-activity-entry">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 className="text-sm font-semibold text-navy" data-ui-copy="heading">{activityLabel(activity)}</h4>
                    <time className="text-[11px] text-black/45" dateTime={activity.occurred_at}>{displayDate(activity.occurred_at)}</time>
                  </div>
                  {activity.subject && <p className="text-sm text-black/75 mt-1" data-ui-copy="body">{activity.subject}</p>}
                  {activity.body && <p className="text-sm text-black/65 mt-1 whitespace-pre-wrap" data-ui-copy="body">{activity.body}</p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-black/45">
                    {activity.delivery_status !== 'unknown' && <span>{DELIVERY_LABELS[activity.delivery_status]}</span>}
                    {activity.reply_disposition !== 'unknown' && <span>{REPLY_LABELS[activity.reply_disposition]} reply</span>}
                    {activity.meeting_outcome && <span>{activity.meeting_outcome}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <form onSubmit={saveActivity} className="border border-black/10 bg-parchment p-4 grid gap-3" data-ui-component-content="prospect-activity-form">
          <div>
            <h3 className="text-xs uppercase tracking-[0.14em] font-semibold text-navy" data-ui-copy="heading">Log confirmed activity</h3>
            <p className="text-xs text-black/50 mt-1" data-ui-copy="supporting">Saving this record does not send a message.</p>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Activity type
            <select className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={kind} onChange={(event) => setKind(event.target.value as ProspectActivityKind)} disabled={!conversation || saving}>
              {PROSPECT_ACTIVITY_KINDS.map((option) => <option key={option} value={option}>{KIND_LABELS[option]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Channel
            <select className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={kind === 'bounce' ? 'email' : kind === 'meeting' ? 'video' : channel} onChange={(event) => setChannel(event.target.value as ProspectActivityChannel)} disabled={!conversation || saving || kind === 'bounce' || kind === 'meeting'}>
              {PROSPECT_ACTIVITY_CHANNELS.map((option) => <option key={option} value={option}>{CHANNEL_LABELS[option]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Date and time
            <input type="datetime-local" className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} disabled={!conversation || saving} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Subject
            <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Optional subject" disabled={!conversation || saving} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Message or note
            <textarea className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Paste the message or summarize the conversation" disabled={!conversation || saving} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-black/65">From
              <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={fromEndpoint} onChange={(event) => setFromEndpoint(event.target.value)} placeholder="Address or profile" disabled={!conversation || saving} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-black/65">To
              <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={toEndpoints} onChange={(event) => setToEndpoints(event.target.value)} placeholder="Separate addresses with commas" disabled={!conversation || saving} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-black/65">Delivery
              <select className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={kind === 'bounce' ? 'bounced' : kind === 'message_sent' ? deliveryStatus : 'unknown'} onChange={(event) => setDeliveryStatus(event.target.value as ProspectDeliveryStatus)} disabled={!conversation || saving || kind !== 'message_sent'}>
                {MESSAGE_DELIVERY_STATUSES.map((option) => <option key={option} value={option}>{DELIVERY_LABELS[option]}</option>)}
              </select>
            </label>
            {isReply ? <label className="grid gap-1 text-xs font-semibold text-black/65">Reply disposition
              <select className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={replyDisposition} onChange={(event) => setReplyDisposition(event.target.value as ProspectReplyDisposition)} disabled={!conversation || saving}>
                {PROSPECT_REPLY_DISPOSITIONS.map((option) => <option key={option} value={option}>{REPLY_LABELS[option]}</option>)}
              </select>
            </label> : <div aria-hidden />}
          </div>
          {isMeeting && <label className="grid gap-1 text-xs font-semibold text-black/65">Meeting outcome
            <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={meetingOutcome} onChange={(event) => setMeetingOutcome(event.target.value)} placeholder="What happened or what comes next" disabled={!conversation || saving} />
          </label>}
          {error && <p className="text-xs text-red-700" data-ui-copy="supporting">{error}</p>}
          <button type="submit" className="bg-navy text-white px-4 py-2 text-xs uppercase tracking-wider font-bold disabled:opacity-50" disabled={!conversation || saving || loading}>{saving ? 'Saving' : 'Save activity'}</button>
        </form>
      </div>
      <form onSubmit={saveConversationSettings} className="border-t border-black/10 bg-white px-4 py-4 sm:px-5 grid gap-3" data-ui-component-content="prospect-contact-controls">
        <div>
          <h3 className="text-xs uppercase tracking-[0.14em] font-semibold text-navy" data-ui-copy="heading">Contact controls</h3>
          <p className="text-xs text-black/50 mt-1" data-ui-copy="supporting">Record the next action and contactability. This does not send a message.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold text-black/65">Contactability
            <select className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={contactability} onChange={(event) => setContactability(event.target.value as typeof contactability)} disabled={!conversation || settingsSaving}>
              <option value="unknown">Unknown</option><option value="eligible">Eligible</option><option value="suppressed">Suppressed</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Next action
            <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="For example, follow up" disabled={!conversation || settingsSaving} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-black/65">Due date
            <input type="datetime-local" className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={nextActionDue} onChange={(event) => setNextActionDue(event.target.value)} disabled={!conversation || settingsSaving} />
          </label>
        </div>
        {contactability === 'suppressed' && <label className="grid gap-1 text-xs font-semibold text-black/65">Suppression reason
          <input className="border border-black/15 bg-white px-3 py-2 text-sm font-normal" value={suppressionReason} onChange={(event) => setSuppressionReason(event.target.value)} placeholder="Why should outreach be paused?" disabled={!conversation || settingsSaving} />
        </label>}
        <button type="submit" className="justify-self-start bg-navy text-white px-4 py-2 text-xs uppercase tracking-wider font-bold disabled:opacity-50" disabled={!conversation || settingsSaving || loading}>{settingsSaving ? 'Saving controls' : 'Save contact controls'}</button>
      </form>
    </section>
  );
}
