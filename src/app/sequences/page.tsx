import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import SequenceToggle from "./SequenceToggle";

export const dynamic = "force-dynamic";

const TRIGGER_LABELS: Record<string, string> = {
  new_lead:               "New Lead",
  no_engagement:          "No Engagement",
  client_won:             "Client Won",
  no_show:                "No Show",
  stalled_retainer:       "Stalled Retainer",
  incomplete_intake:      "Incomplete Intake",
  spoke_no_book:          "J5A: Spoke, No Book",
  consulted_no_sign:      "J5B: Consulted, No Sign",
  retainer_awaiting:      "J6: Retainer Awaiting",
  consultation_scheduled: "J2: Consultation Reminders",
  review_request:         "J9: Review Request",
  matter_active:          "J8: Active Matter",
  re_engagement:          "J10: Re-Engagement",
  relationship_milestone: "J11: Relationship Milestone",
  long_term_nurture:      "J12: Long-Term Nurture",
};

export default async function SequencesPage() {
  const { data: sequences, error } = await supabase
    .from("sequence_templates")
    .select("id, name, trigger_event, description, is_active, sequence_steps(count)")
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader
        title="Email Sequences"
        subtitle="Manage automated email sequences for each trigger event."
      />
      <div className="p-8 space-y-4">
        {error && (
          <div className="card p-4 bg-red-50 text-red-700 text-sm">
            {error.message}. Run migration 007_sequence_builder.sql in Supabase.
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/2">
              <tr>
                <th className="text-left px-5 py-3">Sequence</th>
                <th className="text-left px-4 py-3">Trigger</th>
                <th className="text-center px-4 py-3">Steps</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(!sequences || sequences.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-black/40">
                    No sequences yet. Run the migration to seed the default sequences.
                  </td>
                </tr>
              )}
              {(sequences ?? []).map((seq) => {
                const stepCount = (seq.sequence_steps as unknown as { count: number }[])?.[0]?.count ?? 0;
                return (
                  <tr key={seq.id} className="border-b border-black/5 hover:bg-black/1 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-medium">{seq.name}</div>
                      {seq.description && (
                        <div className="text-xs text-black/50 mt-0.5 max-w-sm truncate">{seq.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className="badge bg-sky-100 text-sky-700">
                        {TRIGGER_LABELS[seq.trigger_event] ?? seq.trigger_event}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className="text-black/60">{stepCount}</span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <SequenceToggle id={seq.id} isActive={seq.is_active} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/sequences/${seq.id}`}
                        className="text-xs font-medium text-navy hover:underline"
                      >
                        Edit →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
