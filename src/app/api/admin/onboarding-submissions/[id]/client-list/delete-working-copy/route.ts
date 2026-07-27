/**
 * POST /api/admin/onboarding-submissions/[id]/client-list/delete-working-copy
 *
 * Operator-only. Removes the uploaded client-list files (and the legacy
 * single-file customer_base upload, when present) from the
 * firm-onboarding-docs storage bucket, once the import has been verified.
 * This is the PIPEDA delete-after-import step: the firm's data stops living
 * in our storage, while the file-metadata audit trail (name, size, mime,
 * path) stays on the row.
 *
 * Blocked until client-list/verify has run first, and blocked a second time
 * once already deleted, so this can never fire twice or fire early.
 *
 * Auth: getOperatorSession() (same gate as /admin/*).
 *
 * Returns:
 *   200 { ok: true, deleted_at, removed }
 *   400 { ok: false, error }               // missing id, or wrong path
 *   401 { ok: false, error: "unauthorized" }
 *   404 { ok: false, error: "submission not found" }
 *   409 { ok: false, error: "import not verified yet" }
 *   409 { ok: false, error: "already deleted" }
 *   500 { ok: false, error }               // storage removal failed; row not stamped
 */

import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const BUCKET = "firm-onboarding-docs";

interface ClientListFileRow {
  storage_path?: unknown;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .select(
      "id, client_list_path, client_list_files, customer_base_storage_path, client_list_import_verified_at, client_list_working_copy_deleted_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ ok: false, error: `lookup failed: ${lookupErr.message}` }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ ok: false, error: "submission not found" }, { status: 404 });
  }
  if (existing.client_list_path !== "share_with_us") {
    return NextResponse.json(
      { ok: false, error: "this submission is not on the share_with_us path" },
      { status: 400 },
    );
  }
  if (!existing.client_list_import_verified_at) {
    return NextResponse.json({ ok: false, error: "import not verified yet" }, { status: 409 });
  }
  if (existing.client_list_working_copy_deleted_at) {
    return NextResponse.json({ ok: false, error: "already deleted" }, { status: 409 });
  }

  const files: unknown = existing.client_list_files;
  const filePaths = (Array.isArray(files) ? files : [])
    .map((f: ClientListFileRow) => (typeof f?.storage_path === "string" ? f.storage_path : null))
    .filter((p): p is string => p !== null);
  const legacyPath = existing.customer_base_storage_path;
  const paths = legacyPath ? [...filePaths, legacyPath] : filePaths;

  if (paths.length > 0) {
    const { error: removeErr } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
    if (removeErr) {
      return NextResponse.json({ ok: false, error: `storage removal failed: ${removeErr.message}` }, { status: 500 });
    }
  }

  const deletedAt = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("firm_onboarding_intake")
    .update({ client_list_working_copy_deleted_at: deletedAt })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: `update failed: ${updateErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted_at: deletedAt, removed: paths.length });
}
