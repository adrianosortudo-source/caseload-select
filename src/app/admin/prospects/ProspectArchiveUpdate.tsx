"use client";

import { useMemo, useRef, useState } from "react";

export type ProspectArchiveUpdateSource = "highlevel" | "import";

export type ProspectArchiveUpdatePreview = {
  source: ProspectArchiveUpdateSource;
  newRecords: number;
  unchangedRecords: number;
  heldRecords: number;
  unclassifiedRecords: number;
  incompleteRecords: number;
  preparedAt: string;
};

export type ProspectArchiveUpdateReceipt = {
  id: string;
  recordedAt: string;
  source: ProspectArchiveUpdateSource;
  appliedRecords: number;
  unchangedRecords: number;
};

/**
 * The data connection owns preparation, preview and application. This surface
 * is deliberately passive until that contract is supplied by a verified API.
 */
export type ProspectArchiveUpdateContract = {
  status: "unavailable" | "preparing" | "ready" | "applying";
  preview?: ProspectArchiveUpdatePreview;
  receipt?: ProspectArchiveUpdateReceipt;
  noChanges?: boolean;
  onApplyReviewedUpdate?: () => void | Promise<void>;
};

type SourceOption = {
  value: ProspectArchiveUpdateSource;
  label: string;
  note: string;
};

const sourceOptions: readonly SourceOption[] = [
  {
    value: "highlevel",
    label: "HighLevel direct sync",
    note: "Direct sync needs a verified connection. It is not connected in this console yet.",
  },
  {
    value: "import",
    label: "Import history bundle",
    note: "Upload requires a supported history bundle. No bundle parser is connected yet.",
  },
];

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function sourceLabel(source: ProspectArchiveUpdateSource): string {
  return source === "highlevel" ? "HighLevel direct sync" : "Import history bundle";
}

