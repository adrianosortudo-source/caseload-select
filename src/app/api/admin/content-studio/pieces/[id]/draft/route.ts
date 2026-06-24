import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getActiveStrategy,
  getNextVersionNumber,
  createPieceVersion,
  recordAiRun,
} from "@/lib/content-studio";
import type { StrategyRow } from "@/lib/content-studio";

export const dynamic = "force-dynamic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

function buildSystemPrompt(strategy: StrategyRow, format: string): string {
  const voice = strategy.voice_rules as Record<string, unknown>;
  const specs = strategy.format_specs as Record<string, Record<string, unknown>>;
  const formatSpec = specs[format] ?? {};
  const strategyJson = strategy.strategy_json as Record<string, unknown>;

  const bannedVocab = (voice.banned_vocabulary as string[]) ?? [];
  const approvedVocab = (voice.approved_vocabulary as string[]) ?? [];
  const formattingRules = (voice.formatting_rules as Record<string, boolean>) ?? {};
  const lsoRules = (voice.lso_rules as Record<string, unknown>) ?? {};
  const territory = strategyJson.territory_context as string | undefined;
  const voiceTone = (voice.tone as string) ?? "authoritative, direct, evidence-led";

  const parts: string[] = [];

  parts.push(
    "You are a legal content writer producing a draft for an Ontario law firm."
  );
  parts.push(
    `Format: ${format.replace(/_/g, " ")}. Write in Markdown.`
  );

  if (formatSpec.word_range) {
    const [min, max] = formatSpec.word_range as [number, number];
    parts.push(`Target word count: ${min} to ${max} words.`);
  }

  if (formatSpec.structure) {
    const sections = formatSpec.structure as string[];
    parts.push(
      `Required structure sections: ${sections.join(", ")}.`
    );
  }

  parts.push(`Voice and tone: ${voiceTone}.`);

  if (bannedVocab.length > 0) {
    parts.push(
      `BANNED vocabulary (do not use any of these words or phrases): ${bannedVocab.join(", ")}.`
    );
  }

  if (approvedVocab.length > 0) {
    parts.push(
      `Approved vocabulary (prefer using these terms where natural): ${approvedVocab.join(", ")}.`
    );
  }

  // Formatting constraints
  const formatRules: string[] = [];
  if (formattingRules.no_em_dashes) {
    formatRules.push(
      "Never use em dashes. Use commas, colons, semicolons, or restructure."
    );
  }
  if (formattingRules.no_italics) {
    formatRules.push("Never use italics for any purpose.");
  }
  if (formattingRules.no_orphan_words) {
    formatRules.push("Avoid orphan words (single word alone on the last line of a paragraph).");
  }
  if (formattingRules.no_rule_of_three) {
    formatRules.push(
      "Avoid rule-of-three constructions unless the items are genuinely distinct and necessary."
    );
  }
  if (formatRules.length > 0) {
    parts.push(`Formatting rules: ${formatRules.join(" ")}`);
  }

  // LSO compliance
  const lsoConstraints = (lsoRules.constraints as string[]) ?? [];
  parts.push(
    "LSO Rule 4.2-1 compliance is mandatory. No outcome promises, no 'specialist' or 'expert' language, no unverifiable superlatives."
  );
  if (lsoConstraints.length > 0) {
    parts.push(`Additional LSO constraints: ${lsoConstraints.join("; ")}.`);
  }

  // Opening discipline
  parts.push(
    "Opening discipline: lead with consequence to the reader, not firm performance. Do not open with 'At our firm' or 'We specialize in'."
  );

  // Territory context
  if (territory) {
    parts.push(`Territory context: ${territory}.`);
  }

  parts.push(
    "Each paragraph must advance one idea. Back every claim with facts and reasons. Lead with strong action verbs. Close with a specific conclusion or call to action."
  );

  return parts.join("\n\n");
}

