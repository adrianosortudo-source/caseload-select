// Structured-output generation for the canonical_service_page format.
//
// Scope note (2026-07-02): this is the narrow first implementation step from
// the SEO/AEO spec (docs/CONTENT_STUDIO_SEO_AEO_SPEC.md, Section 10, operator-
// confirmed build order). It covers generation, JSON schema, and response
// validation for one format only. It does not wire the AEO/SEO deterministic
// validators from content-validators.ts (that is the next step, tracked
// separately) and it does not touch any other STRUCTURED_OUTPUT_REQUIRED_FORMATS
// entry (paid_traffic_landing, review_request, review_response stay gated).
//
// Storage note: this module writes into content_piece_versions.body_structured
// and content_piece_versions.seo_metadata, both existing JSONB columns
// (confirmed live on caseload-select-ca 2026-07-02, no migration involved).
// No new column, table, or CHECK constraint is introduced by this file. If a
// future change to this format needs storage this module cannot provide with
// the existing columns, stop and report rather than proposing a migration;
// Task #12 (migration history reconciliation) is still open.
//
// Design principle: the model only authors reader-facing prose (the answer
// paragraph, section bodies, the FAQ pairs, the bio narrative, SEO title and
// description). Every entity fact (firm name, lawyer name, LSO member number,
// credentials, address) is assembled deterministically from
// strategy_json.canonical_nap and strategy_json.authority_assets, which are
// already on file and already treated as ground truth elsewhere in this
// codebase. The model is never asked to state a fact it could get wrong.
//
// No import "server-only" here on purpose: this file has no I/O and no
// Supabase dependency, so it stays safe to unit-test directly (see the
// Developer Gotchas note in CLAUDE.md about server-only breaking route tests
// that transitively import an IO lib).

import type { StrategyRow } from "./content-studio";

// ─────────────────────────────────────────────────────────────────────────
// Section keys, matching format_specs.canonical_service_page.structure in
// drg_strategy_v2.upload.json verbatim, so downstream code can cross-
// reference the format spec without a translation table.
// ─────────────────────────────────────────────────────────────────────────

