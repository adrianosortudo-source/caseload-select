import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const { data, error } = await supabase
    .from("matter_routing")
    .select("*")
    .eq("firm_id", firmId)
    .order("sub_type", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const body = await req.json() as {
    sub_type: string;
    ghl_pipeline_id?: string;
    ghl_stage?: string;
    assigned_staff_id?: string;
    assigned_staff_email?: string;
  };

  if (!body.sub_type?.trim()) {
    return NextResponse.json({ error: "sub_type is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("matter_routing")
    .upsert({
      firm_id:              firmId,
      sub_type:             body.sub_type.trim(),
      ghl_pipeline_id:      body.ghl_pipeline_id ?? null,
      ghl_stage:            body.ghl_stage ?? null,
      assigned_staff_id:    body.assigned_staff_id ?? null,
      assigned_staff_email: body.assigned_staff_email ?? null,
    }, { onConflict: "firm_id,sub_type" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
