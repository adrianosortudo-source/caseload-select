'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { canApproveAgencyFollowupMessage } from '@/lib/agency-followup-ui';

type Journey = {
  id: string; name: string; journeyKey: string; version: number; state: string;
  timezone: string; businessDays: number[]; localWindowStart: string; localWindowEnd: string;
  minimumSpacingHours: number; stepCount: number;
};
type TemplateVersion = { id: string; templateKey: string; version: number; state: string; subject: string; body: string };
type QueueItem = {
  id: string; enrollmentId: string; prospectId: string; firmName: string; prospectStage: string;
  journeyName: string; stepNumber: number; state: string; eligibility: string;
  contactability: string; conversationStatus: string; recipientEmail: string; subject: string;
  body: string; scheduledAt: string | null; blockers: string[]; sequenceReleased: boolean;
};
type ConsoleData = { send: { mode: 'off' | 'test' | 'live'; ready: boolean }; journeys: Journey[]; templates: TemplateVersion[]; items: QueueItem[] };
type ProspectMatch = { id: string; firm_name: string; contact_name?: string | null; contact_email?: string | null; stage?: string };

const BLOCKER_LABELS: Record<string, string> = {
  eligibility_pending: 'Eligibility has not been recorded',
  eligibility_unknown: 'Eligibility is unknown',
  eligibility_not_approved: 'Eligibility is not approved with evidence',
  eligibility_evidence_missing: 'Eligibility evidence is missing',
  sequence_not_released: 'This prospect has not been released',
  message_not_approved: 'This message needs individual approval',
  approval_missing: 'This message needs individual approval',
  approval_stale_recipient: 'Recipient details changed after approval',
  approval_stale_content: 'Message content changed after approval',
  recipient_email_invalid: 'A valid contact email is required',
  recipient_identity_missing: 'Recipient identity is incomplete',
  prospect_mismatch: 'The message is not linked to this prospect',
  contactability_unknown: 'Contactability history is incomplete',
  contactability_blocked: 'Prospect operations have placed a hold',
  conversation_stopped: 'A reply, booking, bounce, or completed conversation stops follow-up',
  prospect_status_stopped: 'Current prospect stage stops follow-up',
  cancelled: 'This message or enrollment is stopped',
  not_due: 'This message is not due yet',
  minimum_spacing_not_elapsed: 'Minimum spacing between messages has not passed',
  invalid_schedule: 'The message schedule is invalid',
  approval_invalid_reviewer_or_time: 'Approval reviewer or time is missing or invalid',
};

function prettyState(value: string): string {
  return value.replaceAll('_', ' ');
}

function normalizeJourneyKey(value: string): string {
  return value.trim().toLowerCase();
}

