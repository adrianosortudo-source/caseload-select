"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ── Source Brief Form ────────────────────────────────────── */

const BRIEF_FIELDS = [
  { key: "decision_question", label: "Decision question", hint: "What question does the reader need answered?" },
  { key: "legal_distinction", label: "Legal distinction", hint: "What legal nuance separates this from common advice?" },
  { key: "consequence", label: "Consequence", hint: "What happens if the reader ignores this?" },
  { key: "authorities", label: "Authorities", hint: "Statutes, case law, or regulations to cite." },
  { key: "five_line_brief_seeds", label: "Brief seeds", hint: "Five seed lines for the draft body." },
  { key: "territory", label: "Territory", hint: "Build and govern / Buy, lease and finance / Continue and transfer" },
  { key: "seo_target_query", label: "SEO target query", hint: "Primary search query this piece targets." },
] as const;

type BriefData = Record<string, string>;

export function SourceBriefForm({
  pieceId,
  initial,
}: {
  pieceId: string;
  initial: BriefData | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<BriefData>(initial ?? {});

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/content-studio/pieces/${pieceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_brief: values }),
        }
      );
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }, [pieceId, values, router]);

  const hasContent =
    initial && Object.values(initial).some((v) => v && v.trim().length > 0);

  if (!editing) {
    return (
      <div className="rounded border border-black/8 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-wider text-black/50">
            Source Brief
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-sky-600 hover:text-sky-700"
          >
            {hasContent ? "Edit" : "Start brief"}
          </button>
        </div>
        {!hasContent ? (
          <p className="text-sm text-black/40">
            No source brief yet. Click &ldquo;Start brief&rdquo; to fill out the
            decision question, legal distinction, and territory.
          </p>
        ) : (
          <dl className="space-y-3">
            {BRIEF_FIELDS.map(({ key, label }) => {
              const val = initial?.[key];
              if (!val) return null;
              return (
                <div key={key}>
                  <dt className="text-xs font-medium text-black/60">{label}</dt>
                  <dd className="mt-0.5 text-sm text-black/80">{val}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-sky-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-wider text-sky-600">
          Editing Source Brief
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setValues(initial ?? {});
              setEditing(false);
              setError(null);
            }}
            className="text-xs text-black/50 hover:text-black/70"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs font-medium px-3 py-1.5 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save brief"}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-4 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-4">
        {BRIEF_FIELDS.map(({ key, label, hint }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-black/60 mb-1">
              {label}
            </label>
            {key === "five_line_brief_seeds" ? (
              <textarea
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                rows={4}
                placeholder={hint}
                className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400 placeholder:text-black/30"
              />
            ) : (
              <input
                type="text"
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                placeholder={hint}
                className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400 placeholder:text-black/30"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Piece Actions ────────────────────────────────────────── */

const GATE_ORDER = [
  "discovery",
  "position",
  "draft",
  "legal_gate",
  "authoring",
  "production",
];

const GATE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  position: "Position",
  draft: "Draft",
  legal_gate: "Legal gate",
  authoring: "EN/PT authoring",
  production: "Production",
};

type ActionState = "idle" | "loading" | "success" | "error";

export function PieceActions({
  pieceId,
  currentGate,
  hasVersion,
  hasBrief,
}: {
  pieceId: string;
  currentGate: string;
  hasVersion: boolean;
  hasBrief: boolean;
}) {
  const router = useRouter();
  const [validateState, setValidateState] = useState<ActionState>("idle");
  const [draftState, setDraftState] = useState<ActionState>("idle");
  const [advanceState, setAdvanceState] = useState<ActionState>("idle");
  const [exportState, setExportState] = useState<ActionState>("idle");
  const [publishState, setPublishState] = useState<ActionState>("idle");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [exportUrls, setExportUrls] = useState<Record<string, string> | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const currentIndex = GATE_ORDER.indexOf(currentGate);
  const nextGate =
    currentIndex >= 0 && currentIndex < GATE_ORDER.length - 1
      ? GATE_ORDER[currentIndex + 1]
      : null;

  async function runAction(
    endpoint: string,
    method: string,
    body: unknown,
    setState: (s: ActionState) => void
  ) {
    setState("loading");
    setResultMsg(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!data.ok) {
        setState("error");
        setResultMsg(data.error ?? "Action failed");
        return data;
      }
      setState("success");
      router.refresh();
      return data;
    } catch {
      setState("error");
      setResultMsg("Network error");
      return null;
    }
  }

  const handleValidate = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/validate`,
      "POST",
      {},
      setValidateState
    ).then((d) => {
      if (d?.summary) {
        setResultMsg(
          `${d.summary.pass} pass, ${d.summary.warn} warn, ${d.summary.fail} fail`
        );
      }
    });

  const handleDraft = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/draft`,
      "POST",
      {},
      setDraftState
    ).then((d) => {
      if (d?.version) {
        setResultMsg(`Draft v${d.version.version_number} generated`);
      }
    });

  const handleAdvance = () => {
    if (!nextGate) return;
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}`,
      "PATCH",
      { workflow_gate: nextGate },
      setAdvanceState
    );
  };

  const handleExport = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/export`,
      "POST",
      {},
      setExportState
    ).then((d) => {
      if (d?.signed_urls) {
        setExportUrls(d.signed_urls);
        setResultMsg(`Exported v${d.version_number}. Links are valid for 1 hour.`);
      }
    });

  const handlePublishRecord = () => {
    if (!publishedUrl.trim()) {
      setPublishState("error");
      setResultMsg("Enter the URL where this piece was placed first.");
      return;
    }
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/publish-record`,
      "POST",
      { published_url: publishedUrl.trim() },
      setPublishState
    ).then((d) => {
      if (d?.ok) setResultMsg("Publish recorded.");
    });
  };

  function btnClass(state: ActionState, base: string) {
    if (state === "loading") return `${base} opacity-50 cursor-wait`;
    return `${base} cursor-pointer`;
  }

  return (
    <div className="rounded border border-black/8 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-black/50 mb-4">
        Actions
      </div>
      <div className="space-y-2">
        <button
          onClick={handleValidate}
          disabled={validateState === "loading" || !hasVersion}
          className={btnClass(
            validateState,
            "w-full text-left rounded border border-black/10 px-3 py-2.5 hover:bg-black/[0.02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          <div className="text-sm font-medium text-black/70">
            {validateState === "loading" ? "Running validators..." : "Run validators"}
          </div>
          {!hasVersion && (
            <div className="text-xs text-black/40 mt-0.5">
              Generate a draft first
            </div>
          )}
        </button>

        <button
          onClick={handleDraft}
          disabled={draftState === "loading" || !hasBrief}
          className={btnClass(
            draftState,
            "w-full text-left rounded border border-black/10 px-3 py-2.5 hover:bg-black/[0.02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          <div className="text-sm font-medium text-black/70">
            {draftState === "loading" ? "Generating draft..." : "Generate draft"}
          </div>
          {!hasBrief && (
            <div className="text-xs text-black/40 mt-0.5">
              Fill out the source brief first
            </div>
          )}
        </button>

        {nextGate && (
          <button
            onClick={handleAdvance}
            disabled={advanceState === "loading"}
            className={btnClass(
              advanceState,
              "w-full text-left rounded border border-sky-200 bg-sky-50 px-3 py-2.5 hover:bg-sky-100 transition-colors"
            )}
          >
            <div className="text-sm font-medium text-sky-700">
              {advanceState === "loading"
                ? "Advancing..."
                : `Advance to ${GATE_LABELS[nextGate] ?? nextGate}`}
            </div>
            <div className="text-xs text-sky-600/60 mt-0.5">
              Move this piece to the next workflow gate.
            </div>
          </button>
        )}

        {!nextGate && currentGate === "production" && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <div className="text-sm font-medium text-emerald-700">
              At final gate
            </div>
            <div className="text-xs text-emerald-600/60 mt-0.5">
              This piece is in the production gate.
            </div>
          </div>
        )}

        <div className="pt-2 mt-2 border-t border-black/8">
          <button
            onClick={handleExport}
            disabled={exportState === "loading" || !hasVersion}
            className={btnClass(
              exportState,
              "w-full text-left rounded border border-black/10 px-3 py-2.5 hover:bg-black/[0.02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <div className="text-sm font-medium text-black/70">
              {exportState === "loading" ? "Exporting..." : "Export bundle"}
            </div>
            <div className="text-xs text-black/40 mt-0.5">
              Requires a lawyer-approved deliverable (or an active publish
              delegation). Writes page.html + schema.json + meta.json.
            </div>
          </button>

          {exportUrls && (
            <div className="mt-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 space-y-1">
              {Object.entries(exportUrls).map(([name, url]) => (
                <div key={name}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-700 hover:underline"
                  >
                    {name} →
                  </a>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 rounded border border-black/10 px-3 py-2.5">
            <div className="text-sm font-medium text-black/70 mb-1">
              Record publish
            </div>
            <div className="text-xs text-black/40 mb-2">
              After you place the exported bundle on the firm&apos;s site,
              record the URL here. This does not publish anything itself.
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={publishedUrl}
                onChange={(e) => setPublishedUrl(e.target.value)}
                placeholder="https://drglaw.ca/..."
                className="flex-1 text-xs border border-black/15 rounded px-2 py-1.5 focus:outline-none focus:border-sky-400 placeholder:text-black/30"
              />
              <button
                onClick={handlePublishRecord}
                disabled={publishState === "loading"}
                className="text-xs font-medium px-3 py-1.5 rounded bg-black/80 text-white hover:bg-black disabled:opacity-50 shrink-0"
              >
                {publishState === "loading" ? "Recording..." : "Record"}
              </button>
            </div>
          </div>
        </div>

        {resultMsg && (
          <div
            className={`text-xs rounded px-3 py-2 ${
              validateState === "error" ||
              draftState === "error" ||
              advanceState === "error" ||
              exportState === "error" ||
              publishState === "error"
                ? "bg-rose-50 text-rose-700 border border-rose-200"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
          >
            {resultMsg}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Create Piece from Slot ───────────────────────────────── */

export function CreatePieceButton({
  firmId,
  slotId,
  theme,
  format,
}: {
  firmId: string;
  slotId: string;
  theme: string;
  format: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/content-studio/pieces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firm_id: firmId,
          calendar_slot_id: slotId,
          title_working: theme,
          format,
        }),
      });
      const data = await res.json();
      if (data.ok && data.piece?.id) {
        router.push(`/admin/content-studio/${data.piece.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setCreating(false);
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={creating}
      className="text-xs font-medium text-sky-600 hover:text-sky-700 disabled:opacity-50"
    >
      {creating ? "Creating..." : "Create"}
    </button>
  );
}
