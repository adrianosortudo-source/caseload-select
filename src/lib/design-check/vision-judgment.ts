import { createHash } from "node:crypto";
import type { DimensionResult } from "./dimension-types";

/**
 * Phase 2: the vision-model judgment layer. Covers what a text/HTML
 * parser structurally cannot verify (Gestalt hierarchy, whitespace
 * confidence, whether a layout "reads as designed"), using the
 * framework's fixed 7-item rubric verbatim, low temperature, one cited
 * reason per score. Mirrors Content Studio's proven Anthropic call
 * pattern (draft/route.ts): raw fetch, strict structured outputs via
 * constrained decoding, so the score object cannot arrive malformed.
 *
 * Caching note: the build plan commits to caching on screenshot hash so
 * a re-scan of an unchanged page does not re-spend tokens. There is
 * nowhere to cache TO in v1 (no Supabase persistence, per the operator's
 * 2026-07-16 decision). This module computes and returns the hash so the
 * mechanism is ready to wire to a real cache later; it does not fabricate
 * caching against no store.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CONTENT_STUDIO_MODEL ?? "claude-sonnet-5";
const JUDGMENT_TOOL_NAME = "emit_design_judgment";

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

const JUDGMENT_TOOL_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    judgments: {
      type: "array" as const,
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          item: {
            type: "string" as const,
            enum: JUDGMENT_RUBRIC_ITEMS.map((r) => r.key),
          },
          // Strict structured-output mode rejects minimum/maximum on
          // integer properties (confirmed live: "For 'integer' type,
          // properties maximum, minimum are not supported"). The 0-100
          // range is stated in the description and re-validated below in
          // judgeScreenshot rather than enforced by the schema.
          score: { type: "integer" as const, description: "0 to 100." },
          reason: {
            type: "string" as const,
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
      const failsAndWarns = d.items.filter((i) => i.status !== "pass").map((i) => `${i.label}: ${i.detail}`);
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
 * Confirmed live (2026-07-16) that this happens at a meaningfully high
 * rate, not a rare fluke: 1 of 2 real calls against sakurabalaw.ca hit
 * it. Not retried: ANTHROPIC_API_KEY missing, network failure, or a
 * non-2xx HTTP response, none of which a same-input retry is likely to
 * fix.
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const screenshotHash = hashScreenshot(screenshotPng);
  const screenshotBase64 = screenshotPng.toString("base64");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "structured-outputs-2025-11-13",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      // No temperature parameter: confirmed live that this model deprecates
      // it ("temperature is deprecated for this model"), matching Content
      // Studio's own call (draft/route.ts), which never sets it either.
      // Strict structured outputs (constrained decoding) is the
      // determinism mechanism here, not a low-temperature setting.
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshotBase64 },
            },
            { type: "text", text: buildUserPrompt(deterministicFindings) },
          ],
        },
      ],
      tools: [
        {
          name: JUDGMENT_TOOL_NAME,
          description: "Emit the 7-item design judgment rubric scores.",
          input_schema: JUDGMENT_TOOL_SCHEMA,
          strict: true,
        },
      ],
      tool_choice: { type: "tool", name: JUDGMENT_TOOL_NAME },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown error");
    throw new Error(`Anthropic API returned ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; input?: unknown }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const toolUse = result.content.find((c) => c.type === "tool_use");
  if (!toolUse || !toolUse.input) {
    throw new Error("Anthropic response contained no tool_use block.");
  }

  const parsed = toolUse.input as { judgments: JudgmentScore[] };
  const judgments = validateJudgments(parsed.judgments);

  return {
    screenshotHash,
    judgments,
    usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
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
