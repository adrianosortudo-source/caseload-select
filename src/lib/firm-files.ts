/**
 * I/O wrapper for the firm file exchange.
 *
 * Owns the storage bucket + DB pair: every upload writes to `firm-files`
 * storage AND inserts into `firm_files` + `firm_file_events`. Every signed
 * download URL is logged. Archive is soft (storage object retained).
 *
 * The /api/portal/[firmId]/files routes call into this. UI never talks to
 * Supabase storage directly — signed URLs flow through here.
 */

import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  buildStoragePath,
  validateUpload,
  validateExternalUrl,
  cleanLinkTitle,
  isValidSection,
  type FileSection,
  type FileKind,
} from "@/lib/firm-files-pure";

const BUCKET_ID = "firm-files";
const SIGNED_URL_TTL_SECONDS = 60;

export interface FirmFileRow {
  id: string;
  firm_id: string;
  kind: FileKind;
  uploaded_by_role: "operator" | "lawyer";
  uploaded_by_id: string | null;
  section: FileSection;
  category: string | null;       // legacy functional category; retained for back-compat
  display_name: string;
  storage_path: string | null;   // null for link rows
  size_bytes: number | null;     // null for link rows
  mime_type: string | null;      // null for link rows
  external_url: string | null;   // set for link rows
  description: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by_role: "operator" | "lawyer" | null;
  archived_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActorContext {
  role: "operator" | "lawyer";
  lawyer_id?: string | null;
}

/**
 * List files for a firm, newest first.
 */
export async function listFirmFiles(
  firmId: string,
  options: { includeArchived?: boolean; section?: FileSection } = {},
): Promise<FirmFileRow[]> {
  let query = supabase
    .from("firm_files")
    .select("*")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: false });

  if (!options.includeArchived) {
    query = query.eq("archived", false);
  }
  if (options.section) {
    query = query.eq("section", options.section);
  }

  const { data, error } = await query.returns<FirmFileRow[]>();
  if (error) throw new Error(`listFirmFiles failed: ${error.message}`);
  return data ?? [];
}

/**
 * Read a single file row by id. Returns null when not found. Caller
 * authorises by checking firm_id against the requesting session.
 */
