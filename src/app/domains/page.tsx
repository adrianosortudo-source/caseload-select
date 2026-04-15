/**
 * /domains
 *
 * Custom domain management. Shows all intake_firms with their
 * custom_domain config. Allows adding/removing per firm.
 * Changes register the domain with Vercel and update the DB.
 * Middleware handles the actual routing at edge.
 */

import { supabase } from "@/lib/supabase";
import DomainManager from "./DomainManager";

export const dynamic = "force-dynamic";

type FirmRow = {
  id: string;
  name: string;
  custom_domain: string | null;
  status: string | null;
};

export default async function DomainsPage() {
  const { data } = await supabase
    .from("intake_firms")
    .select("id, name, custom_domain, status")
    .order("name");

  const firms = (data ?? []) as FirmRow[];
  const configured = firms.filter((f) => f.custom_domain).length;

  return (
    <div className="p-8 max-w-4xl space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold">Custom Domains</h1>
        <p className="text-sm text-black/50 mt-1">
          {configured} of {firms.length} firm{firms.length !== 1 ? "s" : ""} with a custom domain configured
        </p>
      </div>

      {/* How it works */}
      <div className="card p-5 space-y-3">
        <div className="text-xs font-semibold text-black/50 uppercase tracking-wide">How routing works</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-black/60">
          <div>
            <div className="font-medium text-black/70 mb-1">Intake widget</div>
            <code className="bg-black/5 px-2 py-0.5 rounded font-mono">intake.firm.ca/</code>
            <div className="mt-1 text-black/40">→ widget/[firmId]</div>
          </div>
          <div>
            <div className="font-medium text-black/70 mb-1">Client portal</div>
            <code className="bg-black/5 px-2 py-0.5 rounded font-mono">intake.firm.ca/portal</code>
            <div className="mt-1 text-black/40">→ portal/[firmId]</div>
          </div>
          <div>
            <div className="font-medium text-black/70 mb-1">DNS record</div>
            <code className="bg-black/5 px-2 py-0.5 rounded font-mono">CNAME → cname.vercel-dns.com</code>
            <div className="mt-1 text-black/40">Set at DNS provider</div>
          </div>
        </div>
      </div>

      {/* Firms table */}
      {firms.length === 0 ? (
        <div className="card p-10 text-center text-black/40 text-sm">
          No intake firms found. Set up a firm via onboarding first.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/8 bg-black/[0.02] text-xs text-black/50">
                <th className="text-left px-4 py-3 font-medium">Firm</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Custom domain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {firms.map((firm) => (
                <tr key={firm.id} className="hover:bg-black/[0.01]">
                  <td className="px-4 py-3 font-medium text-black/80">{firm.name}</td>
                  <td className="px-4 py-3">
                    <span className="badge bg-black/5 text-black/50 capitalize">
                      {firm.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <DomainManager
                      firmId={firm.id}
                      firmName={firm.name}
                      initialDomain={firm.custom_domain}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* NEXT_PUBLIC_APP_DOMAIN reminder */}
      <div className="card p-4 border-amber-100 bg-amber-50/50">
        <div className="text-xs font-semibold text-amber-800 mb-1">Environment check</div>
        <p className="text-xs text-amber-700">
          Set <code className="bg-amber-100 px-1 rounded font-mono">NEXT_PUBLIC_APP_DOMAIN</code> in Vercel environment variables
          to your main app domain (e.g. <code className="bg-amber-100 px-1 rounded font-mono">app.caseloadselect.ca</code>).
          The middleware uses this to distinguish custom domains from the main app.
        </p>
      </div>

    </div>
  );
}
