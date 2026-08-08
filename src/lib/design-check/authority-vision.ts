import { createHash } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Authority and Positioning judgment layer (WEBSITE_AUTHORITY_SIGNAL_MODULE.md
 * "Judgment prompts" list). Separate rubric and separate call from Phase 2's
 * vision-judgment.ts (that one grades general design-quality composition;
 * this one grades positioning and proof-authenticity), but the exact same
 * call shape: Gemini SDK, native JSON-schema constrained decoding, one
 * retry on a duplicate/missing-entry validation failure. Migrated from
 * Anthropic 2026-08-06 alongside vision-judgment.ts for vendor consistency
 * (see that file's header for the full rationale).
 *
 * The module lists 7 judgment prompts. One, "is the message consistent
 * across home, about, and service pages," is a cross-page check the
 * operator's 2026-07-16 v1 single-URL decision puts out of scope; asking
 * the model to judge pages it was never shown would be fabricated
 * measurement, not deferred scope, so it is dropped from this rubric
 * rather than asked anyway. The other 6 run against the single screenshot.
 */

const MODEL = "gemini-2.5-flash";

export const AUTHORITY_JUDGMENT_RUBRIC_ITEMS = [
  {
    key: "five_second_clarity",
    definition: "Does the hero, read in 5 seconds, name what category of legal help this is, who it is for, the benefit, and why this firm over another.",
  },
  {
    key: "point_of_difference",
    definition: "Is a real, checkable point of difference stated (an 'only' claim, a named focus), or only an unverifiable superlative like 'best' or 'trusted'.",
  },
  {
    key: "proof_authenticity",
    definition: "Does the proof on the page (case studies, photos, testimonials) feel first-hand and specific, or generic and stock (stock-library faces, generic gavel/courthouse imagery, vague claims).",
  },
  {
    key: "named_method",
    definition: "Is a named, described process or method visible, presented in neutral non-superiority terms, versus a generic list of legal steps.",
  },
  {
    key: "buyer_situation_language",
    definition: "Does the page speak to concrete situations a real client would recognize ('if your situation involves X'), or only abstract service category names.",
  },
  {
    key: "author_credibility",
    definition: "Where an author or team bio is visible, does it read as a real credentialed person (role, experience, named credential), or a thin placeholder.",
  },
] as const;

export type AuthorityJudgmentKey = (typeof AUTHORITY_JUDGMENT_RUBRIC_ITEMS)[number]["key"];

export interface AuthorityJudgmentScore {
  item: AuthorityJudgmentKey;
  score: number;
  reason: string;
}

export interface AuthorityVisionJudgmentResult {
  screenshotHash: string;
  judgments: AuthorityJudgmentScore[];
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
            enum: AUTHORITY_JUDGMENT_RUBRIC_ITEMS.map((r) => r.key),
          },
          // The 0-100 range lives in the description and is re-validated
          // at runtime below instead of relying on schema-level min/max
          // (see vision-judgment.ts for the full rationale; the
          // enum-uniqueness check below needs runtime validation
          // regardless of what the schema can express).
          score: { type: "integer", description: "0 to 100." },
          reason: {
            type: "string",
            description: "One sentence of evidence for this score, citing what is actually visible in the screenshot.",
          },
        },
        required: ["item", "score", "reason"],
      },
    },
  },
  required: ["judgments"],
};

function buildSystemPrompt(): string {
  const items = AUTHORITY_JUDGMENT_RUBRIC_ITEMS.map((r, i) => `${i + 1}. ${r.key}: ${r.definition}`).join("\n");
  return [
    "You are grading a law firm website screenshot for authority and positioning: how clearly it states what it does and for whom, and how much of its credibility is earned (verifiable proof) versus merely claimed (unbacked superlatives).",
    "Score each of the following 6 items from 0 to 100 and give exactly one sentence of visual evidence per score, citing what is actually visible in the screenshot.",
    items,
    "",
    "Rules:",
    "- Grade only what a real visitor would see in this screenshot. Do not invent detail you cannot see.",
    "- Governing principle: authority is a structure others can point to, not a self-designation. A page can sound confident and still score low here if nothing backs the confidence.",
    "- A deterministic findings summary (lexicon hits, schema presence, testimonial attribution) is provided below as corroborating evidence. The screenshot is the primary evidence for every judgment item.",
    "- Do not repeat or re-score the deterministic findings themselves. Score only the 6 rubric items above.",
    '- Be specific. "Looks credible" is not evidence; "the hero states a named practice area and a specific city, with no generic best-firm language" is evidence.',
  ].join("\n");
}

function buildUserPrompt(deterministicSummary: string): string {
  return `Deterministic findings already measured for this page:\n${deterministicSummary}\n\nScore the 6 rubric items against the attached screenshot.`;
}

export function hashScreenshot(screenshotPng: Buffer): string {
  return createHash("sha256").update(screenshotPng).digest("hex");
}

/** One retry on a duplicate/missing-entry validation failure, matching
 * vision-judgment.ts's confirmed-live failure rate for this call shape. */
export async function judgeAuthorityScreenshot(
  screenshotPng: Buffer,
  deterministicSummary: string
): Promise<AuthorityVisionJudgmentResult> {
  try {
    return await judgeAuthorityScreenshotOnce(screenshotPng, deterministicSummary);
  } catch (err) {
    const isValidationFailure = err instanceof Error && /duplicate entries|missing entries|out of range/.test(err.message);
    if (!isValidationFailure) throw err;
    return await judgeAuthorityScreenshotOnce(screenshotPng, deterministicSummary);
  }
}

async function judgeAuthorityScreenshotOnce(
  screenshotPng: Buffer,
  deterministicSummary: string
): Promise<AuthorityVisionJudgmentResult> {
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
    { text: buildUserPrompt(deterministicSummary) },
  ]);

  const raw = result.response.text();
  let parsed: { judgments: AuthorityJudgmentScore[] };
  try {
    parsed = JSON.parse(raw) as { judgments: AuthorityJudgmentScore[] };
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

function validateJudgments(judgments: AuthorityJudgmentScore[]): AuthorityJudgmentScore[] {
  const seen = new Map<AuthorityJudgmentKey, AuthorityJudgmentScore>();
  const duplicates: AuthorityJudgmentKey[] = [];
  for (const j of judgments) {
    if (j.score < 0 || j.score > 100 || !Number.isInteger(j.score)) {
      throw new Error(`Authority judgment score out of range for "${j.item}": ${j.score}.`);
    }
    if (seen.has(j.item)) duplicates.push(j.item);
    seen.set(j.item, j);
  }
  if (duplicates.length > 0) {
    throw new Error(`Authority judgment returned duplicate entries for: ${duplicates.join(", ")}. Full response: ${JSON.stringify(judgments)}`);
  }
  const missing = AUTHORITY_JUDGMENT_RUBRIC_ITEMS.map((r) => r.key).filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new Error(`Authority judgment is missing entries for: ${missing.join(", ")}.`);
  }
  return judgments;
}
