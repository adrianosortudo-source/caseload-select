"use client";

/**
 * Publication Readiness, Workstream 5: the read-only readiness summary shown
 * inside the content plan.
 *
 * Presentational only. Every count and check shown here is pre-computed by
 * evaluatePeriodReadiness (@/lib/publication-readiness) and handed down as
 * props; this component never calls the evaluator, never fetches deliverable
 * data itself, and never generates, translates, publishes, or approves
 * anything. The two network calls it can trigger are both read-only:
 * re-checking existing evidence (reconcile-artifacts) and downloading the
 * manifest (publication-manifest), both operator-only and both already
 * shipped as read-only endpoints in Workstreams 6 and 7.
 */

import { useState } from "react";
import {
  deriveDisplayState,
  type DeliverableReadiness,
  type PeriodLifecycle,
  type ReadinessCheck,
} from "@/lib/publication-readiness";

export interface PlanPublicationReadiness {
  summary: { active: number; ready: number; blocked: number; excluded: number };
  items: DeliverableReadiness[];
}

const ASSET_REQUIREMENT_KEYS = new Set([
  "hero_image",
  "campaign_image",
  "webpage_artifact",
  "pdf_artifact",
  "form_present",
  "delivery_email_present",
  "thank_you_page_present",
]);

interface ReadinessBreakdown {
  missingApproval: number;
  missingAssets: number;
  staleAssets: number;
  metadataIncomplete: number;
}

function breakdown(active: DeliverableReadiness[]): ReadinessBreakdown {
  let missingApproval = 0;
  let missingAssets = 0;
  let staleAssets = 0;
  let metadataIncomplete = 0;
  for (const item of active) {
    if (item.missingRequirements.includes("current_version_approved")) missingApproval++;
    if (item.missingRequirements.some((k) => ASSET_REQUIREMENT_KEYS.has(k))) missingAssets++;
    if (item.staleArtifacts.length > 0) staleAssets++;
    if (item.missingRequirements.includes("role_and_locale_known")) metadataIncomplete++;
  }
  return { missingApproval, missingAssets, staleAssets, metadataIncomplete };
}

function formatEvidence(evidence: NonNullable<ReadinessCheck["evidence"]>): string {
  const parts: string[] = [];
  if (evidence.storagePath) parts.push(evidence.storagePath);
  if (evidence.publicUrl) parts.push(evidence.publicUrl);
  if (evidence.artifactId) parts.push(`artifact ${evidence.artifactId}`);
  if (evidence.versionId) parts.push(`version ${evidence.versionId}`);
  return parts.length > 0 ? parts.join(", ") : "none recorded";
}

