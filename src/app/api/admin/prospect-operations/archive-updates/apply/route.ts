import { NextRequest, NextResponse } from 'next/server';

import { getOperatorSession } from '@/lib/portal-auth';
import { applyReviewedArchiveSyncBundle } from '@/lib/prospect-archive-sync/persistence';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

/**
 * Operator-only application of a short-lived, server-minted review permit.
 * The persistence layer performs one database RPC only. It has no HighLevel
 * client, no outbound network call and no workflow/contact mutation path.
 */
export async function POST(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Reviewed archive update is too large.' }, { status: 413 });
  }

  let input: { bundle?: unknown; review_permit?: unknown };
  try { input = await request.json() as { bundle?: unknown; review_permit?: unknown }; } catch {
    return NextResponse.json({ error: 'Invalid reviewed archive update JSON.' }, { status: 400 });
  }
  if (!input || typeof input !== 'object' || typeof input.review_permit !== 'string' || !input.review_permit) {
    return NextResponse.json({ error: 'A server-issued review permit is required.' }, { status: 400 });
  }

  try {
    const applied = await applyReviewedArchiveSyncBundle({
      bundle: input.bundle,
      reviewPermit: input.review_permit,
      operatorId: session.lawyer_id,
    });
    return NextResponse.json({
      receipt: applied.receipt,
      preview_digest: applied.prepared.previewDigest,
      bundle_digest: applied.prepared.bundleDigest,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Could not apply the reviewed archive update.',
    }, { status: 422 });
  }
}
