/**
 * /admin/firms/[firmId]/routing
 *
 * Firm-scoped routing config. firmId comes from the URL segment rather
 * than a ?firm_id= query param so the sidebar firm switcher can navigate
 * between firms without resetting the page. Auth is enforced by
 * /admin/layout.tsx (getOperatorSession).
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import RoutingConfigPanel from "@/components/admin/RoutingConfigPanel";
import type { LawyerOption } from "@/components/admin/RoutingConfigPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface FirmSlim {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
}

interface LawyerRow {
  id: string;
  name: string | null;
  display_name: string | null;
  title: string | null;
  role: string | null;
  email: string | null;
}

function firmDisplayName(f: { name: string | null; branding: { firm_name?: string } | null }): string {
  return f.branding?.firm_name ?? f.name ?? "Unknown firm";
}

export default async function FirmRoutingPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const { data: firm, error } = await supabase
    .from("intake_firms")
    .select("id, name, branding, default_lead_by_practice_area, default_lead_id, default_assignees")
    .eq("id", firmId)
    .maybeSingle();

  if (error) return <ErrorState message={error.message} />;
  if (!firm) return <ErrorState message={`No firm found for id ${firmId}.`} />;

  const { data: lawyerRows } = await supabase
    .from("firm_lawyers")
    .select("id, name, display_name, title, role, email")
    .eq("firm_id", firmId)
    .returns<LawyerRow[]>();

  const lawyers: LawyerOption[] = (lawyerRows ?? [])
    .filter((l) => l.role !== "operator")
    .map((l) => ({
      id: l.id,
      name: l.display_name?.trim() || l.name?.trim() || l.email?.trim() || l.id,
      role: l.role,
      title: l.title,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const f = firm as unknown as FirmSlim & {
    default_lead_by_practice_area: Record<string, string> | null;
    default_lead_id: string | null;
    default_assignees: string[] | null;
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Lead routing</h1>
        <p className="mt-1 text-sm text-black/60">{firmDisplayName(f)}</p>
      </div>

      <RoutingConfigPanel
        firmId={f.id}
        firmName={firmDisplayName(f)}
        lawyers={lawyers}
        initialConfig={{
          default_lead_by_practice_area: f.default_lead_by_practice_area ?? {},
          default_lead_id: f.default_lead_id ?? null,
          default_assignees: Array.isArray(f.default_assignees) ? f.default_assignees : [],
        }}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
