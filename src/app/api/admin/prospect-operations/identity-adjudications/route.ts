import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import {
  createProspectIdentityAdjudication,
  getProspectIdentityResolution,
  isProspectOperationsUuid,
  listProspectIdentityAdjudications,
  validateIdentityAdjudicationInput,
} from '@/lib/prospect-operations';

/**
 * Operator-only identity review. This route records source-backed decisions;
 * it never discovers, merges, or rewrites identities on its own.
 */
export async function GET(request: NextRequest) {
  if (!(await getOperatorSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sourceLinkId = request.nextUrl.searchParams.get('source_link_id');
  if (!isProspectOperationsUuid(sourceLinkId)) {
    return NextResponse.json({ error: 'A valid source_link_id is required' }, { status: 400 });
  }
  try {
    const [adjudications, confirmed_identity] = await Promise.all([
      listProspectIdentityAdjudications(sourceLinkId),
      getProspectIdentityResolution(sourceLinkId),
    ]);
    return NextResponse.json({ adjudications, confirmed_identity });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const input = validateIdentityAdjudicationInput(payload);
  if (!input) return NextResponse.json({ error: 'Invalid identity adjudication payload' }, { status: 400 });
  try {
    const adjudication = await createProspectIdentityAdjudication(input, session.lawyer_id);
    return NextResponse.json({ adjudication }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (/duplicate key|idempotency/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (/cannot change canonical identity|active contact|requires a source|source link not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
