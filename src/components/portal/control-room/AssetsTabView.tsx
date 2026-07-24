"use client";

/**
 * CR-15/16: Assets tab (Section 11), the primary visual-asset workspace.
 * Client component for filter + open-drawer + inline-form state -- the
 * view model itself is assembled server-side (assembleAssetsViewModel) and
 * passed in as props, along with the raw manifest so the drawer (CR-17)
 * can look up the exact piece/requirement objects the Asset Brief Builder
 * (CR-18) needs.
 *
 * Register/Select/Reject/Supersede/Export/Dry-run are wired to the real
 * operator-only API routes (package-assets, package-export,
 * package-dry-run). Every result renders INLINE inside the card/section it
 * came from -- never a toast-only signal that can be missed. Upload via
 * Gateway, Bind via Gateway, and Record rendered verification stay
 * disabled: they need the deployed gateway credential and a real evidence
 * pipeline, neither of which exists in this build.
 */
import { useState } from "react";
import type { AssetCard, AssetCardFilter, AssetPieceGroup } from "@/lib/publishing-package-control-room-assets";
import { filterAssetCards } from "@/lib/publishing-package-control-room-assets";
import type { AssetStatus } from "@/lib/publishing-package-control-room-overview";
import type { PackageManifest } from "@/lib/publishing-package-control-room-manifest";
import { buildAssetBrief, briefToJson } from "@/lib/publishing-package-control-room-brief";
import AssetDetailView from "@/components/portal/control-room/AssetDetailView";

interface AssetsTabViewProps {
  firmId: string;
  periodId: string;
  manifest: PackageManifest;
  groups: AssetPieceGroup[];
  allCards: AssetCard[];
  viewerRole: "operator" | "lawyer";
}

const NAMED_FILTERS: { key: AssetCardFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "missing", label: "Missing" },
  { key: "candidate", label: "Candidate" },
  { key: "selected", label: "Selected" },
  { key: "uploaded", label: "Uploaded" },
  { key: "bound", label: "Bound" },
  { key: "rendered_verified", label: "Rendered verified" },
  { key: "blocked", label: "Blocked" },
  { key: "superseded", label: "Superseded" },
  { key: "locale:en-CA", label: "EN" },
  { key: "locale:pt-BR", label: "PT" },
];

const STATUS_LABEL: Record<AssetStatus, string> = {
  required: "Required", missing: "Missing", candidate: "Candidate",
  visually_selected: "Selected", hash_verified: "Hash verified", uploaded: "Uploaded",
  bound: "Bound", rendered_verified: "Rendered verified", release_ready: "Release ready",
  blocked: "Blocked", rejected: "Rejected", superseded: "Superseded", not_planned: "Not planned",
};

function cardKey(c: AssetCard): string {
  return `${c.contentSlotId}::${c.assetRole}::${c.destination}::${c.assetId ?? "gap"}`;
}

type InlineResult = { kind: "success" | "error"; message: string };

