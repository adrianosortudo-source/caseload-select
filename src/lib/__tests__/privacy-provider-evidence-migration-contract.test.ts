import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase", "migrations");
  const filename = readdirSync(directory).find((entry) =>
    entry.endsWith("_privacy_provider_evidence_required.sql"),
  );
  expect(filename).toBeTruthy();
  return readFileSync(join(directory, filename!), "utf8")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

describe("privacy provider evidence migration contract", () => {
  it("keeps the completion primitive service-only with a fixed search path", () => {
    const sql = migrationSql();

    expect(sql).toContain(
      "create or replace function private.complete_screened_lead_external_cleanup_impl",
    );
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain(
      "revoke all privileges on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb) from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant execute on function public.complete_screened_lead_external_cleanup(uuid, uuid, jsonb) to service_role",
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.complete_screened_lead_external_cleanup[^;]+to (anon|authenticated|public)/,
    );
  });

  it("requires evidence rather than a provider-managed location marker", () => {
    const sql = migrationSql();

    for (const provider of ["ghl", "meta", "resend"]) {
      expect(sql).toContain(
        `jsonb_typeof(p_cleanup_summary->'${provider}_status'), '' ) <> 'string'`,
      );
      expect(sql).toContain(
        `coalesce(p_cleanup_summary->>'${provider}_status', '') not in ('completed', 'not_applicable')`,
      );
    }
    expect(sql).toContain(
      "provider_managed is not completion evidence",
    );
  });

  it("rejects non-object summaries before enumerating object keys", () => {
    const sql = migrationSql();
    const objectTypeGuard = sql.indexOf(
      "jsonb_typeof(p_cleanup_summary) <> 'object' then",
    );
    const keyEnumeration = sql.indexOf(
      "jsonb_object_keys(p_cleanup_summary)",
    );

    expect(objectTypeGuard).toBeGreaterThan(-1);
    expect(keyEnumeration).toBeGreaterThan(objectTypeGuard);
    expect(sql.slice(objectTypeGuard, keyEnumeration)).toContain("end if");
  });

  it("reopens every completion lacking three valid provider dispositions", () => {
    const sql = migrationSql();

    expect(sql).toContain("set external_cleanup_status = 'pending'");
    expect(sql).toContain("external_cleanup_completed_at = null");
    expect(sql).toContain("cleanup_summary = null");
    expect(sql).toContain(
      "where request.external_cleanup_status = 'complete'",
    );
    for (const provider of ["ghl", "meta", "resend"]) {
      expect(sql).toContain(
        `jsonb_typeof(request.cleanup_summary->'${provider}_status'), '' ) = 'string'`,
      );
      expect(sql).toContain(
        `coalesce(request.cleanup_summary->>'${provider}_status', '') in ('completed', 'not_applicable')`,
      );
    }
  });
});
