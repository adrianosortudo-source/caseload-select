import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import {
  provisionProspectSourceRecord,
  validateProvisionProspectSourceRecordInput,
} from '@/lib/prospect-operations';

/**
 * Operator-only first-party source provisioning. It always creates a new
 * source-backed identity; resolving it to an existing identity is a separate,
 * explicit adjudication action.
 */
export async function POST(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const input = validateProvisionProspectSourceRecordInput(payload);
  if (!input) return NextResponse.json({ error: 'Invalid source-provisioning payload' }, { status: 400 });
  try {
    return NextResponse.json({ provision: await provisionProspectSourceRecord(input, session.lawyer_id) }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (/source record already exists|idempotency key already belongs/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (/first-party source URL|required|invalid |active operator identity/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