function OperatorAction({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) {
    return (
      <button
        type="button"
        disabled
        title="Requires a live database and the Publishing Package Gateway -- not available in this build"
        className="text-[11px] font-medium text-black/30 border border-black/10 px-2 py-1 cursor-not-allowed"
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-medium text-navy border border-navy/30 px-2 py-1 hover:bg-navy/5"
    >
      {label}
    </button>
  );
}

function InlineResultBanner({ result }: { result: InlineResult | undefined }) {
  if (!result) return null;
  return (
    <div className={`text-[11px] px-2 py-1 border ${result.kind === "success" ? "border-navy/30 bg-navy/5 text-navy" : "border-red-300 bg-red-50 text-red-800"}`}>
      {result.message}
    </div>
  );
}

interface CardActionsProps {
  firmId: string;
  periodId: string;
  card: AssetCard;
  onResult: (key: string, result: InlineResult) => void;
  result: InlineResult | undefined;
}

function apiBase(firmId: string, periodId: string) {
  return `/api/portal/${firmId}/periods/${periodId}`;
}

function CardActions({ firmId, periodId, card, onResult, result }: CardActionsProps) {
  const key = cardKey(card);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showSupersedeForm, setShowSupersedeForm] = useState(false);
  const [filename, setFilename] = useState("");
  const [sha256, setSha256] = useState("");
  const [width, setWidth] = useState(String(card.requiredWidth));
  const [height, setHeight] = useState(String(card.requiredHeight));
  const [altText, setAltText] = useState("");
  const [mimeType, setMimeType] = useState("image/jpeg");
  const [byteSize, setByteSize] = useState("");
  const [reason, setReason] = useState("");
  const [replacementId, setReplacementId] = useState("");

  async function post(path: string, body?: unknown) {
    try {
      const res = await fetch(`${apiBase(firmId, periodId)}${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onResult(key, { kind: "error", message: (json as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      onResult(key, { kind: "success", message: "Done." });
    } catch (err) {
      onResult(key, { kind: "error", message: err instanceof Error ? err.message : "request failed" });
    }
  }

  if (card.kind === "requirement_gap") {
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          <OperatorAction label="Register candidate" onClick={() => setShowRegisterForm((s) => !s)} />
          <OperatorAction label="Upload via Gateway" />
        </div>
        {showRegisterForm && (
          <div className="space-y-1 border border-black/10 p-2">
            <label className="block text-[10px] text-black/50">
              Filename
              <input value={filename} onChange={(e) => setFilename(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
            </label>
            <label className="block text-[10px] text-black/50">
              SHA-256 (64 lowercase hex chars)
              <input value={sha256} onChange={(e) => setSha256(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs font-mono" />
            </label>
            <div className="flex gap-1.5">
              <label className="block text-[10px] text-black/50 flex-1">
                Width
                <input value={width} onChange={(e) => setWidth(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
              </label>
              <label className="block text-[10px] text-black/50 flex-1">
                Height
                <input value={height} onChange={(e) => setHeight(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
              </label>
            </div>
            <label className="block text-[10px] text-black/50">
              Alt text
              <input value={altText} onChange={(e) => setAltText(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
            </label>
            <div className="flex gap-1.5">
              <label className="block text-[10px] text-black/50 flex-1">
                MIME type
                <input value={mimeType} onChange={(e) => setMimeType(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
              </label>
              <label className="block text-[10px] text-black/50 flex-1">
                Byte size
                <input value={byteSize} onChange={(e) => setByteSize(e.target.value)} className="block w-full border border-black/15 px-1.5 py-0.5 text-xs" />
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                post("/package-assets", {
                  content_slot_id: card.contentSlotId,
                  asset_role: card.assetRole,
                  locale: card.locale,
                  destination: card.destination,
                  filename,
                  mime_type: mimeType,
                  byte_size: Number(byteSize),
                  width: Number(width),
                  height: Number(height),
                  sha256,
                  alt_text: altText,
                  text_policy: card.textPolicy,
                  overlay_language: card.overlayLanguage,
                })
              }
              className="text-[11px] font-medium text-white bg-navy px-2 py-1"
            >
              Submit
            </button>
          </div>
        )}
        <InlineResultBanner result={result} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <OperatorAction label="Select" onClick={() => post(`/package-assets/${card.assetId}/select`)} />
        <OperatorAction label="Reject" onClick={() => setShowRejectForm((s) => !s)} />
        <OperatorAction label="Supersede" onClick={() => setShowSupersedeForm((s) => !s)} />
        <OperatorAction label="Bind via Gateway" />
        <OperatorAction label="Record rendered verification" />
      </div>
      {showRejectForm && (
        <div className="flex gap-1.5">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rejection reason"
            aria-label="Rejection reason"
            className="flex-1 border border-black/15 px-1.5 py-0.5 text-xs"
          />
          <button type="button" onClick={() => post(`/package-assets/${card.assetId}/reject`, { reason })} className="text-[11px] font-medium text-white bg-navy px-2 py-1">
            Confirm
          </button>
        </div>
      )}
      {showSupersedeForm && (
        <div className="flex gap-1.5">
          <input
            value={replacementId}
            onChange={(e) => setReplacementId(e.target.value)}
            placeholder="Replacement asset id"
            aria-label="Replacement asset id"
            className="flex-1 border border-black/15 px-1.5 py-0.5 text-xs font-mono"
          />
          <button
            type="button"
            onClick={() => post(`/package-assets/${card.assetId}/supersede`, { replacement_asset_id: replacementId })}
            className="text-[11px] font-medium text-white bg-navy px-2 py-1"
          >
            Confirm
          </button>
        </div>
      )}
      <InlineResultBanner result={result} />
    </div>
  );
}

function AssetCardView({
  firmId, periodId, card, viewerRole, onOpen, onResult, result,
}: {
  firmId: string; periodId: string; card: AssetCard; viewerRole: "operator" | "lawyer";
  onOpen: () => void; onResult: (key: string, result: InlineResult) => void; result: InlineResult | undefined;
}) {
  const isGap = card.kind === "requirement_gap";
  return (
    <div className={`border p-3 space-y-2 ${isGap ? "border-red-200 bg-red-50/40" : "border-black/8 bg-white"}`}>
      <button type="button" onClick={onOpen} className="text-left w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-navy truncate underline underline-offset-2">{card.pieceTitle}</div>
            <div className="text-[11px] text-black/50">{card.locale} · {card.destination} · {card.assetRole}</div>
          </div>
          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-black/5 border border-black/10">
            {STATUS_LABEL[card.status]}
          </span>
        </div>
      </button>

      <div className="text-[11px] text-black/60 space-y-0.5">
        <div>Required: {card.requiredWidth}×{card.requiredHeight} · {card.textPolicy}{card.overlayLanguage ? ` · overlay ${card.overlayLanguage}` : ""}</div>
        <div>Safe area: {card.safeArea}</div>
        {card.requiredCopy && <div>Required copy: &ldquo;{card.requiredCopy}&rdquo;</div>}
      </div>

      {!isGap && (
        <div className="text-[11px] text-black/60 space-y-0.5 border-t border-black/5 pt-2">
          <div className="truncate">Filename: {card.filename}</div>
          <div>{card.width}×{card.height} · {card.mimeType} · {card.byteSize ? `${Math.round(card.byteSize / 1024)} KB` : "—"}</div>
          <div className="break-all font-mono text-[10px] text-black/40">{card.sha256}</div>
          {card.isSelected && <div className="text-navy font-medium">Selected candidate</div>}
        </div>
      )}

      {card.blockingReason && (
        <div className="text-[11px] text-red-800">{card.blockingReason}</div>
      )}

      {viewerRole === "operator" && (
        <div className="border-t border-black/5 pt-2">
          <CardActions firmId={firmId} periodId={periodId} card={card} onResult={onResult} result={result} />
        </div>
      )}
    </div>
  );
}

export default function AssetsTabView({ firmId, periodId, manifest, groups, allCards, viewerRole }: AssetsTabViewProps) {
  const [filter, setFilter] = useState<AssetCardFilter>("all");
  const [openCardKey, setOpenCardKey] = useState<string | null>(null);
  const [cardResults, setCardResults] = useState<Record<string, InlineResult>>({});
  const [headerResult, setHeaderResult] = useState<InlineResult | null>(null);
  const [dryRunOutput, setDryRunOutput] = useState<unknown>(null);

  function onCardResult(key: string, result: InlineResult) {
    setCardResults((prev) => ({ ...prev, [key]: result }));
  }

  async function exportManifest() {
    try {
      const res = await fetch(`${apiBase(firmId, periodId)}/package-export`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHeaderResult({ kind: "error", message: (json as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "package-export.json";
      a.click();
      URL.revokeObjectURL(url);
      setHeaderResult({ kind: "success", message: "Export downloaded." });
    } catch (err) {
      setHeaderResult({ kind: "error", message: err instanceof Error ? err.message : "export failed" });
    }
  }

  async function runDryRun() {
    try {
      const res = await fetch(`${apiBase(firmId, periodId)}/package-dry-run`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHeaderResult({ kind: "error", message: (json as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      setDryRunOutput(json);
      setHeaderResult({ kind: "success", message: "Dry run complete -- see results below." });
    } catch (err) {
      setHeaderResult({ kind: "error", message: err instanceof Error ? err.message : "dry run failed" });
    }
  }

  const filtered = filterAssetCards(allCards, filter);
  const filteredIds = new Set(filtered.map(cardKey));

  const openCard = openCardKey ? allCards.find((c) => cardKey(c) === openCardKey) ?? null : null;
  const openPiece = openCard ? manifest.pieces.find((p) => p.contentSlotId === openCard.contentSlotId) ?? null : null;
  const openRequirement = openCard && openPiece
    ? openPiece.requiredAssets.find((r) => r.assetRole === openCard.assetRole && r.destination === openCard.destination) ?? null
    : null;
  const openGroup = openCard ? groups.find((g) => g.contentSlotId === openCard.contentSlotId) ?? null : null;
  const openCandidates = openCard
    ? allCards.filter(
        (c) => c.contentSlotId === openCard.contentSlotId && c.assetRole === openCard.assetRole && c.destination === openCard.destination,
      )
    : [];

  const brief = openCard?.kind === "requirement_gap" && openPiece && openRequirement
    ? buildAssetBrief(openPiece, openRequirement, openPiece.approvalStatus)
    : null;

  return (
    <section aria-labelledby="control-room-assets-heading" className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 id="control-room-assets-heading" className="text-sm font-semibold text-navy">
          Assets
        </h2>
        {viewerRole === "operator" && (
          <div className="flex items-center gap-2">
            <OperatorAction label="Export manifest" onClick={exportManifest} />
            <OperatorAction label="Run asset-binding dry run" onClick={runDryRun} />
            <OperatorAction label="Download receipt" />
          </div>
        )}
      </div>

      {headerResult && (
        <div className={`text-xs px-2.5 py-1.5 border ${headerResult.kind === "success" ? "border-navy/30 bg-navy/5 text-navy" : "border-red-300 bg-red-50 text-red-800"}`}>
          {headerResult.message}
        </div>
      )}
      {dryRunOutput != null && (
        <pre className="text-[10px] bg-black/5 border border-black/10 p-2 overflow-x-auto">{JSON.stringify(dryRunOutput, null, 2)}</pre>
      )}

      <div role="group" aria-label="Filter assets" className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
        {NAMED_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-medium px-2.5 py-1 border whitespace-nowrap ${
              filter === f.key ? "bg-navy text-white border-navy" : "bg-white text-black/60 border-black/15 hover:border-black/30"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {openCard && openPiece && (
        <div className="border-2 border-navy bg-white p-4 relative">
          <button
            type="button"
            onClick={() => setOpenCardKey(null)}
            aria-label="Close asset detail"
            className="absolute top-3 right-3 text-black/40 hover:text-black text-sm"
          >
            Close ✕
          </button>
          <AssetDetailView
            piece={{ pieceTitle: openPiece.readerTitle, sourceVersionId: openPiece.sourceVersionId, approvalStatus: openPiece.approvalStatus }}
            focusedCard={openCard}
            candidates={openCandidates}
            pieceRoleGroups={openGroup?.roles ?? []}
          />
          {viewerRole === "operator" && brief && (
            <div className="flex gap-2 mt-4 pt-3 border-t border-black/8">
              <OperatorAction
                label="Copy brief"
                onClick={() => {
                  void navigator.clipboard?.writeText(briefToJson(brief));
                }}
              />
              <OperatorAction
                label="Download brief as JSON"
                onClick={() => {
                  const blob = new Blob([briefToJson(brief)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${brief.filenameConvention}.brief.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.contentSlotId}>
            <h3 className="text-xs font-semibold text-navy/80 uppercase tracking-wider mb-2">{group.pieceTitle}</h3>
            {group.roles.map((role) => {
              const visibleCards = role.cards.filter((c) => filteredIds.has(cardKey(c)));
              if (visibleCards.length === 0) return null;
              return (
                <div key={`${role.assetRole}-${role.destination}`} className="mb-3">
                  <div className="text-[11px] text-black/40 uppercase tracking-wider mb-1.5">{role.assetRole} · {role.destination}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {visibleCards.map((card) => (
                      <AssetCardView
                        key={cardKey(card)}
                        firmId={firmId}
                        periodId={periodId}
                        card={card}
                        viewerRole={viewerRole}
                        onOpen={() => setOpenCardKey(cardKey(card))}
                        onResult={onCardResult}
                        result={cardResults[cardKey(card)]}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