export default function AgencyFollowupClient({ initialData }: { initialData: ConsoleData }) {
  const router = useRouter();
  const [journeys, setJourneys] = useState(initialData.journeys);
  const [journeyId, setJourneyId] = useState(initialData.journeys.find((item) => item.state === 'active')?.id ?? '');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<ProspectMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [evidenceByEnrollment, setEvidenceByEnrollment] = useState<Record<string, string>>({});
  const [basisByEnrollment, setBasisByEnrollment] = useState<Record<string, string>>({});
  const [templateKey, setTemplateKey] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [journeyKey, setJourneyKey] = useState('');
  const [journeyName, setJourneyName] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [businessDays, setBusinessDays] = useState([1, 2, 3, 4, 5]);
  const [localWindowStart, setLocalWindowStart] = useState('09:00');
  const [localWindowEnd, setLocalWindowEnd] = useState('17:00');
  const [minimumSpacingHours, setMinimumSpacingHours] = useState('168');
  const [journeySteps, setJourneySteps] = useState([{ templateVersionId: '', delayBusinessDays: '0' }]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/agency-crm/follow-up', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; journeyId?: string; version?: number };
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
      router.refresh();
      return result;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function findProspects(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`/api/admin/agency-crm/prospects?q=${encodeURIComponent(search)}&limit=20`);
      const result = await response.json() as { items?: ProspectMatch[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Prospect search failed');
      setMatches(result.items ?? []);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const byEnrollment = new Map<string, QueueItem[]>();
  for (const item of initialData.items) {
    const group = byEnrollment.get(item.enrollmentId) ?? [];
    group.push(item);
    byEnrollment.set(item.enrollmentId, group);
  }
  const sendStatus = initialData.send.mode === 'off'
    ? 'Sending is off. Approved messages stay queued.'
    : !initialData.send.ready
      ? 'Sending is unavailable until required configuration is complete.'
      : initialData.send.mode === 'test'
        ? 'Test mode is limited to allowlisted recipients and records.'
        : 'Live mode is enabled. Each dispatch is limited to one message.';

  return (
    <main className="w-full min-w-0 space-y-6">
      <header data-ui-component-content="agency-follow-up-heading" className="w-full min-w-0 space-y-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold" data-ui-copy="supporting">Agency CRM</p>
          <h1 className="mt-1 w-full text-2xl font-bold text-navy" data-ui-copy="heading">Follow-up journeys</h1>
          <p className="mt-2 w-full text-sm leading-6 text-black/65 [text-wrap:pretty]" data-ui-copy="body">
            Review one prospect at a time. Record eligibility, release, and each message approval separately.
          </p>
          <p className="mt-1 w-full text-sm leading-6 text-black/65 [text-wrap:pretty]" data-ui-copy="supporting">Approvals enqueue reviewed messages. {sendStatus}</p>
        </div>
        <a className="shrink-0 text-sm font-semibold text-navy underline" href="/admin/agency-crm">Return to Agency CRM</a>
      </header>

      {error && <div role="alert" className="w-full border border-red-200 bg-white px-4 py-3 text-sm text-red-800">{error}</div>}

      <section aria-labelledby="author-title" className="w-full min-w-0 border border-black/10 bg-white p-4 sm:p-5">
        <div data-ui-component-content="agency-follow-up-authoring" className="w-full min-w-0 space-y-5">
        <div className="w-full min-w-0">
          <h2 id="author-title" data-ui-copy="heading" className="w-full text-lg font-semibold text-navy">Author versioned journeys</h2>
          <p data-ui-copy="supporting" className="mt-1 w-full text-sm leading-6 text-black/60 [text-wrap:pretty]">Template content is immutable after creation. New copy or schedule changes create new versions.</p>
        </div>
        <form className="grid w-full min-w-0 gap-3 lg:grid-cols-3" onSubmit={async (event) => {
          event.preventDefault();
          if (await act({ action: 'template_create', templateKey, subject: templateSubject, body: templateBody })) {
            setTemplateKey(''); setTemplateSubject(''); setTemplateBody('');
          }
        }}>
          <label className="block min-w-0 text-sm font-medium text-black/80">Template key
            <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} placeholder="intro-email" />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80">Email subject
            <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={templateSubject} onChange={(event) => setTemplateSubject(event.target.value)} />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80 lg:col-span-3">Email body
            <textarea className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" rows={4} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} />
          </label>
          <button className="justify-self-start bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !templateKey.trim() || !templateSubject.trim() || !templateBody.trim()}>Create template draft</button>
        </form>

        {initialData.templates.length > 0 && <div className="grid w-full min-w-0 gap-3 sm:grid-cols-2">
          {initialData.templates.map((template) => <article key={template.id} className="w-full min-w-0 border border-black/10 p-3">
            <h3 className="w-full break-words font-semibold text-navy">{template.templateKey} v{template.version} · {prettyState(template.state)}</h3>
            <p className="mt-1 w-full break-words text-sm text-black/70">{template.subject}</p>
            <p className="mt-1 w-full whitespace-pre-wrap break-words text-sm leading-6 text-black/60">{template.body}</p>
            {template.state === 'draft' && <button className="mt-2 text-sm font-semibold text-navy underline disabled:opacity-50" disabled={busy} onClick={() => act({ action: 'template_approve', templateVersionId: template.id })}>Approve template v{template.version}</button>}
          </article>)}
        </div>}

        <form className="grid w-full min-w-0 gap-3 border-t border-black/10 pt-4 lg:grid-cols-2" onSubmit={async (event) => {
          event.preventDefault();
          const steps = journeySteps.map((step) => ({ templateVersionId: step.templateVersionId, delayBusinessDays: Number(step.delayBusinessDays) }));
          const result = await act({
            action: 'journey_create', journeyKey, name: journeyName, timezone,
            businessDays, localWindowStart, localWindowEnd, minimumSpacingHours: Number(minimumSpacingHours),
            steps,
          });
          if (result?.journeyId && result.version) {
            setJourneys((current) => [{
              id: result.journeyId!, name: journeyName, journeyKey: normalizeJourneyKey(journeyKey), version: result.version!, state: 'draft',
              timezone, businessDays: [...businessDays], localWindowStart, localWindowEnd,
              minimumSpacingHours: Number(minimumSpacingHours), stepCount: steps.length,
            }, ...current.filter((journey) => journey.id !== result.journeyId)]);
          }
        }}>
          <h3 data-ui-copy="heading" className="w-full text-base font-semibold text-navy lg:col-span-2">Create a journey version</h3>
          <label className="block min-w-0 text-sm font-medium text-black/80">Journey key
            <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={journeyKey} onChange={(event) => setJourneyKey(event.target.value)} placeholder="diagnostic-follow-up" />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80">Journey name
            <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={journeyName} onChange={(event) => setJourneyName(event.target.value)} />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80">IANA timezone
            <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Toronto" />
          </label>
          <fieldset className="min-w-0 text-sm text-black/80">
            <legend className="font-medium">Business days</legend>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
              {[[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']].map(([day, label]) => <label key={day} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={businessDays.includes(Number(day))} onChange={() => setBusinessDays((current) => current.includes(Number(day)) ? current.filter((value) => value !== Number(day)) : [...current, Number(day)].sort())} />{label}
              </label>)}
            </div>
          </fieldset>
          <label className="block min-w-0 text-sm font-medium text-black/80">Local window start
            <input type="time" className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={localWindowStart} onChange={(event) => setLocalWindowStart(event.target.value)} />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80">Local window end
            <input type="time" className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={localWindowEnd} onChange={(event) => setLocalWindowEnd(event.target.value)} />
          </label>
          <label className="block min-w-0 text-sm font-medium text-black/80">Minimum spacing between scheduled messages, hours
            <input type="number" min="0" max="8760" className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={minimumSpacingHours} onChange={(event) => setMinimumSpacingHours(event.target.value)} />
          </label>
          <div className="grid w-full min-w-0 gap-2 lg:col-span-2">
            <p className="w-full text-sm font-medium text-black/80">Ordered steps</p>
            {journeySteps.map((step, index) => <div key={index} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
              <label className="block min-w-0 text-sm text-black/80">Template version
                <select className="mt-1 block w-full min-w-0 border border-black/20 bg-white px-3 py-2" value={step.templateVersionId} onChange={(event) => setJourneySteps((current) => current.map((item, stepIndex) => stepIndex === index ? { ...item, templateVersionId: event.target.value } : item))}>
                  <option value="">Choose approved template</option>
                  {initialData.templates.filter((template) => template.state === 'approved').map((template) => <option key={template.id} value={template.id}>{template.templateKey} v{template.version}</option>)}
                </select>
              </label>
              <label className="block min-w-0 text-sm text-black/80">Delay, business days
                <input type="number" min="0" max="3650" className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={step.delayBusinessDays} onChange={(event) => setJourneySteps((current) => current.map((item, stepIndex) => stepIndex === index ? { ...item, delayBusinessDays: event.target.value } : item))} />
              </label>
              {journeySteps.length > 1 && <button type="button" className="self-end px-2 py-2 text-sm text-red-800 underline" onClick={() => setJourneySteps((current) => current.filter((_, stepIndex) => stepIndex !== index))}>Remove step</button>}
            </div>)}
            <div className="flex flex-wrap gap-3">
              <button type="button" className="text-sm font-semibold text-navy underline" onClick={() => setJourneySteps((current) => [...current, { templateVersionId: '', delayBusinessDays: '0' }])} disabled={journeySteps.length >= 100}>Add step</button>
              <button className="bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !journeyKey.trim() || !journeyName.trim() || journeySteps.some((step) => !step.templateVersionId) || initialData.templates.every((template) => template.state !== 'approved')}>Save draft journey version</button>
            </div>
          </div>
        </form>

        {journeys.length > 0 && <div className="grid w-full min-w-0 gap-2 border-t border-black/10 pt-4">
          <h3 className="w-full text-base font-semibold text-navy">Journey versions</h3>
          {journeys.map((journey) => <div key={journey.id} className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 border border-black/10 p-3">
            <p className="min-w-0 flex-1 break-words text-sm text-black/80">{journey.name} v{journey.version} · {prettyState(journey.state)} · {journey.timezone} · {journey.businessDays.length} days · {journey.localWindowStart} to {journey.localWindowEnd} · {journey.minimumSpacingHours}h spacing · {journey.stepCount} steps</p>
            {journey.state === 'draft' && journey.stepCount > 0 && <button className="shrink-0 text-sm font-semibold text-navy underline disabled:opacity-50" disabled={busy} onClick={async () => {
              if (await act({ action: 'journey_activate', journeyId: journey.id })) {
                setJourneys((current) => current.map((item) => item.id === journey.id
                  ? { ...item, state: 'active' }
                  : normalizeJourneyKey(item.journeyKey) === normalizeJourneyKey(journey.journeyKey) && item.state === 'active'
                    ? { ...item, state: 'retired' }
                    : item));
              }
            }}>Activate version</button>}
          </div>)}
        </div>}
        </div>
      </section>

      <section aria-labelledby="enroll-title" className="w-full min-w-0 border border-black/10 bg-white p-2 sm:p-5">
        <div data-ui-component-content="agency-follow-up-enrollment" className="w-full min-w-0">
        <h2 id="enroll-title" data-ui-copy="heading" className="w-full text-lg font-semibold text-navy">Start a prospect review</h2>
        <p data-ui-copy="supporting" className="mt-1 w-full text-sm leading-6 text-black/60">Enrollment creates a draft with message snapshots. It does not contact the prospect.</p>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
          <label className="block min-w-0 text-sm font-medium text-black/80">
            Journey version
            <select className="mt-1 block w-full min-w-0 border border-black/20 bg-white px-3 py-2" value={journeyId} onChange={(event) => setJourneyId(event.target.value)}>
              <option value="">Choose a journey</option>
              {journeys.filter((journey) => journey.state === 'active').map((journey) =>
                <option key={journey.id} value={journey.id}>{journey.name} v{journey.version}</option>)}
            </select>
          </label>
          <form onSubmit={findProspects} className="flex min-w-0 items-end gap-2">
            <label className="block min-w-0 flex-1 text-sm font-medium text-black/80">
              Find one prospect
              <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Firm or contact name" />
            </label>
            <button className="shrink-0 bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || search.trim().length < 2}>Search</button>
          </form>
        </div>
        {matches.length > 0 && <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
          {matches.map((prospect) => <li key={prospect.id} className="min-w-0 border border-black/10 p-3">
            <p className="break-words font-semibold text-navy">{prospect.firm_name}</p>
            <p className="mt-1 break-words text-sm text-black/65">{prospect.contact_name || 'No contact name'} · {prospect.contact_email || 'No email'} · {prettyState(prospect.stage || 'unknown')}</p>
            <button className="mt-2 text-sm font-semibold text-navy underline disabled:opacity-50" disabled={busy || !journeyId || !prospect.contact_email} onClick={async () => {
              if (await act({ action: 'enroll', journeyId, prospectId: prospect.id })) setMatches([]);
            }}>Create draft review</button>
          </li>)}
        </ul>}
        </div>
      </section>

      <section data-ui-component-content="agency-follow-up-queue" aria-labelledby="queue-title" className="w-full min-w-0 space-y-4">
        <div className="space-y-1">
          <h2 id="queue-title" data-ui-copy="heading" className="w-full text-lg font-semibold text-navy">Prospect review queue</h2>
          <p data-ui-copy="supporting" className="w-full text-sm text-black/55">{byEnrollment.size} prospect{byEnrollment.size === 1 ? '' : 's'} · {initialData.items.length} message{initialData.items.length === 1 ? '' : 's'}</p>
        </div>
        {byEnrollment.size === 0 && <div className="w-full border border-black/10 bg-white p-5 text-sm leading-6 text-black/65">No follow-up drafts yet. Choose an active journey and a prospect above to create the first review.</div>}
        {[...byEnrollment.entries()].map(([enrollmentId, items]) => {
          const first = items[0];
          return <article key={enrollmentId} className="w-full min-w-0 border border-black/10 bg-white p-4 sm:p-5">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-base font-semibold text-navy">{first.firmName}</h3>
                <p className="mt-1 break-words text-sm text-black/65">{first.recipientEmail || 'No email'} · {first.journeyName} · {prettyState(first.prospectStage)}</p>
                <p className="mt-1 text-xs text-black/55">Contactability: {prettyState(first.contactability)} · Conversation: {prettyState(first.conversationStatus)} · Eligibility: {prettyState(first.eligibility)}</p>
              </div>
              <span className="shrink-0 border border-black/15 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-black/70">{first.sequenceReleased ? 'Released' : 'Draft'}</span>
            </div>

            <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
              {items.map((item) => <section key={item.id} className={`w-full min-w-0 border border-black/10 p-3 ${items.length === 1 ? 'lg:col-span-2' : ''}`}>
                <div data-ui-component-content="agency-follow-up-message" className="w-full min-w-0">
                <div className="space-y-1">
                  <span data-ui-copy="supporting" className="block w-full text-xs font-semibold uppercase tracking-wide text-black/60">Message {item.stepNumber}</span>
                  <h4 data-ui-copy="heading" className="w-full break-words text-sm font-semibold text-navy sm:text-base [text-wrap:pretty]">{item.subject || 'No subject'}</h4>
                  <span className="block w-full text-xs uppercase tracking-wide text-black/60">{prettyState(item.state)}</span>
                </div>
                <p data-ui-copy="body" className="mt-2 w-full whitespace-pre-wrap break-words text-sm leading-6 text-black/75 [text-wrap:pretty]">{item.body}</p>
                </div>
                {item.blockers.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-5 text-red-800">
                  {[...new Set(item.blockers.map((blocker) => BLOCKER_LABELS[blocker] ?? prettyState(blocker)))].map((label) => <li key={label}>{label}</li>)}
                </ul>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canApproveAgencyFollowupMessage({ messageState: item.state, sequenceReleased: item.sequenceReleased, blockers: item.blockers }) && <button className="border border-navy px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50" disabled={busy} onClick={() => act({ action: 'approve', enrollmentId, messageId: item.id })}>Approve this message</button>}
                </div>
              </section>)}
            </div>

            <div className="mt-4 grid min-w-0 gap-3 border-t border-black/10 pt-4 lg:grid-cols-2">
              <form className="flex min-w-0 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void act({ action: 'eligibility', enrollmentId, state: 'eligible', evidenceRef: evidenceByEnrollment[enrollmentId] }); }}>
                <label className="text-sm font-medium text-black/80">Eligibility evidence for this prospect
                  <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={evidenceByEnrollment[enrollmentId] ?? ''} onChange={(event) => setEvidenceByEnrollment((current) => ({ ...current, [enrollmentId]: event.target.value }))} placeholder="Source or note supporting eligibility" />
                </label>
                <button className="self-start border border-navy px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50" disabled={busy || !(evidenceByEnrollment[enrollmentId] ?? '').trim()}>Record eligible</button>
              </form>
              <form className="flex min-w-0 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void act({ action: 'release', enrollmentId, basis: basisByEnrollment[enrollmentId] }); }}>
                <label className="text-sm font-medium text-black/80">Individual release basis
                  <input className="mt-1 block w-full min-w-0 border border-black/20 px-3 py-2" value={basisByEnrollment[enrollmentId] ?? ''} onChange={(event) => setBasisByEnrollment((current) => ({ ...current, [enrollmentId]: event.target.value }))} placeholder="Why this prospect may enter review" />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button className="self-start border border-navy px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50" disabled={busy || first.sequenceReleased || first.eligibility !== 'eligible' || !(basisByEnrollment[enrollmentId] ?? '').trim()}>Release this prospect</button>
                  {first.sequenceReleased && <button type="button" className="self-start border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50" disabled={busy} onClick={() => act({ action: 'pause', enrollmentId, reason: 'Paused by operator from follow-up review queue' })}>Pause journey</button>}
                </div>
              </form>
            </div>
          </article>;
        })}
      </section>
    </main>
  );
}
