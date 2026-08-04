/**
 * Client-list intake, two-path model (Firm Profile Form 2, Section B).
 *
 * Pure validation and display helpers, no I/O, no server-only import so this
 * loads cleanly from vitest. Used by the firm-profile submit route, the
 * FirmProfileForm client component, the admin onboarding-submissions views,
 * and the operator launch validator at /onboarding.
 */

export interface ClientListFile {
  storage_path: string;
  original_name: string;
  size_bytes: number;
  mime_type: string | null;
}

export type ClientListPath = "share_with_us" | "self_upload";

export const MAX_CLIENT_LIST_FILES = 10;
export const MAX_CLIENT_LIST_FILE_BYTES = 50 * 1024 * 1024;

type ValidationResult =
  | { ok: true; value: { path: ClientListPath; files: ClientListFile[]; selfUploadConfirmed: boolean } }
  | { ok: false; error: string };

function isValidFileEntry(entry: unknown, tokenPrefix: string): entry is ClientListFile {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.storage_path !== "string" || !e.storage_path.startsWith(tokenPrefix)) return false;
  if (typeof e.original_name !== "string" || e.original_name.length === 0 || e.original_name.length > 200) {
    return false;
  }
  if (
    typeof e.size_bytes !== "number" ||
    !Number.isInteger(e.size_bytes) ||
    e.size_bytes < 1 ||
    e.size_bytes > MAX_CLIENT_LIST_FILE_BYTES
  ) {
    return false;
  }
  if (e.mime_type !== null && typeof e.mime_type !== "string") return false;
  return true;
}

export function validateClientListSubmission(
  body: {
    client_list_path?: unknown;
    client_list_files?: unknown;
    client_list_attested?: unknown;
    client_list_self_upload_confirmed?: unknown;
  },
  token: string
): ValidationResult {
  const path = body.client_list_path;
  if (path !== "share_with_us" && path !== "self_upload") {
    return { ok: false, error: "client_list_path is required (share_with_us or self_upload)" };
  }

  if (body.client_list_attested !== true) {
    return { ok: false, error: "the consent attestation is required" };
  }

  if (path === "share_with_us") {
    const files = body.client_list_files;
    if (!Array.isArray(files) || files.length === 0) {
      return { ok: false, error: "at least one uploaded file is required on the share_with_us path" };
    }
    if (files.length > MAX_CLIENT_LIST_FILES) {
      return { ok: false, error: "too many files; max 10" };
    }
    const tokenPrefix = `${encodeURIComponent(token)}/`;
    for (const entry of files) {
      if (!isValidFileEntry(entry, tokenPrefix)) {
        return { ok: false, error: "invalid file entry" };
      }
    }
    return {
      ok: true,
      value: { path, files: files as ClientListFile[], selfUploadConfirmed: false },
    };
  }

  // path === "self_upload"
  if (body.client_list_self_upload_confirmed !== true) {
    return { ok: false, error: "self-upload confirmation is required" };
  }
  const files = body.client_list_files;
  if (files !== undefined && !(Array.isArray(files) && files.length === 0)) {
    return { ok: false, error: "files cannot be attached on the self_upload path" };
  }
  return { ok: true, value: { path, files: [], selfUploadConfirmed: true } };
}

function parseFilesArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function clientListStatusLabel(row: {
  client_list_path: string | null;
  client_list_files: unknown;
  client_list_import_verified_at: string | null;
  client_list_working_copy_deleted_at: string | null;
}): string {
  if (row.client_list_working_copy_deleted_at) return "deleted";
  if (row.client_list_import_verified_at) return "verified";
  if (row.client_list_path === "self_upload") return "self-upload";
  if (row.client_list_path === "share_with_us") {
    return `files (${parseFilesArray(row.client_list_files).length})`;
  }
  return "none";
}

export interface ClientListCheckSubmission {
  legal_name: string | null;
  submitted_at: string;
  client_list_path: string | null;
  client_list_files: unknown;
  client_list_attested_at: string | null;
  client_list_import_verified_at: string | null;
  client_list_working_copy_deleted_at: string | null;
}

export function deriveClientListCheck(
  submissions: ClientListCheckSubmission[],
  firmName: string
): { status: "pass" | "fail" | "warn"; detail: string } {
  const target = firmName.trim().toLowerCase();
  const matches = submissions.filter(
    (s) => s.legal_name !== null && s.legal_name.trim().toLowerCase() === target && s.client_list_path !== null
  );

  let candidate: ClientListCheckSubmission | null = null;
  for (const s of matches) {
    if (!candidate || new Date(s.submitted_at).getTime() > new Date(candidate.submitted_at).getTime()) {
      candidate = s;
    }
  }

  if (!candidate) {
    return { status: "fail", detail: "No firm-profile submission with a client list" };
  }

  if (!candidate.client_list_attested_at) {
    return { status: "fail", detail: "Client list present but consent attestation missing" };
  }

  if (candidate.client_list_path === "self_upload") {
    return { status: "pass", detail: "Self-upload confirmed by the firm" };
  }

  // client_list_path === "share_with_us"
  if (!candidate.client_list_import_verified_at) {
    const n = parseFilesArray(candidate.client_list_files).length;
    return { status: "warn", detail: `Files received (${n}): import not yet verified` };
  }

  if (!candidate.client_list_working_copy_deleted_at) {
    return { status: "pass", detail: "Imported and verified: working copy pending deletion" };
  }

  return { status: "pass", detail: "Imported, verified, working copy deleted" };
}
