// Focused test file for the canonical_service_page AEO/SEO validators added
// 2026-07-02 (SEO/AEO spec Section 10 step 3). Does not expand coverage of
// the pre-existing Markdown-format validators in content-validators.ts;
// those already have production usage via /api/admin/content-studio/pieces/
// [id]/validate/route.ts and are out of scope for this pass.
//
// Step 5 addendum (same day): added coverage for the three NEW plain-text
// SEO/AEO validators (validateAnswerInTop30PercentText,
// validatePrimaryQueryPresenceText, validateJurisdictionServiceAreaEarlyText)
// and their gated wiring into runDeterministicValidators. These are siblings
// of the structured validators above, retrofitted for counsel_note/checklist
// (Markdown formats with no body_structured/seo_metadata). Still does not
// expand coverage of the pre-existing pre-Step-3 validators themselves.
//
// Ses.16 WP-4 addendum (2026-07-05): the next-20% autonomous build run
// produced real counsel_note pieces and found two of those pre-Step-3
// validators actively broken (never covered by a test anywhere in this
// repo before now). validateItalicsMarkup miscounted every `**bold**`
// phrase as italics (its regex captured the inner `*text*` hiding inside
// `**text**`), and validateLsoCompliance's bare `guarantee` pattern flagged
// the legal noun "personal guarantee", a load-bearing term in commercial
// lease content, as an LSO outcome-promise violation. Both are fixed below
// and get narrow regression coverage; this does not become a general
// initiative to backfill coverage for the rest of the pre-Step-3 battery.

import { describe, it, expect } from "vitest";
import {
  validateNamedAuthorPresent,
  validateFaqBlockPresent,
  validateAnswerInTop30Percent,
  validateLastUpdatedDateVisible,
  validatePrimaryQueryPresence,
  validateJurisdictionAndServiceAreaEarly,
  validateInternalLinksPresent,
  validateFaqQuestionsAreQuestionShaped,
  validateSchemaDirectivesPresent,
  runCanonicalServicePageValidators,
  validateAnswerInTop30PercentText,
  validatePrimaryQueryPresenceText,
  validateJurisdictionServiceAreaEarlyText,
  runDeterministicValidators,
  validateItalicsMarkup,
  validateLsoCompliance,
  validateInternalLinkDomains,
  validateHeadingQueryAlignment,
  validateEntityPresent,
  validateSecondaryQueryCoverage,
  validateServiceAreaPresence,
  significantWords,
  validatePtJurisdictionDisclosure,
  runPtValidators,
  type ValidatorConfig,
} from "../content-validators";
import { SERVICE_PAGE_SECTION_KEYS, type ServicePageBlock } from "../content-studio-structured";

const PRIMARY_QUERY = "commercial lease review Ontario";

function goodBlocks(): ServicePageBlock[] {
  return [
    {
      type: "h1",
      key: SERVICE_PAGE_SECTION_KEYS.h1,
      line1: "Ontario commercial leases put risk on the tenant",
      line2: "a lawyer review catches it before you sign",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.firstParagraph,
      body_markdown:
        "A lawyer reviews the relocation, assignment, and repair clauses in your commercial lease before you sign, because those three Ontario-specific terms carry the most risk.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.qualification,
      heading: "Do you have this matter",
      body_markdown: "If you are about to sign or renew a commercial lease, this applies to you.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.whatIsAtStake,
      heading: "What is at stake",
      body_markdown: "The relocation and assignment clauses decide who bears the cost later.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.authorBio,
      body_markdown:
        "Damaris Regina Guimaraes · Commercial Lease Review · 2026-07-02\n\nLaw Society of Ontario, member 91022I\n\nA short narrative bio paragraph.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.howTheProcessWorks,
      heading: "How the process works",
      body_markdown: "Submit the lease. A lawyer reviews it and returns notes within a defined scope.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.criticalInformation,
      heading: "What to know early",
      body_markdown: "Bring the lease before you sign, not after a dispute starts.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.feesAndExpectations,
      heading: "Fees and what to expect",
      body_markdown: "A written estimate is provided before work starts.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.differentiation,
      heading: "Differentiation",
      body_markdown: "The review focuses on the clauses most likely to matter later.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.serviceAreaCoverage,
      heading: "Service area",
      body_markdown: "This service covers Toronto and the surrounding area.",
    },
    {
      type: "section",
      key: SERVICE_PAGE_SECTION_KEYS.finalCta,
      heading: "Next step",
      body_markdown: "A lawyer reviews the brief.\n\n**Submit for review**",
    },
    {
      type: "faq_block",
      key: SERVICE_PAGE_SECTION_KEYS.faqBlock,
      items: [
        {
          question: "Do I need a lawyer to review a commercial lease in Ontario?",
          answer: "A commercial lease is negotiable before signature and difficult to renegotiate after.",
        },
        {
          question: "What does the review check?",
          answer: "The relocation, assignment, and repair clauses.",
        },
      ],
    },
  ];
}

function goodSeoMetadata(): Record<string, unknown> {
  return {
    generated_at: new Date().toISOString(),
    title: "Commercial Lease Review, Ontario",
    internal_links_used: [{ url: "https://drglaw.ca/resources/x", anchor_text: "the checklist" }],
    schema: {
      legal_service: { "@type": "LegalService" },
      person: { "@type": "Person" },
      faq_page: { "@type": "FAQPage" },
      breadcrumb_list: { "@type": "BreadcrumbList" },
    },
  };
}

