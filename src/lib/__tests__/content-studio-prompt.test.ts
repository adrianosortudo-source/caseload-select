import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildArticleSchemaBlock,
  buildMarkdownSeoMetadata,
} from "../content-studio-prompt";
import type { StrategyRow } from "../content-studio";

function makeStrategy(overrides: Record<string, unknown> = {}): StrategyRow {
  return {
    id: "strategy-1",
    firm_id: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
    name: "DRG Law Content Strategy v2",
    version: 2,
    status: "active",
    default_locale: "en",
    bilingual_enabled: true,
    jurisdiction: "Ontario",
    strategy_json: {
      territory_context: "Ontario SMB owners signing commercial leases.",
      positioning_statement: "DRG Law reviews the lease before you sign.",
      strategic_messages: ["A lawyer reviews the lease before you sign, not after a dispute starts."],
      ...((overrides.strategy_json as Record<string, unknown>) ?? {}),
    },
    format_specs: {
      counsel_note: {
        word_range: [600, 900],
        structure: ["intro", "body", "faqs"],
        spine: "inverted_pyramid",
      },
      checklist: {
        page_structure: ["cover", "step-1", "step-2", "cta"],
      },
      ...((overrides.format_specs as Record<string, unknown>) ?? {}),
    },
    voice_rules: {
      banned_vocabulary: ["delve"],
      approved_vocabulary: ["Ontario"],
      formatting_rules: {
        no_em_dashes: true,
        no_italics: true,
        no_orphan_words: true,
        no_rule_of_three: true,
      },
      lso_rules: { constraints: ["No outcome promises"] },
      tone: "authoritative, direct, evidence-led",
    },
    ...overrides,
  } as StrategyRow;
}

describe("buildSystemPrompt", () => {
  it("keeps the base opening discipline (consequence-led) when there is no primary_query", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {});
    expect(prompt).toContain("Opening discipline: Lead with consequence to the reader, not firm performance.");
    expect(prompt).not.toContain("SEO/AEO target:");
  });

  it("always bans vague topic-scoping openers, regardless of primary_query", () => {
    const withoutQuery = buildSystemPrompt(makeStrategy(), "counsel_note", {});
    const withQuery = buildSystemPrompt(makeStrategy(), "counsel_note", {
      primary_query: "do I need a lawyer to review a commercial lease in Ontario",
    });
    expect(withoutQuery).toContain("Avoid vague topic-scoping openers");
    expect(withQuery).toContain("Avoid vague topic-scoping openers");
  });

  it("adds the SEO/AEO target layer and the answer-first opening when primary_query is present", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {
      primary_query: "do I need a lawyer to review a commercial lease in Ontario",
      secondary_queries: ["commercial lease review lawyer Toronto", "what does a lawyer check in a lease"],
      answer_summary: "A lawyer reviews the relocation, assignment, and repair clauses before you sign.",
    });
    expect(prompt).toContain(
      'SEO/AEO target: this piece answers "do I need a lawyer to review a commercial lease in Ontario".'
    );
    expect(prompt).toContain("commercial lease review lawyer Toronto");
    expect(prompt).toContain("what does a lawyer check in a lease");
    expect(prompt).toContain(
      'Opening discipline: The first paragraph states the direct answer to "do I need a lawyer to review a commercial lease in Ontario"'
    );
    expect(prompt).toContain("A lawyer reviews the relocation, assignment, and repair clauses before you sign.");
    expect(prompt).toContain("Jurisdiction and matter type appear by the second sentence.");
  });

  it("does not add a secondary-queries clause when none are supplied", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {
      primary_query: "do I need a lawyer to review a commercial lease in Ontario",
    });
    expect(prompt).toContain("SEO/AEO target:");
    expect(prompt).not.toContain("Secondary queries to cover naturally");
  });

  it("still applies to checklist (page_structure formats), not only counsel_note", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "checklist", {
      primary_query: "commercial lease relocation clause checklist",
    });
    expect(prompt).toContain("SEO/AEO target:");
    expect(prompt).toContain("Required page sequence");
  });

  it("preserves existing behavior: banned/approved vocabulary, LSO compliance, and formatting rules still render", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {});
    expect(prompt).toContain("BANNED vocabulary (never use): delve.");
    expect(prompt).toContain("Approved vocabulary (prefer these where natural): Ontario.");
    expect(prompt).toContain("LSO Rule 4.2-1 is mandatory and blocking.");
    expect(prompt).toContain("Never use em dashes.");
  });

  it("surfaces the five_line_brief literal labels when the format spec defines them (Ses.16 WP-4 bugfix)", () => {
    const prompt = buildSystemPrompt(
      makeStrategy({
        format_specs: {
          counsel_note: {
            word_range: [600, 900],
            structure: ["intro", "body", "five_line_brief"],
            five_line_brief: ["risk", "price", "timeline", "decision", "next_step"],
          },
        },
      }),
      "counsel_note",
      {}
    );
    expect(prompt).toContain("five_line_brief section is five short lines");
    expect(prompt).toContain("risk, price, timeline, decision, next step");
    expect(prompt).toContain('the risk line contains the word "risk"');
  });

  it("omits the five_line_brief instruction entirely when the format spec has no such array", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {});
    expect(prompt).not.toContain("five_line_brief section is five short lines");
  });
});

