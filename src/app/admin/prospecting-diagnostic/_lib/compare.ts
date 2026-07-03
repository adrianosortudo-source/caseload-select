import type { DomainScan, ProspectingDiagnostic } from "./prospecting";
import type { SeoCheckIssue, SeoCheckResult } from "./seo-types";

export interface SavedRunLike {
  id: string;
  prospect_firm_name: string;
  primary_domain: string;
  created_at: string;
  overall_score: number | null;
  ai_search_score: number | null;
  intent_score: number | null;
  prospect_fit_score: number | null;
  pages_scanned: number;
  total_pages_scanned: number;
  diagnostic: ProspectingDiagnostic;
  scans: DomainScan[];
}

export interface ScoreDelta {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface IssueMovement {
  id: string;
  title: string;
  category: string;
  severity?: string;
  beforeSeverity?: string;
  afterSeverity?: string;
  beforeUrls?: string[];
  afterUrls?: string[];
}

export interface DiagnosticComparison {
  before: SavedRunLike;
  after: SavedRunLike;
  scoreDeltas: ScoreDelta[];
  newIssues: IssueMovement[];
  resolvedIssues: IssueMovement[];
  persistentIssues: IssueMovement[];
  competitorChanges: string[];
  bestIntentPageBefore: string | null;
  bestIntentPageAfter: string | null;
  recommendedNextAction: string;
}

function primaryResult(run: SavedRunLike): SeoCheckResult | null {
  const primary = run.scans.find((s) => s.role === "primary" && s.result);
  return primary?.result ?? null;
}

function issueKey(issue: SeoCheckIssue): string {
  return issue.id || `${issue.category}::${issue.title}`.toLowerCase();
}

function issueMovement(issue: SeoCheckIssue): IssueMovement {
  return {
    id: issueKey(issue),
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    beforeSeverity: issue.severity,
    afterSeverity: issue.severity,
    beforeUrls: issue.affectedUrls,
    afterUrls: issue.affectedUrls,
  };
}

function scoreDelta(label: string, before: number | null | undefined, after: number | null | undefined): ScoreDelta {
  const b = before ?? null;
  const a = after ?? null;
  return { label, before: b, after: a, delta: b === null || a === null ? null : a - b };
}

function competitorMap(run: SavedRunLike): Map<string, { overall: number | null; ai: number | null; intent: number | null }> {
  const map = new Map<string, { overall: number | null; ai: number | null; intent: number | null }>();
  for (const scan of run.scans) {
    if (scan.role !== "competitor" || !scan.result) continue;
    map.set(scan.domain, {
      overall: scan.result.overallScore ?? null,
      ai: scan.result.aiSearchScore ?? null,
      intent: scan.result.intentAlignment?.score ?? null,
    });
  }
  return map;
}

function competitorChanges(before: SavedRunLike, after: SavedRunLike): string[] {
  const oldMap = competitorMap(before);
  const newMap = competitorMap(after);
  const domains = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  const out: string[] = [];
  for (const domain of domains) {
    const old = oldMap.get(domain);
    const cur = newMap.get(domain);
    if (!old && cur) {
      out.push(`${domain} was added as a competitor scan.`);
      continue;
    }
    if (old && !cur) {
      out.push(`${domain} was not included in the newer competitor scan.`);
      continue;
    }
    if (!old || !cur) continue;
    const parts: string[] = [];
    if (old.overall !== null && cur.overall !== null && old.overall !== cur.overall) parts.push(`SEO ${old.overall} to ${cur.overall}`);
    if (old.ai !== null && cur.ai !== null && old.ai !== cur.ai) parts.push(`AI ${old.ai} to ${cur.ai}`);
    if (old.intent !== null && cur.intent !== null && old.intent !== cur.intent) parts.push(`Intent ${old.intent} to ${cur.intent}`);
    if (parts.length > 0) out.push(`${domain}: ${parts.join(", ")}.`);
  }
  return out;
}

function bestIntentPage(run: SavedRunLike): string | null {
  return primaryResult(run)?.intentAlignment?.bestMatchingPage ?? null;
}

function nextAction(comparison: Omit<DiagnosticComparison, "recommendedNextAction">): string {
  const seo = comparison.scoreDeltas.find((s) => s.label === "SEO Health")?.delta ?? 0;
  const intent = comparison.scoreDeltas.find((s) => s.label === "Intent Alignment")?.delta ?? 0;
  const unresolvedHigh = comparison.persistentIssues.filter((i) => i.afterSeverity === "critical" || i.afterSeverity === "high");
  if (comparison.newIssues.some((i) => i.afterSeverity === "critical" || i.afterSeverity === "high")) {
    return "Investigate the new high-severity issue first, then rerun the scan after the fix.";
  }
  if (unresolvedHigh.length > 0) {
    return `Keep the next work block focused on ${unresolvedHigh[0].title}; it is still present after the newer scan.`;
  }
  if (intent < 0) return "Review the target-intent page. Intent alignment moved backward and may need title, heading, or content updates.";
  if (seo > 0 || intent > 0) return "Use the improvement as follow-up proof, then choose the next unresolved medium-effort issue.";
  return "No major movement surfaced. Confirm the scan inputs are comparable, then prioritize the highest persistent finding.";
}

export function compareDiagnostics(before: SavedRunLike, after: SavedRunLike): DiagnosticComparison {
  const beforePrimary = primaryResult(before);
  const afterPrimary = primaryResult(after);
  const beforeIssues = new Map((beforePrimary?.issues ?? []).map((issue) => [issueKey(issue), issue]));
  const afterIssues = new Map((afterPrimary?.issues ?? []).map((issue) => [issueKey(issue), issue]));

  const newIssues: IssueMovement[] = [];
  const resolvedIssues: IssueMovement[] = [];
  const persistentIssues: IssueMovement[] = [];

  for (const [key, issue] of afterIssues) {
    const prior = beforeIssues.get(key);
    if (!prior) newIssues.push(issueMovement(issue));
    else {
      persistentIssues.push({
        id: key,
        title: issue.title,
        category: issue.category,
        beforeSeverity: prior.severity,
        afterSeverity: issue.severity,
        beforeUrls: prior.affectedUrls,
        afterUrls: issue.affectedUrls,
      });
    }
  }
  for (const [key, issue] of beforeIssues) {
    if (!afterIssues.has(key)) resolvedIssues.push(issueMovement(issue));
  }

  const partial: Omit<DiagnosticComparison, "recommendedNextAction"> = {
    before,
    after,
    scoreDeltas: [
      scoreDelta("SEO Health", before.overall_score ?? beforePrimary?.overallScore, after.overall_score ?? afterPrimary?.overallScore),
      scoreDelta("AI Search", before.ai_search_score ?? beforePrimary?.aiSearchScore, after.ai_search_score ?? afterPrimary?.aiSearchScore),
      scoreDelta("Intent Alignment", before.intent_score ?? beforePrimary?.intentAlignment?.score, after.intent_score ?? afterPrimary?.intentAlignment?.score),
      scoreDelta("Prospect Fit", before.prospect_fit_score ?? beforePrimary?.internalSummary?.prospectFitScore, after.prospect_fit_score ?? afterPrimary?.internalSummary?.prospectFitScore),
      scoreDelta("Pages Scanned", before.total_pages_scanned || before.pages_scanned, after.total_pages_scanned || after.pages_scanned),
    ],
    newIssues,
    resolvedIssues,
    persistentIssues,
    competitorChanges: competitorChanges(before, after),
    bestIntentPageBefore: bestIntentPage(before),
    bestIntentPageAfter: bestIntentPage(after),
  };

  return { ...partial, recommendedNextAction: nextAction(partial) };
}
