import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("channel conversation ledger privilege contract", () => {
  it("pins the service role to read-and-append and makes trigger functions owner-only", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const aclFilename = readdirSync(directory).find((entry) =>
      entry.endsWith("_harden_channel_conversation_acl.sql"),
    );
    expect(aclFilename).toBeTruthy();

    const aclSql = readFileSync(join(directory, aclFilename!), "utf8")
      .toLowerCase()
      .replace(/\s+/g, " ");

    expect(aclSql).toContain(
      "revoke all privileges on table public.channel_conversation_events from public, anon, authenticated, service_role",
    );
    expect(aclSql).toContain(
      "grant select, insert on table public.channel_conversation_events to service_role",
    );
    expect(aclSql).toContain(
      "revoke all privileges on function public.validate_channel_conversation_terminal() from public, anon, authenticated, service_role",
    );
    expect(aclSql).toContain(
      "revoke all privileges on function public.reject_channel_conversation_event_mutation() from public, anon, authenticated, service_role",
    );
    expect(aclSql).not.toContain("channel_conversation_ledger_enabled");
    expect(aclSql).not.toContain("grant all");

    const gateFilename = readdirSync(directory).find((entry) =>
      entry.endsWith("_channel_conversation_default_off_gate.sql"),
    );
    expect(gateFilename).toBeTruthy();

    const gateSql = readFileSync(join(directory, gateFilename!), "utf8")
      .toLowerCase()
      .replace(/\s+/g, " ");

    expect(gateSql).toContain(
      "add column channel_conversation_ledger_enabled boolean not null default false",
    );
    expect(gateSql).toContain(
      "create trigger channel_conversation_events_require_enabled_firm before insert on public.channel_conversation_events",
    );
    expect(gateSql).toContain("and firm.channel_conversation_ledger_enabled = true");
    expect(gateSql).toContain("for share");
    expect(gateSql).toContain("set search_path = ''");
    expect(gateSql).not.toContain("security definer");
    expect(gateSql).toContain(
      "revoke all privileges on function public.require_channel_conversation_ledger_enabled() from public, anon, authenticated, service_role",
    );
    expect(gateSql).toContain("notify pgrst, 'reload schema'");
  });
});
