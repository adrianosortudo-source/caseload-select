// Pure tests for the approval-identity gate and the shared review renderer
// (Codex audit F1/F3/F8 remediation, 2026-07-07). No I/O: renderReviewPayload
// and evaluateApprovalIdentity are pure, so the release-gate decision is tested
// with plain version rows.

import { describe, it, expect } from "vitest";
import {
  renderReviewPayload,
  renderSeoSummary,
  renderDirectAnswerSummary,
  evaluateApprovalIdentity,
  type ReviewVersionInput,
} from "../content-studio-review";

const MD_SEO = {
  generated_at: "2026-07-06T00:00:00.000Z",
  title: "Commercial Lease Review, Ontario",
  meta_description: "A lawyer reviews the lease before you sign.",
  schema: { article: { "@type": "Article", headline: "Commercial Lease Review" } },
};

function mdVersion(body: string, seo: Record<string, unknown> = MD_SEO): ReviewVersionInput {
  return { body_markdown: body, body_structured: null, seo_metadata: seo };
}

describe("renderSeoSummary (F8)", () => {
  it("renders title, meta description, and JSON-LD @types as a labeled block", () => {
    const html = renderSeoSummary(MD_SEO);
    expect(html).toContain("SEO metadata");
    expect(html).toContain("Commercial Lease Review, Ontario");
    expect(html).toContain("A lawyer reviews the lease before you sign.");
    expect(html).toContain("Article");
  });

  it("returns empty string when there is nothing SEO-relevant", () => {
    expect(renderSeoSummary(null)).toBe("");
    expect(renderSeoSummary({ generator: "x" })).toBe("");
  });

  it("surfaces a staleness warning when schema_stale is set", () => {
    const html = renderSeoSummary({ ...MD_SEO, schema_stale: true });
    expect(html).toContain("NOT recomputed");
  });

  it("escapes HTML in SEO fields", () => {
    const html = renderSeoSummary({ title: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderReviewPayload (F8: SEO summary is part of the reviewed body)", () => {
  it("includes the rendered body AND the SEO metadata summary for the EN version", () => {
    const payload = renderReviewPayload({
      format: "counsel_note",
      languageMode: "en",
      en: mdVersion("# Commercial Lease Review\n\nA lawyer reviews the lease."),
      pt: null,
    });
    expect(payload).toContain("<h1>Commercial Lease Review</h1>");
    expect(payload).toContain("SEO metadata");
    expect(payload).toContain("Article");
  });

  it("appends a labeled Portuguese section for a bilingual piece with a PT version", () => {
    const payload = renderReviewPayload({
      format: "counsel_note",
      languageMode: "bilingual",
      en: mdVersion("# English\n\nBody."),
      pt: mdVersion("# Portugues\n\nCorpo em Ontario."),
    });
    expect(payload).toContain("Portuguese version");
    expect(payload).toContain("<h1>Portugues</h1>");
  });

  it("omits the Portuguese section when the piece is bilingual but PT is missing", () => {
    const payload = renderReviewPayload({
      format: "counsel_note",
      languageMode: "bilingual",
      en: mdVersion("# English\n\nBody."),
      pt: null,
    });
    expect(payload).not.toContain("Portuguese version");
  });
});

describe("evaluateApprovalIdentity", () => {
  it("blocks when there is no approved snapshot on file", () => {
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "en",
      approvedBodyHtml: null,
      en: mdVersion("# T\n\nBody."),
      pt: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("approval_snapshot_missing");
  });

  it("ALLOWS when the current EN payload matches the approved body", () => {
    const en = mdVersion("# Title\n\nApproved body content.");
    const approvedBodyHtml = renderReviewPayload({
      format: "counsel_note",
      languageMode: "en",
      en,
      pt: null,
    });
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "en",
      approvedBodyHtml,
      en,
      pt: null,
    });
    expect(r.ok).toBe(true);
  });

  it("BLOCKS when the current EN version was edited/regenerated after approval", () => {
    const enApproved = mdVersion("# Title\n\nApproved body content.");
    const approvedBodyHtml = renderReviewPayload({
      format: "counsel_note",
      languageMode: "en",
      en: enApproved,
      pt: null,
    });
    const enEdited = mdVersion("# Title\n\nEdited body content, different now.");
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "en",
      approvedBodyHtml,
      en: enEdited,
      pt: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("approval_stale");
  });

  it("BLOCKS a bilingual piece approved EN-only once a PT version is added afterward", () => {
    const en = mdVersion("# Title\n\nEnglish body.");
    // Approved when only EN existed: the deliverable body was EN-only.
    const approvedEnOnly = renderReviewPayload({
      format: "counsel_note",
      languageMode: "bilingual",
      en,
      pt: null,
    });
    const pt = mdVersion("# Titulo\n\nCorpo em portugues, direito de Ontario.");
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "bilingual",
      approvedBodyHtml: approvedEnOnly,
      en,
      pt,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("approval_stale");
  });

  it("ALLOWS a bilingual piece when the approved EN+PT snapshot matches the current EN+PT payload", () => {
    const en = mdVersion("# Title\n\nEnglish body.");
    const pt = mdVersion("# Titulo\n\nCorpo em portugues, direito de Ontario.");
    const approvedBoth = renderReviewPayload({
      format: "counsel_note",
      languageMode: "bilingual",
      en,
      pt,
    });
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "bilingual",
      approvedBodyHtml: approvedBoth,
      en,
      pt,
    });
    expect(r.ok).toBe(true);
  });

  it("BLOCKS a bilingual piece when the PT half changed after approval", () => {
    const en = mdVersion("# Title\n\nEnglish body.");
    const ptApproved = mdVersion("# Titulo\n\nCorpo aprovado em Ontario.");
    const approvedBoth = renderReviewPayload({
      format: "counsel_note",
      languageMode: "bilingual",
      en,
      pt: ptApproved,
    });
    const ptEdited = mdVersion("# Titulo\n\nCorpo REESCRITO em Ontario.");
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "bilingual",
      approvedBodyHtml: approvedBoth,
      en,
      pt: ptEdited,
    });
    expect(r.ok).toBe(false);
  });
});

