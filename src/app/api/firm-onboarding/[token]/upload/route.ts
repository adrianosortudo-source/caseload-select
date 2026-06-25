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
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";

const BUCKET = "firm-onboarding-docs";

// Two upload kinds share this route + bucket. `verification` is the WhatsApp
// business-verification doc (tight: 10 MB, PDF / JPEG / PNG). `fees` is the
// Services + Fees schedule a firm uploads (looser: 50 MB, common office,
// document, and image formats). The form passes `kind` in the multipart body;
// anything other than "fees" falls back to the verification profile.
const UPLOAD_KINDS = {
  verification: {
    maxBytes: 10 * 1024 * 1024, // 10 MB
    prefix: "",
    allowedMime: new Set(["application/pdf", "image/jpeg", "image/png"]),
  },
  fees: {
    maxBytes: 50 * 1024 * 1024, // 50 MB
    prefix: "fees/",
    allowedMime: new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
    ]),
  },
} as const;

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

  if (!token || token.length < 8 || token.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid token" }, { status: 400 });
  }

  // The token is a shared-secret slug, not a pre-registered key, so an
  // unguessable token is the only gate. Rate-limit per IP to cap junk/cost
  // writes to the private bucket from anyone fuzzing token prefixes.
  const rl = await checkRateLimit("firmOnboarding", ipFromRequest(req));
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many uploads from this network. Try again later." },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
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

  const kindRaw = formData.get("kind");
  const kind: keyof typeof UPLOAD_KINDS = kindRaw === "fees" ? "fees" : "verification";
  const { maxBytes, prefix, allowedMime } = UPLOAD_KINDS[kind];

  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `file too large; max ${maxBytes / 1024 / 1024} MB` },
      { status: 400 }
    );
  }
  if (!allowedMime.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `unsupported file type: ${file.type || "unknown"}.` },
      { status: 400 }
    );
  }

  const safeName = sanitizeFilename(file.name);
  const stamp = Date.now();
  const storagePath = `${encodeURIComponent(token)}/${prefix}${stamp}-${safeName}`;

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
