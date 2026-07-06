// Pure prompt-building logic for the Markdown-generation path (counsel_note,
// checklist, landing_page, and any other format not gated into
// content-studio-structured.ts's structured-output branch). Extracted from
// draft/route.ts on 2026-07-02 (SEO/AEO spec Section 10 step 5,
// operator-confirmed) for two reasons: these functions are shared and
// format-agnostic (buildSystemPrompt/buildUserPrompt take `format` as a
// plain string, no per-format branching beyond a couple of formatSpec reads),
// and pulling them into their own file makes them directly unit-testable.
//
// Deliberately imports StrategyRow as `import type` only. content-studio.ts
// carries a real, intentional `import "server-only"` (it does genuine I/O
// via supabaseAdmin), and a `import type` is fully erased at compile time,
// so this file never triggers that side effect even though it references
// the type. Importing this file (or a test that imports it) is therefore
// safe under vitest's node environment, unlike importing content-studio.ts
// or draft/route.ts directly would be.
import type { StrategyRow } from "./content-studio";

// Ses.17 WP-4: shared between buildSystemPrompt's Markdown path and the
// structured canonical_service_page branch in draft/route.ts (which builds
// its own system prompt via content-studio-structured.ts's
// buildCanonicalServicePageSystemPrompt and has no language parameter of its
// own; the caller appends this directive post-hoc instead of threading a
// language param through that file's prompt builder). Same instruction
// either way: PT is authored from the brief with meaning parity, never
// translated from finished English.
export function buildPtLanguageDirective(): string {
  return (
    "Language: write this entire piece in Portuguese, for a Portuguese-reading Ontario audience. " +
    "Author directly in Portuguese from the source brief below with full meaning parity to the firm's " +
    "intent; this is not a translation exercise, do not draft in English first. State explicitly, in " +
    "Portuguese, that this content concerns Ontario law (jurisdiction disclosure), since a Portuguese-" +
    "reading audience should not assume the firm practises in Ontario without being told."
  );
}