export const SERVICE_PAGE_SECTION_KEYS = {
  h1: "h1_two_beat_problem_or_benefit",
  firstParagraph: "first_paragraph_direct_answer_to_target_query",
  qualification: "qualification_do_you_have_this_matter",
  whatIsAtStake: "what_is_at_stake_no_outcome_figures",
  authorBio: "named_author_bio_block_with_credentials",
  howTheProcessWorks: "how_the_process_works_step_by_step",
  criticalInformation: "critical_information_what_to_know_early",
  feesAndExpectations: "fees_and_what_to_expect_factual",
  differentiation: "differentiation_factual_no_superlatives",
  serviceAreaCoverage: "service_area_coverage",
  finalCta: "final_cta_submit_for_review",
  faqBlock: "faq_block_question_h2_direct_first_sentence",
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Model output shape (what the tool call returns) and the Anthropic tool
// schema that constrains it.
// ─────────────────────────────────────────────────────────────────────────

export interface CanonicalServicePageModelOutput {
  h1: { line1: string; line2: string };
  sections: {
    first_paragraph_direct_answer: string;
    qualification: { heading: string; body_markdown: string };
    what_is_at_stake: { heading: string; body_markdown: string };
    author_bio: { bio_text: string };
    how_the_process_works: { heading: string; body_markdown: string };
    critical_information: { heading: string; body_markdown: string };
    fees_and_expectations: { heading: string; body_markdown: string };
    differentiation: { heading: string; body_markdown: string };
    service_area_coverage: { heading: string; body_markdown: string };
    final_cta: { heading: string; body_markdown: string; cta_label: string };
  };
  faq_block: Array<{ question: string; answer: string }>;
  seo: {
    title: string;
    meta_description: string;
    internal_links_used: Array<{ url: string; anchor_text: string }>;
  };
}

export const CANONICAL_SERVICE_PAGE_TOOL_NAME = "emit_canonical_service_page";

// Every object node carries additionalProperties: false because the tool is
// sent with strict: true (Anthropic structured outputs). Strict mode
// constrains decoding to this schema exactly, which is what eliminates the
// double-encoded-sections failure class the 2026-07-05 prod smoke test hit
// (the model emitted sections as a malformed JSON *string*). The API rejects
// a strict tool whose object nodes omit additionalProperties.
const HEADING_SECTION = {
  type: "object",
  required: ["heading", "body_markdown"],
  additionalProperties: false,
  properties: {
    heading: { type: "string" },
    body_markdown: { type: "string" },
  },
} as const;

export const CANONICAL_SERVICE_PAGE_TOOL_SCHEMA = {
  type: "object",
  required: ["h1", "sections", "faq_block", "seo"],
  additionalProperties: false,
  properties: {
    h1: {
      type: "object",
      required: ["line1", "line2"],
      additionalProperties: false,
      properties: {
        line1: { type: "string", description: "First beat, ink-weight, states the problem or the benefit." },
        line2: { type: "string", description: "Second beat, carries the emphasis." },
      },
    },
    sections: {
      type: "object",
      required: [
        "first_paragraph_direct_answer",
        "qualification",
        "what_is_at_stake",
        "author_bio",
        "how_the_process_works",
        "critical_information",
        "fees_and_expectations",
        "differentiation",
        "service_area_coverage",
        "final_cta",
      ],
      additionalProperties: false,
      properties: {
        first_paragraph_direct_answer: {
          type: "string",
          description:
            "150-200 words. States the direct answer to the target query in sentence one. No heading; this is the opening paragraph of the page.",
        },
        qualification: HEADING_SECTION,
        what_is_at_stake: HEADING_SECTION,
        author_bio: {
          type: "object",
          required: ["bio_text"],
          additionalProperties: false,
          properties: {
            bio_text: {
              type: "string",
              description:
                "Short narrative bio paragraph in voice. Do not state credentials, LSO membership, or degrees here; those are added deterministically from firm records.",
            },
          },
        },
        how_the_process_works: HEADING_SECTION,
        critical_information: HEADING_SECTION,
        fees_and_expectations: HEADING_SECTION,
        differentiation: HEADING_SECTION,
        service_area_coverage: HEADING_SECTION,
        final_cta: {
          type: "object",
          required: ["body_markdown", "cta_label"],
          additionalProperties: false,
          properties: {
            heading: { type: "string" },
            body_markdown: { type: "string" },
            cta_label: { type: "string", description: "Prefer an approved CTA from voice_rules.approved_ctas." },
          },
        },
      },
    },
    faq_block: {
      type: "array",
      // Strict mode rejects minItems > 1; the >= 2 floor is enforced by
      // validateCanonicalServicePageOutput after the call instead.
      description: "At least 2 FAQ entries drawn from the client question variants.",
      items: {
        type: "object",
        required: ["question", "answer"],
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
      },
    },
    seo: {
      type: "object",
      required: ["title", "meta_description"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        meta_description: { type: "string" },
        internal_links_used: {
          type: "array",
          items: {
            type: "object",
            required: ["url", "anchor_text"],
            additionalProperties: false,
            properties: {
              url: { type: "string" },
              anchor_text: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Prompt builders. Same layered order as buildSystemPrompt in draft/route.ts
// (Origin, Personality, Format, then a new SEO/AEO layer, Lexicon, LSO
// compliance, Opening discipline extended with the answer-first rule,
// Strategic messages, Reference, Factual-claim guard rail last). The SEO/AEO
// layer sits between Format and Lexicon per the spec's contamination
// guardrails: task-shaping fields, not identity-shaping ones.
// ─────────────────────────────────────────────────────────────────────────

interface SourceBriefLike {
  primary_query?: string;
  secondary_queries?: string[];
  client_question_variants?: string[];
  jurisdiction?: string;
  practice_area?: string;
  matter_type?: string;
  service_area?: string | string[];
  audience?: string;
  search_intent?: string;
  answer_summary?: string;
  internal_link_targets?: Array<{ url: string; anchor_text_hint?: string; relation?: string }>;
  verified_facts?: boolean;
  [key: string]: unknown;
}

function joinList(items: string[] | undefined): string {
  return items && items.length > 0 ? items.join("; ") : "";
}

export function buildCanonicalServicePageSystemPrompt(
  strategy: StrategyRow,
  sourceBriefRaw: Record<string, unknown>
): string {
  const sourceBrief = sourceBriefRaw as SourceBriefLike;
  const voice = strategy.voice_rules as Record<string, unknown>;
  const strategyJson = strategy.strategy_json as Record<string, unknown>;
  const specs = strategy.format_specs as Record<string, Record<string, unknown>>;
  const formatSpec = (specs.canonical_service_page ?? {}) as Record<string, unknown>;

  const bannedVocab = (voice.banned_vocabulary as string[]) ?? [];
  const approvedVocab = (voice.approved_vocabulary as string[]) ?? [];
  const approvedCtas = (voice.approved_ctas as string[]) ?? [];
  const lsoRules = (voice.lso_rules as Record<string, unknown>) ?? {};
  const territory = strategyJson.territory_context as string | undefined;
  const positioning = strategyJson.positioning_statement as string | undefined;
  const strategicMessages = (strategyJson.strategic_messages as string[] | undefined) ?? [];
  const voiceTone = (voice.tone as string) ?? "authoritative, direct, evidence-led";
  const reference = voice.reference as
    | { samples?: Array<{ title?: string; language?: string; excerpt: string }> }
    | undefined;

  const parts: string[] = [];

  parts.push("You are a legal content writer producing a canonical service page draft for an Ontario law firm.");
  if (positioning) parts.push(`Positioning: ${positioning}`);
  if (territory) parts.push(`Territory context: ${territory}`);

  parts.push(`Voice and tone: ${(formatSpec.tone as string) ?? voiceTone}.`);

  parts.push(
    "Format: canonical_service_page. You produce content only, not markup or JSON-LD. " +
      "Call the emit_canonical_service_page tool with your content; do not reply in prose."
  );

  // SEO/AEO layer.
  if (sourceBrief.primary_query) {
    const seoParts: string[] = [
      `This page answers the query: "${sourceBrief.primary_query}".`,
    ];
    if (sourceBrief.secondary_queries?.length) {
      seoParts.push(`Secondary queries to cover naturally where they match a real reader question: ${joinList(sourceBrief.secondary_queries)}.`);
    }
    if (sourceBrief.client_question_variants?.length) {
      seoParts.push(`Client question variants, in a real reader's own words, to draw the FAQ block from: ${joinList(sourceBrief.client_question_variants)}.`);
    }
    if (sourceBrief.answer_summary) {
      seoParts.push(`The plain-language answer this page exists to give: ${sourceBrief.answer_summary}`);
    }
    if (sourceBrief.search_intent) {
      seoParts.push(`Search intent: ${sourceBrief.search_intent}.`);
    }
    parts.push(`SEO/AEO target: ${seoParts.join(" ")}`);
  }

  if (bannedVocab.length > 0) parts.push(`BANNED vocabulary (never use): ${bannedVocab.join(", ")}.`);
  if (approvedVocab.length > 0) parts.push(`Approved vocabulary (prefer these where natural): ${approvedVocab.join(", ")}.`);
  if (approvedCtas.length > 0) {
    parts.push(`Approved CTA labels, prefer one of these for the final CTA: ${approvedCtas.join(", ")}.`);
  }

  parts.push(
    "Formatting rules: never use em dashes, use commas, colons, or restructure. Never use italics. " +
      "Avoid orphan words. Never make timing or response-speed promises. Avoid decorative rule-of-three constructions."
  );

  parts.push(
    "LSO Rule 4.2-1 is mandatory and blocking. No outcome promises ('we win', 'guarantee', 'will recover'); " +
      "no specialist or expert self-designation; no unverifiable superlatives; no timing promises; no fake scarcity. " +
      "This applies with no exception to the opening paragraph and to the FAQ block; a technically well-formed " +
      "FAQ answer that promises an outcome still fails."
  );
  const lsoConstraints = (lsoRules.constraints as string[]) ?? [];
  if (lsoConstraints.length > 0) parts.push(`Additional LSO constraints: ${lsoConstraints.join("; ")}.`);

  // Opening discipline, extended with the answer-first rule from the SEO/AEO
  // spec (Section 4). This is the same high-primacy slot the Markdown
  // generator uses; the answer-first rule tightens it rather than adding a
  // new, separately-weighted instruction.
  parts.push(
    "Opening discipline: the first paragraph (150-200 words, this is sections.first_paragraph_direct_answer) " +
      "states the direct answer to the target query in sentence one, before anything else. The jurisdiction " +
      "and the matter type both appear by the second sentence. No vague topic-scoping opener ('Understanding X " +
      "can be complex', 'When it comes to X'). No legal-essay opening, no doctrine history before the answer. " +
      "Do not open with 'At our firm', 'We specialize in', 'Our firm is', 'With over X years'."
  );
  parts.push(
    "Each paragraph advances one idea. Strong action verbs at the open. Specific conclusions or next steps at " +
      "the close. Paragraphs no longer than three lines."
  );

  if (strategicMessages.length > 0) {
    parts.push(`Strategic messages this draft must reinforce: ${strategicMessages.map((m, i) => `(${i + 1}) ${m}`).join("; ")}.`);
  }

  if (reference?.samples?.length) {
    const samples = reference.samples.filter((s) => !s.language || s.language === "en").slice(0, 3);
    if (samples.length > 0) {
      const block = samples
        .map((s, i) => `[Reference ${i + 1}${s.title ? ` (${s.title})` : ""}]\n${s.excerpt}`)
        .join("\n\n");
      parts.push(`Reference samples of on-brand writing. Match the rhythm and register:\n\n${block}`);
    }
  }

  parts.push(
    "Do not include unverified statistics, fabricated quotes, named case outcomes, dollar figures, percentages, " +
      "or statute citations that you cannot ground in the source brief. Do not state the firm name, the lawyer's " +
      "name, credentials, or LSO membership in author_bio.bio_text; those are added separately from firm records. " +
      "If a fact is needed and not in the source brief, write around it rather than inventing it."
  );

  return parts.join("\n\n");
}

export function buildCanonicalServicePageUserPrompt(sourceBriefRaw: Record<string, unknown>): string {
  const sourceBrief = sourceBriefRaw as SourceBriefLike;
  const parts: string[] = [];
  parts.push("Write a canonical service page draft based on the following source brief.\n");

  const fieldLabels: Record<string, string> = {
    primary_query: "Primary query",
    secondary_queries: "Secondary queries",
    client_question_variants: "Client question variants",
    jurisdiction: "Jurisdiction",
    practice_area: "Practice area",
    matter_type: "Matter type",
    service_area: "Service area",
    audience: "Target audience",
    search_intent: "Search intent",
    answer_summary: "Answer summary",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    const val = sourceBrief[key];
    if (Array.isArray(val) && val.length > 0) {
      parts.push(`${label}: ${val.join("; ")}`);
    } else if (typeof val === "string" && val.trim().length > 0) {
      parts.push(`${label}: ${val.trim()}`);
    }
  }

  if (sourceBrief.internal_link_targets?.length) {
    const links = sourceBrief.internal_link_targets
      .map((l) => `${l.anchor_text_hint ?? "(no anchor hint)"} -> ${l.url}${l.relation ? ` [${l.relation}]` : ""}`)
      .join("; ");
    parts.push(
      `Internal link options (use only where the anchor text reads naturally in context; do not force a link ` +
        `into every paragraph): ${links}`
    );
  }

  parts.push("\nCall emit_canonical_service_page with the complete draft. Do not reply with prose.");
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Anthropic response parsing (pure: takes the already-fetched JSON body).
// ─────────────────────────────────────────────────────────────────────────

interface AnthropicMessageResult {
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  stop_reason?: string | null;
}

export function extractToolUseInput(
  aiResult: AnthropicMessageResult
): { ok: true; input: unknown } | { ok: false; error: string } {
  // A max_tokens stop truncates the tool call mid-JSON; the partial input
  // then fails shape validation with misleading "field missing" errors.
  // Surface the real cause instead. (Caught by the 2026-07-05 prod smoke
  // test: a full service page overran the original 4096 ceiling.)
  if (aiResult.stop_reason === "max_tokens") {
    return {
      ok: false,
      error:
        "Model output was truncated at the max_tokens ceiling before the tool call completed. Raise max_tokens for this format and retry.",
    };
  }
  const toolBlock = aiResult.content?.find(
    (block) => block.type === "tool_use" && block.name === CANONICAL_SERVICE_PAGE_TOOL_NAME
  );
  if (!toolBlock) {
    const textBlock = aiResult.content?.find((b) => b.type === "text" && b.text);
    return {
      ok: false,
      error: textBlock?.text
        ? `Model replied with text instead of calling the tool: ${textBlock.text.slice(0, 200)}`
        : "No tool_use block found in the model response.",
    };
  }
  return { ok: true, input: toolBlock.input };
}

// ─────────────────────────────────────────────────────────────────────────
// Response validation. Hand-rolled, no schema library dependency (matches
// this repo's existing convention in content-validators.ts: plain functions,
// no zod/ajv anywhere in package.json).
// ─────────────────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function pushIfMissing(errors: string[], ok: boolean, message: string) {
  if (!ok) errors.push(message);
}

export function validateCanonicalServicePageOutput(
  input: unknown
): { valid: true; output: CanonicalServicePageModelOutput } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { valid: false, errors: ["Tool input is not an object."] };
  }
  const obj = input as Record<string, unknown>;

  const h1 = obj.h1 as Record<string, unknown> | undefined;
  pushIfMissing(errors, !!h1 && isNonEmptyString(h1.line1), "h1.line1 missing or empty.");
  pushIfMissing(errors, !!h1 && isNonEmptyString(h1.line2), "h1.line2 missing or empty.");

  const sections = obj.sections as Record<string, unknown> | undefined;
  if (!sections || typeof sections !== "object") {
    errors.push("sections missing or not an object.");
  } else {
    pushIfMissing(
      errors,
      isNonEmptyString(sections.first_paragraph_direct_answer),
      "sections.first_paragraph_direct_answer missing or empty."
    );
    const headingKeys = [
      "qualification",
      "what_is_at_stake",
      "how_the_process_works",
      "critical_information",
      "fees_and_expectations",
      "differentiation",
      "service_area_coverage",
    ];
    for (const key of headingKeys) {
      const section = sections[key] as Record<string, unknown> | undefined;
      pushIfMissing(errors, !!section && isNonEmptyString(section.body_markdown), `sections.${key}.body_markdown missing or empty.`);
    }
    const authorBio = sections.author_bio as Record<string, unknown> | undefined;
    pushIfMissing(errors, !!authorBio && isNonEmptyString(authorBio.bio_text), "sections.author_bio.bio_text missing or empty.");
    const finalCta = sections.final_cta as Record<string, unknown> | undefined;
    pushIfMissing(errors, !!finalCta && isNonEmptyString(finalCta.body_markdown), "sections.final_cta.body_markdown missing or empty.");
    pushIfMissing(errors, !!finalCta && isNonEmptyString(finalCta.cta_label), "sections.final_cta.cta_label missing or empty.");
  }

  const faqBlock = obj.faq_block;
  if (!Array.isArray(faqBlock) || faqBlock.length < 2) {
    errors.push("faq_block missing or has fewer than 2 entries.");
  } else {
    faqBlock.forEach((pair, i) => {
      const p = pair as Record<string, unknown>;
      pushIfMissing(errors, isNonEmptyString(p?.question), `faq_block[${i}].question missing or empty.`);
      pushIfMissing(errors, isNonEmptyString(p?.answer), `faq_block[${i}].answer missing or empty.`);
    });
  }

  const seo = obj.seo as Record<string, unknown> | undefined;
  pushIfMissing(errors, !!seo && isNonEmptyString(seo.title), "seo.title missing or empty.");
  pushIfMissing(errors, !!seo && isNonEmptyString(seo.meta_description), "seo.meta_description missing or empty.");
  if (seo?.internal_links_used !== undefined && !Array.isArray(seo.internal_links_used)) {
    errors.push("seo.internal_links_used must be an array when present.");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, output: input as CanonicalServicePageModelOutput };
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic assembly: model output -> stored blocks + schema JSON-LD +
// seo_metadata. Entity facts come from strategy_json, never from the model.
// ─────────────────────────────────────────────────────────────────────────

export type ServicePageBlock =
  | { type: "h1"; key: string; line1: string; line2: string }
  | { type: "section"; key: string; heading?: string; body_markdown: string }
  | { type: "faq_block"; key: string; items: Array<{ question: string; answer: string }> };

function authorLine(strategy: StrategyRow): { name: string; credentialsLine: string } {
  const nap = (strategy.strategy_json as Record<string, unknown>).canonical_nap as
    | Record<string, unknown>
    | undefined;
  const authorityAssets = (strategy.strategy_json as Record<string, unknown>).authority_assets as
    | Record<string, unknown>
    | undefined;
  const name = (nap?.lawyer_public_facing_name as string) ?? "";
  const lsoNumber = nap?.lso_member_number as string | undefined;
  const fourAs = authorityAssets?.four_as as Record<string, unknown> | undefined;
  const accreditations =
    (fourAs?.accreditations as Array<Record<string, unknown>> | undefined)?.filter(
      (a) => a.publishable === true
    ) ?? [];
  const credentialNames = accreditations.map((a) => a.name as string).filter(Boolean);
  const credentialParts: string[] = [];
  if (lsoNumber) credentialParts.push(`Law Society of Ontario, member ${lsoNumber}`);
  credentialParts.push(...credentialNames);
  return { name, credentialsLine: credentialParts.join(". ") };
}

export function toBodyStructuredBlocks(
  output: CanonicalServicePageModelOutput,
  strategy: StrategyRow
): ServicePageBlock[] {
  const { name, credentialsLine } = authorLine(strategy);
  const bylineFormat =
    ((strategy.format_specs as Record<string, Record<string, unknown>>).canonical_service_page
      ?.byline_format as string | undefined) ?? "{byline}";
  const byline = name ? bylineFormat.replace("{byline}", name).replace(/ · \{topic_short\} · \{publish_date\}/, "") : "";

  const authorBioBody = [byline, credentialsLine, output.sections.author_bio.bio_text]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  return [
    { type: "h1", key: SERVICE_PAGE_SECTION_KEYS.h1, line1: output.h1.line1, line2: output.h1.line2 },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.firstParagraph,
      body_markdown: output.sections.first_paragraph_direct_answer,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.qualification,
      heading: output.sections.qualification.heading,
      body_markdown: output.sections.qualification.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.whatIsAtStake,
      heading: output.sections.what_is_at_stake.heading,
      body_markdown: output.sections.what_is_at_stake.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.authorBio,
      body_markdown: authorBioBody,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.howTheProcessWorks,
      heading: output.sections.how_the_process_works.heading,
      body_markdown: output.sections.how_the_process_works.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.criticalInformation,
      heading: output.sections.critical_information.heading,
      body_markdown: output.sections.critical_information.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.feesAndExpectations,
      heading: output.sections.fees_and_expectations.heading,
      body_markdown: output.sections.fees_and_expectations.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.differentiation,
      heading: output.sections.differentiation.heading,
      body_markdown: output.sections.differentiation.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.serviceAreaCoverage,
      heading: output.sections.service_area_coverage.heading,
      body_markdown: output.sections.service_area_coverage.body_markdown,
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.finalCta,
      heading: output.sections.final_cta.heading,
      body_markdown: `${output.sections.final_cta.body_markdown}\n\n**${output.sections.final_cta.cta_label}**`,
    },
    {
      type: "faq_block",
      key: SERVICE_PAGE_SECTION_KEYS.faqBlock,
      items: output.faq_block,
    },
  ];
}

export function flattenServicePageToPlainText(blocks: ServicePageBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "h1") {
      parts.push(`# ${block.line1}\n${block.line2}`);
    } else if (block.type === "section") {
      if (block.heading) parts.push(`## ${block.heading}`);
      parts.push(block.body_markdown);
    } else if (block.type === "faq_block") {
      for (const item of block.items) {
        parts.push(`### ${item.question}\n${item.answer}`);
      }
    }
  }
  return parts.join("\n\n");
}

interface SchemaBlocks {
  legal_service: Record<string, unknown>;
  person: Record<string, unknown>;
  faq_page: Record<string, unknown>;
  breadcrumb_list: Record<string, unknown>;
  breadcrumb_urls_incomplete: boolean;
}

export function assembleSchemaBlocks(
  output: CanonicalServicePageModelOutput,
  strategy: StrategyRow,
  sourceBriefRaw: Record<string, unknown>
): SchemaBlocks {
  const sourceBrief = sourceBriefRaw as SourceBriefLike;
  const nap = ((strategy.strategy_json as Record<string, unknown>).canonical_nap ?? {}) as Record<
    string,
    unknown
  >;
  const authorityAssets = (strategy.strategy_json as Record<string, unknown>).authority_assets as
    | Record<string, unknown>
    | undefined;
  const fourAs = authorityAssets?.four_as as Record<string, unknown> | undefined;
  const accreditations =
    (fourAs?.accreditations as Array<Record<string, unknown>> | undefined)?.filter(
      (a) => a.publishable === true
    ) ?? [];

  const serviceArea = sourceBrief.service_area
    ? Array.isArray(sourceBrief.service_area)
      ? sourceBrief.service_area
      : [sourceBrief.service_area]
    : [strategy.jurisdiction];

  const legalService: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LegalService",
    name: nap.legal_entity ?? null,
    alternateName: nap.trade_name ?? null,
    url: nap.website ?? null,
    telephone: nap.public_phone ?? null,
    email: nap.email ?? null,
    address: {
      "@type": "PostalAddress",
      streetAddress: nap.address ?? null,
      addressCountry: "CA",
    },
    areaServed: serviceArea,
    availableLanguage: nap.languages ?? null,
  };

  const person: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: nap.lawyer_public_facing_name ?? null,
    worksFor: { "@type": "LegalService", name: nap.legal_entity ?? null },
    knowsLanguage: nap.languages ?? null,
    hasCredential: [
      ...(nap.lso_member_number
        ? [
            {
              "@type": "EducationalOccupationalCredential",
              credentialCategory: "license",
              recognizedBy: { "@type": "Organization", name: "Law Society of Ontario" },
              url: nap.lso_member_url ?? null,
            },
          ]
        : []),
      ...accreditations.map((a) => ({
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "degree",
        about: a.name,
      })),
    ],
  };

  const faqPage: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: output.faq_block.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: { "@type": "Answer", text: pair.answer },
    })),
  };

  // Breadcrumb URLs need a real site path, which is not deterministically
  // knowable from the strategy JSON alone. Emit names only and flag the gap
  // rather than inventing a slug.
  const homeUrl = (nap.website as string | undefined) ?? null;
  const practiceArea = sourceBrief.practice_area ?? "Service";
  const pageTitle = output.seo.title || `${output.h1.line1} ${output.h1.line2}`.trim();
  const breadcrumbUrlsIncomplete = !homeUrl;
  const breadcrumbList: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: homeUrl },
      { "@type": "ListItem", position: 2, name: practiceArea, item: null },
      { "@type": "ListItem", position: 3, name: pageTitle, item: null },
    ],
  };

  return {
    legal_service: legalService,
    person,
    faq_page: faqPage,
    breadcrumb_list: breadcrumbList,
    breadcrumb_urls_incomplete: breadcrumbUrlsIncomplete,
  };
}

