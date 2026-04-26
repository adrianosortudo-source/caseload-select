import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await supabase
    .from("sequence_templates")
    .select("*, sequence_steps(*)")
    .eq("id", id)
    .order("step_number", { referencedTable: "sequence_steps", ascending: true })
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ sequence: data });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name         !== undefined) patch.name          = body.name;
  if (body.description  !== undefined) patch.description   = body.description;
  if (body.trigger_event !== undefined) patch.trigger_event = body.trigger_event;
  if (body.is_active    !== undefined) patch.is_active      = body.is_active;

  const { data, error } = await supabase
    .from("sequence_templates")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ sequence: data });
}
