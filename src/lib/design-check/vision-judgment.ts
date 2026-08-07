import { createHash } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { DimensionResult } from "./dimension-types";

/**
 * Phase 2: the vision-model judgment layer. Covers what a text/HTML
 * parser structurally cannot verify (Gestalt hierarchy, whitespace
 * confidence, whether a layout "reads as designed"), using the
 * framework's fixed 7-item rubric verbatim, one cited reason per score.
 * Runs on Gemini, matching every other AI call site in this app (screen
 * engine extraction, Firm Assist embeddings, voice transcription): the
 * SDK's native JSON-schema constrained decoding (responseMimeType +
 * responseSchema), the same mechanism screen-llm-server.ts already uses,
 * combined with an inline base64 image part the same way
 * /api/transcribe/route.ts already sends inline audio. Originally built
 * on Anthropic (Content Studio's call pattern); migrated 2026-08-06 for
 * vendor consistency, per the operator's standing rule that this stack
 * runs on Gemini.
 *
 * Caching note: the build plan commits to caching on screenshot hash so
 * a re-scan of an unchanged page does not re-spend tokens. There is
 * nowhere to cache TO in v1 (no Supabase persistence, per the operator's
 * 2026-07-16 decision). This module computes and returns the hash so the
 * mechanism is ready to wire to a real cache later; it does not fabricate
 * caching against no store.
 */

const MODEL = "gemini-2.5-flash";

export const JUDGMENT_RUBRIC_ITEMS = [
  {
    key: "first_impression",
    definition: "Is the value and audience clear above the fold, and does one action win the eye.",
  },
  {
    key: "hierarchy",
    definition: "Is there one dominant element per section, sized by decision-priority, with eye-stops under five.",
  },
  {
    key: "composition_whitespace",
    definition: "Does the spacing read as confident and deliberate, or cramped and template-like.",
  },
  {
    key: "grid_alignment",
    definition: "Does the layout hold to shared axes and a coherent grid.",
  },
  {
    key: "trust",
    definition: "Does the page look credible at a glance (the aesthetic-usability effect), with proof near the ask.",
  },
  {
    key: "coherence",
    definition: "Read the whole page top to bottom: does it read as one unified promise or as disjointed sections.",
  },
  {
    key: "template_tell",
    definition: "Does this look designed for this business, or assembled from a generic theme.",
  },
] as const;

export type JudgmentKey = (typeof JUDGMENT_RUBRIC_ITEMS)[number]["key"];

export interface JudgmentScore {
  item: JudgmentKey;
  score: number;
  reason: string;
}

export interface VisionJudgmentResult {
  screenshotHash: string;
  judgments: JudgmentScore[];
  usage: { inputTokens: number; outputTokens: number };
}

const JUDGMENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    judgments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: {
            type: "string",
            enum: JUDGMENT_RUBRIC_ITEMS.map((r) => r.key),
          },
          // The 0-100 range is stated in the description and re-validated
          // below in judgeScreenshot rather than enforced by the schema
          // (Gemini's schema subset has no reliable cross-vendor min/max
          // guarantee for integers, matching the defensive posture this
          // file already needs for the enum-uniqueness check below, which
          // no JSON-schema-shaped mechanism can express either way).
          score: { type: "integer", description: "0 to 100." },
          reason: {
            type: "string",
            description: "One sentence of visual evidence for this score. Cite what is actually visible, not a generic opinion.",
          },
        },
        required: ["item", "score", "reason"],
      },
    },
  },
  required: ["judgments"],
};

function buildSystemPrompt(): string {
  const items = JUDGMENT_RUBRIC_ITEMS.map((r, i) => `${i + 1}. ${r.key}: ${r.definition}`).join("\n");
  return [
    "You are grading a law firm website screenshot against a fixed design-quality rubric.",
    "Score each of the following 7 items from 0 to 100 and give exactly one sentence of visual evidence per score, citing what is actually visible in the screenshot.",
    items,
    "",
    "Rules:",
    "- Grade only what a real visitor would see in this screenshot. Do not invent detail you cannot see.",
    "- A deterministic findings summary is provided below. Use it as corroborating evidence where relevant (for example, if the summary reports 4 H1 tags, that supports a lower hierarchy score), but the screenshot is the primary evidence for every judgment item.",
    "- Do not repeat or re-score the deterministic findings themselves; they are already scored elsewhere. Score only the 7 rubric items above.",
    "- Be specific. \"Looks clean\" is not evidence; \"the hero has one CTA button and no competing element above the fold\" is evidence.",
  ].join("\n");
}

