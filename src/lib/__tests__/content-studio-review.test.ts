// Pure tests for the approval-identity gate and the shared review renderer
// (Codex audit F1/F3/F8 remediation, 2026-07-07). No I/O: renderReviewPayload
// and evaluateApprovalIdentity are pure, so the release-gate decision is tested
// with plain version rows.

import { describe, it, expect } from "vitest";
import {
  renderReviewPayload,
  renderSeoSummary,
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
