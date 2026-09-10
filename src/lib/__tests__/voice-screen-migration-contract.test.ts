import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const storeMocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase-admin", () => ({ supabaseAdmin: { from: storeMocks.from } }));
import { inquiryByToken, liveConfig, voiceScreenSubjectDigests } from "../voice-screen-store";
import { createContinuation } from "../voice-screen-live";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260909231831_voice_screen_parallel_journey.sql"),
  "utf8",
).toLowerCase();
const compact = migration.replace(/\s+/g, "");
const hardeningMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260910022033_voice_screen_native_webhook_replay_oauth.sql"),
  "utf8",
).toLowerCase();
const hardeningCompact = hardeningMigration.replace(/\s+/g, "");

describe("parallel voice-to-Screen migration contract", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("requires retention and revokes issued bearer links after key rotation", async () => {
    vi.stubEnv("V2S_ENABLED", "true"); vi.stubEnv("V2S_RETENTION_ENABLED", "false");
    expect(liveConfig()).toBeNull();
    vi.stubEnv("V2S_RETENTION_ENABLED", "true"); vi.stubEnv("V2S_RETENTION_DAYS", "7");
    vi.stubEnv("V2S_FIRM_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("V2S_LOCATION_ID", "location"); vi.stubEnv("V2S_AGENT_ID", "agent");
    vi.stubEnv("V2S_GHL_MARKETPLACE_APP_ID", "marketplace_app");
    vi.stubEnv("V2S_PUBLIC_ORIGIN", "https://example.test");
    vi.stubEnv("V2S_TOKEN_KEY", "k".repeat(32));
    vi.stubEnv("V2S_SUBJECT_SUPPRESSION_KEYS", Buffer.alloc(32, 4).toString("base64url"));
    const minted = createContinuation("k".repeat(32));
    const chain = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), neq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "inquiry", token_nonce: minted.nonce, token_hash: minted.hash } }) };
    for (const method of [chain.select, chain.eq, chain.gt, chain.neq]) method.mockReturnValue(chain);
    storeMocks.from.mockReturnValue(chain);
    expect((await inquiryByToken(minted.token))?.id).toBe("inquiry");
    vi.stubEnv("V2S_TOKEN_KEY", "r".repeat(32));
    expect(await inquiryByToken(minted.token)).toBeNull();
  });
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

  it("durably claims signed events, suppresses erased subjects and stores only encrypted OAuth tokens", () => {
    for (const table of ["voice_screen_event_claims", "voice_screen_subject_suppressions", "voice_screen_ghl_oauth_installations"]) {
      expect(hardeningMigration).toContain(`alter table public.${table} enable row level security`);
      expect(hardeningMigration).toContain(`alter table public.${table} force row level security`);
      expect(hardeningMigration).toContain(`revoke all privileges on table public.${table}`);
    }
    expect(hardeningCompact).toContain("primarykey(firm_id,location_id,agent_id,call_id)");
    expect(hardeningCompact).toContain("discard_after>=event_ended_at+interval'25hours'");
    expect(hardeningCompact).toContain("pg_advisory_xact_lock");
    expect(hardeningCompact).toContain("'reason','subject_suppressed'");
    expect(hardeningMigration).toContain("subject_digest text not null");
    const suppressionDefinition = hardeningMigration.split("create table public.voice_screen_subject_suppressions")[1].split("create table public.voice_screen_ghl_oauth_installations")[0];
    expect(suppressionDefinition).not.toContain("contact_id");
    expect(hardeningMigration).toContain("access_token_ciphertext text check");
    expect(hardeningMigration).toContain("refresh_token_ciphertext text check");
    expect(hardeningMigration).toContain("marketplace_app_id text not null");
    expect(hardeningMigration).toContain("status text not null default 'active'");
    expect(hardeningCompact).toContain("reason','integration_not_installed'");
    expect(hardeningMigration).toContain("function public.v2s_revoke_ghl_installation");
    expect(hardeningMigration).not.toMatch(/\baccess_token\s+text\b|\brefresh_token\s+text\b/);
    expect(hardeningMigration).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[^;]+\s+to\s+(?:public|anon|authenticated)/);
  });

  it("carries legacy subject digests after a suppression-key rotation", () => {
    const current = Buffer.alloc(32, 7).toString("base64url");
    const legacy = Buffer.alloc(32, 6).toString("base64url");
    const base = { firmId: "11111111-1111-4111-8111-111111111111", locationId: "location", subjectSuppressionKeys: [legacy] };
    const legacyDigest = voiceScreenSubjectDigests(base, "contact_1")[0];
    const rotated = voiceScreenSubjectDigests({ ...base, subjectSuppressionKeys: [current, legacy] }, "contact_1");
    expect(rotated).toHaveLength(2);
    expect(rotated[1]).toBe(legacyDigest);
  });
});
