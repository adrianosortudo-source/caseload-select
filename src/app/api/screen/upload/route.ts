/**
 * POST /api/screen/upload
 *
 * Accepts a single file attachment for a Round 3 intake session.
 * Files are stored in Supabase Storage under the firm's namespace.
 *
 * Gate: session must have otp_verified = true. File slots only appear in
 * Round 3, which starts after OTP  -  so otp_verified is the sufficient gate.
 *
 * Body: multipart/form-data
 *   session_id: string
 *   file:       File  -  the attachment
 *
 * Returns:
 *   { url: string; path: string; filename: string }
 *
 * Storage layout:
 *   intake-attachments/{firmId}/{sessionId}/{timestamp}-{sanitizedFilename}
 *
 * Max file size: 10 MB. Allowed MIME types: image/*, application/pdf, text/plain.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const BUCKET = "intake-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
    }

    const formData = await req.formData();
    const sessionId = formData.get("session_id");
    const file = formData.get("file");

    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
    }

    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `File type ${file.type} not allowed. Use PDF, image, or plain text.` },
        { status: 415 },
      );
    }

    // Verify session: must have otp_verified (R3 gate)
    const { data: session, error: sessionErr } = await supabase
      .from("intake_sessions")
      .select("id, firm_id, otp_verified")
      .eq("id", sessionId)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!session.otp_verified) {
      return NextResponse.json({ error: "OTP verification required before uploading files" }, { status: 403 });
    }

    const firmId = (session.firm_id as string | null) ?? "unknown";
    const timestamp = Date.now();
    const safeFilename = sanitizeFilename(file.name || "attachment");
    const storagePath = `${firmId}/${sessionId}/${timestamp}-${safeFilename}`;

    const buffer = await file.arrayBuffer();

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      console.error("[screen/upload] Storage error:", uploadErr);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      url: urlData.publicUrl,
      path: storagePath,
      filename: file.name,
    });
  } catch (err) {
    console.error("[screen/upload] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
