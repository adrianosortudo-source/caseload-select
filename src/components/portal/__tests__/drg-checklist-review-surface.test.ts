import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DRG Checklist Deliverables review surface", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "components", "portal", "DeliverableReview.tsx"),
    "utf8",
  );

  it("keeps the complete text review surface and exposes the same-version PDF download", () => {
    expect(source).toContain('deliverable.deliverable_role === "lead_magnet_pdf"');
    expect(source).toContain("version.signed_url");
    expect(source).toContain("Download the Checklist (PDF)");
    expect(source).toContain("Baixar o Checklist (PDF)");
    expect(source).toContain("The complete text below and this PDF belong to the same version under review.");
  });

  it("upgrades the manifest writer and provides an exact generic revision path", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "20260818170000_drg_checklist_text_review_contract.sql"),
      "utf8",
    );
    expect(migration).toContain("decision tools must be complete text Deliverables with separately attached PDFs");
    expect(migration).toContain("apply_drg_checklist_review_revision");
    expect(migration).toContain("jsonb_array_length(p_manifest->'items') <> 2");
    expect(migration).toContain("publicationAuthorized");
    expect(migration).toContain("notificationAuthorized");
    expect(migration).toContain("verified_noop");
  });
});