export function buildSystemPrompt(
  strategy: StrategyRow,
  format: string,
  sourceBrief: Record<string, unknown>,
  language: "en" | "pt" = "en"
): string {
  const voice = strategy.voice_rules as Record<string, unknown>;
  const specs = strategy.format_specs as Record<string, Record<string, unknown>>;
  const formatSpec = specs[format] ?? {};
  const strategyJson = strategy.strategy_json as Record<string, unknown>;

  const bannedVocab = (voice.banned_vocabulary as string[]) ?? [];
  const approvedVocab = (voice.approved_vocabulary as string[]) ?? [];
  const formattingRules = (voice.formatting_rules as Record<string, boolean>) ?? {};
  const lsoRules = (voice.lso_rules as Record<string, unknown>) ?? {};
  const territory = strategyJson.territory_context as string | undefined;
  const positioning = strategyJson.positioning_statement as string | undefined;
  const strategicMessages =
    (strategyJson.strategic_messages as string[] | undefined) ?? [];
  const voiceTone = (voice.tone as string) ?? "authoritative, direct, evidence-led";
  const reference = voice.reference as
    | { samples?: Array<{ title?: string; language?: string; excerpt: string }> }
    | undefined;
  const formatTone = formatSpec.tone as string | undefined;
  const spine = formatSpec.spine as string | undefined;

  const primaryQuery = sourceBrief.primary_query as string | undefined;
  const secondaryQueries = (sourceBrief.secondary_queries as string[] | undefined) ?? [];
  const answerSummary = sourceBrief.answer_summary as string | undefined;

  const parts: string[] = [];

  // ─── ORIGIN LAYER ───
  // (B1/B10 Castagliano Prompt Stack: who we are, why this work matters.
  //  Primacy principle: front-load doctrine before the task.)
  parts.push(
    "You are a legal content writer producing a draft for an Ontario law firm."
  );
  if (positioning) {
    parts.push(`Positioning: ${positioning}`);
  }
  if (territory) {
    parts.push(`Territory context: ${territory}`);
  }

  // ─── LANGUAGE LAYER (Ses.17 WP-4) ───
  // Identity-shaping, so it sits with ORIGIN, ahead of format/lexicon
  // directives. Doctrine (strategy voice_traits.bilingual_at_depth,
  // non-negotiable): PT is authored from the same source brief with meaning
  // parity, never translated from finished English.
  if (language === "pt") {
    parts.push(buildPtLanguageDirective());
  }

  // ─── PERSONALITY LAYER ───
  // Voice tone (per-format override beats firm-level default).
  parts.push(`Voice and tone: ${formatTone ?? voiceTone}.`);

  // ─── ARTIFACT + FORMAT LAYER ───
  parts.push(
    `Format: ${format.replace(/_/g, " ")}. Write in Markdown${
      language === "pt" ? ", entirely in Portuguese" : ""
    }.`
  );
  if (formatSpec.word_range) {
    const [min, max] = formatSpec.word_range as [number, number];
    parts.push(
      `Target word count: ${min} to ${max} words. The range is a ceiling, not a quota; a shorter answer that fully serves the query is preferred.`
    );
  }
  // Spine directive (B9 Albrighton inverted pyramid / step-by-step / PPPP).
  if (spine) {
    const spineGuidance: Record<string, string> = {
      inverted_pyramid:
        "Inverted-pyramid spine: lead with the answer in paragraph one; expand with explanation, examples, then external citations, then extras. Each section reads as if it were the last.",
      step_by_step:
        "Step-by-step spine: numbered steps under their own subheads, capped at seven. Lower perceived effort for the reader.",
      problem_solution:
        "Problem-solution spine: name one problem, expand one implication the reader has not considered, present the solution, prove with process and credentials.",
      PPPP_landing:
        "Promise-Picture-Proof-Prompt spine: promise the deliverable (not a legal outcome), picture the reader's resolved situation, prove with process and credentials, prompt the next action.",
      AIDA_menu:
        "AIDA menu: pick from Attention, Interest, Desire, Action moves as the page demands. AIDA is a menu of moves, not a four-section template.",
    };
    if (spineGuidance[spine]) parts.push(spineGuidance[spine]);
  }
  // Structure read (page_structure for checklist/landing_page; structure for others).
  if (
    (format === "checklist" || format === "landing_page") &&
    Array.isArray(formatSpec.page_structure)
  ) {
    const pages = formatSpec.page_structure as string[];
    parts.push(
      `Required ${format === "checklist" ? "page sequence" : "section sequence"} (in order): ${pages
        .map((p, i) => `${i + 1}. ${p}`)
        .join("; ")}.`
    );
  } else if (formatSpec.structure) {
    const sections = formatSpec.structure as string[];
    parts.push(`Required structure sections: ${sections.join(", ")}.`);
  }

  // Five-line-brief literal labels (Ses.16 WP-4 bugfix, 2026-07-05).
  // format_specs.<format>.five_line_brief (e.g. counsel_note's
  // ["risk","price","timeline","decision","next_step"]) was defined in the
  // strategy JSON but never reached the model: the structure-sections line
  // above only told it a section named "five_line_brief" should exist, not
  // which five words to use inside it. content-validators.ts's
  // validateRequiredSections then checks for those exact words literally,
  // so a well-written five-line brief that happened not to use them (a real
  // case found in a generated power-of-attorney piece) failed for a reason
  // that had nothing to do with its actual quality. This closes the gap
  // between what the strategy promises and what the model is told.
  if (Array.isArray(formatSpec.five_line_brief) && formatSpec.five_line_brief.length > 0) {
    const labels = formatSpec.five_line_brief as string[];
    parts.push(
      `The five_line_brief section is five short lines, one for each of these labels, in this order: ` +
        `${labels.map((l) => l.replace(/_/g, " ")).join(", ")}. Use the literal word for each label ` +
        `somewhere in its line (for example the risk line contains the word "risk"), even for a matter type ` +
        `where that dimension is not obviously the main story; state briefly what that dimension is or why ` +
        `it is minimal for this matter, rather than omitting the word.`
    );
  }

  // ─── SEO/AEO LAYER (Step 5 retrofit) ───
  // Task-shaping, same category as the format/word-count directives above,
  // not identity-shaping (Lexicon and later layers), so it sits here. A
  // no-op for any piece whose source_brief carries no primary_query: the
  // format-agnostic prompt builders are shared across counsel_note,
  // checklist, and landing_page, so this activates per-piece on whichever
  // format the operator attaches the SEO/AEO fields to (per the SEO/AEO
  // spec Section 2 design: canonical_service_page's own attach point for
  // checklist's SEO surface is the landing_page it wraps, not checklist
  // itself; this code does not enforce that convention, it only reads
  // whatever is on source_brief).
  if (primaryQuery) {
    const secondaryLine =
      secondaryQueries.length > 0
        ? ` Secondary queries to cover naturally where they match a real reader question: ${secondaryQueries.join("; ")}.`
        : "";
    parts.push(`SEO/AEO target: this piece answers "${primaryQuery}".${secondaryLine}`);
  }

  // ─── LEXICON LAYER ───
  if (bannedVocab.length > 0) {
    parts.push(
      `BANNED vocabulary (never use): ${bannedVocab.join(", ")}.`
    );
  }
  if (approvedVocab.length > 0) {
    parts.push(
      `Approved vocabulary (prefer these where natural): ${approvedVocab.join(", ")}.`
    );
  }

  // Formatting constraints.
  const formatRules: string[] = [];
  if (formattingRules.no_em_dashes) {
    formatRules.push(
      "Never use em dashes. Use commas, colons, semicolons, parentheses, or restructure."
    );
  }
  if (formattingRules.no_italics) {
    formatRules.push("Never use italics for any purpose.");
  }
  if (formattingRules.no_orphan_words) {
    formatRules.push(
      "Avoid orphan words (a single short word alone on the last line of a paragraph)."
    );
  }
  if (formattingRules.no_rule_of_three) {
    formatRules.push(
      "Avoid decorative rule-of-three constructions unless the three items are genuinely distinct and load-bearing."
    );
  }
  if (formattingRules.no_timing_promises !== false) {
    formatRules.push(
      "Never make timing or response-speed promises ('within hours', 'same-day response', 'fast turnaround', 'within a minute'). Describe the service feature instead (who reads the intake, bilingual capacity)."
    );
  }
  if (formatRules.length > 0) {
    parts.push(`Formatting rules: ${formatRules.join(" ")}`);
  }

  // ─── LSO compliance (mandatory, surfaces the binding constraints) ───
  const lsoConstraints = (lsoRules.constraints as string[]) ?? [];
  parts.push(
    "LSO Rule 4.2-1 is mandatory and blocking. No outcome promises ('we win', 'guarantee', 'will recover'); no specialist or expert self-designation; no unverifiable superlatives ('best', 'top', '#1'); no timing promises; no fake scarcity. Convert outcome language to process language: not 'we win your case' but 'a lawyer reviews what you share'."
  );
  if (lsoConstraints.length > 0) {
    parts.push(`Additional LSO constraints: ${lsoConstraints.join("; ")}.`);
  }

  // ─── Opening + paragraph discipline ───
  // Step 5 retrofit: when the piece has a primary_query or answer_summary,
  // the opening line leads with the stricter answer-first rule (SEO/AEO spec
  // Section 4) ahead of the existing anti-pattern list, instead of adding a
  // second, separately-weighted instruction the model might trade off
  // against the rest of the prompt. The vague-topic-scoping-opener ban is
  // format-agnostic and always included; it does not depend on primary_query
  // being present.
  const answerFirstClause = primaryQuery
    ? `The first paragraph states the direct answer to "${primaryQuery}"${
        answerSummary ? ` (in the spirit of: "${answerSummary}")` : ""
      } in plain language before anything else, not a definition of the topic and not firm performance. Jurisdiction and matter type appear by the second sentence. `
    : "Lead with consequence to the reader, not firm performance. ";
  parts.push(
    `Opening discipline: ${answerFirstClause}Do not open with 'At our firm', 'We specialize in', 'Our firm is', 'With over X years'. Do not use suspense bait ('you won't believe', 'imagine', 'what if'). Avoid vague topic-scoping openers ('Understanding X can be complex', 'When it comes to X', 'Navigating X'); context, if needed, comes after the answer, not before it.`
  );
  parts.push(
    "Each paragraph advances one idea. Strong action verbs at the open. Specific conclusions or next steps at the close. No transitional fluff. Paragraphs no longer than three lines. One idea per sentence; split 'and/but/or' if it carries a second idea."
  );

  // ─── Strategic messages (B1 Castagliano Message Alignment Check seed) ───
  if (strategicMessages.length > 0) {
    parts.push(
      `Strategic messages this draft must reinforce: ${strategicMessages
        .map((m, i) => `(${i + 1}) ${m}`)
        .join("; ")}.`
    );
  }

  // ─── REFERENCE LAYER ───
  // Style-sample injection (B1 Castagliano: "showing beats telling" by far).
  // Reference excerpts are real, on-brand DRG copy. Match the rhythm, sentence
  // length, and register of these samples.
  if (reference?.samples?.length) {
    const matchLanguage = (sample: { language?: string }) =>
      language === "pt"
        ? sample.language === "pt"
        : !sample.language || sample.language === "en";
    const samples = reference.samples.filter(matchLanguage).slice(0, 3);
    if (samples.length > 0) {
      const block = samples
        .map((s, i) => {
          const title = s.title ? ` (${s.title})` : "";
          return `[Reference ${i + 1}${title}]\n${s.excerpt}`;
        })
        .join("\n\n");
      parts.push(
        `Reference samples of on-brand DRG writing. Match the rhythm, sentence length, and plain declarative register of these excerpts:\n\n${block}`
      );
    }
  }

  // ─── Factual-claim guard rail (B10 Vane) ───
  parts.push(
    "Do not include unverified statistics, fabricated quotes, named case outcomes, dollar figures, percentages, or statute citations that you cannot ground in the source brief. If a fact is needed and not in the source brief, ask for it via a [VERIFY:] tag rather than inventing it."
  );

  return parts.join("\n\n");
}

