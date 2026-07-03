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

export interface SeoIntentSignal {
  signal: string;
  status: "pass" | "warn" | "fail";
  weight: number;
  detail: string;
  evidence?: string;
}

export interface SeoPageAuditSnapshot {
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  imageCount: number;
  imagesMissingAlt: number;
  internalLinksOut: number;
  ctaEvidence: string[];
  phoneEvidence: string[];
}

export interface SeoRenderingSnapshot {
  risk: "low" | "medium" | "high";
  wordCount: number;
  scriptCount: number;
  externalScriptCount: number;
  appShellLikely: boolean;
  emptyAppRoot: boolean;
  hasNoscriptFallback: boolean;
  evidence: string[];
  recommendation?: string;
}

export interface SeoRenderingSummary {
  risk: "low" | "medium" | "high";
  highRiskPages: number;
  mediumRiskPages: number;
  totalPages: number;
  evidence: string[];
}

export interface SeoIntentAlignment {
  score: number;
  grade: string;
  confidence: Confidence;
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  bestMatchingPage?: string;
  matchedSignals?: number;
  totalSignals?: number;
  evidence: SeoIntentSignal[];
  missingSignals?: string[];
}

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/**
 * Per-page view, narrowed to the fields the prospect-enrichment research packet
 * reads. The live API returns a richer PageResult; structural typing lets this
 * narrower shape read it safely.
 */
export interface SeoPageResult {
  url: string;
  title: string | null;
  pageType: string;
  schema: {
    types: string[];
    fields: { address: boolean; areaServed: boolean };
  };
  lawFirm: {
    practiceAreaIntent: boolean;
    addressVisible: boolean;
  };
  wordCount?: number;
  rendering?: SeoRenderingSnapshot;
  metaDescription?: string | null;
  pageAudit?: SeoPageAuditSnapshot;
  intentAlignment?: SeoIntentAlignment;
}

export interface SeoCheckResult {
  domain: string;
  scanMode: "quick" | "standard" | "deep";
  pagesScanned: number;
  /** Present on the live API response; read by the enrichment research packet. */
  pages?: SeoPageResult[];
  categories: SeoCategoryResult[];
  overallScore: number;
  grade: string;
  aiSearchScore: number;
  aiSearchGrade: string;
  aiPolicyScore: number;
  aiPolicyGrade: string;
  intentAlignment?: SeoIntentAlignment;
  renderingSummary?: SeoRenderingSummary;
  issues: SeoCheckIssue[];
  internalSummary?: SeoInternalSummary;
  severityBreakdown: SeverityBreakdown;
  partial?: boolean;
  checkedAt: string;
}
