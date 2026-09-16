import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915183000_preview_qa_session_registry.sql"),
  "utf8",
);

describe("preview QA session registry migration", () => {
  it("keeps registry tables and privileged RPCs private from browser roles", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.preview_qa_sessions from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.preview_qa_bootstrap_grants from public, anon, authenticated");
    expect(migration).toContain("revoke all on function public.consume_preview_qa_bootstrap_and_issue_session");
    expect(migration).toContain("revoke all on function public.verify_preview_qa_session");
    expect(migration).toContain("grant execute on function public.consume_preview_qa_bootstrap_and_issue_session");
    expect(migration).toContain("grant execute on function public.verify_preview_qa_session");
    expect(migration).toMatch(/security definer\s+set search_path = ''/g);
  });

  it("consumes the bootstrap grant under a row lock before issuing a session", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("consumed_at is not null");
    expect(migration).toContain("p_bootstrap_nonce_hash");
    expect(migration).toContain("set consumed_at = pg_catalog.now()");
  });
});