function goodContext() {
  return {
    primaryQuery: PRIMARY_QUERY,
    answerSummary: "A lawyer reviews the relocation, assignment, and repair clauses before you sign.",
    jurisdiction: "Ontario",
    serviceArea: ["Toronto"],
    internalLinkTargets: [{ url: "https://drglaw.ca/resources/x", anchor_text_hint: "the checklist" }],
    title: "Commercial Lease Review, Ontario",
  };
}

describe("runCanonicalServicePageValidators (integration)", () => {
  it("passes a well-formed canonical service page on every check", () => {
    const results = runCanonicalServicePageValidators(goodBlocks(), goodSeoMetadata(), goodContext());
    const failing = results.filter((r) => r.status !== "pass");
    expect(failing).toEqual([]);
  });

  it("surfaces multiple independent failures on a broken page without one masking another", () => {
    const blocks = goodBlocks().map((b) =>
      b.key === SERVICE_PAGE_SECTION_KEYS.authorBio && b.type === "section" ? { ...b, body_markdown: "" } : b
    );
    const results = runCanonicalServicePageValidators(blocks, undefined, goodContext());
    const failingKeys = results.filter((r) => r.status === "fail").map((r) => r.key);
    expect(failingKeys).toContain("named_author_present");
    expect(failingKeys).toContain("last_updated_visible");
    expect(failingKeys).toContain("schema_directives_present");
  });
});

describe("validateNamedAuthorPresent", () => {
  it("passes when the author bio block is populated", () => {
    expect(validateNamedAuthorPresent(goodBlocks()).status).toBe("pass");
  });

  it("fails when the author bio block is empty", () => {
    const blocks = goodBlocks().map((b) =>
      b.key === SERVICE_PAGE_SECTION_KEYS.authorBio && b.type === "section" ? { ...b, body_markdown: "" } : b
    );
    const result = validateNamedAuthorPresent(blocks);
    expect(result.status).toBe("fail");
  });

  it("fails when the author bio block is missing entirely", () => {
    const blocks = goodBlocks().filter((b) => b.key !== SERVICE_PAGE_SECTION_KEYS.authorBio);
    expect(validateNamedAuthorPresent(blocks).status).toBe("fail");
  });
});

describe("validateFaqBlockPresent", () => {
  it("passes with 2+ complete question/answer pairs", () => {
    expect(validateFaqBlockPresent(goodBlocks()).status).toBe("pass");
  });

  it("fails when the FAQ block has fewer than 2 items", () => {
    const blocks = goodBlocks().map((b) =>
      b.type === "faq_block" ? { ...b, items: [b.items[0]] } : b
    );
    expect(validateFaqBlockPresent(blocks).status).toBe("fail");
  });

  it("fails when the FAQ block is missing entirely", () => {
    const blocks = goodBlocks().filter((b) => b.type !== "faq_block");
    expect(validateFaqBlockPresent(blocks).status).toBe("fail");
  });

  it("fails when a FAQ item has an empty answer", () => {
    const blocks = goodBlocks().map((b) =>
      b.type === "faq_block"
        ? { ...b, items: [b.items[0], { question: "A question?", answer: "" }] }
        : b
    );
    expect(validateFaqBlockPresent(blocks).status).toBe("fail");
  });
});

describe("validateAnswerInTop30Percent", () => {
  it("passes when the query overlaps the opening content", () => {
    const result = validateAnswerInTop30Percent(goodBlocks(), PRIMARY_QUERY);
    expect(result.status).toBe("pass");
  });

  it("passes with no findings when no query or answer summary is supplied", () => {
    expect(validateAnswerInTop30Percent(goodBlocks(), undefined, undefined).status).toBe("pass");
  });

  it("fails when the answer is buried: the on-topic content only appears in the last block, well past the first 30%", () => {
    // Built from scratch rather than overriding goodBlocks(): goodBlocks()'s
    // later sections (qualification mentions "commercial lease", authorBio
    // mentions "Ontario") would leak into the top-30% window once the
    // shortened opening blocks are small enough for the window to reach past
    // them, producing a false partial match instead of a clean zero.
    const filler = (n: number) =>
      `This is general placeholder paragraph number ${n} that does not reference the specific topic at hand in any way.`;
    const buried: ServicePageBlock[] = [
      { type: "h1", key: SERVICE_PAGE_SECTION_KEYS.h1, line1: "General legal information", line2: "read on for details" },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.firstParagraph, body_markdown: filler(1) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.qualification, heading: "Section two", body_markdown: filler(2) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.whatIsAtStake, heading: "Section three", body_markdown: filler(3) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.authorBio, body_markdown: "Some Lawyer, general practice." },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.howTheProcessWorks, heading: "Section four", body_markdown: filler(4) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.criticalInformation, heading: "Section five", body_markdown: filler(5) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.feesAndExpectations, heading: "Section six", body_markdown: filler(6) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.differentiation, heading: "Section seven", body_markdown: filler(7) },
      { type: "section", key: SERVICE_PAGE_SECTION_KEYS.serviceAreaCoverage, heading: "Section eight", body_markdown: filler(8) },
      {
        type: "section",
        key: SERVICE_PAGE_SECTION_KEYS.finalCta,
        heading: "Finally, the actual topic",
        body_markdown: "Only here, at the very end, does the page mention a commercial lease review in Ontario.",
      },
      {
        type: "faq_block",
        key: SERVICE_PAGE_SECTION_KEYS.faqBlock,
        items: [
          { question: "Do I need a lawyer to review a commercial lease in Ontario?", answer: "Yes." },
          { question: "What does the review check?", answer: "The key clauses." },
        ],
      },
    ];
    const result = validateAnswerInTop30Percent(buried, PRIMARY_QUERY);
    expect(result.status).toBe("fail");
  });
});

