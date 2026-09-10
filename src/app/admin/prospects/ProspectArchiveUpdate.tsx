"use client";

import { useMemo, useState } from "react";

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

  const selected = useMemo(() => sourceOptions.find((option) => option.value === source)!, [source]);
  const preview = contract?.preview?.source === source ? contract.preview : undefined;
  const isApplying = contract?.status === "applying";
  const canApply = Boolean(preview && contract?.status === "ready" && contract.onApplyReviewedUpdate && !isApplying);

  async function applyReviewedUpdate() {
    if (!canApply || !contract?.onApplyReviewedUpdate) return;
    setApplyRequested(true);
    try {
      await contract.onApplyReviewedUpdate();
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
              <input type="radio" name="archive-source" value={option.value} checked={source === option.value} onChange={() => { setSource(option.value); setPrepareRequested(false); }} className="mt-1" />
              <span className="min-w-0 text-sm font-semibold text-navy">{option.label}</span>
            </span>
            <span className="mt-1 block w-full text-xs leading-5 text-black/60">{option.note}</span>
          </label>
        ))}
      </fieldset>
      <p id="archive-source-guidance" className="mt-3 w-full text-sm text-black/60" data-ui-copy="supporting">{selected.note}</p>

      <div className="mt-4 rounded border border-amber-300/70 bg-amber-50/60 p-3" data-ui-component-content="prospect-archive-update-state">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Preparation status</p>
        <p className="mt-1 w-full text-sm text-black/75" aria-live="polite" data-ui-copy="body">
          {contract?.status === "preparing" ? "Preparing a verified update preview..." : contract?.status === "ready" && preview ? `Preview prepared ${dateTime(preview.preparedAt)}.` : contract?.status === "applying" ? "Applying the reviewed update through the verified connection..." : prepareRequested ? "A verified connection or supported history bundle is required before a preview can be prepared." : "Choose a source, then prepare a preview when its connection is available."}
        </p>
        <button type="button" onClick={() => setPrepareRequested(true)} disabled={contract?.status === "preparing" || isApplying} className="mt-3 rounded border border-navy px-3 py-2 text-sm font-semibold text-navy hover:bg-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
          {contract?.status === "preparing" ? "Preparing preview" : "Prepare update preview"}
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

      {(contract?.receipt || contract?.noChanges) && <div className="mt-4 rounded border border-teal/25 bg-teal/10 p-3" data-ui-component-content="prospect-archive-update-result">
        <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Latest result</p>
        {contract.noChanges ? <p className="mt-1 w-full text-sm text-black/75" data-ui-copy="body">No changes were found. The archive already matches the verified source.</p> : contract.receipt ? <p className="mt-1 w-full text-sm text-black/75" data-ui-copy="body">Receipt {contract.receipt.id} recorded {dateTime(contract.receipt.recordedAt)} from {sourceLabel(contract.receipt.source)}. {contract.receipt.appliedRecords} records applied and {contract.receipt.unchangedRecords} unchanged.</p> : null}
      </div>}
    </section>
  );
}