export default function ProspectArchiveUpdate({ contract }: { contract?: ProspectArchiveUpdateContract }) {
  const [source, setSource] = useState<ProspectArchiveUpdateSource>("highlevel");
  const [prepareRequested, setPrepareRequested] = useState(false);
  const [applyRequested, setApplyRequested] = useState(false);
  const [localContract, setLocalContract] = useState<ProspectArchiveUpdateContract>({ status: "unavailable" });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => sourceOptions.find((option) => option.value === source)!, [source]);
  const activeContract = contract ?? localContract;
  const preview = activeContract.preview?.source === source ? activeContract.preview : undefined;
  const isApplying = activeContract.status === "applying";
  const canApply = Boolean(preview && activeContract.status === "ready" && activeContract.onApplyReviewedUpdate && !isApplying);

  async function applyReviewedUpdate() {
    if (!canApply || !activeContract.onApplyReviewedUpdate) return;
    setApplyRequested(true);
    try {
      await activeContract.onApplyReviewedUpdate();
    } finally {
      setApplyRequested(false);
    }
  }

  const categories = [
    ["New", preview?.newRecords],
    ["Unchanged", preview?.unchangedRecords],
    ["Held", preview?.heldRecords],
    ["Unclassified", preview?.unclassifiedRecords],
    ["Incomplete", preview?.incompleteRecords],
  ] as const;

  async function prepareBundle(file: File) {
    if (file.size > 2 * 1024 * 1024) { setError("This history bundle is larger than the 2 MB preview limit."); return; }
    setError(null);
    setPrepareRequested(true);
    setLocalContract({ status: "preparing" });
    try {
      const bundle = JSON.parse(await file.text());
      const response = await fetch("/api/admin/prospect-operations/archive-updates/preview", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; receipt?: { prepared_at?: string; new_records?: number; unchanged_records?: number; held_records?: number; unclassified_records?: number; incomplete_records?: number; digest?: string } };
      if (!response.ok || !payload.receipt) throw new Error(payload.error ?? "The archive preview could not be prepared.");
      setLocalContract({
        status: "ready",
        preview: { source: "import", newRecords: payload.receipt.new_records ?? 0, unchangedRecords: payload.receipt.unchanged_records ?? 0, heldRecords: payload.receipt.held_records ?? 0, unclassifiedRecords: payload.receipt.unclassified_records ?? 0, incompleteRecords: payload.receipt.incomplete_records ?? 0, preparedAt: payload.receipt.prepared_at ?? new Date().toISOString() },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The history bundle could not be read.");
      setLocalContract({ status: "unavailable" });
    }
  }

  return (
    <section
      aria-labelledby="prospect-archive-update-heading"
      className="rounded-lg border border-border-brand bg-white p-4 sm:p-5 [&_[data-ui-copy]]:text-pretty"
      data-ui-component-content="prospect-archive-update"
    >
      <p className="w-full text-xs font-semibold uppercase tracking-wider text-gold-on-light" data-ui-copy="supporting">Archive operations</p>
      <h2 id="prospect-archive-update-heading" className="mt-1 w-full text-xl font-bold text-navy" data-ui-copy="heading">Update prospect archive</h2>
      <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Prepare a safe, incremental update before any history enters the prospect archive. This panel cannot contact HighLevel, change a workflow, or send a message.</p>

      <fieldset className="mt-4 grid gap-2 sm:grid-cols-2" aria-describedby="archive-source-guidance">
        <legend className="w-full text-xs font-semibold uppercase tracking-wide text-field-label">Update source</legend>
          {sourceOptions.map((option) => (
            <label key={option.value} className={`cursor-pointer rounded border p-3 ${source === option.value ? "border-navy bg-navy/[0.03]" : "border-border-brand bg-parchment/30"}`}>
            <span className="flex items-start gap-2">
              <input type="radio" name="archive-source" value={option.value} checked={source === option.value} onChange={() => { setSource(option.value); setPrepareRequested(false); setError(null); }} className="mt-1" />
              <span className="min-w-0 text-sm font-semibold text-navy">{option.label}</span>
            </span>
            <span className="mt-1 block w-full text-xs leading-5 text-black/60">{option.note}</span>
          </label>
        ))}
      </fieldset>
      <p id="archive-source-guidance" className="mt-3 w-full text-sm text-black/60" data-ui-copy="supporting">{selected.note}</p>
      {source === "import" && <div className="mt-3 rounded border border-border-brand bg-parchment/30 p-3">
        <label className="block w-full text-xs font-semibold uppercase tracking-wide text-field-label">History bundle (.json)
          <input ref={inputRef} type="file" accept="application/json,.json" className="mt-2 block w-full text-sm text-black" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void prepareBundle(file); }} />
        </label>
        <p className="mt-2 w-full text-xs text-black/60">The server checks the bundle against the protected BA/AE source registry. It creates no archive records at this stage.</p>
      </div>}
      {error && <p className="mt-3 w-full rounded border border-red-fail/30 bg-red-50 p-3 text-sm text-red-fail" role="alert">{error}</p>}

      <div className="mt-4 rounded border border-amber-300/70 bg-amber-50/60 p-3" data-ui-component-content="prospect-archive-update-state">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Preparation status</p>
        <p className="mt-1 w-full text-sm text-black/75" aria-live="polite" data-ui-copy="body">
          {activeContract.status === "preparing" ? "Preparing a verified update preview..." : activeContract.status === "ready" && preview ? `Preview prepared ${dateTime(preview.preparedAt)}.` : activeContract.status === "applying" ? "Applying the reviewed update through the verified connection..." : prepareRequested ? "Choose a supported history bundle for preview. Direct HighLevel sync remains unavailable until its connection is verified." : "Choose a source, then prepare a preview when its connection is available."}
        </p>
        <button type="button" onClick={() => { setPrepareRequested(true); if (source === "import") inputRef.current?.click(); }} disabled={activeContract.status === "preparing" || isApplying} className="mt-3 rounded border border-navy px-3 py-2 text-sm font-semibold text-navy hover:bg-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
          {activeContract.status === "preparing" ? "Preparing preview" : source === "import" ? "Choose history bundle" : "Prepare update preview"}
        </button>
      </div>

      <div className="mt-4">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Preview</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Archive update preview categories">
          {categories.map(([label, value]) => <div key={label} className="rounded border border-border-brand bg-parchment/45 p-3"><span className="block text-xs font-semibold uppercase tracking-wide text-field-label">{label}</span><strong className="mt-1 block text-xl text-navy">{typeof value === "number" ? value : "Not prepared"}</strong></div>)}
        </div>
        <p className="mt-3 w-full text-sm text-black/60" data-ui-copy="body">{preview ? "Review held, unclassified, and incomplete items before applying. Unchanged items remain untouched." : "Counts appear only after the connection produces a verified preview. This panel does not invent a successful result."}</p>
      </div>

      <div className="mt-4 rounded border border-border-brand bg-parchment/30 p-3" data-ui-component-content="prospect-archive-update-apply">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Apply reviewed update</p>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">One reviewed action will be available only after the future verified API supplies a preview and an authorized apply function.</p>
        <button type="button" onClick={() => void applyReviewedUpdate()} disabled={!canApply || applyRequested} className="mt-3 rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-45">
          {isApplying || applyRequested ? "Applying reviewed update" : "Apply reviewed update"}
        </button>
        {!canApply && <p className="mt-2 w-full text-xs text-black/55" data-ui-copy="supporting">Application is unavailable until a verified preview and authorized update contract are present.</p>}
      </div>

      {(activeContract.receipt || activeContract.noChanges) && <div className="mt-4 rounded border border-teal/25 bg-teal/10 p-3" data-ui-component-content="prospect-archive-update-result">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Latest result</p>
        {activeContract.noChanges ? <p className="mt-1 w-full text-sm text-black/75" data-ui-copy="body">No changes were found. The archive already matches the verified source.</p> : activeContract.receipt ? <p className="mt-1 w-full text-sm text-black/75" data-ui-copy="body">Receipt {activeContract.receipt.id} recorded {dateTime(activeContract.receipt.recordedAt)} from {sourceLabel(activeContract.receipt.source)}. {activeContract.receipt.appliedRecords} records applied and {activeContract.receipt.unchangedRecords} unchanged.</p> : null}
      </div>}
    </section>
  );
}