describe("validateLastUpdatedDateVisible", () => {
  it("passes with a valid ISO date in seo_metadata.generated_at", () => {
    expect(validateLastUpdatedDateVisible(goodSeoMetadata()).status).toBe("pass");
  });

  it("fails when seo_metadata is undefined", () => {
    expect(validateLastUpdatedDateVisible(undefined).status).toBe("fail");
  });

  it("fails when generated_at is missing", () => {
    const { generated_at, ...rest } = goodSeoMetadata();
    void generated_at;
    expect(validateLastUpdatedDateVisible(rest).status).toBe("fail");
  });

  it("fails when generated_at is not a parseable date", () => {
    expect(validateLastUpdatedDateVisible({ generated_at: "not a date" }).status).toBe("fail");
  });
});

describe("validatePrimaryQueryPresence", () => {
  it("passes when the query appears naturally in the H1/title/intro", () => {
    const result = validatePrimaryQueryPresence(goodBlocks(), PRIMARY_QUERY, "Commercial Lease Review, Ontario");
    expect(result.status).toBe("pass");
  });

  it("passes with no findings when no primary query is supplied", () => {
    expect(validatePrimaryQueryPresence(goodBlocks(), undefined, undefined).status).toBe("pass");
  });

  it("fails when the query has no overlap with the H1, title, or intro", () => {
    const blocks = goodBlocks().map((b) => {
      if (b.key === SERVICE_PAGE_SECTION_KEYS.h1 && b.type === "h1") {
        return { ...b, line1: "Something else entirely", line2: "unrelated to the query" };
      }
      if (b.key === SERVICE_PAGE_SECTION_KEYS.firstParagraph && b.type === "section") {
        return { ...b, body_markdown: "Nothing here relates to the topic in question." };
      }
      return b;
    });
    const result = validatePrimaryQueryPresence(blocks, PRIMARY_QUERY, "Unrelated Title");
    expect(result.status).toBe("fail");
  });

  it("warns when the exact query phrase is repeated unnaturally often (keyword stuffing)", () => {
    const stuffed = goodBlocks().map((b) =>
      b.key === SERVICE_PAGE_SECTION_KEYS.criticalInformation && b.type === "section"
        ? {
            ...b,
            body_markdown: `${PRIMARY_QUERY}. ${PRIMARY_QUERY} matters. Every ${PRIMARY_QUERY} should start here. ${PRIMARY_QUERY} again.`,
          }
        : b
    );
    const result = validatePrimaryQueryPresence(stuffed, PRIMARY_QUERY, "Commercial Lease Review, Ontario");
    expect(result.status).toBe("warn");
    expect(result.findings.some((f) => f.message.toLowerCase().includes("stuffing"))).toBe(true);
  });
});

describe("validateJurisdictionAndServiceAreaEarly", () => {
  it("passes when the jurisdiction appears in the H1 or opening paragraph", () => {
    const result = validateJurisdictionAndServiceAreaEarly(goodBlocks(), "Ontario", ["Toronto"]);
    expect(result.status).toBe("pass");
  });

  it("passes with no findings when neither jurisdiction nor service area is supplied", () => {
    expect(validateJurisdictionAndServiceAreaEarly(goodBlocks(), undefined, undefined).status).toBe("pass");
  });

  it("fails when the jurisdiction never appears on the page at all", () => {
    // goodBlocks()'s authorBio ("Law Society of Ontario") and FAQ question
    // ("...commercial lease in Ontario?") both mention the jurisdiction too,
    // so a true absence test has to clear those blocks as well, not just the
    // opening paragraph.
    const blocks = goodBlocks().map((b) => {
      if (b.key === SERVICE_PAGE_SECTION_KEYS.h1 && b.type === "h1") {
        return { ...b, line1: "Commercial leases put risk on the tenant", line2: "a lawyer catches it" };
      }
      if (b.key === SERVICE_PAGE_SECTION_KEYS.firstParagraph && b.type === "section") {
        return {
          ...b,
          body_markdown: "A lawyer reviews the relocation and assignment clauses before you sign.",
        };
      }
      if (b.key === SERVICE_PAGE_SECTION_KEYS.authorBio && b.type === "section") {
        return {
          ...b,
          body_markdown: "Damaris Regina Guimaraes, lawyer.\n\nLaw Society member 91022I\n\nA short narrative bio.",
        };
      }
      if (b.type === "faq_block") {
        return {
          ...b,
          items: [
            { question: "Do I need a lawyer to review a commercial lease?", answer: "A commercial lease is negotiable before signature." },
            b.items[1],
          ],
        };
      }
      return b;
    });
    const result = validateJurisdictionAndServiceAreaEarly(blocks, "Ontario", undefined);
    expect(result.status).toBe("fail");
  });

  it("warns when the jurisdiction appears on the page but not early", () => {
    const blocks = goodBlocks().map((b) => {
      if (b.key === SERVICE_PAGE_SECTION_KEYS.h1 && b.type === "h1") {
        return { ...b, line1: "Commercial leases put risk on the tenant", line2: "a lawyer catches it" };
      }
      if (b.key === SERVICE_PAGE_SECTION_KEYS.firstParagraph && b.type === "section") {
        return {
          ...b,
          body_markdown: "A lawyer reviews the relocation and assignment clauses before you sign.",
        };
      }
      if (b.key === SERVICE_PAGE_SECTION_KEYS.criticalInformation && b.type === "section") {
        return { ...b, body_markdown: "This applies to leases governed by Ontario law." };
      }
      return b;
    });
    const result = validateJurisdictionAndServiceAreaEarly(blocks, "Ontario", undefined);
    expect(result.status).toBe("warn");
  });

  it("warns when a supplied service area is absent from the page", () => {
    const result = validateJurisdictionAndServiceAreaEarly(goodBlocks(), "Ontario", ["Ottawa"]);
    expect(result.status).toBe("warn");
  });
});

