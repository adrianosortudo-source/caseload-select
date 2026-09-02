import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("channel conversation ledger privilege contract", () => {
  it("pins the service role to read-and-append and makes trigger functions owner-only", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const filename = readdirSync(directory).find((entry) =>
      entry.endsWith("_harden_channel_conversation_acl.sql"),
    );
    expect(filename).toBeTruthy();

    const sql = readFileSync(join(directory, filename!), "utf8")
      .toLowerCase()
      .replace(/\s+/g, " ");

    expect(sql).toContain(
      "revoke all privileges on table public.channel_conversation_events from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "grant select, insert on table public.channel_conversation_events to service_role",
    );
    expect(sql).toContain(
      "revoke all privileges on function public.validate_channel_conversation_terminal() from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "revoke all privileges on function public.reject_channel_conversation_event_mutation() from public, anon, authenticated, service_role",
    );
    expect(sql).not.toContain("grant all");
  });
});
