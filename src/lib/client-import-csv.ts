export const CLIENT_IMPORT_TEMPLATE_VERSION = "relationship-import-v1";
export const CLIENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CLIENT_IMPORT_MAX_ROWS = 5000;

export const CLIENT_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "relationship_type",
  "practice_area",
  "matter_closed_year",
  "marketing_permission",
] as const;

export type ClientImportPermission = "express" | "implied" | "unknown" | "no_contact";
export type ClientImportRelationship =
  | "current_client"
  | "former_client"
  | "prospective_client"
  | "referral_source"
  | "unknown";

export interface ClientImportRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  relationshipType: ClientImportRelationship;
  practiceArea: string | null;
  matterClosedYear: number | null;
  marketingPermission: ClientImportPermission;
}

export interface ClientImportIssue {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ClientImportParseResult {
  ok: boolean;
  rows: ClientImportRow[];
  issues: ClientImportIssue[];
  headers: string[];
  missingHeaders: string[];
}

const ALIASES: Record<string, (typeof CLIENT_IMPORT_HEADERS)[number]> = {
  "first name": "first_name",
  firstname: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  "relationship type": "relationship_type",
  relationship: "relationship_type",
  "practice area": "practice_area",
  "matter closed year": "matter_closed_year",
  "year matter closed": "matter_closed_year",
  "marketing permission": "marketing_permission",
  "marketing consent": "marketing_permission",
  consent: "marketing_permission",
};

const FORBIDDEN_HEADERS = new Set([
  "notes",
  "matter_details",
  "matter details",
  "case_summary",
  "case summary",
  "documents",
  "privileged_content",
  "privileged content",
]);

function canonicalHeader(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES[normalized] ?? normalized.replaceAll(" ", "_");
}

export function parseCsvRecords(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  return records.filter((row) => row.some((cell) => cell.trim() !== ""));
}

export function normalizeClientImportPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function normalizeClientImportEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function enumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return fallback;
  return allowed.includes(normalized as T) ? (normalized as T) : null;
}

export function parseClientImportCsv(
  input: string,
  options: { byteLength?: number; maxRows?: number } = {},
): ClientImportParseResult {
  const issues: ClientImportIssue[] = [];
  if ((options.byteLength ?? new TextEncoder().encode(input).byteLength) > CLIENT_IMPORT_MAX_FILE_BYTES) {
    return {
      ok: false,
      rows: [],
      issues: [{ rowNumber: 1, field: "file", message: "CSV must be 5 MB or smaller." }],
      headers: [],
      missingHeaders: [...CLIENT_IMPORT_HEADERS],
    };
  }

  let records: string[][];
  try {
    records = parseCsvRecords(input);
  } catch (error) {
    return {
      ok: false,
      rows: [],
      issues: [{ rowNumber: 1, field: "file", message: error instanceof Error ? error.message : "Invalid CSV." }],
      headers: [],
      missingHeaders: [...CLIENT_IMPORT_HEADERS],
    };
  }
  if (records.length < 2) {
    return {
      ok: false,
      rows: [],
      issues: [{ rowNumber: 1, field: "file", message: "CSV must include a header row and at least one contact." }],
      headers: records[0] ?? [],
      missingHeaders: [...CLIENT_IMPORT_HEADERS],
    };
  }

  const rawHeaders = records[0].map((header) => header.trim());
  const headers = rawHeaders.map(canonicalHeader);
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  const missingHeaders = CLIENT_IMPORT_HEADERS.filter((header) => !headers.includes(header));
  if (duplicates.length) {
    issues.push({ rowNumber: 1, field: "headers", message: `Duplicate columns: ${[...new Set(duplicates)].join(", ")}.` });
  }
  if (missingHeaders.length) {
    issues.push({ rowNumber: 1, field: "headers", message: `Missing required columns: ${missingHeaders.join(", ")}.` });
  }
  const forbidden = rawHeaders.filter((header) => FORBIDDEN_HEADERS.has(header.trim().toLowerCase()));
  if (forbidden.length) {
    issues.push({
      rowNumber: 1,
      field: "headers",
      message: `Remove columns that may contain privileged or matter-detail content: ${forbidden.join(", ")}.`,
    });
  }
  if (issues.length) return { ok: false, rows: [], issues, headers, missingHeaders };

  const maxRows = Math.min(options.maxRows ?? CLIENT_IMPORT_MAX_ROWS, CLIENT_IMPORT_MAX_ROWS);
  if (records.length - 1 > maxRows) {
    return {
      ok: false,
      rows: [],
      issues: [{ rowNumber: 1, field: "file", message: `CSV contains more than ${maxRows} contacts.` }],
      headers,
      missingHeaders: [],
    };
  }

  const rows: ClientImportRow[] = [];
  const identities = new Map<string, number>();
  for (let index = 1; index < records.length; index += 1) {
    const rowNumber = index + 1;
    const cells = records[index];
    const value = (header: string) => cells[headers.indexOf(header)]?.trim() ?? "";
    const firstName = value("first_name").slice(0, 100);
    const lastName = value("last_name").slice(0, 100);
    const rawEmail = value("email");
    const rawPhone = value("phone");
    const email = normalizeClientImportEmail(rawEmail);
    const phone = normalizeClientImportPhone(rawPhone);
    const relationshipType = enumValue<ClientImportRelationship>(
      value("relationship_type"),
      ["current_client", "former_client", "prospective_client", "referral_source", "unknown"],
      "unknown",
    );
    const marketingPermission = enumValue<ClientImportPermission>(
      value("marketing_permission"),
      ["express", "implied", "unknown", "no_contact"],
      "unknown",
    );
    const closedYearRaw = value("matter_closed_year");
    const closedYear = closedYearRaw ? Number.parseInt(closedYearRaw, 10) : null;

    if (!firstName && !lastName) issues.push({ rowNumber, field: "name", message: "Provide a first or last name." });
    if (rawEmail && !email) issues.push({ rowNumber, field: "email", message: "Enter a valid email address." });
    if (rawPhone && !phone) issues.push({ rowNumber, field: "phone", message: "Use a Canadian/US 10-digit number or E.164 format." });
    if (!email && !phone) issues.push({ rowNumber, field: "identity", message: "Provide a valid email address or phone number." });
    if (!relationshipType) issues.push({ rowNumber, field: "relationship_type", message: "Use a supported relationship type." });
    if (!marketingPermission) issues.push({ rowNumber, field: "marketing_permission", message: "Use express, implied, unknown, or no_contact." });
    if (closedYear !== null && (!/^\d{4}$/.test(closedYearRaw) || closedYear < 1900 || closedYear > new Date().getFullYear())) {
      issues.push({ rowNumber, field: "matter_closed_year", message: "Use a four-digit year no later than the current year." });
    }

    const keys = [email && `email:${email}`, phone && `phone:${phone}`].filter(Boolean) as string[];
    for (const key of keys) {
      const prior = identities.get(key);
      if (prior) issues.push({ rowNumber, field: "identity", message: `Duplicates row ${prior} in this CSV.` });
      else identities.set(key, rowNumber);
    }

    if (!issues.some((issue) => issue.rowNumber === rowNumber)) {
      rows.push({
        rowNumber,
        firstName,
        lastName,
        email,
        phone,
        relationshipType: relationshipType!,
        practiceArea: value("practice_area").slice(0, 120) || null,
        matterClosedYear: closedYear,
        marketingPermission: marketingPermission!,
      });
    }
  }

  return { ok: issues.length === 0, rows, issues, headers, missingHeaders: [] };
}