describe("validateInternalLinksPresent", () => {
  it("passes when targets were offered and at least one was used", () => {
    const result = validateInternalLinksPresent(
      [{ url: "https://drglaw.ca/resources/x", anchor_text_hint: "the checklist" }],
      goodSeoMetadata()
    );
    expect(result.status).toBe("pass");
  });

  it("passes with no findings when no targets were ever offered", () => {
    expect(validateInternalLinksPresent(undefined, goodSeoMetadata()).status).toBe("pass");
  });

  it("warns when targets were offered but none were used", () => {
    const result = validateInternalLinksPresent(
      [{ url: "https://drglaw.ca/resources/x", anchor_text_hint: "the checklist" }],
      { ...goodSeoMetadata(), internal_links_used: [] }
    );
    expect(result.status).toBe("warn");
  });

  it("warns when targets were offered and seo_metadata is undefined", () => {
    const result = validateInternalLinksPresent(
      [{ url: "https://drglaw.ca/resources/x", anchor_text_hint: "the checklist" }],
      undefined
    );
    expect(result.status).toBe("warn");
  });
});

describe("validateFaqQuestionsAreQuestionShaped", () => {
  it("passes when every FAQ item ends with a question mark", () => {
    expect(validateFaqQuestionsAreQuestionShaped(goodBlocks()).status).toBe("pass");
  });

  it("warns on a statement-shaped FAQ heading", () => {
    const blocks = goodBlocks().map((b) =>
      b.type === "faq_block"
        ? {
            ...b,
            items: [
              { question: "Commercial lease reviews explained", answer: "Some answer." },
              b.items[1],
            ],
          }
        : b
    );
    const result = validateFaqQuestionsAreQuestionShaped(blocks);
    expect(result.status).toBe("warn");
  });
});

describe("validateSchemaDirectivesPresent", () => {
  it("passes when all four required schema blocks are present", () => {
    expect(validateSchemaDirectivesPresent(goodSeoMetadata()).status).toBe("pass");
  });

  it("fails when seo_metadata is undefined", () => {
    expect(validateSchemaDirectivesPresent(undefined).status).toBe("fail");
  });

  it("fails when a required schema block is missing", () => {
    const meta = goodSeoMetadata();
    const schema = meta.schema as Record<string, unknown>;
    const { faq_page, ...restOfSchema } = schema;
    void faq_page;
    meta.schema = restOfSchema;
    const result = validateSchemaDirectivesPresent(meta);
    expect(result.status).toBe("fail");
    expect(result.findings[0].message).toContain("faq_page");
  });
});

