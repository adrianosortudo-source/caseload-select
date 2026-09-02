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
    expect(sql).toContain(
      "when NEW.role = 'operator' then 'https://admin.caseloadselect.ca/api/operator/request-link'",
    );
    expect(sql).toContain(
      "else 'https://app.caseloadselect.ca/api/portal/request-link'",
    );
    expect(sql).toContain("url := request_url");
  });

  it("stamps the invitation only after pg_net returns a request id", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const enqueue = sql.indexOf("select net.http_post(");
    const nullGuard = sql.indexOf("if request_id is null then");
    const stamp = sql.indexOf("set invitation_sent_at = now()");
    expect(enqueue).toBeGreaterThan(-1);
    expect(nullGuard).toBeGreaterThan(enqueue);
    expect(stamp).toBeGreaterThan(nullGuard);
  });

  it("idempotently installs the invitation trigger for fresh databases", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("drop trigger if exists trg_firm_lawyers_invite on public.firm_lawyers");
    expect(sql).toContain("create trigger trg_firm_lawyers_invite");
    expect(sql).toContain("after insert on public.firm_lawyers");
    expect(sql).toContain("execute function public.fn_firm_lawyers_send_invitation()");
  });

  it("preserves the security-definer search path and revoked execution boundary", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("from public, anon, authenticated");
  });
});