export function buildSeoMetadata(
  output: CanonicalServicePageModelOutput,
  sourceBriefRaw: Record<string, unknown>,
  schemaBlocks: SchemaBlocks
): Record<string, unknown> {
  const sourceBrief = sourceBriefRaw as SourceBriefLike;
  return {
    generator: "structured_v1",
    generated_at: new Date().toISOString(),
    primary_query: sourceBrief.primary_query ?? null,
    secondary_queries: sourceBrief.secondary_queries ?? [],
    search_intent: sourceBrief.search_intent ?? null,
    answer_summary: sourceBrief.answer_summary ?? null,
    jurisdiction: sourceBrief.jurisdiction ?? null,
    service_area: sourceBrief.service_area ?? null,
    title: output.seo.title,
    meta_description: output.seo.meta_description,
    internal_links_used: output.seo.internal_links_used ?? [],
    schema: {
      legal_service: schemaBlocks.legal_service,
      person: schemaBlocks.person,
      faq_page: schemaBlocks.faq_page,
      breadcrumb_list: schemaBlocks.breadcrumb_list,
    },
    breadcrumb_urls_incomplete: schemaBlocks.breadcrumb_urls_incomplete,
  };
}

// =============================================================================
// Admin preview renderer (added 2026-07-02, SEO/AEO spec Section 10 step 4,
// operator-confirmed narrow scope). Pure function, no I/O: turns
// ServicePageBlock[] + seo_metadata into HTML for the ADMIN PREVIEW page
// only. Not a public-site renderer, not a publish pipeline, deliberately out
// of scope per the operator's Step 4 confirmation.
//
// JSON-LD is returned separately (schemaJson) rather than inlined as
// <script> tags in `html`, so the caller decides how to place it (the admin
// preview shows it as a distinct readable block, per operator instruction).
//
// Safety: every text field is HTML-escaped before any markup is
// reintroduced. Inline markdown (bold, links) is applied to the ALREADY-
// escaped string via regex substitution, so a raw "<script>" in model or
// operator-entered content can never survive into `html` as a real tag; it
// only ever appears as inert escaped text. Link URLs are constrained to
// http(s) and are matched (and thus placed into the href attribute) only
// after escaping, so an embedded quote cannot break out of the attribute.
// =============================================================================

