import type { ProspectSourceContactState } from '@/lib/prospect-operations-types';

const STATUS_LABELS: Record<ProspectSourceContactState['status'], string> = {
  not_contacted: 'Not contacted',
  awaiting_reply: 'Awaiting reply',
  replied: 'Replied',
  unreachable: 'Unreachable',
  declined: 'Declined',
  meeting_scheduled: 'Meeting scheduled',
  completed: 'Completed',
};

const STATUS_CLASSES: Record<ProspectSourceContactState['status'], string> = {
  not_contacted: 'border-black/10 bg-parchment text-black/70',
  awaiting_reply: 'border-amber-200 bg-amber-50 text-amber-900',
  replied: 'border-green-200 bg-green-50 text-green-900',
  unreachable: 'border-red-200 bg-red-50 text-red-900',
  declined: 'border-red-200 bg-red-50 text-red-900',
  meeting_scheduled: 'border-blue-200 bg-blue-50 text-blue-900',
  completed: 'border-green-200 bg-green-50 text-green-900',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(date);
}

export function ProspectContactStatus({
  state,
  loading,
  error,
  sourceRecordKey,
  onOpenHistory,
}: {
  state?: ProspectSourceContactState;
  loading?: boolean;
  error?: string | null;
  sourceRecordKey?: string | null;
  onOpenHistory?: () => void;
}) {
  const lastActivity = formatDate(state?.last_activity_at ?? null);
  const statusClass = error
    ? 'border-red-200 bg-red-50 text-red-900'
    : state
      ? STATUS_CLASSES[state.status]
      : 'border-black/10 bg-parchment text-black/70';

  return (
    <div className="min-w-[11rem] space-y-2" data-ui-component-content="prospect-contact-status">
      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass}`} data-ui-copy="supporting" data-contact-status={state?.status ?? 'unknown'}>
        {loading ? 'Checking contact status' : error ? 'Status unavailable' : state ? STATUS_LABELS[state.status] : sourceRecordKey ? 'No contact record' : 'History unavailable'}
      </span>
      {error && <span className="block text-xs text-red-700" data-ui-copy="supporting">Contact status could not be loaded.</span>}
      {lastActivity && <span className="block text-xs text-black/55" data-ui-copy="supporting">Last activity {lastActivity}</span>}
      {state?.next_action && <span className="block text-xs text-black/55" data-ui-copy="supporting">Next: {state.next_action}</span>}
      {!sourceRecordKey && <span className="block text-xs text-black/50" data-ui-copy="supporting">This record has no stable source key.</span>}
      {sourceRecordKey && onOpenHistory && (
        <button type="button" onClick={onOpenHistory} className="rounded border border-navy px-2 py-1 text-xs font-semibold text-navy hover:bg-parchment" data-ui-copy="action">
          View history
        </button>
      )}
    </div>
  );
}
