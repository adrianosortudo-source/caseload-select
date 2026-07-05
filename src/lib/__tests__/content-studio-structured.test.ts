import { describe, it, expect } from "vitest";
import {
  validateCanonicalServicePageOutput,
  extractToolUseInput,
  toBodyStructuredBlocks,
  assembleSchemaBlocks,
  buildSeoMetadata,
  flattenServicePageToPlainText,
  buildCanonicalServicePageSystemPrompt,
  buildCanonicalServicePageUserPrompt,
  renderServicePagePreview,
  renderMarkdownToSafeHtml,
  CANONICAL_SERVICE_PAGE_TOOL_NAME,
  SERVICE_PAGE_SECTION_KEYS,
  type CanonicalServicePageModelOutput,
  type ServicePageBlock,
} from "../content-studio-structured";
import type { StrategyRow } from "../content-studio";

function makeHeadingSection(overrides: Partial<{ heading: string; body_markdown: string }> = {}) {
  return {
    heading: overrides.heading ?? "A heading",
    body_markdown: overrides.body_markdown ?? "Body content for this section.",
  };
}

function makeValidOutput(
  overrides: Partial<CanonicalServicePageModelOutput> = {}
): CanonicalServicePageModelOutput {
  return {
    h1: { line1: "Ontario commercial leases put risk on the tenant", line2: "before you sign, not after" },
    sections: {
      first_paragraph_direct_answer:
        "A lawyer reviews the relocation, assignment, and repair clauses before you sign, because those three terms carry the most risk in a typical Ontario commercial lease.",
      qualification: makeHeadingSection({ heading: "Do you have this matter" }),
      what_is_at_stake: makeHeadingSection({ heading: "What is at stake" }),
      author_bio: { bio_text: "A short narrative bio paragraph." },
      how_the_process_works: makeHeadingSection({ heading: "How the process works" }),
      critical_information: makeHeadingSection({ heading: "What to know early" }),
      fees_and_expectations: makeHeadingSection({ heading: "Fees and what to expect" }),
      differentiation: makeHeadingSection({ heading: "Differentiation" }),
      service_area_coverage: makeHeadingSection({ heading: "Service area" }),
      final_cta: { heading: "Next step", body_markdown: "A lawyer reviews the brief.", cta_label: "Submit for review" },
    },
    faq_block: [
      { question: "Do I need a lawyer to review a commercial lease?", answer: "A commercial lease is negotiable before signature." },
      { question: "What does a lawyer check?", answer: "The relocation, assignment, and repair clauses." },
    ],
    seo: {
      title: "Commercial Lease Review, Ontario",
      meta_description: "A lawyer reviews the relocation, assignment, and repair clauses before you sign.",
      internal_links_used: [{ url: "https://drglaw.ca/resources/x", anchor_text: "the checklist" }],
    },
    ...overrides,
  } as CanonicalServicePageModelOutput;
}

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
      canonical_nap: {
        legal_entity: "DRG Law Professional Corporation",
        trade_name: "DRG Law",
        lawyer_public_facing_name: "Damaris Regina Guimaraes",
        public_phone: "647-584-0998",
        lso_member_number: "91022I",
        lso_member_url: "https://lso.ca/example",
        address: "PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8",
        email: "info@drglaw.ca",
        languages: ["English", "Portuguese"],
        website: "https://drglaw.ca",
      },
      authority_assets: {
        four_as: {
          accreditations: [
            { name: "Global Professional Master of Laws (GPLLM), University of Toronto, 2023", publishable: true },
            { name: "Unpublishable degree", publishable: false },
          ],
        },
      },
      ...((overrides.strategy_json as Record<string, unknown>) ?? {}),
    },
    format_specs: {
      canonical_service_page: {
        byline_format: "{byline} · {topic_short} · {publish_date}",
      },
    },
    voice_rules: {
      banned_vocabulary: ["delve"],
      approved_vocabulary: ["Ontario"],
      approved_ctas: ["Submit for review"],
      lso_rules: { constraints: ["No outcome promises"] },
    },
    ...overrides,
  } as StrategyRow;
}