export default function PublicationReadinessSummary({
  firmId,
  isOperator,
  readiness,
  titles,
  periodId,
  lifecycleByDeliverableId,
}: {
  firmId: string;
  isOperator: boolean;
  /** Matches the return shape of evaluatePeriodReadiness in @/lib/publication-readiness. */
  readiness: PlanPublicationReadiness;
  /** Deliverable id to title, since DeliverableReadiness only carries the id. */
  titles?: Record<string, string>;
  /** Scopes "Download manifest" to one week. Omit for the whole-plan summary (the manifest endpoint is per period). */
  periodId?: string;
  /**
   * DR-097: deliverable id to ITS period's explicit lifecycle. Missing/
   * omitted defaults every item to "setup_required", the safe default: an
   * item never renders as red "Blocked" for missing metadata, and never
   * renders "Historical" either, unless its period was explicitly
   * classified one way or the other.
   */
  lifecycleByDeliverableId?: Record<string, PeriodLifecycle>;
}) {
  // Publication readiness is an operator control surface. Lawyers need the
  // approval workflow, not internal artifact/metadata diagnostics or release
  // gate labels that are not actionable in their view.
  if (!isOperator) return null;

  const { summary, items } = readiness;
  if (summary.active === 0 && summary.excluded === 0) return null;

  const lifecycles = lifecycleByDeliverableId ?? {};
  const active = items.filter((i) => !i.excluded);
  const withState = active.map((item) => ({
    item,
    state: deriveDisplayState(item, lifecycles[item.deliverableId] ?? "setup_required"),
  }));
  const ready = withState.filter((w) => w.state === "ready");
  const blocked = withState.filter((w) => w.state === "blocked");
  // Within a not-yet-activated period, "setup_required" is a blanket,
  // per-period label (deriveDisplayState never differentiates by item once
  // the period itself isn't enforced -- red "Blocked" must never appear
  // pre-activation). But a piece whose OWN readiness is already fully
  // clean (e.g. Founder Vesting, fully metadata-complete today) should not
  // read as "needs role/locale set" alongside one that genuinely does --
  // split the bucket here, in rendering only, using the always-pure
  // item.ready flag.
  const setupRequired = withState.filter((w) => w.state === "setup_required");
  const setupRequiredNeedsWork = setupRequired.filter((w) => !w.item.ready);
  const setupRequiredAlreadyClean = setupRequired.filter((w) => w.item.ready);
  const historical = withState.filter((w) => w.state === "historical_unreconciled");
  const counts = breakdown(blocked.map((w) => w.item));

  return (
    <div className="border-t border-border-brand/60 pt-4 mt-1 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[color:var(--portal-accent)]">
            Publication readiness
          </p>
          <p className="text-xs text-black/50 mt-0.5 max-w-md">
            Whether each piece has what it needs to go out: approval, bound
            assets, and a route. Status only, nothing here generates,
            translates, or publishes anything.
          </p>
        </div>
        {isOperator && periodId && (
          <a
            href={`/api/admin/content-periods/${periodId}/publication-manifest?format=markdown`}
            target="_blank"
            rel="noreferrer"
            className="flex-none text-[11px] font-semibold text-navy/70 hover:text-navy whitespace-nowrap"
          >
            Download manifest
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <CountChip n={summary.active} label="active" cls="bg-parchment-2 text-muted border-border-brand" />
        <CountChip n={ready.length} label="ready" cls="bg-green-pass/10 text-green-pass border-green-pass/30" />
        {blocked.length > 0 && (
          <CountChip n={blocked.length} label="blocked" cls="bg-red-fail/10 text-red-fail border-red-fail/30" />
        )}
        {setupRequired.length > 0 && (
          <CountChip
            n={setupRequired.length}
            label="setup required"
            cls="bg-amber-50 text-amber-800 border-amber-200"
          />
        )}
        {historical.length > 0 && (
          <CountChip
            n={historical.length}
            label="historical, not reconciled"
            cls="bg-parchment-2 text-muted border-border-brand"
          />
        )}
        <CountChip n={summary.excluded} label="excluded" cls="bg-parchment-2 text-muted border-border-brand" />
      </div>

      {blocked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {counts.missingApproval > 0 && (
            <CountChip
              n={counts.missingApproval}
              label="missing approval"
              cls="bg-amber-50 text-amber-800 border-amber-200"
            />
          )}
          {counts.missingAssets > 0 && (
            <CountChip
              n={counts.missingAssets}
              label="missing assets"
              cls="bg-amber-50 text-amber-800 border-amber-200"
            />
          )}
          {counts.staleAssets > 0 && (
            <CountChip
              n={counts.staleAssets}
              label="stale assets"
              cls="bg-amber-50 text-amber-800 border-amber-200"
            />
          )}
        </div>
      )}

      {blocked.length > 0 && (
        <div className="space-y-1.5">
          {blocked.map(({ item }) => (
            <BlockedDeliverable
              key={item.deliverableId}
              firmId={firmId}
              isOperator={isOperator}
              item={item}
              title={titles?.[item.deliverableId] ?? item.deliverableId}
            />
          ))}
        </div>
      )}

      {setupRequiredNeedsWork.length > 0 && (
        <details className="bg-amber-50/40 border border-amber-200 text-sm">
          <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 select-none">
            <span className="flex-none text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 border rounded-full bg-amber-50 text-amber-800 border-amber-200">
              Setup required
            </span>
            <span className="flex-1 min-w-0 text-black/70">
              {setupRequiredNeedsWork.length} piece{setupRequiredNeedsWork.length === 1 ? "" : "s"} still need
              work before this period can activate
            </span>
          </summary>
          <ul className="px-3 pb-3 pt-1 space-y-1 border-t border-amber-200/60">
            {setupRequiredNeedsWork.map(({ item }) => (
              <li key={item.deliverableId} className="text-[13px] text-black/70 truncate">
                {titles?.[item.deliverableId] ?? item.deliverableId}
                {item.missingRequirements.length > 0 && (
                  <span className="text-black/45"> &middot; missing {item.missingRequirements.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {setupRequiredAlreadyClean.length > 0 && (
        <details className="bg-parchment-2/40 border border-border-brand text-sm">
          <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 select-none">
            <span className="flex-none text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 border rounded-full bg-green-pass/10 text-green-pass border-green-pass/30">
              Ready to activate
            </span>
            <span className="flex-1 min-w-0 text-black/70">
              {setupRequiredAlreadyClean.length} piece{setupRequiredAlreadyClean.length === 1 ? "" : "s"} already
              pass every check; this period just has not been activated yet
            </span>
          </summary>
          <ul className="px-3 pb-3 pt-1 space-y-1 border-t border-border-brand/60">
            {setupRequiredAlreadyClean.map(({ item }) => (
              <li key={item.deliverableId} className="text-[13px] text-black/70 truncate">
                {titles?.[item.deliverableId] ?? item.deliverableId}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CountChip({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 border rounded-full whitespace-nowrap ${cls}`}
    >
      <span className="uppercase tracking-wider">{n}</span>
      <span className="normal-case font-normal">{label}</span>
    </span>
  );
}

function BlockedDeliverable({
  firmId,
  isOperator,
  item,
  title,
}: {
  firmId: string;
  isOperator: boolean;
  item: DeliverableReadiness;
  title: string;
}) {
  const failing = item.checks.filter((c) => c.blocking && c.status !== "pass");
  const stale = new Set(item.staleArtifacts);

  return (
    <details className="bg-parchment-2/40 border border-border-brand text-sm">
      <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 select-none">
        <span className="flex-none text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 border rounded-full bg-red-fail/10 text-red-fail border-red-fail/30">
          Blocked
        </span>
        <span className="flex-1 min-w-0 truncate font-medium text-black/85">{title}</span>
        <span className="flex-none text-[11px] text-muted">
          {failing.length} issue{failing.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-border-brand/60">
        <ul className="space-y-2">
          {failing.map((check) => (
            <li key={check.key} className="text-[13px] leading-snug">
              <p className="font-semibold text-black/80">{check.label}</p>
              {check.reason && <p className="text-black/60">{check.reason}</p>}
              {check.evidence && (
                <p className="text-[12px] text-muted mt-0.5">
                  Evidence found: {formatEvidence(check.evidence)}
                </p>
              )}
              {stale.has(check.key) && (
                <p className="text-[12px] text-amber-800 mt-0.5">
                  Bound to an earlier version, not the current one.
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-black/50">
          Generation is not permitted here; report the gap and wait for the operator.
        </p>
        <div className="flex items-center gap-3 pt-0.5">
          <a
            href={`/portal/${firmId}/deliverables/${item.deliverableId}`}
            className="text-[11px] font-semibold text-navy hover:underline"
          >
            Open draft &rarr;
          </a>
          {isOperator && <ReconcileButton deliverableId={item.deliverableId} />}
        </div>
      </div>
    </details>
  );
}

function ReconcileButton({ deliverableId }: { deliverableId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/content-deliverables/${deliverableId}/reconcile-artifacts`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState("error");
        setMessage(json.error ?? "Could not check evidence.");
        return;
      }
      const results = Array.isArray(json.results) ? (json.results as { result?: string }[]) : [];
      const passed = results.filter((r) => r.result === "pass").length;
      setState("done");
      setMessage(
        results.length === 0
          ? "No registered artifacts to check."
          : `Checked ${results.length} artifact${results.length === 1 ? "" : "s"}, ${passed} passed.`,
      );
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className="text-[11px] font-semibold text-navy/70 hover:text-navy disabled:opacity-50"
      >
        {state === "loading" ? "Checking evidence..." : "Re-check evidence"}
      </button>
      {message && (
        <p className={`text-[11px] mt-1 ${state === "error" ? "text-red-fail" : "text-muted"}`}>{message}</p>
      )}
    </div>
  );
}