const SCHEMA_BLOCK_ORDER = ["legal_service", "person", "faq_page", "breadcrumb_list"] as const;

export interface ServicePagePreview {
  html: string;
  schemaJson: Array<Record<string, unknown>>;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Applies to an ALREADY-escaped string. Deliberately minimal: bold
// (**text**) and links ([label](https://...)). No italics (the compliance
// battery bans italics markup already), no lists, no headings inline (those
// are structured fields, not body text).
function applyInlineMarkdown(escaped: string): string {
  let out = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  return out;
}

function renderParagraphs(raw: string | undefined): string {
  const paragraphs = String(raw ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return "";
  return paragraphs
    .map((p) => `<p>${applyInlineMarkdown(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function renderServicePagePreview(
  blocks: ServicePageBlock[] | null | undefined,
  seoMetadata: Record<string, unknown> | undefined
): ServicePagePreview {
  const htmlParts: string[] = [];

  const generatedAt = seoMetadata?.generated_at;
  if (typeof generatedAt === "string" && !Number.isNaN(Date.parse(generatedAt))) {
    const dateOnly = generatedAt.slice(0, 10);
    htmlParts.push(
      `<p class="cls-preview-last-updated">Last updated: <time datetime="${escapeHtml(
        generatedAt
      )}">${escapeHtml(dateOnly)}</time></p>`
    );
  }

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "h1") {
      htmlParts.push(
        `<h1>${escapeHtml(block.line1)}<br>${escapeHtml(block.line2)}</h1>`
      );
    } else if (block.type === "section") {
      if (block.heading) htmlParts.push(`<h2>${escapeHtml(block.heading)}</h2>`);
      const body = renderParagraphs(block.body_markdown);
      if (body) htmlParts.push(body);
    } else if (block.type === "faq_block") {
      const items = Array.isArray(block.items) ? block.items : [];
      const rendered = items
        .map(
          (item) =>
            `<div class="cls-faq-item"><h3>${escapeHtml(
              item?.question
            )}</h3>${renderParagraphs(item?.answer)}</div>`
        )
        .join("\n");
      htmlParts.push(`<div class="cls-faq-block">${rendered}</div>`);
    } else {
      // Unknown or malformed block type: skip rendering it rather than
      // throwing, but leave a visible marker so a broken row is noticeable
      // in the admin preview instead of silently vanishing.
      htmlParts.push(
        `<p class="cls-preview-unknown-block">[Preview: unrecognized block, skipped]</p>`
      );
    }
  }

  const schema = (seoMetadata?.schema as Record<string, unknown> | undefined) ?? {};
  const schemaJson = SCHEMA_BLOCK_ORDER.map((key) => schema[key]).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object"
  );

  return { html: htmlParts.join("\n"), schemaJson };
}