export function buildUserPrompt(
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
    // Step 5 retrofit: SEO/AEO input model fields (SEO/AEO spec Section 3).
    primary_query: "Primary query",
    secondary_queries: "Secondary queries",
    client_question_variants: "Client question variants",
    service_area: "Service area",
    search_intent: "Search intent",
    answer_summary: "Answer summary",
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    const val = sourceBrief[key];
    if (typeof val === "string" && val.trim().length > 0) {
      parts.push(`${label}: ${val.trim()}`);
    } else if (Array.isArray(val) && val.length > 0) {
      const joined = val
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim())
        .join("; ");
      if (joined) parts.push(`${label}: ${joined}`);
    }
  }

  // Include any extra fields not in the label map
  for (const [key, val] of Object.entries(sourceBrief)) {
    if (
      !(key in fieldLabels) &&
      key !== "internal_link_targets" &&
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

  // Step 5 retrofit: internal_link_targets gets bounded, explicit handling
  // rather than a plain fieldLabels line, matching the same rendering the
  // structured canonical_service_page branch already uses (see
  // content-studio-structured.ts buildCanonicalServicePageUserPrompt). No
  // raw JSON dump; the model gets a labeled, human-readable option list.
  // Ses.17 WP-3: the caller (draft/route.ts) filters non-firm-host targets
  // out of sourceBrief.internal_link_targets before calling this function,
  // so whatever arrives here is already domain-scoped. The post-hoc
  // validateInternalLinkDomains check remains a second line of defense.
  const internalLinkTargets = sourceBrief.internal_link_targets as
    | Array<{ url: string; anchor_text_hint?: string; relation?: string }>
    | undefined;
  if (internalLinkTargets?.length) {
    const links = internalLinkTargets
      .map(
        (l) =>
          `${l.anchor_text_hint ?? "(no anchor hint)"} -> ${l.url}${l.relation ? ` [${l.relation}]` : ""}`
      )
      .join("; ");
    parts.push(
      `Internal link options (use only where the anchor text reads naturally in context; do not force a link ` +
        `into every paragraph): ${links}`
    );
  }

  parts.push(
    "\nProduce the complete draft in Markdown. Include all required sections per the format spec."
  );

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Deterministic SEO metadata + Article JSON-LD for Markdown formats
// (Ses.17 WP-3). Mirrors the design principle already established in
// content-studio-structured.ts's assembleSchemaBlocks/buildSeoMetadata for
// canonical_service_page: entity facts (firm name, lawyer name) come from
// strategy_json.canonical_nap, never from the model, so the model is never
// asked to state a fact it could get wrong. Markdown formats never had any
// seo_metadata at all before this; the flat fields mirror what Phase 1 of
// the SEO/AEO spec promised (primary_query, secondary_queries) and the
// schema.article block closes the "Article schema for counsel_note" gap
// from spec Section 7.
// ─────────────────────────────────────────────────────────────────────────

/**
 * headline: the first Markdown H1 in the generated text if present, else
 * the piece's own title_working. datePublished/dateModified both use
 * generatedAt since a Markdown piece has no separate original-publish date
 * tracked yet (that is the same Phase-4, post-Task-#12 column gap the
 * structured format's last-updated check documents).
 */
export function buildArticleSchemaBlock(input: {
  strategy: StrategyRow;
  titleWorking: string;
  generatedText: string;
  generatedAt: string;
  language?: "en" | "pt";
}): Record<string, unknown> {
  const nap = (input.strategy.strategy_json as Record<string, unknown>).canonical_nap as
    | Record<string, unknown>
    | undefined;
  const headlineMatch = input.generatedText.match(/^#\s+(.+)$/m);
  const headline = (headlineMatch ? headlineMatch[1].trim() : input.titleWorking) || input.titleWorking;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    author: { "@type": "Person", name: nap?.lawyer_public_facing_name ?? null },
    publisher: { "@type": "LegalService", name: nap?.legal_entity ?? null },
    datePublished: input.generatedAt,
    dateModified: input.generatedAt,
    inLanguage: input.language === "pt" ? "pt" : "en",
  };
}

export function buildMarkdownSeoMetadata(input: {
  sourceBrief: Record<string, unknown>;
  articleSchema: Record<string, unknown>;
  generatedAt: string;
}): Record<string, unknown> {
  const sourceBrief = input.sourceBrief;
  return {
    generator: "markdown_v1",
    generated_at: input.generatedAt,
    primary_query: (sourceBrief.primary_query as string | undefined) ?? null,
    secondary_queries: (sourceBrief.secondary_queries as string[] | undefined) ?? [],
    search_intent: (sourceBrief.search_intent as string | undefined) ?? null,
    answer_summary: (sourceBrief.answer_summary as string | undefined) ?? null,
    jurisdiction: (sourceBrief.jurisdiction as string | undefined) ?? null,
    service_area: (sourceBrief.service_area as string | string[] | undefined) ?? null,
    schema: {
      article: input.articleSchema,
    },
  };
}
