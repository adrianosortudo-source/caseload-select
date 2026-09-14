import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260914202504_gta_prospect_worker_evidence_drafts.sql"), "utf8");

describe("GTA prospect worker evidence draft migration", () => {
  it("is private, append-only, source-hashed, and service-only", () => {
    expect(migration).toContain("gta_prospect_worker_evidence_drafts");
    expect(migration).toContain("gta_prospect_worker_evidence_reconciliations");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("reject_gta_prospect_research_history_mutation");
    expect(migration).toContain("contentSha256");
    expect(migration).toContain("worker does not own an active GTA prospect research lease");
    expect(migration).toContain("registered firm identity and canonical domain");
    expect(migration).toContain("direct owner email requires published confirmed-owner evidence");
    expect(migration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.submit_gta_prospect_worker_evidence_draft[^\n]*\s+TO\s+anon/i);
  });
});
