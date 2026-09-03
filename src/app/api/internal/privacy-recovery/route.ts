import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  setPrivacyRecoveryCircuit,
  type PrivacyRecoveryState,
} from '@/lib/privacy-recovery-gate';

export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const expected = process.env.PRIVACY_RECOVERY_CONTROL_TOKEN;
  const supplied = request.headers.get('x-privacy-recovery-token');
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function stateFrom(value: unknown): PrivacyRecoveryState | null {
  return value === 'open' || value === 'locked' || value === 'replaying' ? value : null;
}

/** Separate recovery control plane. It is intentionally not an operator
 * session route and never exposes a state read or replay material. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  let state: PrivacyRecoveryState | null = null;
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body as Record<string, unknown>).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(body, 'state')) {
      throw new Error('invalid payload');
    }
    state = stateFrom((body as { state?: unknown }).state);
  } catch { /* rejected below */ }
  if (!state) return NextResponse.json({ error: 'invalid recovery state' }, { status: 400 });

  // Closing is external-first. Opening is database-first so a Redis failure
  // leaves the runtime safely closed even after the durable state is open.
  try {
    if (state !== 'open') await setPrivacyRecoveryCircuit(state);
    const { data, error } = await supabaseAdmin.rpc('set_privacy_recovery_state', { p_state: state });
    if (error || (data as { ok?: boolean } | null)?.ok !== true) {
      return NextResponse.json({ error: 'recovery state was not persisted' }, { status: 503 });
    }
    if (state === 'open') await setPrivacyRecoveryCircuit(state);
    return NextResponse.json({ ok: true, state });
  } catch {
    return NextResponse.json({ error: 'recovery control is unavailable' }, { status: 503 });
  }
}