function buildUserPrompt(deterministicFindings: DimensionResult[]): string {
  const digest = deterministicFindings
    .map((d) => {
      // Defensive: a caller passing a dimension shape without a flat
      // `items` array (the Authority dimension keeps its checks under
      // subScores) previously threw here and cost the whole judgment
      // pass. A malformed dimension now contributes nothing to the
      // digest instead of taking the pass down with it.
      const items = Array.isArray(d.items) ? d.items : [];
      const failsAndWarns = items.filter((i) => i.status !== "pass").map((i) => `${i.label}: ${i.detail}`);
      return `${d.name} (${d.score}/${d.maxScore}): ${failsAndWarns.length > 0 ? failsAndWarns.join("; ") : "no issues found"}`;
    })
    .join("\n");
  return `Deterministic findings already measured for this page:\n${digest}\n\nScore the 7 rubric items against the attached screenshot.`;
}

export function hashScreenshot(screenshotPng: Buffer): string {
  return createHash("sha256").update(screenshotPng).digest("hex");
}

/**
 * One retry on a validation failure (duplicate or missing rubric item).
 * Confirmed live (2026-07-16, on the prior Anthropic implementation)
 * that this happens at a meaningfully high rate, not a rare fluke: 1 of
 * 2 real calls against sakurabalaw.ca hit it. The same enum-uniqueness
 * gap exists regardless of vendor (no JSON-schema-shaped mechanism can
 * express "each of these keys appears exactly once"), so the retry
 * stays. Not retried: no Gemini API key configured, network failure, or
 * a thrown SDK error, none of which a same-input retry is likely to fix.
 */
export async function judgeScreenshot(
  screenshotPng: Buffer,
  deterministicFindings: DimensionResult[]
): Promise<VisionJudgmentResult> {
  try {
    return await judgeScreenshotOnce(screenshotPng, deterministicFindings);
  } catch (err) {
    const isValidationFailure = err instanceof Error && /duplicate entries|missing entries|out of range/.test(err.message);
    if (!isValidationFailure) throw err;
    return await judgeScreenshotOnce(screenshotPng, deterministicFindings);
  }
}

async function judgeScreenshotOnce(
  screenshotPng: Buffer,
  deterministicFindings: DimensionResult[]
): Promise<VisionJudgmentResult> {
  // GOOGLE_AI_API_KEY first (operator standard, matches screen-llm-server.ts
  // and /api/transcribe), GEMINI_API_KEY accepted as a fallback.
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY).");
  }

  const screenshotHash = hashScreenshot(screenshotPng);
  const screenshotBase64 = screenshotPng.toString("base64");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildSystemPrompt(),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: JUDGMENT_RESPONSE_SCHEMA as never,
    },
  });

  const result = await model.generateContent([
    { inlineData: { mimeType: "image/png", data: screenshotBase64 } },
    { text: buildUserPrompt(deterministicFindings) },
  ]);

  const raw = result.response.text();
  let parsed: { judgments: JudgmentScore[] };
  try {
    parsed = JSON.parse(raw) as { judgments: JudgmentScore[] };
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${raw.slice(0, 500)}`);
  }

  const judgments = validateJudgments(parsed.judgments);
  const usage = result.response.usageMetadata;

  return {
    screenshotHash,
    judgments,
    usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 },
  };
}

/**
 * The strict JSON schema constrains each object's shape but cannot
 * express "each of these 7 enum values appears exactly once across
 * sibling array entries." Confirmed live (2026-07-16, sakurabalaw.ca):
 * the model returned "hierarchy" twice, once with real reasoning and
 * once with the literal reason "placeholder". A duplicate or missing
 * rubric item is a genuine model-output validation failure, not
 * something to silently paper over by picking whichever entry looks
 * better; the honest response is to throw so the caller can retry, not
 * to guess which entry was real.
 */
function validateJudgments(judgments: JudgmentScore[]): JudgmentScore[] {
  const seen = new Map<JudgmentKey, JudgmentScore>();
  const duplicates: JudgmentKey[] = [];
  for (const j of judgments) {
    if (j.score < 0 || j.score > 100 || !Number.isInteger(j.score)) {
      throw new Error(`Vision judgment score out of range for "${j.item}": ${j.score}.`);
    }
    if (seen.has(j.item)) duplicates.push(j.item);
    seen.set(j.item, j);
  }
  if (duplicates.length > 0) {
    throw new Error(`Vision judgment returned duplicate entries for: ${duplicates.join(", ")}. Full response: ${JSON.stringify(judgments)}`);
  }
  const missing = JUDGMENT_RUBRIC_ITEMS.map((r) => r.key).filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new Error(`Vision judgment is missing entries for: ${missing.join(", ")}.`);
  }
  return judgments;
}