describe("Markdown-format SEO/AEO validators (Step 5 retrofit)", () => {
  describe("validateAnswerInTop30PercentText", () => {
    it("passes (no-op) when neither primaryQuery nor answerSummary is supplied", () => {
      const result = validateAnswerInTop30PercentText("Any text at all.");
      expect(result.status).toBe("pass");
      expect(result.findings).toHaveLength(0);
    });

    it("passes when the query overlaps the opening 30%", () => {
      const text =
        "Ontario commercial leases put the relocation risk on the tenant unless the lease says otherwise. " +
        "A lawyer reviews the relocation clause before you sign.\n\n" +
        "Filler paragraph one that does not add new on-topic words. ".repeat(20);
      const result = validateAnswerInTop30PercentText(text, "commercial lease relocation risk Ontario");
      expect(result.status).toBe("pass");
    });

    it("fails when the answer is buried well past the first 30%", () => {
      const filler = "General filler paragraph with no on-topic words whatsoever. ".repeat(60);
      const text = `${filler}\n\nOnly here does the piece mention a commercial lease review in Ontario.`;
      const result = validateAnswerInTop30PercentText(text, "commercial lease review Ontario");
      expect(result.status).toBe("fail");
    });
  });

  describe("validatePrimaryQueryPresenceText", () => {
    it("passes (no-op) when primaryQuery is not supplied", () => {
      const result = validatePrimaryQueryPresenceText("Any text at all.");
      expect(result.status).toBe("pass");
      expect(result.findings).toHaveLength(0);
    });

    it("passes when the query appears in the heading/opening", () => {
      const text =
        "# Commercial Lease Review, Ontario\n\nA lawyer reviews the commercial lease before you sign.";
      const result = validatePrimaryQueryPresenceText(text, "commercial lease review Ontario");
      expect(result.status).toBe("pass");
    });

    it("fails when the query has no overlap anywhere near the heading/opening", () => {
      const text = "# Unrelated Title\n\nSomething else entirely, unrelated to the query.";
      const result = validatePrimaryQueryPresenceText(text, "commercial lease review Ontario");
      expect(result.status).toBe("fail");
    });

    it("warns on unnatural keyword stuffing (exact phrase repeated 3+ times)", () => {
      const phrase = "commercial lease review Ontario";
      const text = `# ${phrase}\n\n${phrase} is important. ${phrase} matters. Consider a ${phrase} soon.`;
      const result = validatePrimaryQueryPresenceText(text, phrase);
      expect(result.status).toBe("warn");
      expect(result.findings.some((f) => f.message.includes("stuffing"))).toBe(true);
    });
  });

  describe("validateJurisdictionServiceAreaEarlyText", () => {
    it("passes (no-op) when neither jurisdiction nor serviceArea is supplied", () => {
      const result = validateJurisdictionServiceAreaEarlyText("Any text at all.");
      expect(result.status).toBe("pass");
      expect(result.findings).toHaveLength(0);
    });

    it("passes when the jurisdiction appears within the first 30%", () => {
      const text = "This page is about Ontario commercial leases. " + "Filler content. ".repeat(30);
      const result = validateJurisdictionServiceAreaEarlyText(text, "Ontario");
      expect(result.status).toBe("pass");
    });

    it("fails when the jurisdiction never appears anywhere", () => {
      const text = "This page never names the province at all. " + "Filler content. ".repeat(30);
      const result = validateJurisdictionServiceAreaEarlyText(text, "Ontario");
      expect(result.status).toBe("fail");
    });

    it("warns when a supplied service area is absent from the piece", () => {
      const text = "This page is about Ontario commercial leases.";
      const result = validateJurisdictionServiceAreaEarlyText(text, "Ontario", "Ottawa");
      expect(result.status).toBe("warn");
    });
  });

  describe("runDeterministicValidators gating", () => {
    function makeMinimalConfig(): ValidatorConfig {
      return {
        banned_vocabulary: [],
        approved_vocabulary: [],
        lso_constraints: [],
        formatting_rules: {
          no_em_dashes: false,
          no_italics: false,
          no_orphan_words: false,
          no_rule_of_three: false,
        },
        format_spec: {},
        format: "counsel_note",
      };
    }

    it("does not add the three new validators when source_brief has none of the new fields", () => {
      const results = runDeterministicValidators("Some draft body text.", makeMinimalConfig(), {
        decision_question: "Should I sign?",
      });
      const keys = results.map((r) => r.key);
      expect(keys).not.toContain("answer_top_30_percent_text");
      expect(keys).not.toContain("primary_query_presence_text");
      expect(keys).not.toContain("jurisdiction_service_area_early_text");
    });

    it("adds the three new validators when the corresponding source_brief fields are present", () => {
      const results = runDeterministicValidators(
        "# Commercial Lease Review, Ontario\n\nA lawyer reviews the commercial lease before you sign.",
        makeMinimalConfig(),
        {
          primary_query: "commercial lease review Ontario",
          jurisdiction: "Ontario",
        }
      );
      const keys = results.map((r) => r.key);
      expect(keys).toContain("answer_top_30_percent_text");
      expect(keys).toContain("primary_query_presence_text");
      expect(keys).toContain("jurisdiction_service_area_early_text");
    });

    it("adds only the relevant one when just service_area (no jurisdiction) is present", () => {
      const results = runDeterministicValidators("Some text about Toronto.", makeMinimalConfig(), {
        service_area: "Toronto",
      });
      const keys = results.map((r) => r.key);
      expect(keys).toContain("jurisdiction_service_area_early_text");
      expect(keys).not.toContain("primary_query_presence_text");
    });
  });
});

describe("validateItalicsMarkup (Ses.16 WP-4 bugfix regression)", () => {
  it("passes clean text with no emphasis markup at all", () => {
    const result = validateItalicsMarkup("Plain text with no emphasis of any kind.");
    expect(result.status).toBe("pass");
  });

  it("does not flag bold (**text**) phrases as italics", () => {
    const result = validateItalicsMarkup(
      "**Share register versus actual ownership.** The register must match. " +
        "**Dividend resolutions versus declared dividends.** Both must align."
    );
    expect(result.status).toBe("pass");
  });

  it("still catches genuine single-asterisk italics", () => {
    const result = validateItalicsMarkup("This word is *truly emphasized* in the sentence.");
    expect(result.status).toBe("fail");
    expect(result.findings[0].message).toContain("1 italic marker");
  });

  it("still catches genuine single-underscore italics", () => {
    const result = validateItalicsMarkup("This word is _truly emphasized_ in the sentence.");
    expect(result.status).toBe("fail");
  });

  it("does not flag bold text written with double underscores", () => {
    const result = validateItalicsMarkup("This is __bold text__ using underscores.");
    expect(result.status).toBe("pass");
  });

  it("still catches <em> and <i> tags and inline italic CSS", () => {
    expect(validateItalicsMarkup("Some <em>emphasized</em> text.").status).toBe("fail");
    expect(validateItalicsMarkup("Some <i>emphasized</i> text.").status).toBe("fail");
    expect(validateItalicsMarkup('<span style="font-style: italic;">text</span>').status).toBe("fail");
  });

  it("counts mixed bold and italic correctly: bold contributes zero, italic contributes one", () => {
    const result = validateItalicsMarkup("**A bold lead-in.** Then *one italic phrase* follows.");
    expect(result.status).toBe("fail");
    expect(result.findings[0].message).toContain("1 italic marker");
  });
});

