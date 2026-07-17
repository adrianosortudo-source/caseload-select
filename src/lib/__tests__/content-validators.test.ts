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
  validateSourceIntegrity,
  validateNegativeReviewResponse,
  validateReviewRequest,
  validateReviewRequestCasl,
  runSharedTextComplianceFloor,
  validateStructuralMonotony,
  extractProseUnits,
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

describe("validateStructuralMonotony", () => {
  // Real DRG Law human-edited prose (drg-law-website /about, 2026-07-10
  // calibration corpus): sentence CV 0.358, longest similar run 3, paragraph
  // CV 0.281. Sits comfortably above every warn floor.
  const HUMAN_PROSE = `Damaris Regina Guimaraes helps business owners understand the legal risk, cost, timeline, and next step before they sign, close, transfer, or commit.

Her work covers business, real estate, contracts, and the owner decisions that need clear written advice before the document moves. Every matter ends in one short written note the owner can read, share with the accountant, and act on.

She runs DRG Law from Ontario by video, phone, or at the client's location.

Live files carry a written status the owner can read at any time. For windows when Damaris is away, DRG Law arranges coverage with named co-counsel. The handoff is short, named, and time-limited.

Before founding DRG Law in Ontario, Damaris trained and practised law in Brazil. That background supports her work with clients who need clear legal explanation in English or Portuguese, but the practice itself is focused on Ontario law.

Damaris begins with what the owner needs to decide: buy, sell, lease, incorporate, transfer, finance, protect, or wait. The legal work follows the decision, not the other way around.

She explains the risk, cost, timeline, and tradeoff early enough for the client to act before signing, closing, or restructuring. No surprises after the document moves.

Every matter is written down in plain English or Portuguese so the client knows what happens next, who is doing what, and by when.`;

  // Synthetic AI-flattened counterpart on the same topic: uniform 13-19 word
  // sentences, uniform 2-sentence paragraphs. Calibration corpus: sentence CV
  // 0.076, longest similar run 16, paragraph CV 0.023.
  const FLATTENED_PROSE = `DRG Law helps business owners understand legal risk before they sign any major contract or agreement. The firm reviews leases, contracts, and transfers so owners know their exposure clearly.

Every matter receives a written summary that owners can share with their accountant or financial advisor. The firm explains timelines and costs so owners can plan their next steps confidently.

DRG Law operates from Ontario and serves clients through video calls, phone calls, and in-person meetings. The firm maintains clear communication throughout every matter from intake through resolution and closing.

When the lawyer is away, coverage is arranged through named co-counsel who understand the file. Clients always have a clear point of contact and a written status update available.

The firm trained across two legal systems, which supports bilingual client communication in two languages. This background helps clients who need explanations in English or Portuguese for their matters.

Every engagement begins with a clear discussion of what decision the client actually needs to make. The legal work then follows that decision rather than following a generic legal process.

The firm explains risk, cost, and timeline early so clients can act before committing to anything. This approach avoids surprises after documents are signed or transactions are finalized completely.

Every matter concludes with a written note explaining next steps and responsibilities for all parties. Clients always know what happens next and who is responsible for each task.`;

  it("passes clean on real human-edited prose (calibration floor)", () => {
    const result = validateStructuralMonotony(HUMAN_PROSE);
    expect(result.status).toBe("pass");
    expect(result.findings).toHaveLength(0);
  });

  it("warns on all three metrics for synthetically flattened prose", () => {
    const result = validateStructuralMonotony(FLATTENED_PROSE);
    expect(result.status).toBe("warn");
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    const messages = result.findings.map((f) => f.message).join(" ");
    expect(messages).toMatch(/rhythm is flat/);
    expect(messages).toMatch(/consecutive sentences/);
    expect(messages).toMatch(/[Pp]aragraph length is uniform/);
  });

  it("passes with an info finding when the sample is too small to measure", () => {
    const result = validateStructuralMonotony(
      "This is one short piece.\n\nIt only has two paragraphs and three sentences. That is not enough to measure rhythm reliably."
    );
    expect(result.status).toBe("pass");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toMatch(/[Ss]ample too small/);
  });

  it("does not flag a locally flat run when the global variance is healthy (run detection)", () => {
    // Eight near-identical 16-word sentences (a locally flat run, above the
    // 7-sentence run ceiling) followed by a handful of sharply varied
    // sentences. Global CV alone could pass this by averaging the flat run
    // against the varied tail; the run check must still catch it independently.
    const flatRun = Array.from(
      { length: 8 },
      (_, i) => `This is sentence number ${i} and it runs to about fifteen words in total length here.`
    ).join(" ");
    const variedTail =
      "Short one. " +
      "This next sentence stretches out considerably longer to break the pattern the run established earlier on. " +
      "Brief. " +
      "One more mid-length sentence to round out the paragraph naturally.";
    const text = `${flatRun}\n\n${variedTail}\n\nA third paragraph adds enough bulk to clear the paragraph-count floor for this test case here.\n\nA fourth paragraph, short.`;
    const result = validateStructuralMonotony(text);
    expect(result.status).toBe("warn");
    expect(result.findings.some((f) => f.message.includes("consecutive sentences"))).toBe(true);
  });
});

