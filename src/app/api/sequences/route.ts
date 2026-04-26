import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabase
    .from("sequence_templates")
    .select("id, name, trigger_event, description, is_active, created_at, sequence_steps(count)")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ sequences: data });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { data, error } = await supabase
    .from("sequence_templates")
    .insert({
      name:          body.name,
      trigger_event: body.trigger_event,
      description:   body.description ?? null,
      is_active:     body.is_active ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ sequence: data });
}