describe("validateLsoCompliance (Ses.16 WP-4 bugfix regression)", () => {
  it("does not flag 'personal guarantee' as an outcome promise", () => {
    const result = validateLsoCompliance(
      "The personal guarantee survives the assignment unless the lease says otherwise. " +
        "A guarantee is a specific legal instrument, not a promise about the case."
    );
    expect(result.status).toBe("pass");
  });

  it("does not flag 'guarantor' or bare contractual usage", () => {
    const result = validateLsoCompliance(
      "The guarantor's obligations continue. The guarantee clause caps the exposure."
    );
    expect(result.status).toBe("pass");
  });

  it("still catches a first-person outcome guarantee", () => {
    const result = validateLsoCompliance("We guarantee you will win this case.");
    expect(result.status).toBe("fail");
  });

  it("still catches 'guarantee you' as a second-person promise", () => {
    const result = validateLsoCompliance("Our process will guarantee you the best possible result.");
    expect(result.status).toBe("fail");
  });

  it("still catches 'guaranteed to' as a promise construction", () => {
    const result = validateLsoCompliance("This approach is guaranteed to succeed in every case.");
    expect(result.status).toBe("fail");
  });

  it("still catches 'guaranteed results'", () => {
    const result = validateLsoCompliance("We deliver guaranteed results for every client.");
    expect(result.status).toBe("fail");
  });

  it("still catches the pre-existing will-win/will-succeed/will-recover patterns", () => {
    expect(validateLsoCompliance("We will win your case.").status).toBe("fail");
    expect(validateLsoCompliance("You will succeed with our help.").status).toBe("fail");
    expect(validateLsoCompliance("We will recover your losses.").status).toBe("fail");
  });

  it("still catches unverifiable superlatives", () => {
    expect(validateLsoCompliance("We are the best lawyer in Toronto.").status).toBe("fail");
    expect(validateLsoCompliance("Rated the #1 firm in Ontario.").status).toBe("fail");
  });
});

// Ses.17 WP-3: five new validators (SEO/AEO spec Section 8 domain allowlist,
// plus heading/entity/secondary-query/service-area coverage signals) shared
// across both the Markdown battery (runDeterministicValidators) and the
// canonical_service_page structured battery (runCanonicalServicePageValidators).
describe("validateInternalLinkDomains", () => {
  const FIRM_WEBSITE = "https://drglaw.ca";

  it("passes (info) when no internal link targets are supplied", () => {
    const result = validateInternalLinkDomains(undefined, FIRM_WEBSITE);
    expect(result.status).toBe("pass");
  });

  it("passes (info) when the firm has no website on file, even with targets present", () => {
    const result = validateInternalLinkDomains(
      [{ url: "https://anywhere.com/page" }],
      undefined
    );
    expect(result.status).toBe("pass");
  });

  it("passes when every target resolves to the firm's own domain", () => {
    const result = validateInternalLinkDomains(
      [{ url: "https://drglaw.ca/journal/a" }, { url: "https://www.drglaw.ca/journal/b" }],
      FIRM_WEBSITE
    );
    expect(result.status).toBe("pass");
  });

  it("fails when a target resolves to an external domain", () => {
    const result = validateInternalLinkDomains(
      [{ url: "https://competitor-firm.ca/page" }],
      FIRM_WEBSITE
    );
    expect(result.status).toBe("fail");
    expect(result.findings[0].message).toContain("does not resolve to the firm's own domain");
  });

  it("fails on a malformed URL rather than silently passing", () => {
    const result = validateInternalLinkDomains([{ url: "not-a-url" }], FIRM_WEBSITE);
    expect(result.status).toBe("fail");
    expect(result.findings[0].message).toContain("not a valid absolute URL");
  });
});

describe("validateHeadingQueryAlignment", () => {
  it("passes (info) when no client question variants or secondary queries are supplied", () => {
    const result = validateHeadingQueryAlignment("# Some heading\n\nBody.", undefined, undefined);
    expect(result.status).toBe("pass");
  });

  it("does not warn on a legitimate structural heading set that reasonably aligns with the query pool", () => {
    // False-positive guard: real service-page headings ("Fees and what to
    // expect", "How the process works") are structural, not query-mirrors,
    // but the overlap ratio (>=30% of headings share significant words with
    // the pool) should still clear the warn threshold on a well-targeted page.
    const text = [
      "# Commercial Lease Review, Ontario",
      "## Do you have a commercial lease question",
      "## How the process works",
      "## Fees and what to expect",
      "## Commercial lease review checklist",
    ].join("\n\n");
    const result = validateHeadingQueryAlignment(
      text,
      ["Do I need a lawyer for a commercial lease?"],
      ["commercial lease review checklist"]
    );
    expect(result.status).toBe("pass");
  });

  it("warns when almost no heading aligns with the supplied query pool", () => {
    const text = [
      "# Unrelated Topic",
      "## About our office",
      "## Contact information",
      "## Directions and parking",
    ].join("\n\n");
    const result = validateHeadingQueryAlignment(
      text,
      ["commercial lease relocation clause"],
      ["commercial lease assignment clause"]
    );
    expect(result.status).toBe("warn");
  });
});

