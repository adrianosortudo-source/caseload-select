import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { database, voiceScreenScopeConfig } from "./voice-screen-store";

const REQUIRED_SCOPE = "voice-ai-dashboard.readonly";
const AUTHORIZE_URL = "https://marketplace.leadconnectorhq.com/oauth/chooselocation";
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const STATE_TTL_MS = 10 * 60 * 1000;
const ENCRYPTION_KEY_VERSION = 1;

export const GHL_OAUTH_STATE_COOKIE = "__Host-v2s-ghl-oauth-state";
export const GHL_OAUTH_CALLBACK_PATH = "/api/admin/integrations/voice-screen/ghl/callback";

function tokenKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 32 ? decoded : null;
}

export function ghlOauthConfig() {
  const scope = voiceScreenScopeConfig();
  const clientId = process.env.V2S_GHL_MARKETPLACE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.V2S_GHL_MARKETPLACE_CLIENT_SECRET ?? "";
  const stateSecret = process.env.V2S_GHL_OAUTH_STATE_SECRET ?? "";
  const encryptionKey = tokenKey(process.env.V2S_GHL_OAUTH_TOKEN_KEY ?? "");
  const redirectUri = process.env.V2S_GHL_OAUTH_REDIRECT_URI?.trim() ?? "";
  if (!scope || !/^[A-Za-z0-9_-]{8,200}$/.test(clientId) || clientSecret.length < 24 || stateSecret.length < 32 || !encryptionKey) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" || url.pathname !== GHL_OAUTH_CALLBACK_PATH || url.search || url.hash || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { ...scope, clientId, clientSecret, stateSecret, encryptionKey, encryptionKeyVersion: ENCRYPTION_KEY_VERSION, redirectUri };
}

export function createGhlOauthState(stateSecret: string, locationId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, n: randomBytes(24).toString("base64url"), l: locationId, e: now + STATE_TTL_MS })).toString("base64url");
  const mac = createHmac("sha256", stateSecret).update(`v2s-ghl-oauth:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyGhlOauthState(state: string, cookieState: string | undefined, stateSecret: string, locationId: string, now = Date.now()) {
  if (!cookieState || state.length > 1024 || cookieState.length !== state.length) return false;
  const stateBytes = Buffer.from(state);
  const cookieBytes = Buffer.from(cookieState);
  if (!timingSafeEqual(stateBytes, cookieBytes)) return false;
  const [payload, providedMac, extra] = state.split(".");
  if (!payload || !providedMac || extra) return false;
  const expectedMac = createHmac("sha256", stateSecret).update(`v2s-ghl-oauth:${payload}`).digest("base64url");
  if (providedMac.length !== expectedMac.length || !timingSafeEqual(Buffer.from(providedMac), Buffer.from(expectedMac))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; n?: unknown; l?: unknown; e?: unknown };
    return decoded.v === 1 && typeof decoded.n === "string" && /^[A-Za-z0-9_-]{32}$/.test(decoded.n) && decoded.l === locationId &&
      typeof decoded.e === "number" && Number.isSafeInteger(decoded.e) && decoded.e >= now && decoded.e <= now + STATE_TTL_MS;
  } catch {
    return false;
  }
}

export function ghlAuthorizationUrl(config: NonNullable<ReturnType<typeof ghlOauthConfig>>, state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", REQUIRED_SCOPE);
  url.searchParams.set("state", state);
  return url;
}

type TokenKind = "access" | "refresh";
type TokenCipherContext = { keyVersion: number; firmId: string; locationId: string; kind: TokenKind };
const tokenAad = (context: TokenCipherContext) => Buffer.from(
  `v2s-ghl-oauth|${context.keyVersion}|${context.firmId}|${context.locationId}|${context.kind}`,
  "utf8",
);

export function encryptGhlOauthToken(value: string, key: Buffer, context: TokenCipherContext, iv = randomBytes(12)) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(tokenAad(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptGhlOauthToken(value: string, key: Buffer, context: TokenCipherContext) {
  const [format, ivValue, ciphertextValue, tagValue, extra] = value.split(".");
  if (format !== "v1" || !ivValue || !ciphertextValue || !tagValue || extra) throw new Error("invalid_oauth_token_ciphertext");
  try {
    const iv = Buffer.from(ivValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (iv.length !== 12 || ciphertext.length < 1 || tag.length !== 16) throw new Error("invalid");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(tokenAad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("invalid_oauth_token_ciphertext");
  }
}

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: "Location";
  locationId: string;
  companyId?: string;
  userId: string;
};

export async function exchangeGhlAuthorizationCode(code: string, config: NonNullable<ReturnType<typeof ghlOauthConfig>>): Promise<TokenResponse> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: "Location",
    redirect_uri: config.redirectUri,
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", Version: "v3" },
    body: form,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("ghl_oauth_exchange_failed");
  const value = await response.json() as Partial<TokenResponse>;
  const scopes = typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : [];
  if (value.token_type !== "Bearer" || value.userType !== "Location" || value.locationId !== config.locationId || scopes.length !== 1 || scopes[0] !== REQUIRED_SCOPE ||
      typeof value.access_token !== "string" || value.access_token.length < 20 || value.access_token.length > 16_384 ||
      typeof value.refresh_token !== "string" || value.refresh_token.length < 20 || value.refresh_token.length > 16_384 ||
      typeof value.expires_in !== "number" || !Number.isInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 604_800 ||
      typeof value.userId !== "string" || value.userId.length < 1 || value.userId.length > 200 ||
      (value.companyId !== undefined && (typeof value.companyId !== "string" || value.companyId.length > 200))) {
    throw new Error("ghl_oauth_scope_mismatch");
  }
  return value as TokenResponse;
}

export async function persistGhlOauthInstallation(token: TokenResponse, config: NonNullable<ReturnType<typeof ghlOauthConfig>>) {
  const db = await database();
  const cipherContext = { keyVersion: config.encryptionKeyVersion, firmId: config.firmId, locationId: config.locationId };
  const { error } = await db.from("voice_screen_ghl_oauth_installations").upsert({
    firm_id: config.firmId,
    location_id: config.locationId,
    marketplace_app_id: config.appId,
    access_token_ciphertext: encryptGhlOauthToken(token.access_token, config.encryptionKey, { ...cipherContext, kind: "access" }),
    refresh_token_ciphertext: encryptGhlOauthToken(token.refresh_token, config.encryptionKey, { ...cipherContext, kind: "refresh" }),
    encryption_key_version: config.encryptionKeyVersion,
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scopes: token.scope.split(/\s+/).filter(Boolean),
    company_id: token.companyId ?? null,
    installed_by_user_id: token.userId,
    status: "active",
    revoked_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "firm_id,location_id" });
  if (error) throw new Error("ghl_oauth_persist_failed");
}
