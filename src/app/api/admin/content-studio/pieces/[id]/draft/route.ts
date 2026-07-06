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
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildArticleSchemaBlock,
  buildMarkdownSeoMetadata,
  buildPtLanguageDirective,
  buildEnLanguageDirective,
  resolveReviewResponseSubformat,
  reviewResponseHasExplicitSentiment,
  type ReviewContext,
} from "@/lib/content-studio-prompt";
import { filterInternalLinkTargetsToFirmHost, type InternalLinkTarget } from "@/lib/content-studio-links";

export const dynamic = "force-dynamic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Env-overridable so a retired model ID is a Vercel env change, not a code
// deploy. claude-sonnet-4-20250514 died with a 404 on 2026-07-05.
const MODEL = process.env.CONTENT_STUDIO_MODEL ?? "claude-sonnet-5";

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
  language = "en",
}: {
  apiKey: string;
  pieceId: string;
  firmId: string;
  sourceBrief: Record<string, unknown>;
  strategy: StrategyRow;
  language?: "en" | "pt";
}): Promise<NextResponse> {
  // WP-3.3: exclude any internal_link_targets URL that does not resolve to
  // the firm's own website host before the model ever sees it. Filtering at
  // the prompt is stronger than the post-hoc validateInternalLinkDomains
  // check alone: a bad link never reaches the draft in the first place.
  const firmWebsite = (
    (strategy.strategy_json as Record<string, unknown>).canonical_nap as
      | Record<string, unknown>
      | undefined
  )?.website as string | undefined;
  const { allowed: allowedLinkTargets, excluded: excludedLinkTargets } =
    filterInternalLinkTargetsToFirmHost(
      sourceBrief.internal_link_targets as InternalLinkTarget[] | undefined,
      firmWebsite
    );
  const filteredSourceBrief: Record<string, unknown> = {
    ...sourceBrief,
    internal_link_targets: allowedLinkTargets,
  };

  // Ses.17 WP-4: content-studio-structured.ts's own prompt builders have no
  // language parameter (canonical_service_page's strict tool schema
  // constrains shape, not language, per the build plan). A PT generation
  // appends the same directive buildSystemPrompt's Markdown path uses,
  // post-hoc, rather than threading a language param through that file.
  const baseSystemPrompt = buildCanonicalServicePageSystemPrompt(strategy, filteredSourceBrief);
  const languageDirective = language === "pt" ? buildPtLanguageDirective() : buildEnLanguageDirective();
  const systemPrompt = `${baseSystemPrompt}\n\n${languageDirective}`;
  const userPrompt = buildCanonicalServicePageUserPrompt(filteredSourceBrief);
  const promptContextHash = hashString(systemPrompt + userPrompt);

  let aiResponse: Response;
  try {
    aiResponse = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Strict structured outputs: constrained decoding guarantees the
        // tool input matches the schema. Without it the prod smoke test
        // (2026-07-05) saw sections arrive as a malformed JSON string.
        "anthropic-beta": "structured-outputs-2025-11-13",
      },
      body: JSON.stringify({
        model: MODEL,
        // A complete service page (10 sections + FAQ + CTA fields) runs
        // ~3300 output tokens; 4096 left no headroom.
        max_tokens: 16384,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [
          {
            name: CANONICAL_SERVICE_PAGE_TOOL_NAME,
            description:
              "Emit the complete canonical service page draft as structured content.",
            input_schema: CANONICAL_SERVICE_PAGE_TOOL_SCHEMA,
            strict: true,
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
    stop_reason?: string | null;
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
  const schemaBlocks = assembleSchemaBlocks(validated.output, strategy, filteredSourceBrief);
  const seoMetadata = buildSeoMetadata(validated.output, filteredSourceBrief, schemaBlocks);
  const flatText = flattenServicePageToPlainText(blocks);
  const textHash = hashString(flatText);

  const versionNumber = await getNextVersionNumber(pieceId, language);

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
      language,
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
    language,
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
    language,
    schema_warnings: schemaBlocks.breadcrumb_urls_incomplete
      ? ["breadcrumb_list item URLs are incomplete: no website URL on file for this firm's canonical_nap."]
      : [],
    excluded_internal_link_targets: excludedLinkTargets,
    ai_run: aiRun ? { id: aiRun.id, model: aiRun.model, usage: aiRun.usage } : null,
  });
}

/**
 * POST /api/admin/content-studio/pieces/[id]/draft
 * Generates an AI draft using the Anthropic Claude API.
 * The piece must be at the "draft" workflow gate.
 */
export async function POST(
  req: NextRequest,
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

  // Ses.17 WP-4: optional { language: "pt" } body, default "en". An empty or
  // absent body (every pre-WP-4 caller) parses to {} and defaults to "en".
  const body = await req.json().catch(() => ({}));
  const language: "en" | "pt" = body?.language === "pt" ? "pt" : "en";

  // Load the piece
  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  if (language === "pt" && piece.language_mode !== "bilingual") {
    return NextResponse.json(
      {
        ok: false,
        error: "This piece is not bilingual; it has no Portuguese authoring path.",
      },
      { status: 400 }
    );
  }

  // Validate workflow gate. legal_gate is allowed alongside draft (Ses.17
  // WP-2, the revision loop): when the firm requests changes, the operator
  // must be able to regenerate without the piece leaving legal_gate. A
  // regeneration here creates a new piece version exactly like one at
  // draft; the SEND_TO_REVIEW route (a separate, explicit action) is what
  // actually posts the update to the linked deliverable.
  const REGENERATION_ALLOWED_GATES = new Set(["draft", "legal_gate"]);
  if (!REGENERATION_ALLOWED_GATES.has(piece.workflow_gate)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Piece must be at the "draft" or "legal_gate" workflow gate to generate a draft. Current gate: ${piece.workflow_gate}`,
      },
      { status: 422 }
    );
  }

  // Ses.17 WP-5: paid_traffic_landing, review_request, and review_response
  // draft through the plain Markdown path below, same as counsel_note; none
  // of the three need a separate structured-output branch (no JSON-LD, no
  // FAQ block). STRUCTURED_OUTPUT_REQUIRED_FORMATS is gone; the pre-existing
  // audit-catch 2026-06-26 note that lived here is stale as of this commit.

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

  // review_response cannot draft without the review it is responding to
  // (Article IV: nothing invented). rating/sentiment drives the TEARS subformat
  // selection in the system prompt (negative vs positive).
  //
  // Codex audit F6 (2026-07-07): an explicit rating (number) or sentiment
  // ("negative"/"positive") is now REQUIRED. Previously only review_text was
  // required, and a missing rating silently defaulted to the POSITIVE prompt,
  // dropping the LSO Rule 3.3 confidentiality guardrails for a negative review.
  let reviewSubformat: "negative" | "positive" | null = null;
  if (piece.format === "review_response") {
    const reviewContext = sourceBrief.review_context as ReviewContext | undefined;
    if (!reviewContext || !reviewContext.review_text || !reviewContext.review_text.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "source_brief.review_context (with at least review_text) is required to draft a review response. Responding to a review requires the review's actual content.",
          code: "review_context_required",
        },
        { status: 422 }
      );
    }
    if (!reviewResponseHasExplicitSentiment(reviewContext)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "review_response requires an explicit source_brief.review_context.rating (number) or review_context.sentiment ('negative' | 'positive'). A missing rating must not be guessed; a negative review answered with the positive prompt drops the LSO Rule 3.3 confidentiality guardrails.",
          code: "review_sentiment_required",
        },
        { status: 422 }
      );
    }
    reviewSubformat = resolveReviewResponseSubformat(reviewContext);
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
      language,
    });
  }

  // WP-3.3: same firm-host filtering as the structured branch above (see
  // its comment). Applied here too since every Markdown format also reads
  // sourceBrief.internal_link_targets via buildUserPrompt.
  const firmWebsite = (
    (strategy.strategy_json as Record<string, unknown>).canonical_nap as
      | Record<string, unknown>
      | undefined
  )?.website as string | undefined;
  const { allowed: allowedLinkTargets, excluded: excludedLinkTargets } =
    filterInternalLinkTargetsToFirmHost(
      sourceBrief.internal_link_targets as InternalLinkTarget[] | undefined,
      firmWebsite
    );
  const filteredSourceBrief: Record<string, unknown> = {
    ...sourceBrief,
    internal_link_targets: allowedLinkTargets,
  };

  const systemPrompt = buildSystemPrompt(strategy, piece.format, filteredSourceBrief, language);
  const userPrompt = buildUserPrompt(filteredSourceBrief, piece.format);
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
    stop_reason?: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };

  // Codex audit F10 (2026-07-07): the Markdown branch never checked
  // stop_reason. A max_tokens truncation returns partial text with
  // stop_reason="max_tokens"; saving that as a normal version ships a cut-off
  // draft. Reject any non-complete end state before persisting a version.
  if (aiResult.stop_reason === "max_tokens") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The model output was truncated at the max_tokens ceiling before completing. Nothing was saved. Shorten the brief or raise max_tokens and retry.",
        code: "generation_truncated",
      },
      { status: 502 }
    );
  }

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
  const versionNumber = await getNextVersionNumber(id, language);
  const textHash = hashString(generatedText);

  // WP-3.1/3.2: Article JSON-LD + last-updated marker for Markdown formats.
  // The structured canonical_service_page branch already assembles its own
  // richer schema (LegalService/FAQPage/BreadcrumbList); Markdown formats had
  // no seo_metadata at all until now. language threads into inLanguage
  // (Ses.17 WP-4); the brief facts themselves (primary_query etc.) stay the
  // same regardless of language, since they describe what the piece targets.
  const generatedAt = new Date().toISOString();
  const articleSchema = buildArticleSchemaBlock({
    strategy,
    titleWorking: piece.title_working,
    generatedText,
    generatedAt,
    language,
  });
  const seoMetadata = buildMarkdownSeoMetadata({
    sourceBrief: filteredSourceBrief,
    articleSchema,
    generatedAt,
  });

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
      language,
      // Codex audit F6: record which review_response subformat drove the prompt
      // so the choice is auditable, not implicit.
      ...(reviewSubformat ? { review_subformat: reviewSubformat } : {}),
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
    language,
    body_markdown: generatedText,
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
    piece_id: id,
    version,
    language,
    excluded_internal_link_targets: excludedLinkTargets,
    ai_run: aiRun
      ? {
          id: aiRun.id,
          model: aiRun.model,
          usage: aiRun.usage,
        }
      : null,
  });
}