describe("buildSystemPrompt Portuguese authoring (Ses.17 WP-4)", () => {
  it("adds a Portuguese language directive when language is 'pt'", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {}, "pt");
    expect(prompt).toContain("write this entire piece in Portuguese");
    expect(prompt).toContain("jurisdiction disclosure");
  });

  it("does not add the Portuguese directive when language is 'en' (default)", () => {
    const prompt = buildSystemPrompt(makeStrategy(), "counsel_note", {});
    expect(prompt).not.toContain("write this entire piece in Portuguese");
  });

  it("notes the Markdown format line should say 'entirely in Portuguese' for pt", () => {
    const ptPrompt = buildSystemPrompt(makeStrategy(), "counsel_note", {}, "pt");
    const enPrompt = buildSystemPrompt(makeStrategy(), "counsel_note", {}, "en");
    expect(ptPrompt).toContain("Write in Markdown, entirely in Portuguese.");
    expect(enPrompt).toContain("Write in Markdown.");
    expect(enPrompt).not.toContain("entirely in Portuguese");
  });

  it("selects PT-language reference samples over EN ones when language is 'pt'", () => {
    const strategy = makeStrategy({
      voice_rules: {
        banned_vocabulary: [],
        approved_vocabulary: ["Ontario"],
        formatting_rules: {
          no_em_dashes: true,
          no_italics: true,
          no_orphan_words: true,
          no_rule_of_three: true,
        },
        lso_rules: { constraints: ["No outcome promises"] },
        tone: "authoritative, direct, evidence-led",
        reference: {
          samples: [
            { title: "EN sample", language: "en", excerpt: "This is the English excerpt." },
            { title: "PT sample", language: "pt", excerpt: "Este é o trecho em português." },
          ],
        },
      },
    });
    const ptPrompt = buildSystemPrompt(strategy, "counsel_note", {}, "pt");
    const enPrompt = buildSystemPrompt(strategy, "counsel_note", {}, "en");
    expect(ptPrompt).toContain("Este é o trecho em português.");
    expect(ptPrompt).not.toContain("This is the English excerpt.");
    expect(enPrompt).toContain("This is the English excerpt.");
    expect(enPrompt).not.toContain("Este é o trecho em português.");
  });
});