describe("extractProseUnits (segmentation guards)", () => {
  it("does not split on a statute citation like 'Rule 4.2-1'", () => {
    const { sentences } = extractProseUnits(
      "The engine follows LSO Rule 4.2-1 in every generated piece. It never makes an outcome promise. This keeps the content compliant across every format the firm publishes today."
    );
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toContain("Rule 4.2-1");
  });

  it("does not split on an abbreviated citation like 's. 7'", () => {
    const { sentences } = extractProseUnits(
      "The obligation is set out in s. 7 of the governing statute. A lawyer reviews the section before advising the client on next steps."
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain("s. 7");
  });

  it("does not split on a corporate abbreviation like 'Inc.'", () => {
    const { sentences } = extractProseUnits(
      "The lease was signed by Acme Holdings Inc. before the amendment took effect. The tenant later disputed the assignment clause in writing."
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain("Inc.");
  });

  it("excludes headings, numbered list items, and FAQ-shaped questions from measurement", () => {
    const text =
      "## Commercial Lease Review\n\n" +
      "1. Submit the lease for review by counsel.\n" +
      "2. Receive a written summary of the risk points identified.\n\n" +
      "### Frequently asked questions\n\n" +
      "**Do I need a lawyer to review my lease?**\n\n" +
      "A review before signing identifies clauses that shift cost or liability onto the tenant while changes are still possible to negotiate.";
    const { sentences, paragraphs } = extractProseUnits(text);
    expect(paragraphs.some((p) => p.startsWith("##"))).toBe(false);
    expect(paragraphs.some((p) => /^\d+[.)]\s/.test(p))).toBe(false);
    expect(paragraphs.some((p) => /^\*\*[^*]+\*\*$/.test(p))).toBe(false);
    expect(sentences.some((s) => s.includes("A review before signing"))).toBe(true);
  });
});

describe("structural_monotony wiring across the three battery runners", () => {
  function minimalConfig(overrides?: Partial<ValidatorConfig["formatting_rules"]>): ValidatorConfig {
    return {
      banned_vocabulary: [],
      approved_vocabulary: [],
      lso_constraints: [],
      formatting_rules: {
        no_em_dashes: false,
        no_italics: false,
        no_orphan_words: false,
        no_rule_of_three: false,
        ...overrides,
      },
      format_spec: {},
      format: "counsel_note",
    };
  }

  it("runs by default inside runDeterministicValidators (Markdown formats)", () => {
    const results = runDeterministicValidators("Some draft body text with a few sentences in it.", minimalConfig());
    expect(results.map((r) => r.key)).toContain("structural_monotony");
  });

  it("runs by default inside runSharedTextComplianceFloor (canonical_service_page)", () => {
    const results = runSharedTextComplianceFloor("Some flattened structured-page text.", minimalConfig());
    expect(results.map((r) => r.key)).toContain("structural_monotony");
  });

  it("runs by default inside runPtValidators (Portuguese, punctuation-based only)", () => {
    const results = runPtValidators("Algum texto em português para o teste de validação.", minimalConfig());
    expect(results.map((r) => r.key)).toContain("structural_monotony");
  });

  it("can be opted out per-piece via no_structural_monotony: false", () => {
    const results = runDeterministicValidators(
      "Some draft body text.",
      minimalConfig({ no_structural_monotony: false })
    );
    expect(results.map((r) => r.key)).not.toContain("structural_monotony");
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

// Ses.17 WP-5: found live during the paid_traffic_landing/review_request
// prod smoke test. validateSourceIntegrity ran unconditionally for every
// format with a source_brief, requiring decision_question/legal_distinction/
// consequence even for the three compliance formats that don't use that
// brief shape at all (a clean review_request draft failed for fields the
// format was never designed around).
describe("validateSourceIntegrity (Ses.17 WP-5 format gating)", () => {
  it("still requires the three fields for a decision-document format like counsel_note", () => {
    const result = validateSourceIntegrity({}, "counsel_note");
    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(3);
  });

  it("still requires the three fields when format is omitted (backward compatible default)", () => {
    const result = validateSourceIntegrity({});
    expect(result.status).toBe("fail");
  });

  it("passes (info) for paid_traffic_landing regardless of the three fields being present", () => {
    expect(validateSourceIntegrity({}, "paid_traffic_landing").status).toBe("pass");
  });

  it("passes (info) for review_request regardless of the three fields being present", () => {
    expect(validateSourceIntegrity({}, "review_request").status).toBe("pass");
  });

  it("passes (info) for review_response regardless of the three fields being present", () => {
    expect(validateSourceIntegrity({}, "review_response").status).toBe("pass");
  });

  it("passes when all three fields are present, for a decision-document format", () => {
    const result = validateSourceIntegrity(
      {
        decision_question: "Should I sign?",
        legal_distinction: "Commercial leases are not consumer-protected.",
        consequence: "A costly move can be forced.",
      },
      "counsel_note"
    );
    expect(result.status).toBe("pass");
  });
});

// Ses.17 WP-5: first real test coverage for these two pre-existing
// validators, retrofitted the moment paid_traffic_landing/review_request/
// review_response could actually draft and reach them. The switch-channels
// regression below is the exact false-negative the WP-5 prod smoke test hit.
describe("validateNegativeReviewResponse", () => {
  it("passes (info) when format is not a review_response format", () => {
    expect(validateNegativeReviewResponse("Anything at all.", "counsel_note").status).toBe("pass");
  });

  it("fails when the response confirms a client relationship", () => {
    const result = validateNegativeReviewResponse(
      "During your matter, we did everything possible.",
      "review_response"
    );
    expect(result.status).toBe("fail");
  });

  it("fails when the response discloses case facts", () => {
    const result = validateNegativeReviewResponse(
      "The settlement was reached after months of negotiation.",
      "review_response"
    );
    expect(result.status).toBe("fail");
  });

  it("does not warn on a compliant close that paraphrases the switch-channels offer (regression: found live 2026-07-06)", () => {
    const result = validateNegativeReviewResponse(
      "Thank you for sharing this feedback. Professional obligations prevent a substantive public " +
        "response. If you would like to raise specific concerns, please call the office or send an " +
        "email directly to the firm.",
      "review_response"
    );
    expect(result.status).toBe("pass");
  });

  it("still warns when there is no switch-channels offer at all", () => {
    const result = validateNegativeReviewResponse(
      "Thank you for sharing this feedback. Professional obligations prevent a substantive public response.",
      "review_response"
    );
    expect(result.status).toBe("warn");
  });

  it("recognizes the original literal phrasing too (no regression on the prior pattern)", () => {
    expect(
      validateNegativeReviewResponse("Please call the firm to discuss further.", "review_response").status
    ).toBe("pass");
    expect(
      validateNegativeReviewResponse("Please email the firm to discuss further.", "review_response").status
    ).toBe("pass");
  });
});

describe("validateReviewRequest", () => {
  it("passes (info) when format is not a review_request format", () => {
    expect(validateReviewRequest("Free gift card for a review!", "counsel_note").status).toBe("pass");
  });

  it("fails on an incentive offer", () => {
    expect(validateReviewRequest("Leave a review for a gift card.", "review_request").status).toBe("fail");
  });

  it("fails on sentiment-gating", () => {
    expect(
      validateReviewRequest("If you had a great experience, please leave a review.", "review_request").status
    ).toBe("fail");
  });

  it("fails on a staff-name request", () => {
    expect(
      validateReviewRequest("Please mention our rep by name in your review.", "review_request").status
    ).toBe("fail");
  });

  it("passes a plain, unconditional review ask", () => {
    const result = validateReviewRequest(
      "Thank you for trusting the firm with your matter. You are welcome to share your experience through a review. This is optional.",
      "review_request"
    );
    expect(result.status).toBe("pass");
  });
});

// ── Codex audit F7: review_request CASL coverage ──────────────────────────────
describe("validateReviewRequestCasl", () => {
  const compliant = [
    "## Email subject",
    "How was your experience?",
    "## Email body",
    "Thank you for trusting DRG Law Professional Corporation with your matter. You are welcome to leave a review.",
    "DRG Law Professional Corporation, PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8. Call 647-584-0998 or visit drglaw.ca.",
    "To stop receiving these messages, unsubscribe here.",
    "## SMS body",
    "DRG Law: thanks for trusting us. Leave a review: drglaw.ca. Reply STOP to unsubscribe.",
  ].join("\n\n");

  it("passes a fully CASL-compliant review_request (email + sms)", () => {
    const r = validateReviewRequestCasl(compliant, "review_request");
    expect(r.status).toBe("pass");
  });

  it("is a no-op (pass) for a non-review_request format", () => {
    expect(validateReviewRequestCasl(compliant, "counsel_note").status).toBe("pass");
    expect(validateReviewRequestCasl("anything", undefined).status).toBe("pass");
  });

  it("fails when the Email body lacks the mailing address", () => {
    const noAddress = [
      "## Email body",
      "Thanks from DRG Law. Call 647-584-0998. Unsubscribe here.",
      "## SMS body",
      "DRG Law. Reply STOP to unsubscribe.",
    ].join("\n\n");
    const r = validateReviewRequestCasl(noAddress, "review_request");
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => /mailing address/i.test(f.message))).toBe(true);
  });

  it("fails when the Email body lacks an unsubscribe affordance", () => {
    const noUnsub = [
      "## Email body",
      "Thanks from DRG Law, PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8. Call 647-584-0998.",
      "## SMS body",
      "DRG Law. Reply STOP to unsubscribe.",
    ].join("\n\n");
    const r = validateReviewRequestCasl(noUnsub, "review_request");
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => /unsubscribe/i.test(f.message))).toBe(true);
  });

  it("fails when the SMS body lacks STOP/unsubscribe language", () => {
    const noStop = [
      "## Email body",
      "Thanks from DRG Law, PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8. Call 647-584-0998. Unsubscribe here.",
      "## SMS body",
      "DRG Law: thanks, please leave a review at drglaw.ca.",
    ].join("\n\n");
    const r = validateReviewRequestCasl(noStop, "review_request");
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => /SMS body must include STOP/i.test(f.message))).toBe(true);
  });

  it("fails when the SMS body section is missing entirely", () => {
    const noSms = [
      "## Email body",
      "Thanks from DRG Law, PO Box 26033 RPO Broadway, Toronto, ON M4P 0A8. Call 647-584-0998. Unsubscribe here.",
    ].join("\n\n");
    const r = validateReviewRequestCasl(noSms, "review_request");
    expect(r.status).toBe("fail");
    expect(r.findings.some((f) => /missing an 'SMS body'/i.test(f.message))).toBe(true);
  });
});

