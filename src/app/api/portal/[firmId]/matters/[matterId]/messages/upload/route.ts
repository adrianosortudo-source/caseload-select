/**
 * POST /api/portal/[firmId]/matters/[matterId]/messages/upload
 *
 * Accepts a multipart upload (field: "file") and stores the file in the
 * firm-files Supabase storage bucket under a message-attachments prefix.
 * Returns the attachment metadata (storage_path, name, size, mime) so
 * the client can include it in a subsequent message POST.
 *
 * No firm_files row is created: message attachments are not Files hub
 * entries. They live in storage only, signed on-demand at list time.
 *
 * Auth: firm session (lawyer/operator) OR client session for this matter.
 * Limits: 25 MB per file; only image, PDF, Word, text types accepted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession, getClientMatterSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getMatterById } from '@/lib/matter-stage';

const BUCKET = 'firm-files';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function safeName(original: string): string {
  return original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; matterId: string }> },
) {
  const { firmId, matterId } = await params;

  const session =
    (await getFirmSession(firmId)) ??
    (await getClientMatterSession(firmId, matterId));
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const matter = await getMatterById(matterId);
  if (!matter || matter.firm_id !== firmId) {
    return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'field "file" is required' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `file type not allowed: ${mime}` }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ts = Date.now();
  const storagePath = `message-attachments/${firmId}/${matterId}/${ts}-${safeName(file.name)}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mime });

  if (uploadErr) {
    console.error('[messages/upload] storage upload failed:', uploadErr.message);
    return NextResponse.json({ error: 'upload failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    attachment: {
      storage_path: storagePath,
      name: file.name,
      size: file.size,
      mime,
    },
  });
}
