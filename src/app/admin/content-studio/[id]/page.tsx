import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { SourceBriefForm, PieceActions, VersionEditPanel } from "../components";
import {
  renderServicePagePreview,
  type ServicePageBlock,
} from "@/lib/content-studio-structured";
import {
  checkLegalGateEntryCondition,
  checkLegalGateExitCondition,
} from "@/lib/content-studio-gates";

export const dynamic = "force-dynamic";

/* ── Gate order + labels ───────────────────────────────────── */

const gateOrder = [
  "discovery",
  "position",
  "draft",
  "legal_gate",
  "authoring",
  "production",
] as const;

const gateLabels: Record<string, string> = {
  discovery: "Discovery",
  position: "Position",
  draft: "Draft",
  legal_gate: "Legal gate",
  authoring: "EN/PT authoring",
  production: "Production",
};

const gateDescriptions: Record<string, string> = {
  discovery:
    "Territory research, competitive positioning, and source brief assembly.",
  position:
    "Firm-specific angle, decision question, and legal distinction locked.",
  draft: "Body copy authored against the source brief and strategy.",
  legal_gate:
    "LSO Rule 4.2-1 compliance review, fact-check, and sign-off.",
  authoring: "English and Portuguese versions finalised and proofread.",
  production:
    "Format-specific output (HTML, PDF, social cards) rendered and scheduled.",
};

/* ── Shared display helpers ────────────────────────────────── */