export async function getFirmFile(fileId: string): Promise<FirmFileRow | null> {
  const { data, error } = await supabase
    .from("firm_files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`getFirmFile failed: ${error.message}`);
  return (data as FirmFileRow | null) ?? null;
}

export interface UploadResult {
  ok: true;
  file: FirmFileRow;
}

export interface UploadFailure {
  ok: false;
  status: 400 | 500;
  reason: string;
  message: string;
}

export interface UploadFileInput {
  firmId: string;
  kind: "file";
  section: string;
  description: string | null;
  filename: string;
  blob: Blob;
  mimeType: string;
  actor: ActorContext;
}

export interface UploadLinkInput {
  firmId: string;
  kind: "link";
  section: string;
  description: string | null;
  externalUrl: string;
  displayName: string;
  actor: ActorContext;
}

export type UploadInput = UploadFileInput | UploadLinkInput;

/**
 * Add a deliverable to the exchange. A `file` uploads bytes to storage; a
 * `link` records an external URL (no storage object). Both insert one
 * firm_files row and log an 'uploaded' audit event.
 */
export async function uploadFirmFile(input: UploadInput): Promise<UploadResult | UploadFailure> {
  return input.kind === "link"
    ? uploadFirmLink(input)
    : uploadFirmFileObject(input);
}

/**
 * File path: validate → storage upload → DB insert → audit log.
 *
 * On any failure between the storage upload and the DB insert, the storage
 * object is best-effort deleted to keep things consistent. A leaked object
 * is non-fatal (no DB row references it; periodic sweep can clean up) but
 * we try not to leave them around.
 */
async function uploadFirmFileObject(input: UploadFileInput): Promise<UploadResult | UploadFailure> {
  // Validate metadata first; cheaper than uploading bytes that we'll reject.
  const validation = validateUpload({
    filename: input.filename,
    section: input.section,
    size: input.blob.size,
    mimeType: input.mimeType,
  });
  if (!validation.ok) {
    return { ok: false, status: 400, reason: validation.reason, message: validation.message };
  }

  const fileId = randomUUID();
  const storagePath = buildStoragePath({
    firmId: input.firmId,
    fileId,
    filename: validation.filename,
  });

  // 1. Upload to storage
  const arrayBuffer = await input.blob.arrayBuffer();
  const uploadResult = await supabase.storage
    .from(BUCKET_ID)
    .upload(storagePath, new Uint8Array(arrayBuffer), {
      contentType: validation.resolvedMime,
      upsert: false,
    });

  if (uploadResult.error) {
    return {
      ok: false,
      status: 500,
      reason: "storage_upload_failed",
      message: uploadResult.error.message,
    };
  }

  // 2. Insert DB row
  const { data: inserted, error: insertErr } = await supabase
    .from("firm_files")
    .insert({
      id: fileId,
      firm_id: input.firmId,
      kind: "file",
      uploaded_by_role: input.actor.role,
      uploaded_by_id: input.actor.lawyer_id ?? null,
      section: validation.section,
      display_name: validation.filename,
      storage_path: storagePath,
      size_bytes: input.blob.size,
      mime_type: validation.resolvedMime,
      description: input.description?.trim() || null,
    })
    .select("*")
    .single();

  if (insertErr) {
    // Best-effort rollback of the storage object.
    void supabase.storage.from(BUCKET_ID).remove([storagePath]);
    return {
      ok: false,
      status: 500,
      reason: "db_insert_failed",
      message: insertErr.message,
    };
  }

  // 3. Audit
  await logFileEvent({
    fileId,
    firmId: input.firmId,
    actor: input.actor,
    eventType: "uploaded",
    metadata: { display_name: validation.filename, size_bytes: input.blob.size, kind: "file" },
  });

  return { ok: true, file: inserted as FirmFileRow };
}

/**
 * Link path: validate section + URL → DB insert → audit log. No storage write.
 */
async function uploadFirmLink(input: UploadLinkInput): Promise<UploadResult | UploadFailure> {
  if (!input.section || !isValidSection(input.section)) {
    return { ok: false, status: 400, reason: "invalid_section", message: "a valid section is required" };
  }
  const urlValidation = validateExternalUrl(input.externalUrl);
  if (!urlValidation.ok) {
    return { ok: false, status: 400, reason: urlValidation.reason, message: urlValidation.message };
  }
  const title = cleanLinkTitle(input.displayName, urlValidation.url);

  const fileId = randomUUID();
  const { data: inserted, error: insertErr } = await supabase
    .from("firm_files")
    .insert({
      id: fileId,
      firm_id: input.firmId,
      kind: "link",
      uploaded_by_role: input.actor.role,
      uploaded_by_id: input.actor.lawyer_id ?? null,
      section: input.section,
      display_name: title,
      external_url: urlValidation.url,
      description: input.description?.trim() || null,
    })
    .select("*")
    .single();

  if (insertErr) {
    return {
      ok: false,
      status: 500,
      reason: "db_insert_failed",
      message: insertErr.message,
    };
  }

  await logFileEvent({
    fileId,
    firmId: input.firmId,
    actor: input.actor,
    eventType: "uploaded",
    metadata: { display_name: title, kind: "link" },
  });

  return { ok: true, file: inserted as FirmFileRow };
}

/**
 * Generate a short-lived signed URL for download. Logs a 'downloaded' event
 * on success. Caller must have already authorised the actor against the
 * file's firm_id.
 */
export async function getFirmFileSignedUrl(args: {
  file: FirmFileRow;
  actor: ActorContext;
}): Promise<{ ok: true; url: string; expires_in_seconds: number } | { ok: false; message: string }> {
  if (!args.file.storage_path) {
    return { ok: false, message: "this item has no stored file" };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET_ID)
    .createSignedUrl(args.file.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: args.file.display_name,
    });

  if (error || !data?.signedUrl) {
    return { ok: false, message: error?.message ?? "could not sign url" };
  }

  await logFileEvent({
    fileId: args.file.id,
    firmId: args.file.firm_id,
    actor: args.actor,
    eventType: "downloaded",
  });

  return { ok: true, url: data.signedUrl, expires_in_seconds: SIGNED_URL_TTL_SECONDS };
}

/**
 * Resolve a link item's external URL and log an 'opened' event. Caller must
 * have already authorised the actor against the file's firm_id.
 */
export async function getFirmFileLinkUrl(args: {
  file: FirmFileRow;
  actor: ActorContext;
}): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!args.file.external_url) {
    return { ok: false, message: "this item is not a link" };
  }

  await logFileEvent({
    fileId: args.file.id,
    firmId: args.file.firm_id,
    actor: args.actor,
    eventType: "opened",
  });

  return { ok: true, url: args.file.external_url };
}

/**
 * Soft-delete: flips archived=true, captures who/when, logs event. The
 * storage object is intentionally NOT deleted; it is kept for audit and the
 * (rare) operator un-archive request. Hard delete is a PIPEDA path.
 */
export async function archiveFirmFile(args: {
  file: FirmFileRow;
  actor: ActorContext;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (args.file.archived) return { ok: true }; // idempotent

  const { error } = await supabase
    .from("firm_files")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by_role: args.actor.role,
      archived_by_id: args.actor.lawyer_id ?? null,
    })
    .eq("id", args.file.id)
    .eq("archived", false); // race guard

  if (error) return { ok: false, message: error.message };

  await logFileEvent({
    fileId: args.file.id,
    firmId: args.file.firm_id,
    actor: args.actor,
    eventType: "archived",
  });

  return { ok: true };
}

// ─── Audit ──────────────────────────────────────────────────────────────────

interface LogEventInput {
  fileId: string;
  firmId: string;
  actor: ActorContext;
  eventType: "uploaded" | "downloaded" | "archived" | "restored" | "opened";
  metadata?: Record<string, unknown>;
}

async function logFileEvent(input: LogEventInput): Promise<void> {
  const { error } = await supabase.from("firm_file_events").insert({
    file_id: input.fileId,
    firm_id: input.firmId,
    actor_role: input.actor.role,
    actor_id: input.actor.lawyer_id ?? null,
    event_type: input.eventType,
    metadata: input.metadata ?? null,
  });
  if (error) {
    // Audit failure shouldn't break the user-visible operation.
    console.error("[firm-files] audit insert failed:", error.message);
  }
}