// =============================================================================
// Markdown-format renderer (added 2026-07-05, WP-2 of the next-20% build plan:
// docs/CONTENT_STUDIO_NEXT20_BUILD_PLAN.md). Every format other than
// canonical_service_page stores body_markdown as plain Markdown text with no
// HTML renderer; the admin preview page shows it raw inside a <pre> block.
// The legal-gate deliverable needs real HTML for the lawyer review surface
// (DeliverableVersion.body_html), so this reuses the exact same
// escape-then-substitute safety discipline as renderServicePagePreview
// above: escapeHtml() runs first, applyInlineMarkdown() only ever operates
// on the already-escaped string, so a raw "<script>" in the model's Markdown
// output can never survive as a live tag.
//
// Deliberately minimal: paragraphs, #/##/### headings, bold, links. No
// lists, no tables, no nested blockquotes. Every format this repo generates
// today (counsel_note, checklist, landing_page, decision_tool,
// clause_in_the_margin, counsel_letter) is prose-and-headings shaped, so
// this covers the actual output; it is not a general Markdown engine.
// =============================================================================

export function renderMarkdownToSafeHtml(markdown: string | null | undefined): string {
  const blocks = String(markdown ?? "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  return blocks
    .map((block) => {
      const headingMatch = block.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const heading = applyInlineMarkdown(escapeHtml(headingMatch[2].trim()));
        return `<h${level}>${heading}</h${level}>`;
      }
      return `<p>${applyInlineMarkdown(escapeHtml(block)).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

// =============================================================================
// Export pipeline (added 2026-07-05, WP-3 of the next-20% build plan:
// docs/CONTENT_STUDIO_NEXT20_BUILD_PLAN.md). This is the mechanism, not the
// publication: it produces a standalone HTML bundle an operator can hand-
// place into a firm's website repo. It writes to no public surface itself.
//
// The DR-082 LSO Rule 4.2-1 disclaimer banner is rendered before content on
// every export, verbatim from the live drg-law-website copy (firm.ts /
// i18n.ts lsoDisclaimerHeadline + lsoDisclaimer body). This is DRG-specific
// wording; a multi-firm version of this pipeline would need the disclaimer
// sourced per-firm (out of scope here, DRG is the only firm this pipeline
// runs against today).
//
// Brand tokens (colors, serif typeface) are DRG's real, verified tokens from
// drg-law-website/src/app/globals.css, not invented values, but this is a
// structurally-correct, readable static document, not a pixel-match of the
// live Next.js site's actual component tree; matching that exactly would
// require importing the site's build, which is out of scope (WP-3 is "the
// mechanism, not the publication").
// =============================================================================

const LSO_DISCLAIMER_HEADLINE = "Legal information, not legal advice.";
const LSO_DISCLAIMER_BODY =
  "What you read on this website is general information about the law. It is not legal advice for your situation. Sending an intake does not make DRG Law your lawyer. That only happens after DRG Law checks for conflicts and both sides sign a written agreement.";

export interface ServicePageExportBundle {
  pageHtml: string;
  schemaJsonLd: Array<Record<string, unknown>>;
  meta: { title: string; metaDescription: string };
}

// Embedding JSON inside a <script> tag: replacing every "<" with its unicode
// escape prevents a "</script>" substring inside the JSON payload from
// closing the tag early. < is valid JSON string syntax and decodes back
// to "<" for any JSON-LD consumer (crawlers, rich-result validators) that
// parses the script's text content as JSON, so this is safe on both sides.
function jsonLdScriptTag(block: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, "\\u003c")}</script>`;
}

function wrapExportDocument(input: {
  title: string;
  metaDescription: string;
  bodyHtml: string;
  schemaJsonLd: Array<Record<string, unknown>>;
}): string {
  const jsonLdScripts = input.schemaJsonLd.map(jsonLdScriptTag).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="description" content="${escapeHtml(input.metaDescription)}">
<style>
  :root {
    --ox: #6E2C2C;
    --brass: #B8956A;
    --cream: #EFE9DD;
    --paper: #FFFCF6;
    --ink: #1A1410;
    --mid: #6B5F52;
  }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: "Source Serif Pro", Georgia, serif;
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    line-height: 1.6;
  }
  h1, h2, h3 { color: var(--ox); font-weight: 600; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.35rem; margin-top: 2rem; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  a { color: var(--ox); }
  .cls-lso-banner {
    background: var(--cream);
    border-left: 4px solid var(--brass);
    padding: 0.9rem 1.1rem;
    margin: 0 0 2rem;
    font-size: 0.9rem;
    color: var(--mid);
  }
  .cls-lso-banner strong { color: var(--ink); }
  .cls-preview-last-updated { color: var(--mid); font-size: 0.85rem; }
  .cls-faq-item { margin: 1.25rem 0; }
</style>
</head>
<body>
<aside class="cls-lso-banner"><strong>${escapeHtml(LSO_DISCLAIMER_HEADLINE)}</strong> ${escapeHtml(LSO_DISCLAIMER_BODY)}</aside>
<article>
${input.bodyHtml}
</article>
${jsonLdScripts}
</body>
</html>`;
}

/** Export bundle for canonical_service_page: reuses renderServicePagePreview
 * for the body HTML + JSON-LD, then wraps it as a standalone document. */
export function renderServicePageExport(
  blocks: ServicePageBlock[] | null | undefined,
  seoMetadata: Record<string, unknown> | undefined
): ServicePageExportBundle {
  const { html, schemaJson } = renderServicePagePreview(blocks, seoMetadata);
  const title = (seoMetadata?.title as string | undefined) ?? "";
  const metaDescription = (seoMetadata?.meta_description as string | undefined) ?? "";
  const pageHtml = wrapExportDocument({
    title,
    metaDescription,
    bodyHtml: html,
    schemaJsonLd: schemaJson,
  });
  return { pageHtml, schemaJsonLd: schemaJson, meta: { title, metaDescription } };
}

/** Export bundle for every Markdown format (counsel_note, checklist,
 * landing_page, etc). No JSON-LD source exists for these formats yet (only
 * canonical_service_page populates seo_metadata.schema); the bundle carries
 * an empty schemaJsonLd array rather than inventing one. */
export function renderMarkdownExport(
  markdown: string | null | undefined,
  meta: { title: string; metaDescription: string }
): ServicePageExportBundle {
  const bodyHtml = renderMarkdownToSafeHtml(markdown);
  const pageHtml = wrapExportDocument({
    title: meta.title,
    metaDescription: meta.metaDescription,
    bodyHtml,
    schemaJsonLd: [],
  });
  return { pageHtml, schemaJsonLd: [], meta };
}
