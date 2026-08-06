/**
 * GET  /api/admin/firms/[firmId]/ownership?phase=onboarding|offboarding
 *   -> the firm's current asset ownership register (DR-111) + the
 *      prioritized transfer/repair list derived from it. Empty register
 *      (register: [], seeded: false) means "seed register" has not run yet.
 *
 * POST /api/admin/firms/[firmId]/ownership   body { phase?: 'onboarding' | 'offboarding' }
 *   -> idempotent seed: inserts one row per catalogue asset not already
 *      present for this firm and phase, returns the resulting register.
 *
 * Auth: getOperatorSession() -- same operator gate as /admin/*. Cross-firm;
 * no firm-match check, the firmId in the path selects the firm.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getOwnershipRegister, seedOwnershipRegister } from "@/lib/asset-ownership";
import { buildTransferList, type ReviewPhase } from "@/lib/asset-ownership-pure";

export const dynamic = "force-dynamic";

function parsePhase(value: string | null): ReviewPhase {
  return value === "offboarding" ? "offboarding" : "onboarding";
}

async function firmExists(firmId: string): Promise<boolean> {
  const { data } = await supabase.from("intake_firms").select("id").eq("id", firmId).maybeSingle();
  return !!data;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { firmId } = await params;
  if (!(await firmExists(firmId))) {
    return NextResponse.json({ ok: false, error: "firm not found" }, { status: 404 });
  }

  const phase = parsePhase(req.nextUrl.searchParams.get("phase"));
  const register = await getOwnershipRegister(firmId, phase);

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    phase,
    seeded: register.length > 0,
    register,
    transfer_list: buildTransferList(register),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { firmId } = await params;
  if (!(await firmExists(firmId))) {
    return NextResponse.json({ ok: false, error: "firm not found" }, { status: 404 });
  }

  let body: { phase?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine; seed defaults to onboarding.
  }
  const phase = parsePhase(body.phase ?? null);

  const register = await seedOwnershipRegister(firmId, phase);

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    phase,
    register,
    transfer_list: buildTransferList(register),
  });
}
