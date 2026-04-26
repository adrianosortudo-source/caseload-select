import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import Link from "next/link";
import FirmForm from "./FirmForm";
import PortalLinkButton from "./PortalLinkButton";

export const dynamic = "force-dynamic";

export default async function FirmsPage() {
  const [firmsRes, leadsRes] = await Promise.all([
    supabase.from("law_firm_clients").select("*").order("created_at", { ascending: false }),
    supabase.from("leads").select("id,law_firm_id,stage,estimated_value"),
  ]);
  const firms = firmsRes.data ?? [];
  const leads = leadsRes.data ?? [];

  return (
    <div>
      <PageHeader title="Law Firm Clients" subtitle="Active firms receiving filtered leads." />
      <div className="p-8 space-y-6">
        <FirmForm />
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Firm</th>
                <th className="text-left">Location</th>
                <th className="text-right">Total leads</th>
                <th className="text-right">Pipeline health</th>
                <th className="text-right">Status</th>
                <th className="text-right">Routing</th>
                <th className="text-right px-4">Portal</th>
              </tr>
            </thead>
            <tbody>
              {firms.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-black/40">
                    No firms yet. Add one above.
                  </td>
                </tr>
              )}
              {firms.map((f) => {
                const fLeads = leads.filter((l) => l.law_firm_id === f.id);
                const won = fLeads.filter((l) => l.stage === "client_won").length;
                const active = fLeads.filter((l) =>
                  ["new_lead", "qualified", "proposal_sent"].includes(l.stage)
                ).length;
                const health = fLeads.length === 0 ? " - " : `${won} won · ${active} active`;
                return (
                  <tr key={f.id} className="border-b border-black/5">
                    <td className="px-4 py-3 font-medium">{f.name}</td>
                    <td className="text-black/60">{f.location ?? " - "}</td>
                    <td className="text-right">{fLeads.length}</td>
                    <td className="text-right text-black/60">{health}</td>
                    <td className="text-right">
                      <span className="badge bg-black/5">{f.status}</span>
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/firms/${f.id}/routing`}
                        className="text-xs text-navy hover:underline"
                      >
                        Routing
                      </Link>
                    </td>
                    <td className="text-right px-4">
                      <PortalLinkButton firmId={f.id} />
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