describe("renderDirectAnswerSummary (direct answer / quotable definition rule)", () => {
  it("returns empty string when no decision is on file", () => {
    expect(renderDirectAnswerSummary(null)).toBe("");
    expect(renderDirectAnswerSummary({ generator: "x" })).toBe("");
  });

  it("renders a not_applicable decision with its rationale", () => {
    const html = renderDirectAnswerSummary({
      direct_answer: {
        applicability: "not_applicable",
        not_applicable_reason: "single-CTA ad landing page",
      },
    });
    expect(html).toContain("Not applicable");
    expect(html).toContain("single-CTA ad landing page");
  });

  it("renders text, classification, jurisdiction/scope, and source status for a required decision", () => {
    const html = renderDirectAnswerSummary({
      direct_answer: {
        applicability: "required",
        text: "A shareholder agreement is a contract among a corporation's shareholders.",
        classification: "binding_rule",
        jurisdiction_scope: "Ontario",
        source_status: "mapped",
        source_refs: ["OBCA s. 108"],
      },
    });
    expect(html).toContain("A shareholder agreement is a contract");
    expect(html).toContain("Binding legal rule");
    expect(html).toContain("Ontario");
    expect(html).toContain("OBCA s. 108");
    expect(html).toContain("Confirm the scope and source before sign-off");
  });

  it("distinguishes firm judgment from a legal proposition in the rendered note", () => {
    const html = renderDirectAnswerSummary({
      direct_answer: {
        applicability: "optional",
        text: "Clients most often miss the relocation clause.",
        classification: "firm_judgment",
        source_status: "not_required",
      },
    });
    expect(html).toContain("firm judgment");
    expect(html).not.toContain("binding law");
  });

  it("escapes HTML in the definition text", () => {
    const html = renderDirectAnswerSummary({
      direct_answer: { applicability: "required", text: "<script>alert(1)</script>", classification: "explanatory" },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("is included in renderReviewPayload for the EN version", () => {
    const payload = renderReviewPayload({
      format: "counsel_note",
      languageMode: "en",
      en: mdVersion("# Title\n\nBody.", {
        direct_answer: {
          applicability: "required",
          text: "A shareholder agreement is a contract.",
          classification: "explanatory",
        },
      }),
      pt: null,
    });
    expect(payload).toContain("Direct answer / quotable definition");
    expect(payload).toContain("A shareholder agreement is a contract.");
  });
});

describe("evaluateApprovalIdentity picks up direct-answer drift (no separate staleness mechanism)", () => {
  it("BLOCKS when the direct-answer decision changes after approval with no new body edit", () => {
    const seoV1 = {
      direct_answer: { applicability: "required", text: "Definition A.", classification: "firm_judgment" },
    };
    const seoV2 = {
      direct_answer: { applicability: "required", text: "Definition A.", classification: "binding_rule" },
    };
    const approvedBodyHtml = renderReviewPayload({
      format: "counsel_note",
      languageMode: "en",
      en: mdVersion("# Title\n\nBody unchanged.", seoV1),
      pt: null,
    });
    const r = evaluateApprovalIdentity({
      format: "counsel_note",
      languageMode: "en",
      approvedBodyHtml,
      en: mdVersion("# Title\n\nBody unchanged.", seoV2),
      pt: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("approval_stale");
  });
});