// ── Codex audit F4: shared text-compliance floor (used by canonical pages) ────
describe("runSharedTextComplianceFloor", () => {
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
      format_spec: {},
      format: "canonical_service_page",
      ...overrides,
    };
  }

  it("catches a timing promise buried in flattened canonical text", () => {
    const text =
      "We review your commercial lease in Ontario. Our intake coordinator will respond promptly to every inquiry.";
    const results = runSharedTextComplianceFloor(text, makeConfig());
    const timing = results.find((r) => r.key === "timing_promise");
    expect(timing?.status).toBe("fail");
  });

  it("catches a US trust badge in canonical text", () => {
    const results = runSharedTextComplianceFloor("We are BBB accredited and Avvo rated.", makeConfig());
    const badge = results.find((r) => r.key === "no_us_trust_badge");
    expect(badge?.status).toBe("fail");
  });

  it("includes the core LSO/brand keys and excludes Markdown-structural checks", () => {
    const keys = runSharedTextComplianceFloor("Plain compliant Ontario legal information.", makeConfig()).map(
      (r) => r.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "banned_vocabulary",
        "lso_compliance",
        "timing_promise",
        "specialist_self_designation",
        "factual_claim",
        "no_us_trust_badge",
        "no_lsa_quality_claim",
      ]),
    );
    // Structural / SEO-field checks belong to the Markdown path, not the floor.
    expect(keys).not.toContain("opening_discipline");
    expect(keys).not.toContain("required_sections");
    expect(keys).not.toContain("page_structure");
  });

  it("passes clean, compliant canonical prose", () => {
    const text =
      "A lawyer reviews your commercial lease before you sign. The review covers relocation, assignment, and repair clauses under Ontario law.";
    const results = runSharedTextComplianceFloor(text, makeConfig());
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });
});