describe("validateCanonicalServicePageOutput", () => {
  it("passes a well-formed output", () => {
    const result = validateCanonicalServicePageOutput(makeValidOutput());
    expect(result.valid).toBe(true);
  });

  it("fails when h1 is missing", () => {
    const bad = makeValidOutput();
    // @ts-expect-error deliberately malformed for the test
    delete bad.h1;
    const result = validateCanonicalServicePageOutput(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("h1"))).toBe(true);
    }
  });

  it("fails when faq_block has fewer than 2 entries", () => {
    const bad = makeValidOutput({ faq_block: [{ question: "Only one?", answer: "Yes." }] });
    const result = validateCanonicalServicePageOutput(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("faq_block"))).toBe(true);
    }
  });

  it("fails when a required section body is empty", () => {
    const bad = makeValidOutput();
    bad.sections.qualification.body_markdown = "";
    const result = validateCanonicalServicePageOutput(bad);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("qualification"))).toBe(true);
    }
  });

  it("rejects a non-object input", () => {
    const result = validateCanonicalServicePageOutput("not an object");
    expect(result.valid).toBe(false);
  });
});

describe("extractToolUseInput", () => {
  it("extracts the tool input when the tool_use block is present", () => {
    const result = extractToolUseInput({
      content: [{ type: "tool_use", name: CANONICAL_SERVICE_PAGE_TOOL_NAME, input: { h1: {} } }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input).toEqual({ h1: {} });
  });

  it("reports the model's text reply when it refuses the tool call", () => {
    const result = extractToolUseInput({
      content: [{ type: "text", text: "I cannot produce this content." }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("I cannot produce this content");
  });

  it("reports a generic error when there is no content at all", () => {
    const result = extractToolUseInput({ content: [] });
    expect(result.ok).toBe(false);
  });

  it("reports truncation when the response stopped at max_tokens, even if a partial tool block exists", () => {
    const result = extractToolUseInput({
      content: [{ type: "tool_use", name: CANONICAL_SERVICE_PAGE_TOOL_NAME, input: {} }],
      stop_reason: "max_tokens",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("max_tokens");
  });
});

describe("toBodyStructuredBlocks", () => {
  it("produces one block per section plus h1 and faq_block, keyed to the format spec", () => {
    const blocks = toBodyStructuredBlocks(makeValidOutput(), makeStrategy());
    const keys = blocks.map((b) => b.key);
    expect(keys).toContain(SERVICE_PAGE_SECTION_KEYS.h1);
    expect(keys).toContain(SERVICE_PAGE_SECTION_KEYS.faqBlock);
    expect(keys).toContain(SERVICE_PAGE_SECTION_KEYS.authorBio);
    expect(blocks).toHaveLength(12);
  });

  it("assembles the author bio block from strategy facts, not from the model's bio_text alone", () => {
    const blocks = toBodyStructuredBlocks(makeValidOutput(), makeStrategy());
    const authorBlock = blocks.find((b) => b.key === SERVICE_PAGE_SECTION_KEYS.authorBio);
    expect(authorBlock && "body_markdown" in authorBlock ? authorBlock.body_markdown : "").toContain(
      "Damaris Regina Guimaraes"
    );
    expect(authorBlock && "body_markdown" in authorBlock ? authorBlock.body_markdown : "").toContain("91022I");
  });

  it("keeps the FAQ items intact", () => {
    const output = makeValidOutput();
    const blocks = toBodyStructuredBlocks(output, makeStrategy());
    const faq = blocks.find((b) => b.type === "faq_block");
    expect(faq && faq.type === "faq_block" ? faq.items.length : 0).toBe(output.faq_block.length);
  });
});

describe("assembleSchemaBlocks", () => {
  it("sources LegalService and Person facts from strategy_json, never from the model", () => {
    const schema = assembleSchemaBlocks(makeValidOutput(), makeStrategy(), { practice_area: "Corporate/Commercial Law" });
    expect(schema.legal_service.name).toBe("DRG Law Professional Corporation");
    expect(schema.person.name).toBe("Damaris Regina Guimaraes");
    const hasCredential = schema.person.hasCredential as Array<Record<string, unknown>>;
    expect(hasCredential.some((c) => c.credentialCategory === "license")).toBe(true);
    // The unpublishable accreditation must not leak into the schema.
    expect(hasCredential.some((c) => c.about === "Unpublishable degree")).toBe(false);
  });

  it("builds FAQPage mainEntity from the model's faq_block", () => {
    const output = makeValidOutput();
    const schema = assembleSchemaBlocks(output, makeStrategy(), {});
    const mainEntity = schema.faq_page.mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(output.faq_block.length);
    expect(mainEntity[0].name).toBe(output.faq_block[0].question);
  });

  it("flags incomplete breadcrumb URLs instead of inventing a slug when no website is on file", () => {
    const strategy = makeStrategy({
      strategy_json: {
        canonical_nap: {
          legal_entity: "No Website Law",
          lawyer_public_facing_name: "Someone",
        },
      },
    });
    const schema = assembleSchemaBlocks(makeValidOutput(), strategy, {});
    expect(schema.breadcrumb_urls_incomplete).toBe(true);
  });

  it("does not flag incomplete breadcrumbs when a website is on file", () => {
    const schema = assembleSchemaBlocks(makeValidOutput(), makeStrategy(), {});
    expect(schema.breadcrumb_urls_incomplete).toBe(false);
  });

  it("defaults areaServed to the firm jurisdiction when no service_area is supplied", () => {
    const schema = assembleSchemaBlocks(makeValidOutput(), makeStrategy(), {});
    expect(schema.legal_service.areaServed).toEqual(["Ontario"]);
  });

  it("uses source_brief.service_area for areaServed when supplied", () => {
    const schema = assembleSchemaBlocks(makeValidOutput(), makeStrategy(), { service_area: ["Toronto"] });
    expect(schema.legal_service.areaServed).toEqual(["Toronto"]);
  });
});

describe("buildSeoMetadata", () => {
  it("carries the source_brief SEO fields and the assembled schema blocks", () => {
    const output = makeValidOutput();
    const strategy = makeStrategy();
    const schema = assembleSchemaBlocks(output, strategy, { primary_query: "commercial lease review" });
    const seoMetadata = buildSeoMetadata(output, { primary_query: "commercial lease review" }, schema);
    expect(seoMetadata.primary_query).toBe("commercial lease review");
    expect(seoMetadata.title).toBe(output.seo.title);
    expect(seoMetadata.generator).toBe("structured_v1");
    expect((seoMetadata.schema as Record<string, unknown>).legal_service).toBeDefined();
  });
});

describe("flattenServicePageToPlainText", () => {
  it("produces a single readable text block covering every section and the FAQ pairs", () => {
    const blocks = toBodyStructuredBlocks(makeValidOutput(), makeStrategy());
    const text = flattenServicePageToPlainText(blocks);
    expect(text).toContain("Ontario commercial leases put risk on the tenant");
    expect(text).toContain("Do I need a lawyer to review a commercial lease?");
    expect(text.length).toBeGreaterThan(200);
  });
});

describe("prompt builders", () => {
  it("includes the primary query and the answer-first opening discipline", () => {
    const prompt = buildCanonicalServicePageSystemPrompt(makeStrategy(), {
      primary_query: "do I need a lawyer to review a commercial lease in Ontario",
    });
    expect(prompt).toContain("do I need a lawyer to review a commercial lease in Ontario");
    expect(prompt).toContain("Opening discipline");
    expect(prompt).toContain("emit_canonical_service_page");
  });

  it("never asks the model to state firm or lawyer facts in the bio", () => {
    const prompt = buildCanonicalServicePageSystemPrompt(makeStrategy(), {});
    expect(prompt).toContain("Do not state the firm name");
  });

  it("renders internal link options as labeled guidance, not a raw JSON dump", () => {
    const userPrompt = buildCanonicalServicePageUserPrompt({
      primary_query: "test query",
      internal_link_targets: [{ url: "https://drglaw.ca/x", anchor_text_hint: "the checklist", relation: "next_step" }],
    });
    expect(userPrompt).toContain("Internal link options");
    expect(userPrompt).toContain("the checklist -> https://drglaw.ca/x");
    expect(userPrompt).not.toContain("{\"url\"");
  });
});

describe("renderServicePagePreview", () => {
  const blocks = toBodyStructuredBlocks(makeValidOutput(), makeStrategy());
  const seoMetadata = {
    generated_at: "2026-07-02T12:00:00.000Z",
    schema: {
      legal_service: { "@type": "LegalService" },
      person: { "@type": "Person" },
      faq_page: { "@type": "FAQPage" },
      breadcrumb_list: { "@type": "BreadcrumbList" },
    },
  };

  it("renders the H1, sections, FAQ, author, and last-updated date", () => {
    const { html } = renderServicePagePreview(blocks, seoMetadata);
    expect(html).toContain("<h1>");
    expect(html).toContain("Ontario commercial leases put risk on the tenant");
    expect(html).toContain("Do I need a lawyer to review a commercial lease?");
    expect(html).toContain("Damaris Regina Guimaraes");
    expect(html).toContain("Last updated:");
    expect(html).toContain("2026-07-02");
  });

  it("returns schema JSON separately from html, in a stable order, with no <script> tags in html", () => {
    const { html, schemaJson } = renderServicePagePreview(blocks, seoMetadata);
    expect(html).not.toContain("<script");
    expect(schemaJson).toHaveLength(4);
    expect(schemaJson[0]).toEqual({ "@type": "LegalService" });
    expect(schemaJson[1]).toEqual({ "@type": "Person" });
    expect(schemaJson[2]).toEqual({ "@type": "FAQPage" });
    expect(schemaJson[3]).toEqual({ "@type": "BreadcrumbList" });
  });

  it("escapes unsafe text instead of letting it become real markup", () => {
    const maliciousBlocks: ServicePageBlock[] = [
      { type: "h1", key: "h1", line1: "<script>alert(1)</script>", line2: "safe line" },
      {
        type: "section",
        key: "qualification",
        heading: "Heading with <img src=x onerror=alert(1)>",
        body_markdown: 'Body with a "quote" and a <b>tag</b>.',
      },
    ];
    const { html } = renderServicePagePreview(maliciousBlocks, undefined);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<b>tag</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;quote&quot;");
  });

  it("applies safe inline markdown (bold, http links) only after escaping", () => {
    const inlineBlocks: ServicePageBlock[] = [
      {
        type: "section",
        key: "final_cta",
        heading: "Next step",
        body_markdown: "A lawyer reviews the brief.\n\n**Submit for review**",
      },
      {
        type: "section",
        key: "differentiation",
        heading: "See also",
        body_markdown:
          "Read [the relocation checklist](https://drglaw.ca/resources/checklist) before you sign.",
      },
    ];
    const { html } = renderServicePagePreview(inlineBlocks, undefined);
    expect(html).toContain("<strong>Submit for review</strong>");
    expect(html).toContain(
      '<a href="https://drglaw.ca/resources/checklist" target="_blank" rel="noopener noreferrer">the relocation checklist</a>'
    );
  });

  it("handles missing/unknown block types and malformed fields without throwing", () => {
    const weirdBlocks: ServicePageBlock[] = [
      { type: "h1", key: "h1", line1: "Title line one", line2: "Title line two" },
      { type: "unknown_future_block", key: "mystery" } as unknown as ServicePageBlock,
      { type: "section", key: "empty", body_markdown: undefined as unknown as string },
      null as unknown as ServicePageBlock,
    ];
    expect(() => renderServicePagePreview(weirdBlocks, undefined)).not.toThrow();
    const { html } = renderServicePagePreview(weirdBlocks, undefined);
    expect(html).toContain("unrecognized block");
    expect(html).toContain("Title line one");
  });

  it("handles missing/empty blocks and missing seo_metadata gracefully", () => {
    expect(() => renderServicePagePreview(undefined, undefined)).not.toThrow();
    expect(() => renderServicePagePreview(null, undefined)).not.toThrow();
    const { html, schemaJson } = renderServicePagePreview([], undefined);
    expect(html).toBe("");
    expect(schemaJson).toEqual([]);
  });

  it("omits the last-updated line when generated_at is missing or invalid", () => {
    const { html: html1 } = renderServicePagePreview(blocks, undefined);
    expect(html1).not.toContain("Last updated:");
    const { html: html2 } = renderServicePagePreview(blocks, { generated_at: "not-a-date" });
    expect(html2).not.toContain("Last updated:");
  });
});

describe("renderMarkdownToSafeHtml", () => {
  it("renders heading levels 1 through 3", () => {
    const html = renderMarkdownToSafeHtml("# Title\n\n## Section\n\n### Sub");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<h3>Sub</h3>");
  });

  it("renders paragraphs split on blank lines", () => {
    const html = renderMarkdownToSafeHtml("First paragraph.\n\nSecond paragraph.");
    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("applies bold and link inline markdown", () => {
    const html = renderMarkdownToSafeHtml("Read the **five-line brief** at [the journal](https://drglaw.ca/journal).");
    expect(html).toContain("<strong>five-line brief</strong>");
    expect(html).toContain('<a href="https://drglaw.ca/journal"');
  });

  it("escapes a raw script tag so it can never render as a live element", () => {
    const html = renderMarkdownToSafeHtml('Some text <script>alert(1)</script> more text.');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles empty and missing input", () => {
    expect(renderMarkdownToSafeHtml("")).toBe("");
    expect(renderMarkdownToSafeHtml(null)).toBe("");
    expect(renderMarkdownToSafeHtml(undefined)).toBe("");
  });
});
