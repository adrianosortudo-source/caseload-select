/**
 * Operator-facing release-graph report. Pure formatting over an already-
 * computed ReleaseGraphAudit[] -- never a second source of truth, mirroring
 * publication-manifest.ts's own renderManifestMarkdown() convention. Groups
 * every audited release under exactly one of the four required verdicts:
 * Publish now / Hold / Needs verification / System improvement.
 */

import { RELEASE_VERDICT_LABEL, type ReleaseGraphAudit, type ReleaseGraphNoPlacementAudit, type ReleaseVerdict } from "./release-graph-types";

export interface ReleaseGraphReportInput {
  periodId?: string;
  audits: ReleaseGraphAudit[];
  noPlacementAudits?: ReleaseGraphNoPlacementAudit[];
  generatedAt: string;
}

export interface ReleaseGraphReportSummary {
  publish_now: number;
  hold: number;
  needs_verification: number;
  system_improvement: number;
  total: number;
}

export function summarizeReleaseGraphAudits(audits: ReleaseGraphAudit[]): ReleaseGraphReportSummary {
  const summary: ReleaseGraphReportSummary = { publish_now: 0, hold: 0, needs_verification: 0, system_improvement: 0, total: audits.length };
  for (const a of audits) summary[a.verdict] += 1;
  return summary;
}

function groupByVerdict(audits: ReleaseGraphAudit[]): Record<ReleaseVerdict, ReleaseGraphAudit[]> {
  const groups: Record<ReleaseVerdict, ReleaseGraphAudit[]> = {
    hold: [],
    needs_verification: [],
    system_improvement: [],
    publish_now: [],
  };
  for (const a of audits) groups[a.verdict].push(a);
  return groups;
}

/**
 * Markdown rendering of the release-graph audit, ordered by urgency (Hold
 * first, Publish now last) so the most actionable items are never buried
 * at the bottom of a long report.
 */
export function renderReleaseGraphReport(input: ReleaseGraphReportInput): string {
  const { audits, noPlacementAudits = [], generatedAt, periodId } = input;
  const summary = summarizeReleaseGraphAudits(audits);
  const groups = groupByVerdict(audits);
  const lines: string[] = [];

  lines.push(`# Release-graph audit${periodId ? ` — period ${periodId}` : ""}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Dry-run, read-only. No placement, claim, receipt, or artifact row was created or modified while producing this report.`);
  lines.push("");
  lines.push(
    `## Summary: ${summary.total} release${summary.total === 1 ? "" : "s"} audited — ` +
      `${summary.hold} Hold, ${summary.needs_verification} Needs verification, ` +
      `${summary.system_improvement} System improvement, ${summary.publish_now} Publish now`,
  );
  lines.push("");

  const order: ReleaseVerdict[] = ["hold", "needs_verification", "system_improvement", "publish_now"];
  for (const verdict of order) {
    const rows = groups[verdict];
    lines.push(`## ${RELEASE_VERDICT_LABEL[verdict]} (${rows.length})`);
    lines.push("");
    if (rows.length === 0) {
      lines.push("_None._");
      lines.push("");
      continue;
    }
    for (const audit of rows) {
      lines.push(`### ${audit.deliverableTitle} → ${audit.destination}`);
      lines.push(
        `- Version: ${audit.versionNumber ?? "unknown"} (\`${audit.versionId || "none"}\`) · Locale: ${audit.locale ?? "unknown"} · Placement: \`${audit.placementId}\``,
      );
      lines.push(
        `- Existing preflight gate: mayPublish=${audit.existingPreflightGate.mayPublish}${
          audit.existingPreflightGate.reason ? ` (${audit.existingPreflightGate.reason})` : ""
        }`,
      );
      if (audit.findings.length === 0) {
        lines.push("- No findings. Every fact this audit checks resolved cleanly.");
      }
      for (const f of audit.findings) {
        lines.push("");
        lines.push(`**${f.summary}** — \`${f.classification}\` (fact: ${f.fact}, release impact: ${f.releaseImpact})`);
        lines.push(`  - Factual evidence: ${f.factualEvidence}`);
        lines.push(`  - Canonical source consulted: ${f.canonicalSourceConsulted}`);
        lines.push(`  - Immediate disposition: ${f.immediateDisposition}`);
        lines.push(`  - Root cause: ${f.rootCause}`);
        lines.push(`  - Proposed durable solution: ${f.proposedDurableSolution}`);
        lines.push(`  - Authority required: ${f.authorityRequired}`);
        lines.push(`  - Reusable preflight rule: ${f.reusablePreflightRule}`);
      }
      lines.push("");
    }
  }

  if (noPlacementAudits.length > 0) {
    lines.push(`## Deliverables with no destination placement (${noPlacementAudits.length})`);
    lines.push("");
    lines.push("Reported by name, never silently dropped from this audit (mirrors publication-preflight.ts's own deliverablesWithNoPlacements list).");
    lines.push("");
    for (const a of noPlacementAudits) lines.push(`- ${a.deliverableTitle} (\`${a.deliverableId}\`)`);
    lines.push("");
  }

  return lines.join("\n");
}

/** JSON form of the same report, for programmatic consumers (a future dashboard, or a CI gate). */
export function toReleaseGraphReportJson(input: ReleaseGraphReportInput): {
  generatedAt: string;
  periodId?: string;
  summary: ReleaseGraphReportSummary;
  audits: ReleaseGraphAudit[];
  noPlacementAudits: ReleaseGraphNoPlacementAudit[];
} {
  return {
    generatedAt: input.generatedAt,
    periodId: input.periodId,
    summary: summarizeReleaseGraphAudits(input.audits),
    audits: input.audits,
    noPlacementAudits: input.noPlacementAudits ?? [],
  };
}