describe("validateEntityPresent", () => {
  it("passes (info) when no entity names are supplied", () => {
    expect(validateEntityPresent("Some body text.", undefined).status).toBe("pass");
    expect(validateEntityPresent("Some body text.", []).status).toBe("pass");
  });

  it("passes when the firm name appears anywhere in the piece", () => {
    const result = validateEntityPresent(
      "DRG Law Professional Corporation reviews the lease before you sign.",
      ["DRG Law Professional Corporation", "Damaris Regina Guimaraes"]
    );
    expect(result.status).toBe("pass");
  });

  it("passes when the named lawyer (not the firm) appears", () => {
    const result = validateEntityPresent(
      "Damaris Regina Guimaraes reviews the lease before you sign.",
      ["DRG Law Professional Corporation", "Damaris Regina Guimaraes"]
    );
    expect(result.status).toBe("pass");
  });

  it("warns when neither entity name appears anywhere", () => {
    const result = validateEntityPresent(
      "A lawyer reviews the lease before you sign.",
      ["DRG Law Professional Corporation", "Damaris Regina Guimaraes"]
    );
    expect(result.status).toBe("warn");
  });
});

describe("validateSecondaryQueryCoverage", () => {
  it("passes (info) when no secondary queries are supplied", () => {
    expect(validateSecondaryQueryCoverage("Some body text.", undefined).status).toBe("pass");
  });

  it("passes when secondary queries have meaningful overlap with the body", () => {
    const text =
      "A commercial lease review lawyer in Toronto checks the relocation and assignment clauses " +
      "before you sign a commercial lease.";
    const result = validateSecondaryQueryCoverage(text, [
      "commercial lease review lawyer Toronto",
    ]);
    expect(result.status).toBe("pass");
  });

  it("warns when secondary queries share almost no words with the body", () => {
    const result = validateSecondaryQueryCoverage("A short unrelated paragraph about parking.", [
      "commercial lease relocation clause assignment",
    ]);
    expect(result.status).toBe("warn");
  });
});

describe("validateServiceAreaPresence", () => {
  it("passes (info) when no service area is supplied", () => {
    expect(validateServiceAreaPresence("Some body text.", undefined).status).toBe("pass");
  });

  it("passes when every supplied service area appears in the piece", () => {
    const result = validateServiceAreaPresence(
      "This service covers Toronto and the surrounding Greater Toronto Area.",
      ["Toronto"]
    );
    expect(result.status).toBe("pass");
  });

  it("passes when service_area is an array and all entries are present", () => {
    const result = validateServiceAreaPresence(
      "This service covers Toronto and Mississauga.",
      ["Toronto", "Mississauga"]
    );
    expect(result.status).toBe("pass");
  });

  it("warns when a supplied service area does not appear anywhere", () => {
    const result = validateServiceAreaPresence("This service covers Toronto.", ["Ottawa"]);
    expect(result.status).toBe("warn");
  });
});

describe("significantWords", () => {
  it("strips punctuation, lowercases, and drops short/stop words", () => {
    expect(significantWords("Commercial Lease Review, Ontario!")).toEqual([
      "commercial",
      "lease",
      "review",
      "ontario",
    ]);
  });
});

describe("runDeterministicValidators gating (Ses.17 WP-3)", () => {
  function makeMinimalConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
    return {
      banned_vocabulary: [],
      approved_vocabulary: [],
      lso_constraints: [],
      formatting_rules: {
        no_em_dashes: false,
        no_italics: false,
        no_orphan_words: false,
        no_rule_of_three: false,
      },
      format_spec: {},
      format: "counsel_note",
      ...overrides,
    };
  }

  it("does not add any WP-3 validator when none of the corresponding fields are present", () => {
    const results = runDeterministicValidators("Some draft body text.", makeMinimalConfig(), {
      decision_question: "Should I sign?",
    });
    const keys = results.map((r) => r.key);
    expect(keys).not.toContain("heading_query_alignment");
    expect(keys).not.toContain("secondary_query_coverage");
    expect(keys).not.toContain("service_area_presence");
    expect(keys).not.toContain("internal_link_domain_allowlist");
    expect(keys).not.toContain("entity_present");
  });

  it("adds heading_query_alignment and secondary_query_coverage when secondary_queries is present", () => {
    const results = runDeterministicValidators(
      "# Commercial Lease Review\n\nBody.",
      makeMinimalConfig(),
      { secondary_queries: ["commercial lease review"] }
    );
    const keys = results.map((r) => r.key);
    expect(keys).toContain("heading_query_alignment");
    expect(keys).toContain("secondary_query_coverage");
  });

  it("adds service_area_presence when service_area is present", () => {
    const results = runDeterministicValidators("Body about Toronto.", makeMinimalConfig(), {
      service_area: "Toronto",
    });
    expect(results.map((r) => r.key)).toContain("service_area_presence");
  });

  it("adds internal_link_domain_allowlist only when internal_link_targets is non-empty, using config.firm_website", () => {
    const withTargets = runDeterministicValidators(
      "Body text.",
      makeMinimalConfig({ firm_website: "https://drglaw.ca" }),
      { internal_link_targets: [{ url: "https://drglaw.ca/x" }] }
    );
    expect(withTargets.map((r) => r.key)).toContain("internal_link_domain_allowlist");

    const withoutTargets = runDeterministicValidators(
      "Body text.",
      makeMinimalConfig({ firm_website: "https://drglaw.ca" }),
      {}
    );
    expect(withoutTargets.map((r) => r.key)).not.toContain("internal_link_domain_allowlist");
  });

  it("adds entity_present only when config.entity_names is populated, independent of sourceBrief", () => {
    const withEntities = runDeterministicValidators(
      "DRG Law reviews the lease.",
      makeMinimalConfig({ entity_names: ["DRG Law"] })
    );
    expect(withEntities.map((r) => r.key)).toContain("entity_present");

    const withoutEntities = runDeterministicValidators("Some text.", makeMinimalConfig());
    expect(withoutEntities.map((r) => r.key)).not.toContain("entity_present");
  });
});

