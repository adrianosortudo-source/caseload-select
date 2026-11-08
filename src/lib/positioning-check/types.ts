/** Public positioning diagnostic contract. Evidence IDs are collector-owned. */
export const ELEMENT_KEYS = ["audience", "practice_focus", "central_promise", "practical_benefits", "emotional_benefits", "reasons_to_choose", "supporting_credentials", "consistency"] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];
export type AssessmentStatus = "observed" | "inferred" | "unclear" | "not_observed" | "not_assessable";
export type Confidence = "high" | "moderate" | "low";
export interface PageCoverage { url: string; title: string; capturedAt: string; state: "readable" | "unreadable" | "truncated"; retainedChars: number }
export interface ScreenshotCoverage { id: string; viewport: "desktop" | "mobile"; state: "captured" | "unavailable" | "clipped"; analyzed: boolean; clippedFromPx: number | null }
interface EvidenceBase { id: string; sourceUrl: string; title: string; capturedAt: string }
export type Evidence = (EvidenceBase & { kind: "text"; excerpt: string; truncated: boolean }) | (EvidenceBase & { kind: "screenshot"; screenshotId: string; visibleRegion: string });
export interface ElementAssessment { key: ElementKey; status: AssessmentStatus; finding: string; clarity: 0 | 1 | 2 | 3 | null; confidence: Confidence | null; evidenceIds: string[]; reason: string; uncertainty: string; conflict: boolean }
export interface VisualFinding { finding: string; evidenceIds: string[] }
export interface Direction { id: string; label: string; audienceSituation: string; possibleStatement: string; evidenceIds: string[]; communicationImplication: string; clientExpectation: string; tradeoff: string; validationQuestions: [string, string, string] }
export interface PositioningResult { status: "success" | "partial"; metadata: { schemaVersion: string; rubricVersion: string; promptVersion: string; model: string; generatedAt: string; requestedUrl: string; resolvedOrigin: string; aiGenerated: true }; coverage: { pages: PageCoverage[]; screenshots: ScreenshotCoverage[]; limitations: string[] }; evidence: Evidence[]; part1: { statement: string; rationale: string; elements: ElementAssessment[]; visualFindings: VisualFinding[] }; part2: { directions: Direction[]; limitations: string[] } }
export type PositioningErrorCode = "invalid_url" | "blocked_or_unreadable" | "rate_limited" | "provider_unavailable" | "invalid_analysis" | "timeout" | "feature_disabled";
export interface PositioningError { status: "error"; code: PositioningErrorCode; message: string; retryable: boolean }
export type PositioningResponse = PositioningResult | PositioningError;