describe("buildUserPrompt", () => {
  it("renders the new SEO/AEO fields as labeled lines", () => {
    const prompt = buildUserPrompt(
      {
        primary_query: "do I need a lawyer to review a commercial lease in Ontario",
        search_intent: "commercial_investigation",
        answer_summary: "A lawyer reviews the relocation, assignment, and repair clauses before you sign.",
        jurisdiction: "Ontario",
      },
      "counsel_note"
    );
    expect(prompt).toContain("Primary query: do I need a lawyer to review a commercial lease in Ontario");
    expect(prompt).toContain("Search intent: commercial_investigation");
    expect(prompt).toContain("Answer summary: A lawyer reviews the relocation, assignment, and repair clauses before you sign.");
    expect(prompt).toContain("Jurisdiction: Ontario");
  });

  it("joins array fields (secondary_queries, client_question_variants, service_area) rather than dropping them", () => {
    const prompt = buildUserPrompt(
      {
        secondary_queries: ["commercial lease review lawyer Toronto", "what does a lawyer check in a lease"],
        client_question_variants: ["Do I actually need a lawyer for this?", "What's the worst clause that gets missed?"],
        service_area: ["Toronto", "Mississauga"],
      },
      "counsel_note"
    );
    expect(prompt).toContain(
      "Secondary queries: commercial lease review lawyer Toronto; what does a lawyer check in a lease"
    );
    expect(prompt).toContain(
      "Client question variants: Do I actually need a lawyer for this?; What's the worst clause that gets missed?"
    );
    expect(prompt).toContain("Service area: Toronto; Mississauga");
  });

  it("renders internal_link_targets as bounded labeled guidance, not a raw JSON dump", () => {
    const prompt = buildUserPrompt(
      {
        primary_query: "test query",
        internal_link_targets: [
          { url: "https://drglaw.ca/x", anchor_text_hint: "the checklist", relation: "next_step" },
        ],
      },
      "counsel_note"
    );
    expect(prompt).toContain("Internal link options");
    expect(prompt).toContain("the checklist -> https://drglaw.ca/x [next_step]");
    expect(prompt).not.toContain('{"url"');
  });

  it("still renders the pre-existing fields exactly as before (backward compatible)", () => {
    const prompt = buildUserPrompt(
      {
        decision_question: "Should I sign this lease as-is?",
        legal_distinction: "Commercial leases are not consumer-protected.",
        consequence: "An unreviewed relocation clause can force a costly move.",
      },
      "counsel_note"
    );
    expect(prompt).toContain("Decision question: Should I sign this lease as-is?");
    expect(prompt).toContain("Legal distinction: Commercial leases are not consumer-protected.");
    expect(prompt).toContain("Consequence if ignored: An unreviewed relocation clause can force a costly move.");
  });

  it("still surfaces unlabeled extra string fields under a humanized label", () => {
    const prompt = buildUserPrompt({ custom_field_name: "Some extra detail" }, "counsel_note");
    expect(prompt).toContain("Custom Field Name: Some extra detail");
  });
});

