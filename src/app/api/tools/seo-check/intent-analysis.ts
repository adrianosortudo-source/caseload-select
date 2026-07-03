/**
 * intent-analysis.ts
 *
 * Pure, network-free intent scoring for the SEO diagnostic. This layer answers
 * the PageAudit-style question operators actually care about in prospecting:
 * "does this site have a strong page for the matter/location we want to test?"
 *
 * It avoids keyword-density scoring. The score is based on evidence placement
 * across high-signal fields: title, meta description, H1/H2, URL, opening copy,
 * body, schema, local modifiers, and page depth.
 */

import { type CategoryResult, type CheckItem, computeGrade } from "./engine-core";

export type IntentSignalStatus = "pass" | "warn" | "fail";
export type IntentConfidence = "high" | "medium" | "low";

export interface IntentInput {
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  targetAudience?: string;
}

export interface NormalizedIntent {
  targetKeyword: string;
  targetMatter: string;
  targetLocation: string;
  targetAudience: string;
  phrases: string[];
  matterTerms: string[];
  locationTerms: string[];
}

export interface IntentSignal {
  signal: string;
  status: IntentSignalStatus;
  weight: number;
  detail: string;
  evidence?: string;
}

export interface PageAuditSnapshot {
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  imageCount: number;
  imagesMissingAlt: number;
  internalLinksOut: number;
  ctaEvidence: string[];
  phoneEvidence: string[];
}

export interface PageIntentResult {
  score: number;
  grade: string;
  confidence: IntentConfidence;
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  matchedSignals: number;
  totalSignals: number;
  evidence: IntentSignal[];
}

export interface SiteIntentResult {
  score: number;
  grade: string;
  confidence: IntentConfidence;
  bestMatchingPage?: string;
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  evidence: IntentSignal[];
  missingSignals: string[];
}

const MAX_TEXT = 500_000;

function cleanText(s: string): string {
  return decodeBasicEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeText(s: string): string {
  return cleanText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaContent(html: string, nameOrProperty: string): string | null {
  const escaped = nameOrProperty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decodeBasicEntities(m[1]).trim();
  }
  return null;
}

function extractAllTags(html: string, tagName: string): string[] {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = cleanText(m[1]);
    if (text) results.push(text);
    if (results.length >= 20) break;
  }
  return results;
}

function uniqueTerms(raw: string): string[] {
  const stop = new Set([
    "and", "the", "for", "with", "from", "law", "lawyer", "lawyers",
    "attorney", "attorneys", "firm", "legal", "service", "services",
    "professional", "corporation", "inc", "llp", "pc", "of", "in", "to",
  ]);
  return [...new Set(normalizeText(raw).split(" ").filter((w) => w.length >= 3 && !stop.has(w)))];
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const h = normalizeText(haystack);
  const p = normalizeText(phrase);
  if (!p) return false;
  return h.includes(p);
}

function termCoverage(haystack: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const h = normalizeText(haystack);
  const matched = terms.filter((t) => h.includes(t)).length;
  return matched / terms.length;
}

function hasAnyPhrase(haystack: string, phrases: string[]): boolean {
  return phrases.some((p) => containsPhrase(haystack, p));
}

function signal(
  name: string,
  status: IntentSignalStatus,
  weight: number,
  detail: string,
  evidence?: string
): IntentSignal {
  return { signal: name, status, weight, detail, evidence };
}

export function normalizeIntentInput(input: IntentInput | null | undefined): NormalizedIntent | null {
  const targetKeyword = typeof input?.targetKeyword === "string" ? input.targetKeyword.trim().slice(0, 120) : "";
  const targetMatter = typeof input?.targetMatter === "string" ? input.targetMatter.trim().slice(0, 120) : "";
  const targetLocation = typeof input?.targetLocation === "string" ? input.targetLocation.trim().slice(0, 80) : "";
  const targetAudience = typeof input?.targetAudience === "string" ? input.targetAudience.trim().slice(0, 120) : "";

  const phraseSource = [targetKeyword, targetMatter].filter(Boolean);
  const phrases = [...new Set(phraseSource.map((p) => p.trim()).filter((p) => normalizeText(p).length >= 3))];
  const matterTerms = uniqueTerms([targetKeyword, targetMatter].filter(Boolean).join(" "));
  const locationTerms = uniqueTerms(targetLocation);

  if (phrases.length === 0 && matterTerms.length === 0 && locationTerms.length === 0) return null;
  return { targetKeyword, targetMatter, targetLocation, targetAudience, phrases, matterTerms, locationTerms };
}

