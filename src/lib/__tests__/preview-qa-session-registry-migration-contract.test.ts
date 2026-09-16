import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const registryMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915183000_preview_qa_session_registry.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260916030440_preview_qa_registry_privilege_hardening.sql"),
  "utf8",
);

describe("preview QA session registry migration", () => {
  it("keeps registry tables and privileged RPCs private from browser roles", () => {
    expect(registryMigration).toContain("enable row level security");
    expect(registryMigration).toContain("revoke all on table public.preview_qa_sessions from public, anon, authenticated");
    expect(registryMigration).toContain("revoke all on table public.preview_qa_bootstrap_grants from public, anon, authenticated");
    expect(registryMigration).toContain("revoke all on function public.consume_preview_qa_bootstrap_and_issue_session");
    expect(registryMigration).toContain("revoke all on function public.verify_preview_qa_session");
    expect(registryMigration).toContain("grant execute on function public.consume_preview_qa_bootstrap_and_issue_session");
    expect(registryMigration).toContain("grant execute on function public.verify_preview_qa_session");
    expect(registryMigration).toMatch(/security definer\s+set search_path = ''/g);
    expect(hardeningMigration).toContain("alter table public.preview_qa_sessions force row level security");
    expect(hardeningMigration).toContain("alter table public.preview_qa_bootstrap_grants force row level security");
    expect(hardeningMigration).toContain("revoke all on table public.preview_qa_sessions from service_role");
    expect(hardeningMigration).toContain("revoke all on table public.preview_qa_bootstrap_grants from service_role");
  });

  it("consumes the bootstrap grant under a row lock before issuing a session", () => {
    expect(registryMigration).toContain("for update");
    expect(registryMigration).toContain("consumed_at is not null");
    expect(registryMigration).toContain("p_bootstrap_nonce_hash");
    expect(registryMigration).toContain("set consumed_at = pg_catalog.now()");
  });
});