// Ses.17 WP-3: Article JSON-LD + last-updated seo_metadata for Markdown
// formats. The structured canonical_service_page branch has its own richer
// assembly (content-studio-structured.ts); these two functions give every
// other format the same last-updated-date + entity-schema coverage.
describe("buildArticleSchemaBlock", () => {
  function makeStrategyWithNap(nap?: Record<string, unknown>): StrategyRow {
    return {
      id: "strategy-1",
      firm_id: "eec1d25e-a047-4827-8e4a-6eb96becca2b",
      name: "DRG Law Content Strategy v2",
      version: 2,
      status: "active",
      default_locale: "en",
      bilingual_enabled: true,
      jurisdiction: "Ontario",
      strategy_json: { canonical_nap: nap },
      format_specs: {},
      voice_rules: {},
    } as StrategyRow;
  }

  it("takes the headline from the first markdown H1 when present", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({
        legal_entity: "DRG Law Professional Corporation",
        lawyer_public_facing_name: "Damaris Regina Guimaraes",
      }),
      titleWorking: "Working title, not the real headline",
      generatedText: "# Commercial Lease Review, Ontario\n\nBody text follows.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(block.headline).toBe("Commercial Lease Review, Ontario");
    expect(block["@type"]).toBe("Article");
    expect(block["@context"]).toBe("https://schema.org");
  });

  it("falls back to titleWorking when the generated text has no H1", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({}),
      titleWorking: "Fallback Title",
      generatedText: "No heading here, just a paragraph.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(block.headline).toBe("Fallback Title");
  });

  it("populates author and publisher from canonical_nap when present", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({
        legal_entity: "DRG Law Professional Corporation",
        lawyer_public_facing_name: "Damaris Regina Guimaraes",
      }),
      titleWorking: "Title",
      generatedText: "Body text.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(block.author).toEqual({ "@type": "Person", name: "Damaris Regina Guimaraes" });
    expect(block.publisher).toEqual({ "@type": "LegalService", name: "DRG Law Professional Corporation" });
  });

  it("nulls out author/publisher name rather than throwing when canonical_nap is missing", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap(undefined),
      titleWorking: "Title",
      generatedText: "Body text.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect((block.author as Record<string, unknown>).name).toBeNull();
    expect((block.publisher as Record<string, unknown>).name).toBeNull();
  });

  it("stamps datePublished and dateModified to the same generatedAt value", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({}),
      titleWorking: "Title",
      generatedText: "Body text.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(block.datePublished).toBe("2026-07-05T12:00:00.000Z");
    expect(block.dateModified).toBe("2026-07-05T12:00:00.000Z");
  });

  it("defaults inLanguage to 'en' when language is omitted", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({}),
      titleWorking: "Title",
      generatedText: "Body text.",
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(block.inLanguage).toBe("en");
  });

  it("sets inLanguage to 'pt' when language is 'pt' (Ses.17 WP-4)", () => {
    const block = buildArticleSchemaBlock({
      strategy: makeStrategyWithNap({}),
      titleWorking: "Title",
      generatedText: "Body text.",
      generatedAt: "2026-07-05T12:00:00.000Z",
      language: "pt",
    });
    expect(block.inLanguage).toBe("pt");
  });
});

describe("buildMarkdownSeoMetadata", () => {
  it("carries the SEO/AEO source_brief fields plus the article schema through", () => {
    const articleSchema = { "@type": "Article", headline: "Test Headline" };
    const metadata = buildMarkdownSeoMetadata({
      sourceBrief: {
        primary_query: "commercial lease review Ontario",
        secondary_queries: ["lease review lawyer Toronto"],
        search_intent: "commercial_investigation",
        answer_summary: "A lawyer reviews the lease before you sign.",
        jurisdiction: "Ontario",
        service_area: ["Toronto"],
      },
      articleSchema,
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(metadata.generator).toBe("markdown_v1");
    expect(metadata.generated_at).toBe("2026-07-05T12:00:00.000Z");
    expect(metadata.primary_query).toBe("commercial lease review Ontario");
    expect(metadata.secondary_queries).toEqual(["lease review lawyer Toronto"]);
    expect(metadata.search_intent).toBe("commercial_investigation");
    expect(metadata.answer_summary).toBe("A lawyer reviews the lease before you sign.");
    expect(metadata.jurisdiction).toBe("Ontario");
    expect(metadata.service_area).toEqual(["Toronto"]);
    expect((metadata.schema as Record<string, unknown>).article).toBe(articleSchema);
  });

  it("defaults absent fields to null/empty-array rather than throwing", () => {
    const metadata = buildMarkdownSeoMetadata({
      sourceBrief: {},
      articleSchema: { "@type": "Article" },
      generatedAt: "2026-07-05T12:00:00.000Z",
    });
    expect(metadata.primary_query).toBeNull();
    expect(metadata.secondary_queries).toEqual([]);
    expect(metadata.search_intent).toBeNull();
    expect(metadata.answer_summary).toBeNull();
    expect(metadata.jurisdiction).toBeNull();
    expect(metadata.service_area).toBeNull();
  });
});
