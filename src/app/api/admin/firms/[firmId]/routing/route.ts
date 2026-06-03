/**
 * GET   /api/admin/firms/[firmId]/routing
 *   -> current routing config for the firm + the firm's selectable lawyers.
 *
 * PATCH /api/admin/firms/[firmId]/routing
 *   body { default_lead_by_practice_area, default_lead_id, default_assignees }
 *   -> validates every id belongs to the firm, normalizes (drops blank PA
 *      defaults, de-dupes assignees), and writes the three intake_firms
 *      columns. Returns the normalized config.
 *
 * This is a UI layer over the live routing fields consumed by
 * createMatterFromBandATake (lib/matter-stage.ts via lib/firm-routing-pure.ts).
 * It does NOT introduce a new routing model.
 *
 * Auth: getOperatorSession() — same operator gate as /admin/*. Operators are
 * cross-firm, so no firm-match check; the firmId in the path selects the firm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOperatorSession } from '@/lib/portal-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  validateRoutingConfig,
  type RoutingConfigDraft,
} from '@/lib/firm-routing-pure';

export const dynamic = 'force-dynamic';

interface LawyerRow {
  id: string;
  name: string | null;
  display_name: string | null;
  title: string | null;
  role: string | null;
  email: string | null;
}

interface LawyerOption {
  id: string;
  name: string; // display_name ?? name ?? email ?? id
  role: string | null;
  title: string | null;
}

function toOption(l: LawyerRow): LawyerOption {
  return {
    id: l.id,
    name: l.display_name?.trim() || l.name?.trim() || l.email?.trim() || l.id,
    role: l.role,
    title: l.title,
  };
}

/** Firm lawyers eligible to be a lead or assignee: everyone on the firm except
 *  the cross-firm operator role. */
async function loadFirmLawyers(firmId: string): Promise<LawyerOption[]> {
  const { data } = await supabase
    .from('firm_lawyers')
    .select('id, name, display_name, title, role, email')
    .eq('firm_id', firmId)
    .returns<LawyerRow[]>();
  return (data ?? [])
    .filter((l) => l.role !== 'operator')
    .map(toOption)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { firmId } = await params;

  const { data: firm, error } = await supabase
    .from('intake_firms')
    .select('id, name, branding, default_lead_by_practice_area, default_lead_id, default_assignees')
    .eq('id', firmId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!firm) {
    return NextResponse.json({ ok: false, error: 'firm not found' }, { status: 404 });
  }

  const lawyers = await loadFirmLawyers(firmId);
  const branding = (firm.branding ?? null) as { firm_name?: string } | null;

  return NextResponse.json({
    ok: true,
    firm: { id: firm.id, name: branding?.firm_name ?? firm.name ?? 'Unknown firm' },
    config: {
      default_lead_by_practice_area:
        (firm.default_lead_by_practice_area as Record<string, string> | null) ?? {},
      default_lead_id: (firm.default_lead_id as string | null) ?? null,
      default_assignees: Array.isArray(firm.default_assignees)
        ? (firm.default_assignees as string[])
        : [],
    },
    lawyers,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { firmId } = await params;

  let body: Partial<RoutingConfigDraft>;
  try {
    body = (await req.json()) as Partial<RoutingConfigDraft>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  // Shape guard before validation (validation handles semantic correctness).
  const draft: RoutingConfigDraft = {
    default_lead_by_practice_area:
      body.default_lead_by_practice_area && typeof body.default_lead_by_practice_area === 'object'
        ? (body.default_lead_by_practice_area as Record<string, string>)
        : {},
    default_lead_id:
      typeof body.default_lead_id === 'string' || body.default_lead_id === null
        ? (body.default_lead_id as string | null)
        : null,
    default_assignees: Array.isArray(body.default_assignees)
      ? (body.default_assignees as string[])
      : [],
  };

  // Confirm the firm exists before writing.
  const { data: firm, error: firmErr } = await supabase
    .from('intake_firms')
    .select('id')
    .eq('id', firmId)
    .maybeSingle();
  if (firmErr) {
    return NextResponse.json({ ok: false, error: firmErr.message }, { status: 500 });
  }
  if (!firm) {
    return NextResponse.json({ ok: false, error: 'firm not found' }, { status: 404 });
  }

  const lawyers = await loadFirmLawyers(firmId);
  const validIds = new Set(lawyers.map((l) => l.id));
  const result = validateRoutingConfig(draft, validIds);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'validation_failed', errors: result.errors }, { status: 400 });
  }

  const { error: updateErr } = await supabase
    .from('intake_firms')
    .update({
      default_lead_by_practice_area: result.normalized.default_lead_by_practice_area,
      default_lead_id: result.normalized.default_lead_id,
      default_assignees: result.normalized.default_assignees,
    })
    .eq('id', firmId);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, firm_id: firmId, config: result.normalized });
}
