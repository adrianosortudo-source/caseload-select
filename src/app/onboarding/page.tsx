/**
 * /onboarding
 *
 * Operator onboarding checklist. Shows setup status for every intake_firms
 * record: required items (blocks launch) and optional items (warnings only).
 *
 * Run this page after configuring a new firm to confirm all integrations are
 * live before the widget goes on the client's website.
 *
 * Data: server-side, direct Supabase queries — no API route needed for the list.
 * Individual firm detail calls the /api/admin/onboarding/[firmId] endpoint
 * (which has Bearer auth) separately, so this page does not expose secrets.
 */

import PageHeader from "@/components/PageHeader";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type CheckStatus = "pass" | "fail" | "warn";

interface ChecklistItem {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  required: boolean;
}

interface FirmChecklist {
  firm_id: string;
  firm_name: string;
  ready_to_launch: boolean;
  required_passed: number;
  required_total: number;
  checklist: ChecklistItem[];
}

function statusIcon(status: CheckStatus) {
  if (status === "pass") return <span className="text-emerald-600 font-bold">✓</span>;
  if (status === "fail") return <span className="text-rose-600 font-bold">✗</span>;
  return <span className="text-amber-500 font-bold">!</span>;
}

function statusBadge(status: CheckStatus) {
  const base = "inline-block px-2 py-0.5 rounded text-xs font-semibold";
  if (status === "pass") return <span className={`${base} bg-emerald-50 text-emerald-700`}>pass</span>;
  if (status === "fail") return <span className={`${base} bg-rose-50 text-rose-700`}>fail</span>;
  return <span className={`${base} bg-amber-50 text-amber-700`}>warn</span>;
}

async function getFirmChecklists(): Promise<FirmChecklist[]> {
  const [firmsRes, sessionCountRes, conflictCountRes] = await Promise.all([
    supabase
      .from("intake_firms")
      .select("id, firm_name, practice_areas, geo_config, branding, ghl_webhook_url, clio_config, scoring_weights, custom_domain")
      .order("created_at", { ascending: true }),
    supabase
      .from("intake_sessions")
      .select("firm_id")
      .not("firm_id", "is", null),
    supabase
      .from("conflict_register")
      .select("law_firm_id"),
  ]);

  const firms = firmsRes.data ?? [];
  const sessions = sessionCountRes.data ?? [];

  const sessionsByFirm: Record<string, number> = {};
  for (const s of sessions) {
    if (s.firm_id) sessionsByFirm[s.firm_id] = (sessionsByFirm[s.firm_id] ?? 0) + 1;
  }

  const conflictFirms = new Set(
    (conflictCountRes.data ?? []).map((r: { law_firm_id: string }) => r.law_firm_id)
  );

  return firms.map((firm) => {
    const practiceAreas = firm.practice_areas as string[] | null;
    const branding = firm.branding as Record<string, unknown> | null;
    const geoConfig = firm.geo_config as Record<string, unknown> | null;
    const clioConfig = firm.clio_config as Record<string, unknown> | null;
    const scoringWeights = firm.scoring_weights as Record<string, unknown> | null;
    const hasSession = (sessionsByFirm[firm.id] ?? 0) > 0;

    const checklist: ChecklistItem[] = [
      {
        key: "practice_areas",
        label: "Practice areas",
        status: practiceAreas && practiceAreas.length > 0 ? "pass" : "fail",
        detail: practiceAreas?.length
          ? practiceAreas.join(", ")
          : "Not configured",
        required: true,
      },
      {
        key: "geo_config",
        label: "Geo boundaries",
        status: geoConfig && Object.keys(geoConfig).length > 0 ? "pass" : "fail",
        detail: geoConfig ? "Set" : "Not configured",
        required: true,
      },
      {
        key: "branding",
        label: "Branding",
        status: branding && branding.name && branding.primary_color ? "pass" : "fail",
        detail: branding?.name ? String(branding.name) : "Not configured",
        required: true,
      },
      {
        key: "ghl_webhook",
        label: "GHL webhook",
        status: firm.ghl_webhook_url ? "pass" : "fail",
        detail: firm.ghl_webhook_url ? "Connected" : "Not configured",
        required: true,
      },
      {
        key: "clio_connected",
        label: "Clio OAuth",
        status: (clioConfig as Record<string, unknown> | null)?.access_token ? "pass" : "warn",
        detail: (clioConfig as Record<string, unknown> | null)?.access_token ? "Connected" : "Not connected",
        required: false,
      },
      {
        key: "first_session",
        label: "Widget live",
        status: hasSession ? "pass" : "warn",
        detail: hasSession ? `${sessionsByFirm[firm.id]} session(s)` : "No sessions yet",
        required: false,
      },
      {
        key: "custom_domain",
        label: "Custom domain",
        status: firm.custom_domain ? "pass" : "warn",
        detail: firm.custom_domain ?? "Using default domain",
        required: false,
      },
      {
        key: "scoring_weights",
        label: "Scoring weights",
        status: scoringWeights && Object.keys(scoringWeights).length > 0 ? "pass" : "warn",
        detail: scoringWeights ? "Custom" : "Default",
        required: false,
      },
      {
        key: "conflict_register",
        label: "Conflict register",
        status: conflictFirms.has(firm.id) ? "pass" : "warn",
        detail: conflictFirms.has(firm.id)
          ? "Register populated"
          : "Empty: load CSV on onboarding or connect Clio",
        required: false,
      },
    ];

    const required = checklist.filter((c) => c.required);
    const requiredPassed = required.filter((c) => c.status === "pass").length;

    return {
      firm_id: firm.id,
      firm_name: firm.firm_name ?? "Unnamed Firm",
      ready_to_launch: required.every((c) => c.status === "pass"),
      required_passed: requiredPassed,
      required_total: required.length,
      checklist,
    };
  });
}

