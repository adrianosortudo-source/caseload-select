import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: existing } = await supabase
    .from("sequence_steps")
    .select("step_number")
    .eq("sequence_id", id)
    .order("step_number", { ascending: false })
    .limit(1);

  const nextStep = (existing?.[0]?.step_number ?? 0) + 1;
  const defaultDelay = nextStep === 1 ? 0 : 24;

  const { data, error } = await supabase
    .from("sequence_steps")
    .insert({
      sequence_id:  id,
      step_number:  nextStep,
      delay_hours:  defaultDelay,
      is_active:    true,
      channels: {
        email:    { subject: "Follow up", body: "Hi {name},", active: true },
        sms:      { body: "", active: false },
        whatsapp: { template_name: "", body: "", active: false },
        internal: { note: "", active: false },
      },
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ step: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { step_ids } = await req.json() as { step_ids: string[] };

  if (!Array.isArray(step_ids)) {
    return NextResponse.json({ error: "step_ids must be an array" }, { status: 400 });
  }

  const updates = step_ids.map((stepId, index) =>
    supabase
      .from("sequence_steps")
      .update({ step_number: index + 1 })
      .eq("id", stepId)
      .eq("sequence_id", id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
