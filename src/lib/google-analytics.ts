/**
 * GA4 Data API client.
 *
 * Uses a Google Cloud service account (base64-encoded JSON in
 * GOOGLE_SERVICE_ACCOUNT_KEY) to fetch reporting data from the
 * GA4 Data API v1beta. Auth is a self-signed JWT exchanged for
 * an access token; no npm dependency required.
 *
 * Env:  GOOGLE_SERVICE_ACCOUNT_KEY  (base64-encoded service account JSON)
 */

import * as crypto from "crypto";

const GA4_BASE = "https://analyticsdata.googleapis.com/v1beta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_LIFETIME_S = 3600;

// ─── Token cache ────────────────────────────────────────────────────────────

let cachedToken: { access_token: string; expires_at: number } | null = null;

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function buildJwt(sa: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_LIFETIME_S,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: sa.private_key,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }
  const sa = loadServiceAccount();
  if (!sa) return null;
  const jwt = buildJwt(sa);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function isGA4Available(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
}

export interface GA4Metric {
  value: number;
  delta: number | null;
}

export interface GA4TopEntry {
  label: string;
  value: number;
}

export interface GA4Report {
  configured: boolean;
  sessions: GA4Metric;
  users: GA4Metric;
  pageviews: GA4Metric;
  engagementRate: GA4Metric;
  topPages: GA4TopEntry[];
  topSources: GA4TopEntry[];
}

interface GA4Row {
  dimensionValues?: Array<{ value: string }>;
  metricValues?: Array<{ value: string }>;
}

interface GA4Response {
  rows?: GA4Row[];
}

async function runReport(
  propertyId: string,
  token: string,
  body: Record<string, unknown>,
): Promise<GA4Response | null> {
  const res = await fetch(`${GA4_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as GA4Response;
}

function metricVal(row: GA4Row | undefined, index: number): number {
  if (!row?.metricValues?.[index]) return 0;
  return Number(row.metricValues[index].value) || 0;
}

function dimVal(row: GA4Row | undefined, index: number): string {
  if (!row?.dimensionValues?.[index]) return "(unknown)";
  return row.dimensionValues[index].value || "(unknown)";
}

function computeDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 1 : null;
  return (current - previous) / previous;
}

export async function fetchGA4Metrics(propertyId: string): Promise<GA4Report> {
  const empty: GA4Report = {
    configured: true,
    sessions: { value: 0, delta: null },
    users: { value: 0, delta: null },
    pageviews: { value: 0, delta: null },
    engagementRate: { value: 0, delta: null },
    topPages: [],
    topSources: [],
  };

  const token = await getAccessToken();
  if (!token) return { ...empty, configured: false };

  const [totals, pages, sources] = await Promise.all([
    runReport(propertyId, token, {
      dateRanges: [
        { startDate: "7daysAgo", endDate: "today" },
        { startDate: "14daysAgo", endDate: "8daysAgo" },
      ],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
        { name: "engagementRate" },
      ],
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5,
    }),
    runReport(propertyId, token, {
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "sessionSourceMedium" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5,
    }),
  ]);

  if (!totals) return empty;

  const current = totals.rows?.[0];
  const previous = totals.rows?.[1];

  return {
    configured: true,
    sessions: {
      value: metricVal(current, 0),
      delta: computeDelta(metricVal(current, 0), metricVal(previous, 0)),
    },
    users: {
      value: metricVal(current, 1),
      delta: computeDelta(metricVal(current, 1), metricVal(previous, 1)),
    },
    pageviews: {
      value: metricVal(current, 2),
      delta: computeDelta(metricVal(current, 2), metricVal(previous, 2)),
    },
    engagementRate: {
      value: metricVal(current, 3),
      delta: computeDelta(metricVal(current, 3), metricVal(previous, 3)),
    },
    topPages: (pages?.rows ?? []).map((r) => ({
      label: dimVal(r, 0),
      value: metricVal(r, 0),
    })),
    topSources: (sources?.rows ?? []).map((r) => ({
      label: dimVal(r, 0),
      value: metricVal(r, 0),
    })),
  };
}
