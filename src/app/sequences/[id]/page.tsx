import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import SequenceEditor from "./SequenceEditor";

export const dynamic = "force-dynamic";

export default async function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("sequence_templates")
    .select("*, sequence_steps(*)")
    .eq("id", id)
    .order("step_number", { referencedTable: "sequence_steps", ascending: true })
    .single();

  if (error || !data) notFound();

  return <SequenceEditor sequence={data} />;
}