const statusTone: Record<string, string> = {
  planned: "bg-black/5 text-black/70",
  briefed: "bg-sky-50 text-sky-700",
  drafting: "bg-amber-50 text-amber-700",
  legal_review: "bg-violet-50 text-violet-700",
  production: "bg-indigo-50 text-indigo-700",
  shipped: "bg-emerald-50 text-emerald-700",
  skipped: "bg-black/5 text-black/50",
  draft: "bg-black/5 text-black/70",
  in_review: "bg-violet-50 text-violet-700",
  changes_requested: "bg-rose-50 text-rose-700",
  approved: "bg-emerald-50 text-emerald-700",
  published: "bg-emerald-50 text-emerald-700",
  archived: "bg-black/5 text-black/50",
  active: "bg-emerald-50 text-emerald-700",
};

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatTimestamp(value: string | null) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${statusTone[value] ?? "bg-black/5 text-black/60"}`}
    >
      {humanize(value)}
    </span>
  );
}

function wordCount(text: string | null): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/* ── Types ─────────────────────────────────────────────────── */

type ContentPiece = {
  id: string;
  firm_id: string;
  calendar_slot_id: string | null;
  title_working: string;
  format: string;
  language_mode: string;
  workflow_gate: string;
  status: string;
  review_date: string | null;
  owner_name: string | null;
  source_brief: Record<string, string> | null;
  created_at: string;
  deliverable_id: string | null;
};

type LinkedDeliverable = {
  id: string;
  status: string;
};

type PieceVersion = {
  id: string;
  piece_id: string;
  language: string;
  version_number: number;
  body_markdown: string | null;
  body_structured: unknown[] | null;
  seo_metadata: Record<string, unknown> | null;
  is_current: boolean;
  created_at: string;
};

type AiRun = {
  id: string;
  piece_id: string;
  run_type: string;
  status: string;
  model: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
};

type Strategy = {
  id: string;
  firm_id: string;
  name: string;
  version: number;
  status: string;
};

/* ── Data loading ──────────────────────────────────────────── */

async function getPieceDetail(id: string) {
  const [pieceRes, enVersionRes, ptVersionRes, aiRunsRes] = await Promise.all([
    supabase
      .from("content_pieces")
      .select(
        "id,firm_id,calendar_slot_id,title_working,format,language_mode,workflow_gate,status,review_date,owner_name,source_brief,created_at,deliverable_id"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("content_piece_versions")
      .select(
        "id,piece_id,language,version_number,body_markdown,body_structured,seo_metadata,is_current,created_at"
      )
      .eq("piece_id", id)
      .eq("language", "en")
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("content_piece_versions")
      .select(
        "id,piece_id,language,version_number,body_markdown,body_structured,seo_metadata,is_current,created_at"
      )
      .eq("piece_id", id)
      .eq("language", "pt")
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("content_ai_runs")
      .select("id,piece_id,run_type,status,model,result,created_at")
      .eq("piece_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const piece = pieceRes.data as ContentPiece | null;
  const enVersion = enVersionRes.data as PieceVersion | null;

  // Fetch strategy separately since we need the firm_id from the piece
  let strategy: Strategy | null = null;
  if (piece) {
    const strategyRes = await supabase
      .from("firm_content_strategies")
      .select("id,firm_id,name,version,status")
      .eq("firm_id", piece.firm_id)
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    strategy = strategyRes.data as Strategy | null;
  }

  // WP-2 (Ses.16 next-20% build plan): the linked deliverable + a live
  // "why is the next advance blocked" hint, computed with the same pure
  // gate functions the PATCH route enforces (content-studio-gates.ts), so
  // the admin surface never drifts from what the route actually checks.
  let deliverable: LinkedDeliverable | null = null;
  if (piece?.deliverable_id) {
    const { data } = await supabase
      .from("content_deliverables")
      .select("id,status")
      .eq("id", piece.deliverable_id)
      .maybeSingle();
    deliverable = (data as LinkedDeliverable | null) ?? null;
  }

  let gateHint: string | null = null;
  if (piece) {
    if (piece.workflow_gate === "draft") {
      let latestValidationResults: { status: string }[] | null = null;
      if (enVersion) {
        const { data: run } = await supabase
          .from("content_ai_runs")
          .select("result")
          .eq("piece_version_id", enVersion.id)
          .eq("run_type", "validate_deterministic")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const result = run?.result as { validators?: { status: string }[] } | undefined;
        latestValidationResults = result?.validators ?? null;
      }
      const entryCheck = checkLegalGateEntryCondition({
        hasCurrentVersion: !!enVersion,
        latestValidationResults,
      });
      if (!entryCheck.ok) gateHint = entryCheck.reason;
    } else if (piece.workflow_gate === "legal_gate") {
      const exitCheck = checkLegalGateExitCondition({
        deliverableStatus: deliverable?.status ?? null,
        delegation: null, // admin hint only; the route re-checks delegation live
        format: piece.format,
      });
      if (!exitCheck.ok) gateHint = exitCheck.reason;
    }
  }

  return {
    piece,
    enVersion,
    ptVersion: ptVersionRes.data as PieceVersion | null,
    aiRuns: (aiRunsRes.data ?? []) as AiRun[],
    strategy,
    deliverable,
    gateHint,
    error:
      pieceRes.error?.message ??
      enVersionRes.error?.message ??
      ptVersionRes.error?.message ??
      aiRunsRes.error?.message ??
      null,
  };
}

/* ── Sub-components ────────────────────────────────────────── */

// canonical_service_page versions carry body_structured + seo_metadata and
// an intentionally empty body_markdown (see content-studio-structured.ts /
// draft/route.ts's structured-output branch). Every other format is
// Markdown-only and keeps the original raw <pre> rendering unchanged.
function VersionBody({
  version,
  format,
}: {
  version: PieceVersion;
  format: string;
}) {
  if (format !== "canonical_service_page") {
    return (
      <pre className="whitespace-pre-wrap text-sm text-black/80 bg-black/[0.02] rounded p-4 max-h-96 overflow-y-auto font-sans leading-relaxed">
        {version.body_markdown ?? "(empty)"}
      </pre>
    );
  }

  if (!Array.isArray(version.body_structured) || version.body_structured.length === 0) {
    return (
      <p className="text-sm text-black/40 bg-black/[0.02] rounded p-4">
        No structured content yet for this canonical_service_page version.
        This format generates as structured output, not Markdown; run the
        draft generator (or regenerate it) to populate body_structured.
      </p>
    );
  }

  const { html, schemaJson } = renderServicePagePreview(
    version.body_structured as ServicePageBlock[],
    version.seo_metadata ?? undefined
  );

  return (
    <div className="space-y-4">
      <div
        className="cls-structured-preview text-sm text-black/80 bg-black/[0.02] rounded p-4 max-h-96 overflow-y-auto leading-relaxed [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-3 [&_p]:mb-2 [&_a]:text-sky-600 [&_a]:underline"
        // Safe: renderServicePagePreview HTML-escapes all text before
        // reintroducing any markup (see the function's own header comment
        // in content-studio-structured.ts). No raw user/model text can
        // reach this as a live tag.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <details className="rounded border border-black/8">
        <summary className="px-4 py-2 cursor-pointer text-xs font-medium text-black/60 hover:text-black/80">
          Schema (JSON-LD) — {schemaJson.length} block
          {schemaJson.length !== 1 ? "s" : ""}
        </summary>
        <pre className="whitespace-pre-wrap text-xs text-black/70 bg-black/[0.02] p-4 max-h-96 overflow-y-auto">
          {schemaJson.length > 0
            ? JSON.stringify(schemaJson, null, 2)
            : "No schema blocks found in seo_metadata."}
        </pre>
      </details>
    </div>
  );
}

function CurrentDraftPanel({
  pieceId,
  format,
  enVersion,
  ptVersion,
}: {
  pieceId: string;
  format: string;
  enVersion: PieceVersion | null;
  ptVersion: PieceVersion | null;
}) {
  if (!enVersion && !ptVersion) {
    return (
      <div className="rounded border border-black/8 bg-white p-6">
        <div className="text-xs uppercase tracking-wider text-black/50 mb-3">
          Current Draft
        </div>
        <p className="text-sm text-black/40">
          No draft versions yet. Run the draft generator or create a version
          manually.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/8 bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-black/10">
        <div className="text-xs uppercase tracking-wider text-black/50">
          Current Draft
        </div>
      </div>

      {enVersion && (
        <div className="p-6 border-b border-black/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium bg-sky-50 text-sky-700 px-2 py-0.5 rounded">
                EN
              </span>
              <span className="text-xs text-black/50">
                v{enVersion.version_number}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-black/50">
                {wordCount(enVersion.body_markdown)} words
              </span>
              <span className="text-xs text-black/40">
                {formatTimestamp(enVersion.created_at)}
              </span>
            </div>
          </div>
          <VersionBody version={enVersion} format={format} />
        </div>
      )}

      {enVersion && (
        <VersionEditPanel
          pieceId={pieceId}
          format={format}
          bodyMarkdown={enVersion.body_markdown}
          bodyStructured={enVersion.body_structured as Array<Record<string, unknown>> | null}
          seoMetadata={enVersion.seo_metadata}
        />
      )}

      {ptVersion && (
        <details className="group">
          <summary className="px-6 py-3 cursor-pointer text-sm font-medium text-black/60 hover:text-black/80 border-b border-black/5">
            <span className="inline-flex items-center gap-2">
              <span className="text-xs font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                PT
              </span>
              Portuguese version (v{ptVersion.version_number},{" "}
              {wordCount(ptVersion.body_markdown)} words)
            </span>
          </summary>
          <div className="p-6">
            <VersionBody version={ptVersion} format={format} />
            <div className="mt-2 text-xs text-black/40">
              {formatTimestamp(ptVersion.created_at)}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

function ValidatorResultsPanel({ aiRuns }: { aiRuns: AiRun[] }) {
  const latestValidation = aiRuns.find(
    (r) => r.run_type === "validate_deterministic" && r.result
  );
  const validators =
    latestValidation?.result &&
    typeof latestValidation.result === "object" &&
    "validators" in latestValidation.result
      ? (latestValidation.result as { validators: unknown[] }).validators
      : null;

  if (!validators || !Array.isArray(validators) || validators.length === 0) {
    return (
      <div className="rounded border border-black/8 bg-white p-6">
        <div className="text-xs uppercase tracking-wider text-black/50 mb-3">
          Validator Results
        </div>
        <p className="text-sm text-black/40">
          No validator results yet. Run validators to check compliance,
          readability, and brand alignment.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/8 bg-white p-6">
      <div className="text-xs uppercase tracking-wider text-black/50 mb-4">
        Validator Results
      </div>
      <div className="space-y-2">
        {validators.map((v, i) => {
          const item = v as Record<string, unknown>;
          const status = String(item.status ?? "unknown");
          const key = String(item.key ?? `validator-${i}`);
          const findings = Array.isArray(item.findings) ? item.findings : [];
          const tone =
            status === "pass"
              ? "text-emerald-700 bg-emerald-50"
              : status === "fail"
                ? "text-rose-700 bg-rose-50"
                : "text-amber-700 bg-amber-50";
          return (
            <div key={key} className="flex items-start gap-3 text-sm">
              <span
                className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${tone}`}
              >
                {status.toUpperCase()}
              </span>
              <div>
                <span className="font-medium text-black/70">
                  {humanize(key)}
                </span>
                {findings.length > 0 && (
                  <div className="text-xs text-black/50 mt-0.5">
                    {findings.length} finding{findings.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowGateTracker({
  currentGate,
  gateHint,
}: {
  currentGate: string;
  gateHint: string | null;
}) {
  const currentIndex = gateOrder.indexOf(
    currentGate as (typeof gateOrder)[number]
  );

  return (
    <div className="rounded border border-black/8 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-black/50 mb-4">
        Workflow Gates
      </div>
      {gateHint && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">Next advance blocked: </span>
          {gateHint}
        </div>
      )}
      <div className="space-y-0">
        {gateOrder.map((gate, index) => {
          const isCompleted = currentIndex > index;
          const isCurrent = currentIndex === index;
          const isPending = currentIndex < index;

          return (
            <div key={gate} className="flex items-start gap-3">
              {/* Vertical line + indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                    isCompleted
                      ? "bg-emerald-100 text-emerald-700"
                      : isCurrent
                        ? "bg-sky-100 text-sky-700 ring-2 ring-sky-300"
                        : "bg-black/5 text-black/30"
                  }`}
                >
                  {isCompleted ? "✓" : index + 1}
                </div>
                {index < gateOrder.length - 1 && (
                  <div
                    className={`w-px h-6 ${isCompleted ? "bg-emerald-200" : "bg-black/10"}`}
                  />
                )}
              </div>

              {/* Label + description */}
              <div className="pb-4">
                <div
                  className={`text-sm font-medium ${
                    isCurrent
                      ? "text-sky-700"
                      : isPending
                        ? "text-black/40"
                        : "text-black/70"
                  }`}
                >
                  {gateLabels[gate]}
                </div>
                <div className="text-xs text-black/40 mt-0.5">
                  {gateDescriptions[gate]}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DELIVERABLE_STATUS_TONE: Record<string, string> = {
  draft: "bg-black/5 text-black/70",
  in_review: "bg-sky-50 text-sky-700",
  changes_requested: "bg-rose-50 text-rose-700",
  approved: "bg-emerald-50 text-emerald-700",
  archived: "bg-black/5 text-black/50",
};

function DeliverableStatusCard({
  firmId,
  deliverable,
}: {
  firmId: string;
  deliverable: LinkedDeliverable | null;
}) {
  if (!deliverable) {
    return (
      <div className="rounded border border-black/8 bg-white p-5">
        <div className="text-xs uppercase tracking-wider text-black/50 mb-3">
          Legal Review
        </div>
        <p className="text-sm text-black/40">
          No deliverable linked yet. One is created automatically the first
          time this piece advances to the legal_gate workflow gate.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/8 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-black/50 mb-3">
        Legal Review
      </div>
      <div className="mb-3">
        <span
          className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${
            DELIVERABLE_STATUS_TONE[deliverable.status] ?? "bg-black/5 text-black/60"
          }`}
        >
          {humanize(deliverable.status)}
        </span>
      </div>
      <Link
        href={`/portal/${firmId}/deliverables/${deliverable.id}`}
        className="text-sm text-sky-600 hover:underline"
      >
        Open in the review portal →
      </Link>
    </div>
  );
}

function PieceMetadataCard({
  piece,
  strategy,
}: {
  piece: ContentPiece;
  strategy: Strategy | null;
}) {
  return (
    <div className="rounded border border-black/8 bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-black/50 mb-4">
        Piece Details
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-xs text-black/50">Format</div>
          <div className="mt-0.5">
            <StatusBadge value={piece.format} />
          </div>
        </div>
        <div>
          <div className="text-xs text-black/50">Language mode</div>
          <div className="mt-0.5 text-sm font-medium text-black/80">
            {piece.language_mode === "bilingual"
              ? "Bilingual (EN + PT)"
              : piece.language_mode.toUpperCase()}
          </div>
        </div>
        <div>
          <div className="text-xs text-black/50">Status</div>
          <div className="mt-0.5">
            <StatusBadge value={piece.status} />
          </div>
        </div>
        <div>
          <div className="text-xs text-black/50">Owner</div>
          <div className="mt-0.5 text-sm text-black/70">
            {piece.owner_name ?? "Unassigned"}
          </div>
        </div>
        <div>
          <div className="text-xs text-black/50">Review date</div>
          <div className="mt-0.5 text-sm text-black/70">
            {formatDate(piece.review_date)}
          </div>
        </div>
        {strategy && (
          <div>
            <div className="text-xs text-black/50">Strategy</div>
            <div className="mt-0.5 text-sm text-black/70">
              {strategy.name} v{strategy.version}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-black/50">Created</div>
          <div className="mt-0.5 text-sm text-black/70">
            {formatTimestamp(piece.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

function countValidatorOutcome(
  result: Record<string, unknown> | null,
  outcome: string
): number {
  if (!result) return 0;
  const validators = (result as { validators?: unknown[] }).validators;
  if (!Array.isArray(validators)) return 0;
  return validators.filter(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      (v as Record<string, unknown>).status === outcome
  ).length;
}

function AiRunHistory({ runs }: { runs: AiRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded border border-black/8 bg-white p-6">
        <div className="text-xs uppercase tracking-wider text-black/50 mb-3">
          AI Run History
        </div>
        <p className="text-sm text-black/40">No AI runs recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/8 bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-black/10">
        <div className="text-xs uppercase tracking-wider text-black/50">
          AI Run History
        </div>
        <div className="text-xs text-black/40 mt-1">
          Last {runs.length} runs.
        </div>
      </div>
      <div className="divide-y divide-black/5">
        {runs.map((run) => {
          const passCount = countValidatorOutcome(
            run.result,
            "pass"
          );
          const failCount = countValidatorOutcome(
            run.result,
            "fail"
          );
          const warnCount = countValidatorOutcome(
            run.result,
            "warn"
          );
          const hasResults = passCount + failCount + warnCount > 0;

          return (
            <div
              key={run.id}
              className="px-6 py-3 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-medium text-black/70">
                  {humanize(run.run_type)}
                </div>
                <div className="text-xs text-black/40 mt-0.5 flex items-center gap-2">
                  <StatusBadge value={run.status} />
                  {run.model && (
                    <span className="text-black/40">{run.model}</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-black/40">
                  {formatTimestamp(run.created_at)}
                </div>
                {hasResults && (
                  <div className="flex items-center gap-2 mt-1 justify-end">
                    {passCount > 0 && (
                      <span className="text-xs text-emerald-600">
                        {passCount} pass
                      </span>
                    )}
                    {warnCount > 0 && (
                      <span className="text-xs text-amber-600">
                        {warnCount} warn
                      </span>
                    )}
                    {failCount > 0 && (
                      <span className="text-xs text-rose-600">
                        {failCount} fail
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default async function ContentPieceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { piece, enVersion, ptVersion, aiRuns, strategy, deliverable, gateHint, error } =
    await getPieceDetail(id);

  if (!piece) {
    return (
      <div>
        <PageHeader
          title="Piece not found"
          right={
            <Link
              href="/admin/content-studio"
              className="text-sm text-sky-600 hover:underline"
            >
              Back to Content Studio
            </Link>
          }
        />
        <div className="p-8">
          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error ?? `No content piece with id ${id}.`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={piece.title_working}
        subtitle={`${humanize(piece.format)} / ${gateLabels[piece.workflow_gate] ?? humanize(piece.workflow_gate)}`}
        right={
          <Link
            href="/admin/content-studio"
            className="text-sm text-sky-600 hover:underline"
          >
            Back to Content Studio
          </Link>
        }
      />

      {error && (
        <div className="mx-8 mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: 2/3 */}
          <div className="lg:col-span-2 space-y-6">
            <SourceBriefForm
              pieceId={piece.id}
              initial={
                piece.source_brief &&
                typeof piece.source_brief === "object"
                  ? (piece.source_brief as Record<string, string>)
                  : null
              }
            />
            <CurrentDraftPanel
              pieceId={piece.id}
              format={piece.format}
              enVersion={enVersion}
              ptVersion={ptVersion}
            />
            <ValidatorResultsPanel aiRuns={aiRuns} />
            <AiRunHistory runs={aiRuns} />
          </div>

          {/* Right column: 1/3 */}
          <div className="space-y-6">
            <PieceMetadataCard piece={piece} strategy={strategy} />
            <DeliverableStatusCard firmId={piece.firm_id} deliverable={deliverable} />
            <WorkflowGateTracker currentGate={piece.workflow_gate} gateHint={gateHint} />
            <PieceActions
              pieceId={piece.id}
              currentGate={piece.workflow_gate}
              hasVersion={!!enVersion}
              hasBrief={
                !!piece.source_brief &&
                typeof piece.source_brief === "object" &&
                Object.keys(piece.source_brief).length > 0
              }
              hasDeliverable={!!piece.deliverable_id}
              languageMode={piece.language_mode}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
