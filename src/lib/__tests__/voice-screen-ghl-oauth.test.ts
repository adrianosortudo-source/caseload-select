import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ scope: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../voice-screen-store", () => ({ voiceScreenScopeConfig: mocks.scope, database: async () => ({ from: mocks.from }) }));

import {
  createGhlOauthState,
  decryptGhlOauthToken,
  encryptGhlOauthToken,
  exchangeGhlAuthorizationCode,
  ghlAuthorizationUrl,
  ghlOauthConfig,
  persistGhlOauthInstallation,
  verifyGhlOauthState,
} from "../voice-screen-ghl-oauth";

const env = () => {
  mocks.scope.mockReturnValue({ firmId: "11111111-1111-4111-8111-111111111111", locationId: "location_test", agentId: "agent_test", appId: "marketplace_app_test" });
  vi.stubEnv("V2S_GHL_MARKETPLACE_CLIENT_ID", "marketplace_client_123");
  vi.stubEnv("V2S_GHL_MARKETPLACE_CLIENT_SECRET", "c".repeat(32));
  vi.stubEnv("V2S_GHL_OAUTH_STATE_SECRET", "s".repeat(32));
  vi.stubEnv("V2S_GHL_OAUTH_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64url"));
  vi.stubEnv("V2S_GHL_OAUTH_REDIRECT_URI", "https://admin.caseloadselect.ca/api/admin/integrations/voice-screen/ghl/callback");
  return ghlOauthConfig()!;
};

describe("Voice Screen HighLevel OAuth", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("binds a short-lived state to the cookie, configured location and HMAC", () => {
    const config = env();
    const state = createGhlOauthState(config.stateSecret, config.locationId, 1_000);
    expect(verifyGhlOauthState(state, state, config.stateSecret, config.locationId, 1_001)).toBe(true);
    expect(verifyGhlOauthState(state, state, config.stateSecret, "other", 1_001)).toBe(false);
    expect(verifyGhlOauthState(state, `${state}x`, config.stateSecret, config.locationId, 1_001)).toBe(false);
    expect(verifyGhlOauthState(state, state, config.stateSecret, config.locationId, 1_000 + 600_001)).toBe(false);
  });

  it("builds the least-privilege Location authorization URL", () => {
    const config = env();
    const url = ghlAuthorizationUrl(config, "state");
    expect(url.origin + url.pathname).toBe("https://marketplace.leadconnectorhq.com/oauth/chooselocation");
    expect(url.searchParams.get("scope")).toBe("voice-ai-dashboard.readonly");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("state");
  });

  it("encrypts tokens with AES-256-GCM before persistence", async () => {
    const config = env();
    const token = "access-token-material-that-must-not-persist-plain";
    const accessContext = { keyVersion: 1, firmId: config.firmId, locationId: config.locationId, kind: "access" as const };
    const ciphertext = encryptGhlOauthToken(token, config.encryptionKey, accessContext, Buffer.alloc(12, 3));
    expect(ciphertext).not.toContain(token);
    expect(decryptGhlOauthToken(ciphertext, config.encryptionKey, accessContext)).toBe(token);
    expect(() => decryptGhlOauthToken(ciphertext, config.encryptionKey, { ...accessContext, kind: "refresh" })).toThrow("invalid_oauth_token_ciphertext");
    expect(() => decryptGhlOauthToken(ciphertext, Buffer.alloc(32, 8), accessContext)).toThrow("invalid_oauth_token_ciphertext");
    const parts = ciphertext.split(".");
    parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
    expect(() => decryptGhlOauthToken(parts.join("."), config.encryptionKey, accessContext)).toThrow("invalid_oauth_token_ciphertext");
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ upsert });
    await persistGhlOauthInstallation({
      access_token: token, refresh_token: "refresh-token-material-that-is-long-enough", expires_in: 3600,
      token_type: "Bearer", scope: "voice-ai-dashboard.readonly", userType: "Location", locationId: config.locationId, userId: "user",
    }, config);
    const row = upsert.mock.calls[0][0];
    expect(row.access_token_ciphertext).not.toContain(token);
    expect(row.refresh_token_ciphertext).not.toContain("refresh-token-material");
    expect(row).not.toHaveProperty("access_token");
    expect(row).toMatchObject({ marketplace_app_id: config.appId, encryption_key_version: 1, status: "active", revoked_at: null });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "firm_id,location_id" });
  });

  it("accepts only an exact Location token with the required scope", async () => {
    const config = env();
    const valid = {
      access_token: "a".repeat(32), refresh_token: "r".repeat(32), expires_in: 86_399,
      token_type: "Bearer", scope: "voice-ai-dashboard.readonly", userType: "Location", locationId: config.locationId, userId: "user_1",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(valid)));
    expect((await exchangeGhlAuthorizationCode("code_123", config)).locationId).toBe(config.locationId);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Version: "v3" },
      redirect: "error",
    });
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...valid, locationId: "other" }));
    await expect(exchangeGhlAuthorizationCode("code_456", config)).rejects.toThrow("ghl_oauth_scope_mismatch");
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...valid, scope: "contacts.readonly" }));
    await expect(exchangeGhlAuthorizationCode("code_789", config)).rejects.toThrow("ghl_oauth_scope_mismatch");
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...valid, scope: "voice-ai-dashboard.readonly contacts.readonly" }));
    await expect(exchangeGhlAuthorizationCode("code_extra", config)).rejects.toThrow("ghl_oauth_scope_mismatch");
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...valid, token_type: "bearer" }));
    await expect(exchangeGhlAuthorizationCode("code_wrong_type", config)).rejects.toThrow("ghl_oauth_scope_mismatch");
  });
});
