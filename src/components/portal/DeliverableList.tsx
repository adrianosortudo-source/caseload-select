"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ContentDeliverable,
  ContentKind,
  DeliverableStatus,
} from "@/lib/types";
import { STATUS_LABELS, CONTENT_KIND_LABELS } from "@/lib/deliverables-pure";

type Row = ContentDeliverable & { open_comments: number; version_count: number };

const STATUS_STYLES: Record<DeliverableStatus, string> = {
  draft: "bg-parchment-2 text-muted border-border-brand",
  in_review: "bg-navy/10 text-navy border-navy/20",
  changes_requested: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-green-pass/10 text-green-pass border-green-pass/30",
  archived: "bg-parchment-2 text-muted border-border-brand",
};

export default function DeliverableList({
  firmId,
  viewerRole,
  includeArchived,
  initialDeliverables,
}: {
  firmId: string;
  viewerRole: "operator" | "lawyer";
  includeArchived: boolean;
  initialDeliverables: Row[];
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-[color:var(--portal-accent)]">
            Content approval
          </p>
          <h1 className="text-2xl font-bold text-navy mt-1">Deliverables</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={
              includeArchived
                ? `/portal/${firmId}/deliverables`
                : `/portal/${firmId}/deliverables?archived=1`
            }
            className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
              includeArchived
                ? "border-navy bg-navy text-white"
                : "border-border-brand bg-white text-black/70 hover:border-navy hover:text-navy"
            }`}
          >
            Show archived
          </Link>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-navy bg-navy text-white hover:bg-navy/90 transition-colors"
          >
            {showNew ? "Close" : "New deliverable"}
          </button>
        </div>
      </div>

      {showNew && (
        <NewDeliverableForm
          firmId={firmId}
          onCreated={(id) => router.push(`/portal/${firmId}/deliverables/${id}`)}
        />
      )}

      {initialDeliverables.length === 0 ? (
        <div className="bg-white border border-border-brand px-6 py-10 text-center">
          <p className="text-sm text-black/60">
            {includeArchived
              ? "No deliverables match these filters."
              : viewerRole === "operator"
                ? "No deliverables yet. Create one to post content for the firm to review."
                : "No deliverables yet. The operator will post content here for your review."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initialDeliverables.map((d) => (
            <Link
              key={d.id}
              href={`/portal/${firmId}/deliverables/${d.id}`}
              className="block bg-white border border-border-brand p-4 hover:border-navy/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-black/40">
                  {CONTENT_KIND_LABELS[d.content_kind]}
                </span>
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${STATUS_STYLES[d.status]}`}
                >
                  {STATUS_LABELS[d.status]}
                </span>
              </div>
              <h2 className="text-base font-bold text-navy mt-1.5 leading-snug">
                {d.kicker ? `${d.kicker} · ` : ""}{d.title}
              </h2>
              {d.description && (
                <p className="text-xs text-black/55 mt-1 line-clamp-2">{d.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-[11px] text-black/45">
                <span>
                  {d.version_count} version{d.version_count === 1 ? "" : "s"}
                </span>
                {d.open_comments > 0 && (
                  <span className="text-amber-700 font-semibold">
                    {d.open_comments} open comment{d.open_comments === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-[11px] text-black/40">
        Each approval is recorded against a specific version with a timestamp and
        the signer's name, as a Law Society of Ontario Rule 4.2-1 compliance
        record. Posting a new version returns the deliverable to review.
      </p>
    </div>
  );
}

function NewDeliverableForm({
  firmId,
  onCreated,
}: {
  firmId: string;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ContentKind>("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), content_kind: kind }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not create.");
        setSaving(false);
        return;
      }
      onCreated(json.deliverable.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-border-brand p-4 space-y-3">
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. October blog post: Ontario severance basics"
          className="w-full border border-border-brand px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">
          Description <span className="text-black/40 font-normal">(optional)</span>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this is and where it will run"
          className="w-full border border-border-brand px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-navy mb-1">Type</label>
        <div className="flex gap-2">
          {(["text", "image", "pdf"] as ContentKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
                kind === k
                  ? "border-navy bg-navy text-white"
                  : "border-border-brand bg-white text-black/60 hover:border-navy"
              }`}
            >
              {CONTENT_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-fail">{error}</p>}
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="px-4 py-2 text-sm font-semibold bg-navy text-white disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create and add first version"}
      </button>
    </form>
  );
}
