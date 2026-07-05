import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getActiveStrategy,
  getNextVersionNumber,
  createPieceVersion,
  recordAiRun,
  type StrategyRow,
} from "@/lib/content-studio";
import {
  CANONICAL_SERVICE_PAGE_TOOL_NAME,
  CANONICAL_SERVICE_PAGE_TOOL_SCHEMA,
  buildCanonicalServicePageSystemPrompt,
  buildCanonicalServicePageUserPrompt,
  extractToolUseInput,
  validateCanonicalServicePageOutput,
  toBodyStructuredBlocks,
  assembleSchemaBlocks,
  buildSeoMetadata,
  flattenServicePageToPlainText,
} from "@/lib/content-studio-structured";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/content-studio-prompt";

export const dynamic = "force-dynamic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Structured-output generation for canonical_service_page. See
 * src/lib/content-studio-structured.ts for the schema, prompt builders,
 * validation, and deterministic assembly. Storage uses the existing
 * content_piece_versions.body_structured and .seo_metadata JSONB columns;
 * no schema change is involved.
 */
async function generateCanonicalServicePageDraft({
  apiKey,
  pieceId,
  firmId,
  sourceBrief,
  strategy,
}: {
  apiKey: string;
  pieceId: string;
  firmId: string;
  sourceBrief: Record<string, unknown>;
  strategy: StrategyRow;
}): Promise<NextResponse> {
  const systemPrompt = buildCanonicalServicePageSystemPrompt(strategy, sourceBrief);
  const userPrompt = buildCanonicalServicePageUserPrompt(sourceBrief);
  const promptContextHash = hashString(systemPrompt + userPrompt);

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
        tools: [
          {
            name: CANONICAL_SERVICE_PAGE_TOOL_NAME,
            description:
              "Emit the complete canonical service page draft as structured content.",
            input_schema: CANONICAL_SERVICE_PAGE_TOOL_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: CANONICAL_SERVICE_PAGE_TOOL_NAME },
      }),
    });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : "Network error";
    return NextResponse.json(
      { ok: false, error: `Anthropic API call failed: ${msg}` },
      { status: 502 }
    );
  }

  if (!aiResponse.ok) {
    const errorBody = await aiResponse.text().catch(() => "unknown error");
    return NextResponse.json(
      { ok: false, error: `Anthropic API returned ${aiResponse.status}: ${errorBody}` },
      { status: 502 }
    );
  }

  const aiResult = (await aiResponse.json()) as {
    id: string;
    content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const toolResult = extractToolUseInput(aiResult);
  if (!toolResult.ok) {
    return NextResponse.json(
      { ok: false, error: `Structured output extraction failed: ${toolResult.error}` },
      { status: 502 }
    );
  }

  const validated = validateCanonicalServicePageOutput(toolResult.input);
  if (!validated.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: "Model output failed schema validation.",
        code: "structured_output_invalid",
        details: validated.errors,
      },
      { status: 422 }
    );
  }

  const blocks = toBodyStructuredBlocks(validated.output, strategy);
  const schemaBlocks = assembleSchemaBlocks(validated.output, strategy, sourceBrief);
  const seoMetadata = buildSeoMetadata(validated.output, sourceBrief, schemaBlocks);
  const flatText = flattenServicePageToPlainText(blocks);
  const textHash = hashString(flatText);

  const versionNumber = await getNextVersionNumber(pieceId, "en");

  const { data: aiRun, error: runErr } = await recordAiRun({
    firm_id: firmId,
    piece_id: pieceId,
    run_type: "draft",
    model: aiResult.model || MODEL,
    prompt_context: {
      system_prompt_hash: hashString(systemPrompt),
      user_prompt_hash: hashString(userPrompt),
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      format: "canonical_service_page",
      generator: "structured_v1",
    },
    result: {
      anthropic_message_id: aiResult.id,
      section_count: blocks.length,
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
    piece_id: pieceId,
    version_number: versionNumber,
    language: "en",
    body_structured: blocks,
    seo_metadata: seoMetadata,
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
    piece_id: pieceId,
    version,
    structured: true,
    schema_warnings: schemaBlocks.breadcrumb_urls_incomplete
      ? ["breadcrumb_list item URLs are incomplete: no website URL on file for this firm's canonical_nap."]
      : [],
    ai_run: aiRun ? { id: aiRun.id, model: aiRun.model, usage: aiRun.usage } : null,
  });
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

  // Audit catch 2026-06-26 HIGH 2: refuse compliance formats that require
  // structured-output generation until the JSON-schema generator branch ships.
  // The current generator always emits Markdown and stores only body_markdown;
  // these formats need structured JSON output matching their renderer input
  // contract (paid_traffic_landing section ordering, review_request channel-
  // specific shape, review_response TEARS subformat discrimination).
  // Accepting them now would produce Markdown that misses the format's
  // structural validators downstream.
  //
  // canonical_service_page removed from this set 2026-07-02: it has its own
  // structured-output branch below (generateCanonicalServicePageDraft), the
  // first format built per the SEO/AEO spec's operator-confirmed build order
  // (docs/CONTENT_STUDIO_SEO_AEO_SPEC.md, Section 10). The other three formats
  // are unchanged and stay gated until their own branches ship.
  const STRUCTURED_OUTPUT_REQUIRED_FORMATS = new Set([
    "paid_traffic_landing",
    "review_request",
    "review_response",
  ]);
  if (STRUCTURED_OUTPUT_REQUIRED_FORMATS.has(piece.format)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Format "${piece.format}" requires structured JSON output and the generator branch has not shipped yet. This format is accepted by the format taxonomy migration but cannot be drafted by the Markdown-only path. Track in project_content_studio_p0_delta_compliance_shipped.md.`,
        code: "structured_output_required",
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

  if (piece.format === "canonical_service_page") {
    return generateCanonicalServicePageDraft({
      apiKey,
      pieceId: id,
      firmId: piece.firm_id,
      sourceBrief,
      strategy,
    });
  }

  const systemPrompt = buildSystemPrompt(strategy, piece.format, sourceBrief);
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
