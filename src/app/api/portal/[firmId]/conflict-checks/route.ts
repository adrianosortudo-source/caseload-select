/**
 * POST /api/portal/[firmId]/conflict-checks
 *
 * Creates a new pending conflict check for a matter.
 * Body: { matter_id: string, screened_lead_id: string, check_type?: string }
 *
 * Auth: portal session (lawyer or operator) scoped to firmId.
 * Returns the created row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirmSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let body: { matter_id?: string; screened_lead_id?: string; check_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { matter_id, screened_lead_id, check_type = 'manual' } = body;
  if (!matter_id || !screened_lead_id) {
    return NextResponse.json(
      { error: 'matter_id and screened_lead_id are required' },
      { status: 400 },
    );
  }

  const VALID_TYPES = ['intake', 'matter_stage', 'manual'];
  if (!VALID_TYPES.includes(check_type)) {
    return NextResponse.json(
      { error: `check_type must be one of ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  // Verify matter belongs to this firm
  const { data: matter } = await supabase
    .from('client_matters')
    .select('id, firm_id')
    .eq('id', matter_id)
    .eq('firm_id', firmId)
    .maybeSingle();

  if (!matter) {
    return NextResponse.json({ error: 'matter not found or not in this firm' }, { status: 404 });
  }

  // Verify lead belongs to this firm
  const { data: lead } = await supabase
    .from('screened_leads')
    .select('id, firm_id')
    .eq('id', screened_lead_id)
    .eq('firm_id', firmId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: 'lead not found or not in this firm' }, { status: 404 });
  }

  const { data: check, error } = await supabase
    .from('screened_conflict_checks')
    .insert({
      firm_id: firmId,
      screened_lead_id,
      matter_id,
      check_status: 'pending',
      check_type,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ check }, { status: 201 });
}
