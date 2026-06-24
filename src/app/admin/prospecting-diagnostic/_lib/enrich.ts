/**
 * enrich.ts
 *
 * Prospect enrichment, Phase 1. Pure, deterministic, no network and no React.
 * It turns the existing SEO scan (SeoCheckResult.pages) into a compact research
 * packet, builds a strict LLM prompt over it, and defensively parses the model's
 * JSON back into a ProspectEnrichment.
 *
 * Split of responsibilities:
 *   - buildResearchPacket: runs CLIENT-side (the client already holds the scan).
 *   - buildEnrichPrompt + parseEnrichment: run SERVER-side in the operator route.
 * All three are pure so they unit-test without a DOM or a network.
 *
 * Discipline: the model is an interpreter of supplied evidence, not a
 * researcher. The prompt forbids invention; the parser never trusts the model
 * (it clamps confidence, caps arrays, and strips em dashes from any string that
 * could reach prospect-facing copy, since market flows into the cold email).
 */

import type { SeoCheckResult, SeoPageResult } from "./seo-types";

export type Confidence = "low" | "medium" | "high";

export interface ResearchPagePacket {
  title: string;
  pageType: string;
  slug: string;
  practiceIntent: boolean;
}

export interface ProspectResearchPacket {
  firmName: string;
  primaryDomain: string;
  /** Reference only. The model is told it has no access to LinkedIn contents. */
  linkedinUrl?: string;
  pagesScanned: number;
  addressSignal: boolean;
  schemaTypes: string[];
  practiceSlugs: string[];
  pages: ResearchPagePacket[];
}

export interface ProspectEnrichment {
  market: { value: string; confidence: Confidence; evidence: string[] };
  practiceAreaFocus: {
    summary: string;
    practiceAreas: string[];
    confidence: Confidence;
    evidence: string[];
  };
  alternateDomains: Array<{ domain: string; reason: string; confidence: Confidence }>;
}

export const EMPTY_ENRICHMENT: ProspectEnrichment = {
  market: { value: "", confidence: "low", evidence: [] },
  practiceAreaFocus: { summary: "", practiceAreas: [], confidence: "low", evidence: [] },
  alternateDomains: [],
};

const MAX_PAGES_IN_PACKET = 24;
const MAX_TITLE_LEN = 140;

// Em dash by code point so this source file does not trip the brand-voice hook.
const EM_DASH_RE = new RegExp(String.fromCharCode(0x2014), "g");

/* ────────────────────────────────────────────────────────
   Research packet (client-side, from the SEO scan)
   ──────────────────────────────────────────────────────── */

function slugOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname + (u.search || "")) || "/";
  } catch {
    return url;
  }
}

export function buildResearchPacket(
  input: { firmName: string; primaryDomain: string; linkedinUrl?: string },
  result: Pick<SeoCheckResult, "pagesScanned" | "pages">
): ProspectResearchPacket {
  const pages: SeoPageResult[] = result.pages ?? [];

  const schemaTypes = [...new Set(pages.flatMap((p) => p.schema?.types ?? []))]
    .filter(Boolean)
    .slice(0, 30);

  const addressSignal = pages.some(
    (p) => p.lawFirm?.addressVisible || p.schema?.fields?.address || p.schema?.fields?.areaServed
  );

  const practiceSlugs = [
    ...new Set(pages.filter((p) => p.pageType === "practice").map((p) => slugOf(p.url))),
  ].slice(0, 20);

  const packetPages: ResearchPagePacket[] = pages.slice(0, MAX_PAGES_IN_PACKET).map((p) => ({
    title: (p.title ?? "").slice(0, MAX_TITLE_LEN).trim(),
    pageType: p.pageType,
    slug: slugOf(p.url),
    practiceIntent: !!p.lawFirm?.practiceAreaIntent,
  }));

  return {
    firmName: input.firmName,
    primaryDomain: input.primaryDomain,
    linkedinUrl: input.linkedinUrl?.trim() || undefined,
    pagesScanned: result.pagesScanned,
    addressSignal,
    schemaTypes,
    practiceSlugs,
    pages: packetPages,
  };
}

