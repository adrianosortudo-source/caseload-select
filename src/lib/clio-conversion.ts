/**
 * Clio matter creation on lead conversion.
 *
 * Called when a lead's stage moves to client_won.
 * Creates a Clio contact (if none exists) and opens a new matter.
 *
 * Gracefully no-ops if:
 *   - The firm has no Clio tokens (firm not connected to Clio)
 *   - CLIO_CLIENT_ID is not configured
 *   - Any Clio API call fails (non-fatal  -  lead is won regardless)
 */

import { supabaseAdmin as supabase } from "./supabase-admin";

const CLIO_BASE = "https://app.clio.com/api/v4";
const CLIO_TOKEN_URL = "https://app.clio.com/oauth/token";

interface ClioTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  case_type: string | null;
  description: string | null;
  law_firm_id: string | null;
}

export interface ClioConversionResult {
  skipped: boolean;
  reason?: string;
  clio_contact_id?: number;
  clio_matter_id?: number;
}

async function getValidToken(firmId: string): Promise<string | null> {
  const { data: firm } = await supabase
    .from("intake_firms")
    .select("clio_config")
    .eq("id", firmId)
    .single();

  const tokens = firm?.clio_config as ClioTokens | null;
  if (!tokens) return null;

  // Refresh if within 60 seconds of expiry
  if (Date.now() >= tokens.expires_at - 60_000) {
    try {
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
      if (!res.ok) return null;
      const refreshed = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
      const updated: ClioTokens = {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
      await supabase.from("intake_firms").update({ clio_config: updated }).eq("id", firmId);
      return updated.access_token;
    } catch {
      return null;
    }
  }

  return tokens.access_token;
}

async function clioPost<T>(token: string, path: string, body: object): Promise<T> {
  const res = await fetch(`${CLIO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Clio ${path} ${res.status}: ${err}`);
  }
  return res.json() as Promise<T>;
}

export async function createClioMatter(lead: Lead): Promise<ClioConversionResult> {
  if (!process.env.CLIO_CLIENT_ID) {
    return { skipped: true, reason: "Clio not configured" };
  }

  const firmId = lead.law_firm_id;
  if (!firmId) {
    return { skipped: true, reason: "No firm linked to lead" };
  }

  const token = await getValidToken(firmId);
  if (!token) {
    return { skipped: true, reason: "Firm not connected to Clio" };
  }

  // Split name into first/last (best-effort)
  const nameParts = (lead.name ?? "Unknown").trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || "-";

  // 1. Create contact
  const contactRes = await clioPost<{ data: { id: number } }>(token, "/contacts", {
    data: {
      type: "Person",
      first_name: firstName,
      last_name: lastName,
      ...(lead.email ? { email_addresses: [{ name: "Work", address: lead.email, default_email: true }] } : {}),
      ...(lead.phone ? { phone_numbers: [{ name: "Mobile", number: lead.phone, default_phone: true }] } : {}),
    },
  });
  const clioContactId = contactRes.data.id;

  // 2. Create matter
  const matterDescription = lead.description
    ? lead.description.slice(0, 255)
    : `${lead.case_type ?? "Legal matter"} (CaseLoad Select)`;

  const matterRes = await clioPost<{ data: { id: number } }>(token, "/matters", {
    data: {
      description: matterDescription,
      status: "Open",
      client: { id: clioContactId },
      ...(lead.case_type ? { custom_field_values: [] } : {}),
    },
  });
  const clioMatterId = matterRes.data.id;

  console.log(`[clio-conversion] Created contact ${clioContactId} + matter ${clioMatterId} for lead ${lead.id}`);

  return { skipped: false, clio_contact_id: clioContactId, clio_matter_id: clioMatterId };
}
