import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

export type UnifiedProspectSource = "shared_registry" | "research_ledger" | "reviewed_fixture" | "legacy_provenance";
export type UnifiedIdentityState = "linked" | "reviewed_match" | "review_needed" | "provisional";

export function prospectSources(record: ReconciledGtaProspect): UnifiedProspectSource[] {
  const sources: UnifiedProspectSource[] = [];
  if (record.qualifiedDossier) sources.push("shared_registry");
  if (record.recordOrigin === "research_ledger") sources.push("research_ledger");
  else if (record.recordOrigin === "reviewed_fixture") sources.push("reviewed_fixture");
  if (record.legacyCrosswalk || record.legacyClusterLawyerCount !== null) sources.push("legacy_provenance");
  return sources.length > 0 ? sources : ["reviewed_fixture"];
}

export function prospectIdentityState(record: ReconciledGtaProspect): UnifiedIdentityState {
  if (record.firmId) return "linked";
  if (["new_pending_identity", "unresolved", "duplicate"].includes(record.reconciliationStatus)) return "review_needed";
  if (record.reconciliationStatus === "update_existing") return "reviewed_match";
  return "provisional";
}

export function filterUnifiedProspectState(
  records: readonly ReconciledGtaProspect[],
  filters: { source?: UnifiedProspectSource | ""; identity?: UnifiedIdentityState | ""; quickView?: "all" | "shared_registry" | "audit_ready" | "identity_review" },
): ReconciledGtaProspect[] {
  return records.filter((record) => {
    if (filters.source && !prospectSources(record).includes(filters.source)) return false;
    const identity = prospectIdentityState(record);
    if (filters.identity && identity !== filters.identity) return false;
    if (filters.quickView === "shared_registry" && !record.qualifiedDossier) return false;
    if (filters.quickView === "audit_ready" && record.qualifiedDossier?.audit.state !== "ready") return false;
    if (filters.quickView === "identity_review" && identity !== "review_needed") return false;
    return true;
  });
}