export default async function OnboardingPage() {
  const firms = await getFirmChecklists();

  const readyCount = firms.filter((f) => f.ready_to_launch).length;
  const notReadyCount = firms.length - readyCount;

  return (
    <div>
      <PageHeader
        title="Firm Onboarding"
        subtitle={`${firms.length} firm(s) · ${readyCount} launch-ready · ${notReadyCount} need attention`}
      />
      <div className="p-8 space-y-6">

        {firms.length === 0 && (
          <div className="card p-8 text-center text-black/40 text-sm">
            No intake firms configured yet. Add a firm via the Supabase dashboard or the widget config.
          </div>
        )}

        {firms.map((firm) => (
          <div key={firm.firm_id} className="card overflow-hidden">
            {/* Firm header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/8">
              <div>
                <div className="font-semibold">{firm.firm_name}</div>
                <div className="text-xs text-black/40 mt-0.5 font-mono">{firm.firm_id}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-black/50">
                  {firm.required_passed}/{firm.required_total} required
                </div>
                {firm.ready_to_launch ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Launch-ready
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    Not ready
                  </span>
                )}
              </div>
            </div>

            {/* Checklist grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-black/5">
              {/* Required items */}
              <div className="col-span-1 lg:col-span-2 p-4">
                <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">Required</div>
                <div className="space-y-2">
                  {firm.checklist
                    .filter((c) => c.required)
                    .map((item) => (
                      <div key={item.key} className="flex items-start gap-2.5">
                        <div className="mt-0.5 w-4 text-center">{statusIcon(item.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-black/70 flex items-center gap-1.5">
                            {item.label}
                            {item.status !== "pass" && statusBadge(item.status)}
                          </div>
                          <div className="text-xs text-black/40 truncate">{item.detail}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Optional items */}
              <div className="col-span-1 lg:col-span-2 p-4">
                <div className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-3">Optional</div>
                <div className="space-y-2">
                  {firm.checklist
                    .filter((c) => !c.required)
                    .map((item) => (
                      <div key={item.key} className="flex items-start gap-2.5">
                        <div className="mt-0.5 w-4 text-center">{statusIcon(item.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-black/70 flex items-center gap-1.5">
                            {item.label}
                            {item.status !== "pass" && statusBadge(item.status)}
                          </div>
                          <div className="text-xs text-black/40 truncate">{item.detail}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Legend */}
        {firms.length > 0 && (
          <div className="flex items-center gap-6 text-xs text-black/40 pt-2">
            <span className="flex items-center gap-1.5"><span className="text-emerald-600 font-bold">✓</span> Pass: configured correctly</span>
            <span className="flex items-center gap-1.5"><span className="text-rose-600 font-bold">✗</span> Fail: required, blocks launch</span>
            <span className="flex items-center gap-1.5"><span className="text-amber-500 font-bold">!</span> Warn: optional, reduced functionality</span>
          </div>
        )}

      </div>
    </div>
  );
}