export function buildPageAuditSnapshot(html: string): PageAuditSnapshot {
  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].slice(0, 500).map((m) => m[0]);
  const imagesMissingAlt = imageTags.filter((tag) => !/\salt=["'][^"']+["']/i.test(tag)).length;
  const internalLinksOut = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)]
    .filter((m) => {
      const href = (m[1] || "").trim();
      return href.startsWith("/") || href.startsWith("#") || !/^[a-z][a-z0-9+.-]*:/i.test(href);
    })
    .length;
  const body = cleanText(html).slice(0, MAX_TEXT);
  const ctaEvidence = [
    "book a call", "schedule a consultation", "free consultation", "contact us",
    "request a consultation", "talk to a lawyer", "call now", "get started",
  ].filter((p) => containsPhrase(body, p)).slice(0, 4);
  const phoneEvidence = body.match(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}/g)?.slice(0, 3) ?? [];

  return {
    metaDescription: extractMetaContent(html, "description"),
    h1s: extractAllTags(html, "h1").slice(0, 5),
    h2s: extractAllTags(html, "h2").slice(0, 12),
    imageCount: imageTags.length,
    imagesMissingAlt,
    internalLinksOut,
    ctaEvidence,
    phoneEvidence,
  };
}

export function analyzePageIntent(input: {
  html: string;
  url: string;
  title: string | null;
  wordCount: number;
  schemaTypes: string[];
  intent: NormalizedIntent;
}): PageIntentResult {
  const pageAudit = buildPageAuditSnapshot(input.html);
  const body = cleanText(input.html).slice(0, MAX_TEXT);
  const firstWords = body.split(/\s+/).slice(0, 160).join(" ");
  const path = (() => { try { return new URL(input.url).pathname.replace(/[-_/]+/g, " "); } catch { return input.url; } })();
  const headings = [...pageAudit.h1s, ...pageAudit.h2s].join(" ");
  const schemaText = input.schemaTypes.join(" ");

  const phrase = input.intent.phrases[0] || input.intent.matterTerms.join(" ");
  const titleText = input.title || "";
  const meta = pageAudit.metaDescription || "";

  const signals: IntentSignal[] = [];
  signals.push(hasAnyPhrase(titleText, input.intent.phrases) || termCoverage(titleText, input.intent.matterTerms) >= 0.5
    ? signal("Title alignment", "pass", 12, "The page title is aligned with the target matter.", titleText)
    : signal("Title alignment", "fail", 12, `The page title does not clearly target ${phrase || "the intended matter"}.`, titleText || undefined));

  signals.push(hasAnyPhrase(meta, input.intent.phrases) || termCoverage(meta, input.intent.matterTerms) >= 0.45
    ? signal("Meta description alignment", "pass", 8, "The search snippet reinforces the target matter.", meta)
    : signal("Meta description alignment", meta ? "warn" : "fail", 8, "The meta description does not clearly support the target matter.", meta || undefined));

  signals.push(pageAudit.h1s.some((h) => hasAnyPhrase(h, input.intent.phrases) || termCoverage(h, input.intent.matterTerms) >= 0.5)
    ? signal("H1 alignment", "pass", 12, "A primary heading supports the target matter.", pageAudit.h1s[0])
    : signal("H1 alignment", "fail", 12, "No H1 clearly matches the target matter.", pageAudit.h1s[0]));

  signals.push(termCoverage(headings, input.intent.matterTerms) >= 0.45
    ? signal("Supporting headings", "pass", 8, "H2/H3-style page structure supports the topic.", pageAudit.h2s.slice(0, 3).join(" | "))
    : signal("Supporting headings", pageAudit.h2s.length > 0 ? "warn" : "fail", 8, "Supporting headings do not build out the target topic.", pageAudit.h2s.slice(0, 3).join(" | ") || undefined));

  signals.push(hasAnyPhrase(path, input.intent.phrases) || termCoverage(path, input.intent.matterTerms) >= 0.5
    ? signal("URL slug", "pass", 7, "The URL slug is relevant to the target matter.", path)
    : signal("URL slug", "warn", 7, "The URL slug is generic or not aligned with the target matter.", path));

  signals.push(termCoverage(firstWords, input.intent.matterTerms) >= 0.45
    ? signal("Opening copy", "pass", 10, "The opening copy introduces the target matter early.", firstWords.slice(0, 220))
    : signal("Opening copy", "warn", 10, "The target matter is not clear in the opening copy.", firstWords.slice(0, 220)));

  const bodyCoverage = termCoverage(body, input.intent.matterTerms);
  signals.push(bodyCoverage >= 0.6
    ? signal("Entity coverage", "pass", 12, "The page body covers the main matter entities.", `${Math.round(bodyCoverage * 100)}% term coverage`)
    : signal("Entity coverage", bodyCoverage >= 0.3 ? "warn" : "fail", 12, "The page body has thin coverage for the target matter.", `${Math.round(bodyCoverage * 100)}% term coverage`));

  if (input.intent.locationTerms.length > 0) {
    const locationHaystack = [titleText, meta, headings, body, schemaText].join(" ");
    const locationCoverage = termCoverage(locationHaystack, input.intent.locationTerms);
    signals.push(locationCoverage >= 0.5
      ? signal("Location modifier", "pass", 8, "The page connects the matter to the target location.", input.intent.targetLocation)
      : signal("Location modifier", "warn", 8, "The page does not clearly connect the matter to the target location.", input.intent.targetLocation));
  }

  signals.push(input.schemaTypes.some((t) => /legalservice|localbusiness|organization|attorney|person|faqpage/i.test(t))
    ? signal("Schema support", "pass", 8, "Structured data provides entity support.", input.schemaTypes.slice(0, 6).join(", "))
    : signal("Schema support", "warn", 8, "No relevant schema type supports the page topic.", input.schemaTypes.slice(0, 6).join(", ") || undefined));

  signals.push(input.wordCount >= 650
    ? signal("Content depth", "pass", 8, "The page has enough depth for a practice/matter page.", `${input.wordCount} words`)
    : signal("Content depth", input.wordCount >= 350 ? "warn" : "fail", 8, "The page is thin for a priority matter page.", `${input.wordCount} words`));

  signals.push(pageAudit.internalLinksOut >= 3
    ? signal("Internal-link context", "pass", 7, "The page connects to other site pages.", `${pageAudit.internalLinksOut} internal links`)
    : signal("Internal-link context", "warn", 7, "The page has little internal-link context.", `${pageAudit.internalLinksOut} internal links`));

  const max = signals.reduce((sum, s) => sum + s.weight, 0);
  const earned = signals.reduce((sum, s) => sum + (s.status === "pass" ? s.weight : s.status === "warn" ? s.weight * 0.5 : 0), 0);
  const score = max > 0 ? Math.round((earned / max) * 100) : 0;
  const matchedSignals = signals.filter((s) => s.status === "pass").length;
  const confidence: IntentConfidence = matchedSignals >= 5 ? "high" : matchedSignals >= 3 ? "medium" : "low";

  return {
    score,
    grade: computeGrade(score),
    confidence,
    targetKeyword: input.intent.targetKeyword || undefined,
    targetMatter: input.intent.targetMatter || undefined,
    targetLocation: input.intent.targetLocation || undefined,
    matchedSignals,
    totalSignals: signals.length,
    evidence: signals,
  };
}

