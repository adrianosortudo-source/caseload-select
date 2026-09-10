"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProspectingArm,
  ProspectingControlPlaneSourcePage,
  ProspectingControlPlaneSourceRecord,
} from "@/lib/prospect-source-registry";

const API_PAGE_SIZE = 100;
const DISPLAY_PAGE_SIZE = 20;
const PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM = "prospecting_control_plane";

type History = { loading: boolean; error?: string; activities?: Array<Record<string, unknown>> };

function title(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "None recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function pill(kind: "BA" | "AE" | "unknown" | "positive" | "negative" | "neutral"): string {
  if (kind === "BA") return "border-teal/25 bg-teal/10 text-teal";
  if (kind === "AE") return "border-navy/20 bg-navy/5 text-navy";
  if (kind === "positive") return "border-green-200 bg-green-50 text-green-900";
  if (kind === "negative") return "border-red-200 bg-red-50 text-red-900";
  if (kind === "unknown") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-black/10 bg-parchment text-black/65";
}

function executionStatusLabel(record: ProspectingControlPlaneSourceRecord): string {
  return record.executionState.historyReconciled
    ? title(record.executionState.displayStatus)
    : "History not reconciled";
}

async function fetchAll(signal: AbortSignal): Promise<ProspectingControlPlaneSourceRecord[]> {
  const records: ProspectingControlPlaneSourceRecord[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const response = await fetch(`/api/admin/prospect-operations/sources?page=${page}&page_size=${API_PAGE_SIZE}`, { signal });
    const payload = await response.json().catch(() => ({})) as Partial<ProspectingControlPlaneSourcePage> & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `Could not load source records (${response.status})`);
    records.push(...(payload.records ?? []));
    pageCount = payload.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);
  return records;
}

