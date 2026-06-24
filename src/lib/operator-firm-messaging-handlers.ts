import 'server-only';

/**
 * Shared request handlers for CaseLoad Connect, used by both the operator
 * routes (/api/admin/firms/[firmId]/messages/*) and the lawyer routes
 * (/api/portal/[firmId]/messages/*). The route files resolve auth and the
 * actor, then delegate here so the two trees never drift.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from './supabase-admin';
import type { MatterAttachment } from './types';
import {
  type MessagingActor,
  participantKey,
  listFirmMessages,
  sendFirmMessage,
  editFirmMessage,
  deleteFirmMessage,
  markFirmChannelRead,
  addReaction,
  removeReaction,
  setPinned,
} from './operator-firm-messaging';

const BUCKET = 'firm-files';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** The operator always posts as "CaseLoad". */
export function operatorActor(): MessagingActor {
  return { role: 'operator', id: 'operator', name: 'CaseLoad' };
}

/**
 * Resolve the lawyer actor (id + display name) from a firm session. Returns
 * null when no stable lawyer identity can be established, in which case the
 * route must refuse. A real firm_lawyers.id is required:
 *   - without it, every legacy-token lawyer would collapse to a shared
 *     sentinel id and could edit/delete each other's messages (ownership is
 *     keyed on sender_id), and reaction/read state would bleed between them.
 *   - the lookup is bound to firm_id so a stale token whose lawyer row has
 *     moved firms cannot resolve an identity for this firm.
 */
export async function resolveLawyerActor(
  firmId: string,
  lawyerId: string | null | undefined,
): Promise<MessagingActor | null> {
  if (!lawyerId) return null;
  const { data } = await supabase
    .from('firm_lawyers')
    .select('display_name, title, email')
    .eq('id', lawyerId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!data) return null;
  const name =
    (data.display_name as string | null) ?? (data.email as string | null) ?? 'The firm';
  return { role: 'lawyer', id: lawyerId, name };
}

export async function handleList(firmId: string, actor: MessagingActor): Promise<NextResponse> {
  const messages = await listFirmMessages(firmId, { viewerParticipant: participantKey(actor) });
  // Reading the list marks it read for this actor (best-effort).
  await markFirmChannelRead(firmId, actor).catch(() => {});
  return NextResponse.json({ ok: true, messages });
}

/**
 * Message action: react / unreact / pin / unpin. Body:
 *   { action: 'react' | 'unreact', emoji }
 *   { action: 'pin' | 'unpin' }
 */
export async function handleMessageAction(
  firmId: string,
  actor: MessagingActor,
  messageId: string,
  req: NextRequest,
): Promise<NextResponse> {
  let body: { action?: string; emoji?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  switch (body.action) {
    case 'react': {
      const r = await addReaction({ firmId, messageId, actor, emoji: body.emoji ?? '' });
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case 'unreact': {
      const r = await removeReaction({ firmId, messageId, actor, emoji: body.emoji ?? '' });
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case 'pin': {
      const r = await setPinned({ firmId, messageId, actor, pinned: true });
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case 'unpin': {
      const r = await setPinned({ firmId, messageId, actor, pinned: false });
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}

export async function handleSend(
  firmId: string,
  actor: MessagingActor,
  req: NextRequest,
): Promise<NextResponse> {
  let body: { body?: string; attachments?: MatterAttachment[]; parent_message_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const result = await sendFirmMessage({
    firmId,
    actor,
    body: body.body ?? '',
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
    parent_message_id: body.parent_message_id ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: result.message });
}

export async function handleEdit(
  firmId: string,
  actor: MessagingActor,
  messageId: string,
  req: NextRequest,
): Promise<NextResponse> {
  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const result = await editFirmMessage({ messageId, firmId, actor, body: body.body ?? '' });
  if (!result.ok) {
    const status = result.error === 'not your message' ? 403 : result.error === 'message not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, message: result.message });
}

export async function handleDelete(
  firmId: string,
  actor: MessagingActor,
  messageId: string,
): Promise<NextResponse> {
  const result = await deleteFirmMessage({ messageId, firmId, actor });
  if (!result.ok) {
    const status = result.error === 'not your message' ? 403 : result.error === 'message not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}

export async function handleMarkRead(firmId: string, actor: MessagingActor): Promise<NextResponse> {
  await markFirmChannelRead(firmId, actor);
  return NextResponse.json({ ok: true });
}

function safeName(original: string): string {
  return original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export async function handleUpload(firmId: string, req: NextRequest): Promise<NextResponse> {
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
  const storagePath = `firm-messages/${firmId}/${ts}-${safeName(file.name)}`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mime });
  if (uploadErr) {
    console.error('[firm-messages/upload] storage upload failed:', uploadErr.message);
    return NextResponse.json({ error: 'upload failed' }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    attachment: { storage_path: storagePath, name: file.name, size: file.size, mime },
  });
}
