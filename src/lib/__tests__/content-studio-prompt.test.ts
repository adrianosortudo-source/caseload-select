import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../content-studio-prompt";
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
