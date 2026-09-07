export type ReconciledProspectSource = "fixture" | "ledger" | "hybrid";
export type ReconciledProspectFallbackReason = "ledger_unavailable" | "ledger_empty";
export type ReconciledProspectSourceCounts = { ledger: number; fixture: number };

export function reconciledProspectSourceLabel({
  source,
  sourceCounts,
  fallbackReason,
}: {
  source: ReconciledProspectSource;
  sourceCounts: ReconciledProspectSourceCounts;
  fallbackReason?: ReconciledProspectFallbackReason;
}): string {
  if (source === "ledger") {
    return `governed research ledger (${sourceCounts.ledger} records)`;
  }
  if (source === "hybrid") {
    return `governed research ledger (${sourceCounts.ledger} records) + reviewed fixture additions (${sourceCounts.fixture} records)`;
  }
  if (fallbackReason === "ledger_unavailable") {
    return "reviewed source-controlled fixture (ledger unavailable)";
  }
  return "reviewed source-controlled fixture (ledger has no records)";
}
