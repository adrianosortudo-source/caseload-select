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
  hasDeliverable,
  languageMode,
}: {
  pieceId: string;
  currentGate: string;
  hasVersion: boolean;
  hasBrief: boolean;
  hasDeliverable: boolean;
  languageMode: string;
}) {
  const router = useRouter();
  const [validateState, setValidateState] = useState<ActionState>("idle");
  const [validatePtState, setValidatePtState] = useState<ActionState>("idle");
  const [draftState, setDraftState] = useState<ActionState>("idle");
  const [draftPtState, setDraftPtState] = useState<ActionState>("idle");
  const [advanceState, setAdvanceState] = useState<ActionState>("idle");
  const [exportState, setExportState] = useState<ActionState>("idle");
  const [exportPtState, setExportPtState] = useState<ActionState>("idle");
  const [publishState, setPublishState] = useState<ActionState>("idle");
  const [sendToReviewState, setSendToReviewState] = useState<ActionState>("idle");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [exportUrls, setExportUrls] = useState<Record<string, string> | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const isBilingual = languageMode === "bilingual";

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

  const handleDraftPt = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/draft`,
      "POST",
      { language: "pt" },
      setDraftPtState
    ).then((d) => {
      if (d?.version) {
        setResultMsg(`Portuguese draft v${d.version.version_number} generated`);
      }
    });

  const handleValidatePt = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/validate`,
      "POST",
      { language: "pt" },
      setValidatePtState
    ).then((d) => {
      if (d?.summary) {
        setResultMsg(
          `Portuguese: ${d.summary.pass} pass, ${d.summary.warn} warn, ${d.summary.fail} fail`
        );
      }
    });

  const handleExportPt = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/export`,
      "POST",
      { language: "pt" },
      setExportPtState
    ).then((d) => {
      if (d?.signed_urls) {
        setExportUrls(d.signed_urls);
        setResultMsg(`Exported Portuguese v${d.version_number}. Links are valid for 1 hour.`);
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

  const handleSendToReview = () =>
    runAction(
      `/api/admin/content-studio/pieces/${pieceId}/send-to-review`,
      "POST",
      {},
      setSendToReviewState
    ).then((d) => {
      if (d?.ok) setResultMsg("Sent to review. The deliverable is back in review pending re-approval.");
    });

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

        {languageMode === "bilingual" && (
          <button
            onClick={handleDraftPt}
            disabled={draftPtState === "loading" || !hasBrief}
            className={btnClass(
              draftPtState,
              "w-full text-left rounded border border-amber-200 bg-amber-50 px-3 py-2.5 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <div className="text-sm font-medium text-amber-700">
              {draftPtState === "loading" ? "Generating Portuguese draft..." : "Generate Portuguese draft"}
            </div>
            <div className="text-xs text-amber-600/60 mt-0.5">
              Authored fresh from the same source brief, not translated from
              the English draft. Required before this piece can advance past
              legal_gate.
            </div>
          </button>
        )}

        {isBilingual && (
          <button
            onClick={handleValidatePt}
            disabled={validatePtState === "loading" || !hasVersion}
            className={btnClass(
              validatePtState,
              "w-full text-left rounded border border-amber-200 bg-amber-50/60 px-3 py-2.5 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <div className="text-sm font-medium text-amber-700">
              {validatePtState === "loading" ? "Validating Portuguese..." : "Validate Portuguese"}
            </div>
            <div className="text-xs text-amber-600/60 mt-0.5">
              Runs the Portuguese validator battery. The PT version must pass
              (zero fails) before it can be sent to review.
            </div>
          </button>
        )}

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

        {hasDeliverable && (
          <button
            onClick={handleSendToReview}
            disabled={sendToReviewState === "loading"}
            className={btnClass(
              sendToReviewState,
              "w-full text-left rounded border border-violet-200 bg-violet-50 px-3 py-2.5 hover:bg-violet-100 transition-colors"
            )}
          >
            <div className="text-sm font-medium text-violet-700">
              {sendToReviewState === "loading" ? "Sending..." : "Send current draft to review"}
            </div>
            <div className="text-xs text-violet-600/60 mt-0.5">
              Posts the current version to the linked deliverable. Requires a
              zero-fail validation run. Returns the deliverable to in_review
              and clears any prior approval.
            </div>
          </button>
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
              delegation) that matches the current version. Writes page.html +
              schema.json + meta.json.
            </div>
          </button>

          {isBilingual && (
            <button
              onClick={handleExportPt}
              disabled={exportPtState === "loading" || !hasVersion}
              className={btnClass(
                exportPtState,
                "w-full mt-2 text-left rounded border border-amber-200 bg-amber-50/60 px-3 py-2.5 hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              <div className="text-sm font-medium text-amber-700">
                {exportPtState === "loading" ? "Exporting Portuguese..." : "Export Portuguese bundle"}
              </div>
              <div className="text-xs text-amber-600/60 mt-0.5">
                Exports the Portuguese version with its Portuguese LSO banner.
                Same approval gate as the English export.
              </div>
            </button>
          )}

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
              validatePtState === "error" ||
              draftState === "error" ||
              draftPtState === "error" ||
              advanceState === "error" ||
              exportState === "error" ||
              exportPtState === "error" ||
              publishState === "error" ||
              sendToReviewState === "error"
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

/* ── Version Edit Panel (Ses.17 WP-2, the revision loop) ───── */

type EditableSection = { key: string; heading?: string; body_markdown: string };
type EditableFaqItem = { question: string; answer: string };

interface EditableServicePage {
  h1: { key: string; line1: string; line2: string } | null;
  sections: EditableSection[];
  faqBlock: { key: string; items: EditableFaqItem[] } | null;
  seoTitle: string;
  seoMetaDescription: string;
}

// Splits the stored ServicePageBlock[] into an editable shape the form can
// bind to, then reassembles it back into ServicePageBlock[] on save. Kept
// local (not imported from content-studio-structured.ts) since this is a
// UI-shape concern, not the canonical block type; the PUT route validates
// the reassembled shape server-side regardless.
function toEditableServicePage(
  blocks: Array<Record<string, unknown>>,
  seoMetadata: Record<string, unknown> | null
): EditableServicePage {
  let h1: EditableServicePage["h1"] = null;
  const sections: EditableSection[] = [];
  let faqBlock: EditableServicePage["faqBlock"] = null;

  for (const b of blocks) {
    if (b.type === "h1") {
      h1 = { key: String(b.key), line1: String(b.line1 ?? ""), line2: String(b.line2 ?? "") };
    } else if (b.type === "section") {
      sections.push({
        key: String(b.key),
        heading: typeof b.heading === "string" ? b.heading : undefined,
        body_markdown: String(b.body_markdown ?? ""),
      });
    } else if (b.type === "faq_block") {
      faqBlock = {
        key: String(b.key),
        items: Array.isArray(b.items)
          ? (b.items as Array<Record<string, unknown>>).map((it) => ({
              question: String(it.question ?? ""),
              answer: String(it.answer ?? ""),
            }))
          : [],
      };
    }
  }

  return {
    h1,
    sections,
    faqBlock,
    seoTitle: String(seoMetadata?.title ?? ""),
    seoMetaDescription: String(seoMetadata?.meta_description ?? ""),
  };
}

function fromEditableServicePage(page: EditableServicePage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (page.h1) blocks.push({ type: "h1", key: page.h1.key, line1: page.h1.line1, line2: page.h1.line2 });
  for (const s of page.sections) {
    blocks.push({ type: "section", key: s.key, heading: s.heading, body_markdown: s.body_markdown });
  }
  if (page.faqBlock) blocks.push({ type: "faq_block", key: page.faqBlock.key, items: page.faqBlock.items });
  return blocks;
}

export function VersionEditPanel({
  pieceId,
  format,
  bodyMarkdown,
  bodyStructured,
  seoMetadata,
}: {
  pieceId: string;
  format: string;
  bodyMarkdown: string | null;
  bodyStructured: Array<Record<string, unknown>> | null;
  seoMetadata: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const isStructured = format === "canonical_service_page";

  const [markdown, setMarkdown] = useState(bodyMarkdown ?? "");
  const [page, setPage] = useState<EditableServicePage>(() =>
    toEditableServicePage(bodyStructured ?? [], seoMetadata)
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setValidationMsg(null);
    try {
      const payload = isStructured
        ? {
            blocks: fromEditableServicePage(page),
            seo_title: page.seoTitle,
            seo_meta_description: page.seoMetaDescription,
          }
        : { body_markdown: markdown };
      const res = await fetch(`/api/admin/content-studio/pieces/${pieceId}/version`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      if (data.validation_summary) {
        const s = data.validation_summary;
        setValidationMsg(`Saved as v${data.version.version_number}. Validation: ${s.pass} pass, ${s.warn} warn, ${s.fail} fail.`);
      } else {
        setValidationMsg(`Saved as v${data.version.version_number}.`);
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }, [pieceId, isStructured, page, markdown, router]);

  if (!editing) {
    return (
      <div className="px-6 py-3 border-t border-black/5 flex items-center justify-between">
        <button
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          Edit this draft
        </button>
        {validationMsg && (
          <span className="text-xs text-emerald-700">{validationMsg}</span>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 border-t border-sky-200 bg-sky-50/30 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-sky-600">Editing Draft</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditing(false);
              setError(null);
              setMarkdown(bodyMarkdown ?? "");
              setPage(toEditableServicePage(bodyStructured ?? [], seoMetadata));
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
            {saving ? "Saving..." : "Save as new version"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {!isStructured && (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={16}
          className="w-full text-sm font-mono border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
        />
      )}

      {isStructured && (
        <div className="space-y-4">
          {page.h1 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-black/60 mb-1">H1 line 1</label>
                <input
                  type="text"
                  value={page.h1.line1}
                  onChange={(e) =>
                    setPage((p) => ({ ...p, h1: p.h1 ? { ...p.h1, line1: e.target.value } : p.h1 }))
                  }
                  className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black/60 mb-1">H1 line 2</label>
                <input
                  type="text"
                  value={page.h1.line2}
                  onChange={(e) =>
                    setPage((p) => ({ ...p, h1: p.h1 ? { ...p.h1, line2: e.target.value } : p.h1 }))
                  }
                  className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>
          )}

          {page.sections.map((s, i) => (
            <div key={s.key} className="rounded border border-black/10 p-3">
              {s.heading !== undefined && (
                <input
                  type="text"
                  value={s.heading}
                  onChange={(e) =>
                    setPage((p) => {
                      const sections = [...p.sections];
                      sections[i] = { ...sections[i], heading: e.target.value };
                      return { ...p, sections };
                    })
                  }
                  placeholder="Heading"
                  className="w-full text-sm font-medium border-0 border-b border-black/10 px-0 pb-1 mb-2 focus:outline-none focus:border-sky-400"
                />
              )}
              <textarea
                value={s.body_markdown}
                onChange={(e) =>
                  setPage((p) => {
                    const sections = [...p.sections];
                    sections[i] = { ...sections[i], body_markdown: e.target.value };
                    return { ...p, sections };
                  })
                }
                rows={5}
                className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
          ))}

          {page.faqBlock && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-black/60">FAQ</div>
              {page.faqBlock.items.map((item, i) => (
                <div key={i} className="rounded border border-black/10 p-3 space-y-2">
                  <input
                    type="text"
                    value={item.question}
                    onChange={(e) =>
                      setPage((p) => {
                        if (!p.faqBlock) return p;
                        const items = [...p.faqBlock.items];
                        items[i] = { ...items[i], question: e.target.value };
                        return { ...p, faqBlock: { ...p.faqBlock, items } };
                      })
                    }
                    placeholder="Question"
                    className="w-full text-sm font-medium border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
                  />
                  <textarea
                    value={item.answer}
                    onChange={(e) =>
                      setPage((p) => {
                        if (!p.faqBlock) return p;
                        const items = [...p.faqBlock.items];
                        items[i] = { ...items[i], answer: e.target.value };
                        return { ...p, faqBlock: { ...p.faqBlock, items } };
                      })
                    }
                    rows={3}
                    placeholder="Answer"
                    className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-black/60 mb-1">SEO title</label>
              <input
                type="text"
                value={page.seoTitle}
                onChange={(e) => setPage((p) => ({ ...p, seoTitle: e.target.value }))}
                className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black/60 mb-1">SEO meta description</label>
              <textarea
                value={page.seoMetaDescription}
                onChange={(e) => setPage((p) => ({ ...p, seoMetaDescription: e.target.value }))}
                rows={2}
                className="w-full text-sm border border-black/15 rounded px-3 py-2 focus:outline-none focus:border-sky-400"
              />
            </div>
          </div>
        </div>
      )}
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
