import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const MIGRATION = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260902133000_role_aware_firm_member_invitation.sql",
);

describe("role-aware firm member invitation migration", () => {
  it("routes operator invitations to the operator endpoint and all firm-side roles to portal", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("when NEW.role = 'operator' then '/api/operator/request-link'");
    expect(sql).toContain("else '/api/portal/request-link'");
    expect(sql).toContain("base_url || request_path");
  });

  it("preserves the security-definer search path and revoked execution boundary", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("from public, anon, authenticated");
  });
});
