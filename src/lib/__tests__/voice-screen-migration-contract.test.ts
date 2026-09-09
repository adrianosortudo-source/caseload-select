import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260909231831_voice_screen_parallel_journey.sql"),
  "utf8",
).toLowerCase();
const compact = migration.replace(/\s+/g, "");

describe("parallel voice-to-Screen migration contract", () => {
  it("keeps both stores browser-inaccessible and service-only", () => {
    for (const table of ["voice_screen_inquiries", "voice_screen_outbox"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
      expect(migration).toContain(`revoke all privileges on table public.${table}`);
    }
    expect(migration).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[^;]+\s+to\s+(?:public|anon|authenticated)/);
  });

  it("uses immutable per-agent call identity and a hashed 256-bit continuation seed", () => {
    expect(compact).toContain("unique(location_id,agent_id,call_id)");
    expect(migration).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("token_nonce ~ '^[a-za-z0-9_-]{43}$'");
    expect(migration).not.toMatch(/\btoken\s+text\b/);
  });

  it("exposes only service-role RPCs for atomic ingest, save, claim, finish, and takeover", () => {
    for (const fn of ["v2s_ingest", "v2s_save", "v2s_claim", "v2s_finish_dispatch", "v2s_takeover"]) {
      expect(migration).toContain(`function public.${fn}`);
      expect(migration).toContain(`grant execute on function public.${fn}`);
    }
    expect(compact).toContain("onconflict(location_id,agent_id,call_id)donothing");
    expect(compact).toContain("andrevision=p_revision");
    expect(migration).toContain("for update");
    expect(compact).toContain("statusin('pending','dispatching','sent','unknown','cancelled')");
  });
});