describe("runCanonicalServicePageValidators firmWebsite wiring (Ses.17 WP-3)", () => {
  it("passes internal_link_domain_allowlist when every link resolves to the firm's own domain", () => {
    const results = runCanonicalServicePageValidators(goodBlocks(), goodSeoMetadata(), {
      ...goodContext(),
      firmWebsite: "https://drglaw.ca",
    });
    const domainResult = results.find((r) => r.key === "internal_link_domain_allowlist");
    expect(domainResult?.status).toBe("pass");
  });

  it("fails internal_link_domain_allowlist when a link resolves to an external domain", () => {
    const results = runCanonicalServicePageValidators(goodBlocks(), goodSeoMetadata(), {
      ...goodContext(),
      internalLinkTargets: [{ url: "https://a-different-law-firm.ca/page" }],
      firmWebsite: "https://drglaw.ca",
    });
    const domainResult = results.find((r) => r.key === "internal_link_domain_allowlist");
    expect(domainResult?.status).toBe("fail");
  });
});

// Ses.17 WP-4: Portuguese authoring's reduced, language-neutral validator
// battery. Deliberately does NOT reuse validateLsoCompliance / opening-
// discipline / banned-vocabulary against Portuguese text, since those match
// specific English phrasing and would be noise pretending to be assurance.
describe("validatePtJurisdictionDisclosure", () => {
  it("passes when the text names Ontário (accented)", () => {
    const result = validatePtJurisdictionDisclosure(
      "Este texto trata de um contrato de locacao comercial em Ontário."
    );
    expect(result.status).toBe("pass");
  });

  it("passes when the text names Ontario (unaccented, e.g. inside a proper noun)", () => {
    const result = validatePtJurisdictionDisclosure(
      "A DRG Law atua em direito de Ontario, sem excecoes."
    );
    expect(result.status).toBe("pass");
  });

  it("warns when neither Ontario nor Ontário appears anywhere", () => {
    const result = validatePtJurisdictionDisclosure(
      "Este texto trata de um contrato de locacao comercial sem mencionar a provincia."
    );
    expect(result.status).toBe("warn");
  });
});

describe("runPtValidators", () => {
  function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
    return {
      banned_vocabulary: [],
      approved_vocabulary: [],
      lso_constraints: [],
      formatting_rules: {
        no_em_dashes: true,
        no_italics: true,
        no_orphan_words: true,
        no_rule_of_three: true,
      },
      format_spec: { word_range: [100, 200] },
      format: "counsel_note",
      ...overrides,
    };
  }

  it("runs only the language-neutral structural checks plus the PT jurisdiction check", () => {
    const text = "Este e um texto de exemplo em Ontario, sem problemas de formatacao. ".repeat(3);
    const results = runPtValidators(text, makeConfig());
    const keys = results.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "em_dash",
        "italics_markup",
        "orphan_words",
        "word_count",
        "rule_of_three",
        "pt_jurisdiction_disclosure",
      ])
    );
    // Explicitly NOT the English-pattern checks.
    expect(keys).not.toContain("banned_vocabulary");
    expect(keys).not.toContain("lso_compliance");
    expect(keys).not.toContain("opening_discipline");
  });

  it("respects formatting_rules gating, same as the EN battery", () => {
    const results = runPtValidators("Texto em Ontario.", makeConfig({
      formatting_rules: {
        no_em_dashes: false,
        no_italics: false,
        no_orphan_words: false,
        no_rule_of_three: false,
      },
      format_spec: {},
    }));
    const keys = results.map((r) => r.key);
    expect(keys).not.toContain("em_dash");
    expect(keys).not.toContain("italics_markup");
    expect(keys).not.toContain("orphan_words");
    expect(keys).not.toContain("word_count");
    expect(keys).not.toContain("rule_of_three");
    expect(keys).toContain("pt_jurisdiction_disclosure");
  });

  it("still catches a banned punctuation mark in Portuguese text (language-neutral check)", () => {
    const bannedChar = String.fromCharCode(8212); // em dash, built at runtime to keep the literal out of source
    const results = runPtValidators(
      `Este texto tem um travessao ${bannedChar} que nao deveria estar aqui, em Ontario.`,
      makeConfig()
    );
    const emDash = results.find((r) => r.key === "em_dash");
    expect(emDash?.status).toBe("fail");
  });
});
