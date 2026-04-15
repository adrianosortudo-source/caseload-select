/**
 * Clio Manage API v4 client.
 *
 * Handles OAuth 2.0 flow and read-only data access for the Client Portal.
 * Tokens are stored per-firm in intake_firms.clio_config JSONB.
 *
 * Required env vars:
 *   CLIO_CLIENT_ID
 *   CLIO_CLIENT_SECRET
 *   CLIO_REDIRECT_URI  (e.g. https://app.caseloadselect.ca/api/clio/callback)
 *
 * Scopes requested: contacts:read matters:read calendar_entries:read
 */

import { supabase } from "./supabase";

const CLIO_BASE = "https://app.clio.com/api/v4";
const CLIO_AUTH_URL = "https://app.clio.com/oauth/authorize";
const CLIO_TOKEN_URL = "https://app.clio.com/oauth/token";
const SCOPES = "contacts:read matters:read calendar_entries:read";

export interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms timestamp
}

// ─── OAuth helpers ───────────────────────────────────────────────────────────

export function getClioAuthUrl(firmId: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CLIO_CLIENT_ID ?? "",
    redirect_uri: process.env.CLIO_REDIRECT_URI ?? "",
    scope: SCOPES,
    state: firmId,
  });
  return `${CLIO_AUTH_URL}?${params}`;
}

export async function exchangeClioCode(code: string): Promise<ClioTokens> {
  const res = await fetch(CLIO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.CLIO_CLIENT_ID ?? "",
      client_secret: process.env.CLIO_CLIENT_SECRET ?? "",
      redirect_uri: process.env.CLIO_REDIRECT_URI ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Clio token exchange failed: ${res.status}`);
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

async function refreshClioTokens(tokens: ClioTokens): Promise<ClioTokens> {
  const res = await fetch(CLIO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: process.env.CLIO_CLIENT_ID ?? "",
      client_secret: process.env.CLIO_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Clio token refresh failed: ${res.status}`);
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

// ─── Token storage in intake_firms.clio_config ───────────────────────────────

export async function saveClioTokens(firmId: string, tokens: ClioTokens): Promise<void> {
  await supabase
    .from("intake_firms")
    .update({ clio_config: tokens })
    .eq("id", firmId);
}

async function loadClioTokens(firmId: string): Promise<ClioTokens | null> {
  const { data } = await supabase
    .from("intake_firms")
    .select("clio_config")
    .eq("id", firmId)
    .single();
  return (data?.clio_config as ClioTokens) ?? null;
}

async function getFreshTokens(firmId: string): Promise<ClioTokens | null> {
  const tokens = await loadClioTokens(firmId);
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - 60_000) return tokens;
  const refreshed = await refreshClioTokens(tokens);
  await saveClioTokens(firmId, refreshed);
  return refreshed;
}

// ─── API fetch helper ────────────────────────────────────────────────────────

async function clioFetch<T>(firmId: string, path: string, params?: Record<string, string>): Promise<T | null> {
  const tokens = await getFreshTokens(firmId);
  if (!tokens) return null;
  const url = new URL(`${CLIO_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

// ─── Read-only data accessors ─────────────────────────────────────────────────

export interface ClioMatter {
  id: number;
  display_number: string;
  description: string;
  status: string;
  practice_area: { name: string } | null;
  client: { name: string } | null;
  open_date: string | null;
  close_date: string | null;
}

export interface ClioContact {
  id: number;
  name: string;
  type: string;
  primary_email_address: string | null;
  primary_phone_number: string | null;
}

export async function getClioMatters(firmId: string, limit = 25): Promise<ClioMatter[]> {
  const data = await clioFetch<{ data: ClioMatter[] }>(firmId, "/matters", {
    limit: String(limit),
    order: "created_at(desc)",
    fields: "id,display_number,description,status,practice_area{name},client{name},open_date,close_date",
  });
  return data?.data ?? [];
}

export async function getClioContacts(firmId: string, query: string): Promise<ClioContact[]> {
  const data = await clioFetch<{ data: ClioContact[] }>(firmId, "/contacts", {
    query,
    limit: "10",
    fields: "id,name,type,primary_email_address,primary_phone_number",
  });
  return data?.data ?? [];
}

export async function isClioConnected(firmId: string): Promise<boolean> {
  const tokens = await loadClioTokens(firmId);
  return tokens !== null;
}
