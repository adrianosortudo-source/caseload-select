/**
 * seo-types.ts
 *
 * Local mirror of the operator-shape response from POST /api/tools/seo-check
 * (the `SeoCheckResult` defined in src/app/api/tools/seo-check/analysis.ts).
 *
 * We mirror rather than import so the admin prospecting tool stays decoupled
 * from the API route folder (which carries server-only network code). Same
 * pattern the public SeoReport component uses. Only the fields the prospecting
 * mapping reads are declared; everything else on the wire is ignored.
 *
 * The internalSummary and per-issue internalNote / prospectingAngle fields are
 * operator-only and are present here because this tool always calls the API
 * with the operator session cookie attached.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";

export interface SeoCheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

export interface SeoCategoryResult {
  name: string;
  score: number;
  maxScore: number;
  items: SeoCheckItem[];
}

export interface SeoCheckIssue {
  id: string;
  category: string;
  severity: Severity;
  status: "pass" | "warn" | "fail";
  title: string;
  detail: string;
  fix?: string;
  evidence?: string;
  affectedUrls: string[];
  affectedCount: number;
  totalPages: number;
  pageTypeImpact?: string[];
  confidence: Confidence;
  effort: Effort;
  priority: number;
  /** Operator-only. */
  internalNote?: string;
  /** Operator-only. Already translated into a business angle by the engine. */
  prospectingAngle?: string;
}

export interface SeoInternalSummary {
  prospectFitScore: number;
  websiteMaturity: "poor" | "basic" | "decent" | "strong";
  urgencyLevel: "low" | "medium" | "high" | "urgent";
  likelyPainPoints: string[];
  strongestOutreachHooks: string[];
  recommendedOpeningAngle: string;
  topRevenueOpportunities: string[];
  technicalBlockers: string[];
  aiVisibilityBlockers: string[];
  localSeoOpportunities: string[];
  trustAndConversionGaps: string[];
}

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface SeoCheckResult {
  domain: string;
  scanMode: "quick" | "standard" | "deep";
  pagesScanned: number;
  categories: SeoCategoryResult[];
  overallScore: number;
  grade: string;
  aiSearchScore: number;
  aiSearchGrade: string;
  aiPolicyScore: number;
  aiPolicyGrade: string;
  issues: SeoCheckIssue[];
  internalSummary?: SeoInternalSummary;
  severityBreakdown: SeverityBreakdown;
  partial?: boolean;
  checkedAt: string;
}
