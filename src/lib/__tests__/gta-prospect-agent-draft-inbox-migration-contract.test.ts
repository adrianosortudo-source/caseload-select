import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260915150000_gta_prospect_agent_draft_inbox.sql"), "utf8");

describe("GTA prospect agent draft inbox migration", () => {
  it("keeps draft staging private and separate from canonical import", () => {
    expect(migration).toContain("CREATE TABLE public.gta_prospect_agent_import_drafts");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.gta_prospect_agent_import_drafts FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.stage_gta_prospect_agent_import_draft");
    expect(migration).toContain("cannot apply a canonical import");
  });

  it("uses idempotent, receipt-backed staging and an operator-only completion record", () => {
    expect(migration).toContain("UNIQUE (submitted_by, idempotency_key)");
    expect(migration).toContain("UNIQUE (source_name, payload_sha256)");
    expect(migration).toContain("complete_gta_prospect_agent_import_draft");
    expect(migration).toContain("state IN ('ready_for_operator', 'review_required', 'applied')");
  });
});
