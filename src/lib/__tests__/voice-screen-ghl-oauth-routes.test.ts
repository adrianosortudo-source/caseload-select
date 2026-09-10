import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(), config: vi.fn(), createState: vi.fn(), authorizationUrl: vi.fn(),
  verifyState: vi.fn(), exchange: vi.fn(), persist: vi.fn(),
  scope: vi.fn(), revoke: vi.fn(),
}));
vi.mock("../voice-screen-store", () => ({ voiceScreenScopeConfig: mocks.scope, revokeGhlInstallation: mocks.revoke }));
vi.mock("../admin-auth", () => ({ requireOperator: mocks.requireOperator }));
vi.mock("../voice-screen-ghl-oauth", () => ({
  GHL_OAUTH_STATE_COOKIE: "__Host-v2s-ghl-oauth-state",
  createGhlOauthState: mocks.createState,
  ghlAuthorizationUrl: mocks.authorizationUrl,
  ghlOauthConfig: mocks.config,
  verifyGhlOauthState: mocks.verifyState,
  exchangeGhlAuthorizationCode: mocks.exchange,
  persistGhlOauthInstallation: mocks.persist,
}));

import { GET as connect } from "../../app/api/admin/integrations/voice-screen/ghl/connect/route";
import { GET as callback } from "../../app/api/admin/integrations/voice-screen/callback/route";
import { POST as disconnect } from "../../app/api/admin/integrations/voice-screen/ghl/disconnect/route";

const config = {
  redirectUri: "https://admin.caseloadselect.ca/api/admin/integrations/voice-screen/callback",
  locationId: "location", appId: "marketplace_app_test", stateSecret: "state-secret", clientId: "client",
};

describe("operator-only HighLevel OAuth routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not initiate OAuth without an operator session", async () => {
    mocks.requireOperator.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await connect(new NextRequest("https://admin.caseloadselect.ca/api/admin/integrations/voice-screen/ghl/connect"));
    expect(response.status).toBe(401);
    expect(mocks.createState).not.toHaveBeenCalled();
  });

  it("sets a host-only state cookie and redirects to HighLevel", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.config.mockReturnValue(config);
    mocks.createState.mockReturnValue("signed-state");
    mocks.authorizationUrl.mockReturnValue(new URL("https://marketplace.leadconnectorhq.com/oauth/chooselocation?state=signed-state"));
    const response = await connect(new NextRequest("https://admin.caseloadselect.ca/api/admin/integrations/voice-screen/ghl/connect"));
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("__Host-v2s-ghl-oauth-state=signed-state");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects initiation from an origin that cannot carry the operator cookie", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.config.mockReturnValue(config);
    const response = await connect(new NextRequest("https://app.caseloadselect.ca/api/admin/integrations/voice-screen/ghl/connect"));
    expect(response.status).toBe(503);
    expect(mocks.createState).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state is not cookie-bound", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.config.mockReturnValue(config);
    mocks.verifyState.mockReturnValue(false);
    const request = new NextRequest(`${config.redirectUri}?code=code_123&state=wrong`);
    const response = await callback(request);
    expect(response.status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("persists an exact-location token before completing the connection", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.config.mockReturnValue(config);
    mocks.verifyState.mockReturnValue(true);
    const token = { locationId: "location" };
    mocks.exchange.mockResolvedValue(token);
    const request = new NextRequest(`${config.redirectUri}?code=code_123&state=signed-state`, {
      headers: { cookie: "__Host-v2s-ghl-oauth-state=signed-state" },
    });
    const response = await callback(request);
    expect(response.status).toBe(307);
    expect(mocks.exchange).toHaveBeenCalledWith("code_123", config);
    expect(mocks.persist).toHaveBeenCalledWith(token, config);
    expect(response.headers.get("location")).toBe("https://admin.caseloadselect.ca/admin/voice-screen?ghl=connected");
  });

  it("rejects a callback on the app origin even with an otherwise valid state", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.config.mockReturnValue(config);
    mocks.verifyState.mockReturnValue(true);
    const request = new NextRequest("https://app.caseloadselect.ca/api/admin/integrations/voice-screen/callback?code=code_123&state=signed-state", {
      headers: { cookie: "__Host-v2s-ghl-oauth-state=signed-state" },
    });
    const response = await callback(request);
    expect(response.status).toBe(503);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("cryptoshreds the exact installation only after operator confirmation", async () => {
    mocks.requireOperator.mockResolvedValue(null);
    mocks.scope.mockReturnValue({ firmId: "firm", locationId: "location", agentId: "agent", appId: "marketplace_app_test" });
    mocks.revoke.mockResolvedValue(1);
    const response = await disconnect(new NextRequest("https://admin.caseloadselect.ca/api/admin/integrations/voice-screen/ghl/disconnect", {
      method: "POST", headers: { origin: "https://admin.caseloadselect.ca", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "DISCONNECT" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(expect.objectContaining({ locationId: "location", appId: "marketplace_app_test" }), { locationId: "location" });
  });
});