function buildUserPrompt(
  sourceBrief: Record<string, unknown>,
  format: string
): string {
  const parts: string[] = [];

  parts.push(
    `Write a ${format.replace(/_/g, " ")} draft based on the following source brief.\n`
  );

  const fieldLabels: Record<string, string> = {
    decision_question: "Decision question",
    legal_distinction: "Legal distinction",
    consequence: "Consequence if ignored",
    practice_area: "Practice area",
    matter_type: "Matter type",
    jurisdiction: "Jurisdiction",
    audience: "Target audience",
    angle: "Content angle",
    key_statute: "Key statute or regulation",
    case_law: "Relevant case law",
    data_point: "Supporting data point",
    cta: "Call to action",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    const val = sourceBrief[key];
    if (val && typeof val === "string" && val.trim().length > 0) {
      parts.push(`${label}: ${val.trim()}`);
    }
  }

  // Include any extra fields not in the label map
  for (const [key, val] of Object.entries(sourceBrief)) {
    if (
      !(key in fieldLabels) &&
      val &&
      typeof val === "string" &&
      val.trim().length > 0
    ) {
      const label = key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      parts.push(`${label}: ${val.trim()}`);
    }
  }

  parts.push(
    "\nProduce the complete draft in Markdown. Include all required sections per the format spec."
  );

  return parts.join("\n");
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * POST /api/admin/content-studio/pieces/[id]/draft
 * Generates an AI draft using the Anthropic Claude API.
 * The piece must be at the "draft" workflow gate.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY is not configured." },
      { status: 500 }
    );
  }

  // Load the piece
  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  // Validate workflow gate
  if (piece.workflow_gate !== "draft") {
    return NextResponse.json(
      {
        ok: false,
        error: `Piece must be at the "draft" workflow gate to generate a draft. Current gate: ${piece.workflow_gate}`,
      },
      { status: 422 }
    );
  }

  // Validate source brief exists
  const sourceBrief = piece.source_brief as Record<string, unknown> | null;
  if (!sourceBrief || Object.keys(sourceBrief).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Piece has no source brief. Add a source brief before generating a draft.",
      },
      { status: 422 }
    );
  }

  // Load the strategy for prompt building
  const strategy = await getActiveStrategy(piece.firm_id);
  if (!strategy) {
    return NextResponse.json(
      {
        ok: false,
        error: "No active content strategy found for this firm.",
      },
      { status: 422 }
    );
  }

  const systemPrompt = buildSystemPrompt(strategy, piece.format);
  const userPrompt = buildUserPrompt(sourceBrief, piece.format);
  const promptContextHash = hashString(systemPrompt + userPrompt);

  // Call the Anthropic Messages API
  let aiResponse: Response;
  try {
    aiResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (fetchError) {
    const msg =
      fetchError instanceof Error ? fetchError.message : "Network error";
    return NextResponse.json(
      { ok: false, error: `Anthropic API call failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!aiResponse.ok) {
    const errorBody = await aiResponse.text().catch(() => "unknown error");
    return NextResponse.json(
      {
        ok: false,
        error: `Anthropic API returned ${aiResponse.status}: ${errorBody}`,
      },
      { status: 502 }
    );
  }

  const aiResult = (await aiResponse.json()) as {
    id: string;
    content: Array<{ type: string; text?: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const generatedText =
    aiResult.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n\n") || "";

  if (generatedText.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "AI returned an empty response." },
      { status: 502 }
    );
  }

  // Create a new piece version with the generated content
  const versionNumber = await getNextVersionNumber(id, "en");
  const textHash = hashString(generatedText);

  // Record the AI run first to get the run ID
  const { data: aiRun, error: runErr } = await recordAiRun({
    firm_id: piece.firm_id,
    piece_id: id,
    run_type: "draft",
    model: aiResult.model || MODEL,
    prompt_context: {
      system_prompt_hash: hashString(systemPrompt),
      user_prompt_hash: hashString(userPrompt),
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      format: piece.format,
    },
    result: {
      anthropic_message_id: aiResult.id,
      text_length: generatedText.length,
    },
    usage: {
      input_tokens: aiResult.usage?.input_tokens ?? 0,
      output_tokens: aiResult.usage?.output_tokens ?? 0,
    },
    input_hash: promptContextHash,
    output_hash: textHash,
    status: "succeeded",
  });

  if (runErr) {
    console.error("Failed to record AI run:", runErr);
  }

  const { data: version, error: versionErr } = await createPieceVersion({
    piece_id: id,
    version_number: versionNumber,
    language: "en",
    body_markdown: generatedText,
    text_hash: textHash,
    created_by: "ai",
    created_with_ai_run_id: aiRun?.id ?? undefined,
  });

  if (versionErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to save version: ${versionErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    piece_id: id,
    version,
    ai_run: aiRun
      ? {
          id: aiRun.id,
          model: aiRun.model,
          usage: aiRun.usage,
        }
      : null,
  });
}