/* ────────────────────────────────────────────────────────
   Prompt (server-side)
   ──────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = [
  "You are a research assistant reading a structured summary of a law firm's public website (page titles, page types, URL slugs, and schema markup) and extracting a few facts for an internal sales workflow.",
  "",
  "Rules:",
  "- Extract ONLY what the supplied website scan evidence supports. If the evidence is weak, return low confidence or an empty value. Never guess.",
  "- Do not infer or invent competitors. Competitors are out of scope for this task.",
  "- Do not invent practice areas. Only list practice areas the page titles, slugs, or schema actually indicate.",
  "- Do not use LinkedIn content. A LinkedIn URL may appear as a reference only; you have no access to its contents.",
  "- Do not write prospect-facing marketing claims. Use plain, factual language. No em dashes.",
  "- Every field carries an evidence array citing the specific signals you used (for example a page title, a URL slug, or a schema type).",
  '- market.value, when known, should be a clean place string such as "Toronto, Ontario". If the city is not evident from titles, slugs, or schema, leave it empty with low confidence.',
  "",
  "Return ONLY a JSON object, with no prose and no code fences, matching exactly this shape:",
  "{",
  '  "market": { "value": string, "confidence": "low"|"medium"|"high", "evidence": string[] },',
  '  "practiceAreaFocus": { "summary": string, "practiceAreas": string[], "confidence": "low"|"medium"|"high", "evidence": string[] },',
  '  "alternateDomains": [ { "domain": string, "reason": string, "confidence": "low"|"medium"|"high" } ]',
  "}",
  "practiceAreaFocus.summary is one plain sentence naming the focus. practiceAreas is a short list of distinct areas. alternateDomains lists OTHER domains only if a title, slug, or schema field clearly references one; otherwise return an empty array.",
].join("\n");

export function buildEnrichPrompt(packet: ProspectResearchPacket): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Firm name: ${packet.firmName}`);
  lines.push(`Primary domain: ${packet.primaryDomain}`);
  if (packet.linkedinUrl) {
    lines.push(`LinkedIn URL (reference only, contents not available): ${packet.linkedinUrl}`);
  }
  lines.push(`Pages scanned: ${packet.pagesScanned}`);
  lines.push(`Address or area-served signal present on site: ${packet.addressSignal ? "yes" : "no"}`);
  lines.push(`Schema types found: ${packet.schemaTypes.length ? packet.schemaTypes.join(", ") : "none"}`);
  lines.push(`Practice-page slugs: ${packet.practiceSlugs.length ? packet.practiceSlugs.join(", ") : "none"}`);
  lines.push("");
  lines.push("Pages (title | type | slug | practice-intent):");
  for (const p of packet.pages) {
    lines.push(`- ${p.title || "(no title)"} | ${p.pageType} | ${p.slug} | ${p.practiceIntent ? "yes" : "no"}`);
  }
  lines.push("");
  lines.push("Produce the JSON object now.");

  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

/* ────────────────────────────────────────────────────────
   Defensive parsing (server-side)
   ──────────────────────────────────────────────────────── */

function stripEm(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(EM_DASH_RE, ", ").replace(/\s+/g, " ").trim();
}

function toConfidence(v: unknown): Confidence {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function toStringList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(stripEm).filter(Boolean).slice(0, cap);
}

function normalizeDomain(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/** Pull the first balanced-looking JSON object out of an LLM response. */
function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Never throws. Returns a valid ProspectEnrichment even from partial or
 * malformed model output, falling back to EMPTY_ENRICHMENT.
 */
export function parseEnrichment(raw: string): ProspectEnrichment {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") return EMPTY_ENRICHMENT;
  const o = obj as Record<string, unknown>;

  const marketObj = (o.market as Record<string, unknown>) ?? {};
  const paObj = (o.practiceAreaFocus as Record<string, unknown>) ?? {};
  const altRaw = Array.isArray(o.alternateDomains) ? o.alternateDomains : [];

  const alternateDomains = altRaw
    .map((entry) => {
      const e = (entry as Record<string, unknown>) ?? {};
      return {
        domain: normalizeDomain(e.domain),
        reason: stripEm(e.reason),
        confidence: toConfidence(e.confidence),
      };
    })
    .filter((d) => d.domain.length > 0)
    .slice(0, 5);

  return {
    market: {
      value: stripEm(marketObj.value),
      confidence: toConfidence(marketObj.confidence),
      evidence: toStringList(marketObj.evidence, 6),
    },
    practiceAreaFocus: {
      summary: stripEm(paObj.summary),
      practiceAreas: toStringList(paObj.practiceAreas, 10),
      confidence: toConfidence(paObj.confidence),
      evidence: toStringList(paObj.evidence, 6),
    },
    alternateDomains,
  };
}