export default function ProspectingControlPlaneRegistry() {
  const [records, setRecords] = useState<ProspectingControlPlaneSourceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [arm, setArm] = useState<"" | ProspectingArm>("");
  const [status, setStatus] = useState("");
  const [contactability, setContactability] = useState("");
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<Record<string, History>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchAll(controller.signal).then(setRecords).catch((cause: Error) => {
      if (cause.name !== "AbortError") setError(cause.message);
    });
    return () => controller.abort();
  }, []);

  const filterOptions = useMemo(() => ({
    statuses: [...new Set((records ?? []).map((record) => record.executionState.displayStatus))].sort(),
    contactability: [...new Set((records ?? []).map((record) => record.contactability?.state ?? "unknown"))].sort(),
  }), [records]);

  const filtered = useMemo(() => (records ?? []).filter((record) => {
    if (arm && record.arm !== arm) return false;
    if (status && record.executionState.displayStatus !== status) return false;
    if (contactability && (record.contactability?.state ?? "unknown") !== contactability) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [record.sourceRecordKey, record.organization.displayName, record.organization.city,
      record.organization.websiteUrl, record.person?.displayName, record.person?.primaryEmail,
      record.highLevel.contactId, record.highLevel.smartListId, ...record.highLevel.workflowIds]
      .filter(Boolean).join(" ").toLowerCase().includes(needle);
  }), [records, query, arm, status, contactability]);

  useEffect(() => setPage(0), [query, arm, status, contactability]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / DISPLAY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * DISPLAY_PAGE_SIZE, (currentPage + 1) * DISPLAY_PAGE_SIZE);

  async function readHistory(record: ProspectingControlPlaneSourceRecord) {
    setHistory((current) => ({ ...current, [record.sourceLinkId]: { loading: true } }));
    const url = `/api/admin/prospect-operations/conversations/source?source_system=${encodeURIComponent(PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM)}&source_record_key=${encodeURIComponent(record.sourceRecordKey)}&limit=100&offset=0`;
    try {
      const response = await fetch(url);
      const payload = await response.json().catch(() => ({})) as { error?: string; conversation?: { activities?: Array<Record<string, unknown>> } };
      if (!response.ok) throw new Error(payload.error ?? `Could not load history (${response.status})`);
      setHistory((current) => ({ ...current, [record.sourceLinkId]: { loading: false, activities: payload.conversation?.activities ?? [] } }));
    } catch (cause) {
      setHistory((current) => ({ ...current, [record.sourceLinkId]: { loading: false, error: (cause as Error).message } }));
    }
  }

  if (error) return <section className="rounded-lg border border-red-fail/30 bg-white p-4 text-sm text-red-fail">The Prospecting Control Plane registry could not be loaded: {error}</section>;

  return (
    <section aria-labelledby="control-plane-registry-heading" className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty" data-ui-component-content="prospecting-control-plane-registry">
      <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Prospecting Control Plane</p>
      <h2 id="control-plane-registry-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">BA and AE operating registry</h2>
      <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Review immutable source identity, reconciled contact state, known HighLevel evidence, activity history, and the provisioning receipt for every governed BA and AE prospect.</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Control Plane totals">
        {[{ name: "Loaded", value: records?.length ?? 0 }, { name: "BA", value: records?.filter((record) => record.arm === "BA").length ?? 0 }, { name: "AE", value: records?.filter((record) => record.arm === "AE").length ?? 0 }, { name: "Suppressed", value: records?.filter((record) => record.contactability?.state === "suppressed").length ?? 0 }].map((item) => <div key={item.name} className="rounded border border-border-brand bg-parchment/45 p-3"><span className="block text-xs font-semibold uppercase tracking-wide text-field-label">{item.name}</span><strong className="mt-1 block text-xl text-navy">{item.value}</strong></div>)}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Control Plane filters">
        <label className="text-xs font-semibold text-field-label">Search<input className="mt-1 w-full rounded border border-border-brand px-3 py-2 text-sm text-black" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firm, person, email, city, or record ID" /></label>
        <label className="text-xs font-semibold text-field-label">Method<select className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black" value={arm} onChange={(event) => setArm(event.target.value as "" | ProspectingArm)}><option value="">BA and AE</option><option value="BA">Beyond Agency</option><option value="AE">Adam Erhart</option><option value="unknown">Arm needs review</option></select></label>
        <label className="text-xs font-semibold text-field-label">Reconciled status<select className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{filterOptions.statuses.map((value) => <option key={value} value={value}>{value === "history_not_reconciled" ? "History not reconciled" : title(value)}</option>)}</select></label>
        <label className="text-xs font-semibold text-field-label">Contactability<select className="mt-1 w-full rounded border border-border-brand bg-white px-3 py-2 text-sm text-black" value={contactability} onChange={(event) => setContactability(event.target.value)}><option value="">All states</option>{filterOptions.contactability.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
      </div>

      <p className="mt-4 w-full text-sm text-black/60" aria-live="polite" data-ui-copy="supporting">{records === null ? "Loading governed prospects..." : `${filtered.length} of ${records.length} Control Plane source records`}</p>
      {records !== null && filtered.length === 0 ? <div className="mt-3 rounded border border-dashed border-border-brand bg-parchment/50 p-4 text-sm text-black/60">No Control Plane records match the current filters.</div> : <div className="mt-3 space-y-3">{visible.map((record) => {
        const sourceHistory = history[record.sourceLinkId];
        const conversationStatus = record.executionState.displayStatus;
        const statusTone: "positive" | "negative" | "neutral" | "unknown" = !record.executionState.historyReconciled ? "unknown" : ["replied", "meeting_scheduled", "completed"].includes(conversationStatus) ? "positive" : ["declined", "unreachable"].includes(conversationStatus) ? "negative" : "neutral";
        return <article key={record.sourceLinkId} className="rounded-lg border border-border-brand p-3 sm:p-4" data-ui-component-content={`control-plane-record-${record.sourceRecordKey}`}>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="min-w-0"><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${pill(record.arm)}`}>{record.arm}</span><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${pill(statusTone)}`}>{executionStatusLabel(record)}</span><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${pill("neutral")}`}>{title(record.contactability?.state ?? "unknown")}</span></div><h3 className="mt-2 w-full break-words text-base font-bold text-navy" data-ui-copy="heading">{record.organization.displayName}</h3><p className="mt-1 w-full break-all text-xs text-black/55" data-ui-copy="supporting">{record.sourceRecordKey}</p><p className="mt-2 w-full text-sm text-black/70" data-ui-copy="body">{record.person ? `${record.person.displayName}${record.person.primaryEmail ? `, ${record.person.primaryEmail}` : ""}` : "No person is attached to this source record."}</p></div>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5 text-black/70"><dt className="font-semibold">City</dt><dd>{record.organization.city ?? "Not recorded"}</dd><dt className="font-semibold">Website</dt><dd className="break-all">{record.organization.websiteUrl ? <a className="text-navy underline underline-offset-2" href={record.organization.websiteUrl} target="_blank" rel="noreferrer">Open website</a> : "Not recorded"}</dd><dt className="font-semibold">Source</dt><dd>{record.sourceUrl ? <a className="text-navy underline underline-offset-2" href={record.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : "Not recorded"}</dd><dt className="font-semibold">Coverage</dt><dd>{title(record.historyCoverage)}</dd></dl>
            <div className="min-w-0 text-xs leading-5 text-black/70"><p className="w-full font-semibold text-field-label" data-ui-copy="supporting">Next action</p><p className="mt-1 w-full" data-ui-copy="body">{record.executionState.historyReconciled ? record.conversation?.nextAction ?? "No next action is recorded." : "Not available until execution history is reconciled."}</p><p className="mt-1 w-full text-black/50" data-ui-copy="supporting">Due: {record.executionState.historyReconciled ? dateTime(record.conversation?.nextActionDue) : "Unknown"}</p><p className="mt-1 w-full text-black/50" data-ui-copy="supporting">Last activity: {record.executionState.historyReconciled ? dateTime(record.conversation?.lastActivityAt) : "Unknown"}</p></div>
          </div>
          <div className="mt-3 rounded border border-amber-300/70 bg-amber-50/60 p-3" data-ui-component-content={`control-plane-execution-${record.sourceRecordKey}`}>
            <h4 className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="heading">HighLevel and journey evidence</h4>
            <dl className="mt-2 grid min-w-0 gap-x-3 gap-y-1 text-xs leading-5 text-black/70 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
              <dt className="font-semibold">Method</dt><dd className="break-words">{record.executionState.method ? title(record.executionState.method) : "Not recorded"}</dd>
              <dt className="font-semibold">Current stage</dt><dd>Unknown</dd>
              <dt className="font-semibold">Location ID</dt><dd className="break-all">{record.highLevel.locationId ?? "Not recorded"}</dd>
              <dt className="font-semibold">Contact ID</dt><dd className="break-all">{record.highLevel.contactId ?? "Not recorded"}</dd>
              <dt className="font-semibold">Smart List ID</dt><dd className="break-all">{record.highLevel.smartListId ?? "Not recorded"}</dd>
              <dt className="font-semibold">Workflow IDs</dt><dd className="break-all">{record.highLevel.workflowIds.length > 0 ? record.highLevel.workflowIds.join(", ") : "Not recorded"}</dd>
            </dl>
            {!record.executionState.historyReconciled && <p className="mt-2 w-full text-xs text-amber-950" data-ui-copy="body">The identifiers above are source-ledger evidence. Current stage and contact status remain unknown until activity history is reconciled.</p>}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <details className="rounded border border-border-brand bg-parchment/35 p-3"><summary className="cursor-pointer text-xs font-semibold text-navy">Immutable source and receipt</summary><dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5 text-black/70"><dt className="font-semibold">Source system</dt><dd className="break-all">{record.sourceSystem}</dd><dt className="font-semibold">Source link</dt><dd className="break-all">{record.sourceLinkId}</dd><dt className="font-semibold">Source created</dt><dd>{dateTime(record.sourceCreatedAt)}</dd><dt className="font-semibold">Source active</dt><dd>{record.sourceActive ? "Yes" : "No"}</dd><dt className="font-semibold">Organization</dt><dd className="break-all">{record.organization.id}</dd><dt className="font-semibold">Person</dt><dd className="break-all">{record.person?.id ?? "Not attached"}</dd><dt className="font-semibold">Phone</dt><dd>{record.person?.primaryPhone ?? "Not recorded"}</dd><dt className="font-semibold">Conversation</dt><dd className="break-all">{record.conversation?.id ?? "Not attached"}</dd><dt className="font-semibold">Receipt</dt><dd className="break-all">{record.provisioningReceipt?.id ?? "Not recorded"}</dd><dt className="font-semibold">Provisioned</dt><dd>{dateTime(record.provisioningReceipt?.createdAt)}</dd><dt className="font-semibold">Idempotency</dt><dd className="break-all">{record.provisioningReceipt?.idempotencyKey ?? "Not recorded"}</dd><dt className="font-semibold">Operator</dt><dd className="break-all">{record.provisioningReceipt?.provisionedByOperatorId ?? "Not recorded"}</dd><dt className="font-semibold">Basis</dt><dd>{record.provisioningReceipt?.provisioningBasis ?? "Not recorded"}</dd></dl><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-navy p-3 text-[11px] leading-5 text-white">{JSON.stringify(record.sourcePayload, null, 2)}</pre></details>
            <details className="rounded border border-border-brand bg-parchment/35 p-3" onToggle={(event) => { if (event.currentTarget.open && !sourceHistory) void readHistory(record); }}><summary className="cursor-pointer text-xs font-semibold text-navy">Read activity history</summary>{sourceHistory?.loading && <p className="mt-3 text-xs text-black/55">Loading verified activity history...</p>}{sourceHistory?.error && <p className="mt-3 text-xs text-red-fail">{sourceHistory.error}</p>}{sourceHistory && !sourceHistory.loading && !sourceHistory.error && (sourceHistory.activities?.length ?? 0) === 0 && <p className="mt-3 text-xs text-black/55">{record.executionState.historyReconciled ? "No reconciled activity entries are available." : "History not reconciled. No local activity entries are available as execution proof."}</p>}{(sourceHistory?.activities ?? []).length > 0 && <ol className="mt-3 space-y-2">{sourceHistory!.activities!.map((activity) => <li key={String(activity.id)} className="rounded border border-border-brand bg-white p-3 text-xs leading-5 text-black/75"><p className="font-semibold text-navy">{title(String(activity.kind))} · {title(String(activity.channel))} · {dateTime(String(activity.occurred_at))}</p>{activity.subject ? <p className="mt-2 font-semibold">{String(activity.subject)}</p> : null}{activity.body ? <p className="mt-1 whitespace-pre-wrap break-words">{String(activity.body)}</p> : null}<p className="mt-2 text-black/50">{title(String(activity.delivery_status))} · {title(String(activity.response_kind))} response · {title(String(activity.reply_disposition))} disposition · {title(String(activity.provenance_system))}</p></li>)}</ol>}</details>
          </div>
        </article>;
      })}</div>}
      {filtered.length > DISPLAY_PAGE_SIZE && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-black/60"><span>Showing {currentPage * DISPLAY_PAGE_SIZE + 1} to {Math.min((currentPage + 1) * DISPLAY_PAGE_SIZE, filtered.length)} of {filtered.length}</span><div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded border border-border-brand px-3 py-2 font-semibold text-navy disabled:opacity-50">Previous</button><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded border border-border-brand px-3 py-2 font-semibold text-navy disabled:opacity-50">Next</button></div></div>}
    </section>
  );
}
