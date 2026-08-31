import "server-only";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "v3";
const MAX_LOOKUP_PAGES = 10;

export type GhlImportFailureCode =
  | "configuration_missing"
  | "lookup_unauthorized"
  | "lookup_rate_limited"
  | "lookup_failed"
  | "create_rate_limited"
  | "create_failed"
  | "create_uncertain"
  | "bad_response";

export type GhlImportDecision =
  | { ok: true; status: "created"; contactId: string }
  | { ok: true; status: "existing_unchanged"; contactId: string; matchCount: number }
  | { ok: true; status: "held_for_review"; matchCount: number }
  | { ok: false; code: GhlImportFailureCode; reconcileRequired: boolean; retryAfterSeconds?: number };

interface LookupPage {
  contacts?: Array<{ id?: unknown }>;
  meta?: { nextCursor?: unknown };
  nextCursor?: unknown;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

async function lookupExact(
  locationId: string,
  token: string,
  identity: { email: string } | { phone: string },
): Promise<{ ok: true; ids: Set<string> } | { ok: false; code: GhlImportFailureCode; retryAfterSeconds?: number }> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
    const query = new URLSearchParams({ locationId, limit: "20", ...identity });
    if (cursor) query.set("nextCursor", cursor);
    let response: Response;
    try {
      response = await fetch(`${GHL_API_BASE}/contacts/lookup?${query.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_API_VERSION,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch {
      return { ok: false, code: "lookup_failed" };
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, code: "lookup_unauthorized" };
      if (response.status === 429) {
        return { ok: false, code: "lookup_rate_limited", retryAfterSeconds: retryAfterSeconds(response) };
      }
      return { ok: false, code: "lookup_failed" };
    }
    let body: LookupPage;
    try {
      body = (await response.json()) as LookupPage;
    } catch {
      return { ok: false, code: "bad_response" };
    }
    if (!Array.isArray(body.contacts)) return { ok: false, code: "bad_response" };
    for (const contact of body.contacts) if (typeof contact.id === "string" && contact.id) ids.add(contact.id);
    const next = body.meta?.nextCursor ?? body.nextCursor;
    if (typeof next !== "string" || !next || next === cursor) return { ok: true, ids };
    cursor = next;
  }
  return { ok: false, code: "lookup_failed" };
}

export async function importContactCreateOnly(input: {
  locationId: string | null | undefined;
  token: string | null | undefined;
  batchId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  relationshipType: "current_client" | "former_client" | "prospective_client" | "referral_source" | "unknown";
  marketingPermission: "express" | "implied" | "unknown" | "no_contact";
  practiceArea: string | null;
  matterClosedYear: number | null;
}): Promise<GhlImportDecision> {
  const locationId = input.locationId?.trim();
  const token = input.token?.trim();
  if (!locationId || !token) return { ok: false, code: "configuration_missing", reconcileRequired: false };

  const matchIds = new Set<string>();
  for (const identity of [
    input.email ? ({ email: input.email } as const) : null,
    input.phone ? ({ phone: input.phone } as const) : null,
  ]) {
    if (!identity) continue;
    const result = await lookupExact(locationId, token, identity);
    if (!result.ok) return { ok: false, code: result.code, reconcileRequired: false, retryAfterSeconds: result.retryAfterSeconds };
    for (const id of result.ids) matchIds.add(id);
  }

  if (matchIds.size === 1) {
    return { ok: true, status: "existing_unchanged", contactId: [...matchIds][0], matchCount: 1 };
  }
  if (matchIds.size > 1) return { ok: true, status: "held_for_review", matchCount: matchIds.size };

  const practiceTag = input.practiceArea
    ? input.practiceArea.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    : "unknown";
  const body: Record<string, unknown> = {
    locationId,
    firstName: input.firstName,
    lastName: input.lastName,
    dnd: true,
    source: "CaseLoad Select firm-authorized relationship import",
    tags: [
      "caseload-select:import-hold",
      `caseload-select:import:${input.batchId}`,
      `caseload-select:relationship:${input.relationshipType}`,
      `caseload-select:permission:${input.marketingPermission}`,
      `caseload-select:practice:${practiceTag || "unknown"}`,
      `caseload-select:matter-closed:${input.matterClosedYear ?? "unknown"}`,
    ],
  };
  if (input.email) body.email = input.email;
  if (input.phone) body.phone = input.phone;

  let response: Response;
  try {
    response = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "create_uncertain", reconcileRequired: true };
  }
  if (!response.ok) {
    if (response.status === 429) {
      return { ok: false, code: "create_rate_limited", reconcileRequired: false, retryAfterSeconds: retryAfterSeconds(response) };
    }
    // A timeout/5xx can occur after the upstream contact is committed. Never
    // retry create blindly; force a new exact lookup first.
    if (response.status >= 500) return { ok: false, code: "create_uncertain", reconcileRequired: true };
    return { ok: false, code: "create_failed", reconcileRequired: false };
  }
  try {
    const root = (await response.json()) as { contact?: { id?: unknown }; id?: unknown };
    const id = typeof root.contact?.id === "string" ? root.contact.id : typeof root.id === "string" ? root.id : null;
    if (!id) return { ok: false, code: "bad_response", reconcileRequired: true };
    return { ok: true, status: "created", contactId: id };
  } catch {
    return { ok: false, code: "bad_response", reconcileRequired: true };
  }
}
