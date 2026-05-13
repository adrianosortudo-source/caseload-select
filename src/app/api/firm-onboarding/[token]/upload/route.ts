/**
 * POST /api/firm-onboarding/[token]/upload
 *
 * Receives a single verification document upload from the public form at
 * /firm-onboarding/[token]. Stores the file in the private
 * `firm-onboarding-docs` Supabase Storage bucket and returns the storage
 * path plus metadata so the form can persist them on the eventual row.
 *
 * The token is the credential; anyone with the URL can upload. The
 * Supabase storage policy enforces file size (10 MB) and MIME type
 * (PDF / JPEG / PNG) — we also validate here for fast feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const BUCKET = "firm-onboarding-docs";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

// Filename sanitizer — keep alphanumeric, dot, dash, underscore. Replace the
// rest. Prevents path traversal and weird filesystem behaviour.
function sanitizeFilename(name: string): string {
  const trimmed = name.slice(0, 120);
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "expected multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "no file field in form data" },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `file too large; max ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `unsupported file type: ${file.type}. Allowed: PDF, JPEG, PNG.` },
      { status: 400 }
    );
  }

  const safeName = sanitizeFilename(file.name);
  const stamp = Date.now();
  const storagePath = `${encodeURIComponent(token)}/${stamp}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      { ok: false, error: `upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    storage_path: storagePath,
    original_name: file.name,
    size_bytes: file.size,
    mime_type: file.type,
  });
}
