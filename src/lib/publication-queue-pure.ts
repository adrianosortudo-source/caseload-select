/**
 * Publication Operator, Workstream 5: pure classification helper for the
 * queue LIST view. Approximates the richer 7-way taxonomy
 * (publication-preflight-status.ts) from the existing, already-batched
 * PreflightPlacementReport (publication-preflight.ts) so the queue index
 * doesn't have to run the full per-placement manifest pipeline for every
 * row. The authoritative classification for one placement is always
 * evaluatePublicationPreflightStatus against its real
 * PublicationExecutionManifest, on the detail/dry-preflight page.
 */
import type { PreflightPlacementReport } from "@/lib/publication-preflight";

export type QueueRoughCategory =
  | "ready"
  | "already_published"
  | "ambiguous_external_state"
  | "blocked_content"
  | "blocked_other";

export function roughCategory(row: PreflightPlacementReport): QueueRoughCategory {
  if (row.mayPublish) return "ready";
  if (row.currentReceipt?.verificationState === "verified") return "already_published";
  if (
    row.currentReceipt &&
    (row.currentReceipt.verificationState === "unverified" ||
      row.currentReceipt.verificationState === "failed" ||
      row.currentReceipt.verificationState === "reconciling")
  ) {
    return "ambiguous_external_state";
  }
  const reason = row.reason ?? "";
  if (
    reason.includes("period") ||
    reason.includes("approved") ||
    reason.includes("version") ||
    reason.includes("readiness") ||
    reason.includes("comment")
  ) {
    return "blocked_content";
  }
  return "blocked_other";
}

export const QUEUE_CATEGORY_LABEL: Record<QueueRoughCategory, string> = {
  ready: "Ready",
  already_published: "Already published",
  ambiguous_external_state: "Needs reconciliation",
  blocked_content: "Blocked (content)",
  blocked_other: "Blocked (other)",
};

export const QUEUE_CATEGORY_TONE: Record<QueueRoughCategory, string> = {
  ready: "bg-emerald-50 text-emerald-700",
  already_published: "bg-sky-50 text-sky-700",
  ambiguous_external_state: "bg-amber-50 text-amber-700",
  blocked_content: "bg-rose-50 text-rose-700",
  blocked_other: "bg-black/5 text-black/60",
};