export function buildIntentCategory(pageIntent: PageIntentResult | null): CategoryResult | null {
  if (!pageIntent) return null;
  const items: CheckItem[] = pageIntent.evidence.map((e) => ({
    label: e.signal,
    status: e.status,
    detail: e.detail,
    fix: e.status === "pass" ? undefined : fixForSignal(e.signal),
  }));
  const maxScore = items.length * 10;
  const score = Math.round((pageIntent.score / 100) * maxScore);
  return { name: "Intent Alignment", score, maxScore, items };
}

function fixForSignal(signalName: string): string {
  if (signalName === "Title alignment") return "Rewrite the title around the priority matter and location.";
  if (signalName === "Meta description alignment") return "Write a search snippet that states the matter, audience, and next step.";
  if (signalName === "H1 alignment") return "Use one clear H1 that names the practice or matter clients search for.";
  if (signalName === "Supporting headings") return "Add supporting headings for symptoms, process, FAQs, evidence, timelines, or services.";
  if (signalName === "Location modifier") return "Add natural location language where the firm actually serves clients.";
  if (signalName === "Schema support") return "Add LegalService, Attorney, Person, FAQPage, or LocalBusiness schema where appropriate.";
  if (signalName === "Content depth") return "Expand the page with useful, jurisdiction-specific explanation and intake guidance.";
  if (signalName === "Internal-link context") return "Link this page to related practice, attorney, FAQ, and contact pages.";
  return "Align this page with the target matter using specific, client-language evidence.";
}

export function aggregateIntentAlignment(pageResults: Array<{ url: string; intentAlignment?: PageIntentResult }>): SiteIntentResult | null {
  const withIntent = pageResults.filter((p): p is { url: string; intentAlignment: PageIntentResult } => !!p.intentAlignment);
  if (withIntent.length === 0) return null;
  const best = withIntent.reduce((a, b) => (b.intentAlignment.score > a.intentAlignment.score ? b : a));
  const score = Math.round(withIntent.reduce((sum, p) => sum + p.intentAlignment.score, 0) / withIntent.length);
  const bestEvidence = best.intentAlignment.evidence;
  const missingSignals = bestEvidence.filter((e) => e.status !== "pass").map((e) => e.signal);
  const highConfidencePages = withIntent.filter((p) => p.intentAlignment.confidence === "high").length;
  const confidence: IntentConfidence = highConfidencePages > 0 ? "high" : withIntent.some((p) => p.intentAlignment.confidence === "medium") ? "medium" : "low";

  return {
    score,
    grade: computeGrade(score),
    confidence,
    bestMatchingPage: best.url,
    targetKeyword: best.intentAlignment.targetKeyword,
    targetMatter: best.intentAlignment.targetMatter,
    targetLocation: best.intentAlignment.targetLocation,
    evidence: bestEvidence,
    missingSignals,
  };
}
