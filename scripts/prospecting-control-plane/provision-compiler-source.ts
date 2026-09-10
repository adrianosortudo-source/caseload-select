export type JsonObject = Record<string, unknown>;
export const EXPECTED_CLS_IDS = [
  ...Array.from({ length: 25 }, (_, i) => `BA-B1-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 25 }, (_, i) => `BA-B2-${String(i + 26).padStart(2, "0")}`),
  ...Array.from({ length: 50 }, (_, i) => `AE-${String(i + 1).padStart(3, "0")}`),
];

const GENERIC_LOCAL_PARTS = new Set(["accounts", "admin", "appointments", "billing", "bookings", "business", "careers", "clientcare", "clients", "clientservices", "consultations", "contact", "contactus", "enquiries", "frontdesk", "general", "hello", "help", "hiring", "info", "inquiries", "inquiry", "intake", "law", "lawyers", "legal", "mail", "marketing", "media", "newclients", "noreply", "office", "reception", "receptiondesk", "recruiting", "service", "services", "support", "team"]);

export interface AuthorityRecord {
  id: string; firm: string; domain: string; person: string; role: string | null; email: string;
  route: string; urls: string[]; observedAt: string; payloadPath: string | null;
  payloadSha256: string; version: string;
}

export function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}
export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
function optionalText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function domain(value: string): string { return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); }
function timestamp(value: string, label: string): string {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO date or timestamp.`);
  return parsed.toISOString();
}
function firstParty(value: unknown, expectedDomain: string, label: string): string {
  let parsed: URL;
  try { parsed = new URL(text(value, label)); } catch { throw new Error(`${label} must be a valid HTTP(S) URL.`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`${label} must be HTTP(S).`);
  const host = domain(parsed.hostname); const expected = domain(expectedDomain);
  if (host !== expected && !host.endsWith(`.${expected}`) && !expected.endsWith(`.${host}`)) throw new Error(`${label} is not first-party to ${expectedDomain}.`);
  parsed.hash = "";
  return parsed.toString();
}

export function recordsById(value: unknown, label: string): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  array(value, label).forEach((item, i) => {
    const row = object(item, `${label}[${i}]`); const id = text(row.record_id, `${label}[${i}].record_id`);
    if (result.has(id)) throw new Error(`${label} contains duplicate record_id ${id}.`);
    result.set(id, row);
  });
  return result;
}
export function assertExactIds(actual: Iterable<string>, expected: string[], label: string): void {
  const set = new Set(actual); const missing = expected.filter((id) => !set.has(id)); const extra = [...set].filter((id) => !expected.includes(id));
  if (missing.length || extra.length) throw new Error(`${label} CLS ID set mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
}
export function parseBa(row: JsonObject): AuthorityRecord {
  const id = text(row.record_id, "BA record_id"); const host = domain(text(row.domain, `${id}.domain`));
  return { id, firm: text(row.public_firm_name ?? row.firm, `${id}.public_firm_name`), domain: host, person: text(row.owner, `${id}.owner`), role: optionalText(row.owner_role), email: text(row.recipient_email, `${id}.recipient_email`).toLowerCase(), route: text(row.route_class, `${id}.route_class`), urls: [firstParty(row.owner_evidence_url, host, `${id}.owner_evidence_url`)], observedAt: timestamp(text(row.evidence_observed_at, `${id}.evidence_observed_at`), `${id}.evidence_observed_at`), payloadPath: optionalText(row.asset_path), payloadSha256: text(row.asset_sha256, `${id}.asset_sha256`).toLowerCase(), version: "BA_PROMISE_FIRST_ASSET_MANIFEST_v1.5" };
}
export function parseAe(row: JsonObject, version: string): AuthorityRecord {
  const id = text(row.record_id, "AE record_id"); const host = domain(text(row.domain, `${id}.domain`)); const urls = array(row.source_urls, `${id}.source_urls`);
  if (!urls.length) throw new Error(`${id}.source_urls cannot be empty.`);
  return { id, firm: text(row.firm, `${id}.firm`), domain: host, person: text(row.owner, `${id}.owner`), role: optionalText(row.owner_role), email: text(row.recipient, `${id}.recipient`).toLowerCase(), route: text(row.route_class, `${id}.route_class`), urls: urls.map((url, i) => firstParty(url, host, `${id}.source_urls[${i}]`)), observedAt: timestamp(text(row.evidence_observed_at, `${id}.evidence_observed_at`), `${id}.evidence_observed_at`), payloadPath: optionalText(row.journey_path), payloadSha256: text(row.journey_sha256, `${id}.journey_sha256`).toLowerCase(), version };
}
export function isGenericRoute(record: AuthorityRecord): boolean {
  const local = record.email.slice(0, record.email.lastIndexOf("@")).toLowerCase().replace(/[._+-].*$/, "");
  return GENERIC_LOCAL_PARTS.has(local) || /generic|shared/i.test(record.route);
}
export function normalizedIdentity(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, " "); }
export function normalizedDomain(value: string): string { return domain(value); }
export function normalizedTimestamp(value: string, label: string): string { return timestamp(value, label); }
