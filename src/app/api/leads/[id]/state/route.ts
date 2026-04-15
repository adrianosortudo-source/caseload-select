import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ALLOWED = [
  "unaware",
  "problem_aware",
  "solution_aware",
  "decision_ready",
  "price_sensitive",
  "delayed",
];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { lead_state } = await req.json();

  if (!ALLOWED.includes(lead_state)) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }

  const { data: current, error: readErr } = await supabase
    .from("leads")
    .select("lead_state")
    .eq("id", id)
    .single();

  if (readErr || !current) {
    return NextResponse.json({ error: readErr?.message ?? "not found" }, { status: 404 });
  }

  if (current.lead_state === lead_state) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .update({ lead_state, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: error?.message ?? "update failed" }, { status: 400 });
  }

  await supabase.from("state_history").insert({
    lead_id: id,
    old_state: current.lead_state,
    new_state: lead_state,
  });

  return NextResponse.json({ lead });
}
