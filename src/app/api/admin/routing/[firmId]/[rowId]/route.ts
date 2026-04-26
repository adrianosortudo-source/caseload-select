import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; rowId: string }> }
) {
  const { firmId, rowId } = await params;
  const body = await req.json() as {
    ghl_pipeline_id?: string | null;
    ghl_stage?: string | null;
    assigned_staff_id?: string | null;
    assigned_staff_email?: string | null;
  };

  const { data, error } = await supabase
    .from("matter_routing")
    .update({
      ghl_pipeline_id:      body.ghl_pipeline_id ?? null,
      ghl_stage:            body.ghl_stage ?? null,
      assigned_staff_id:    body.assigned_staff_id ?? null,
      assigned_staff_email: body.assigned_staff_email ?? null,
    })
    .eq("id", rowId)
    .eq("firm_id", firmId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; rowId: string }> }
) {
  const { firmId, rowId } = await params;
  const { error } = await supabase
    .from("matter_routing")
    .delete()
    .eq("id", rowId)
    .eq("firm_id", firmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
