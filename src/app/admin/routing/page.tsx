/**
 * /admin/routing
 *
 * Operator-facing surface over the LIVE per-firm lead routing config
 * (intake_firms.default_lead_by_practice_area / default_lead_id /
 * default_assignees). Lets the operator view + edit routing defaults without a
 * deploy. This is a UI layer only — the routing logic itself lives in
 * lib/firm-routing-pure.ts and is consumed by createMatterFromBandATake.
 *
 * Firm is selected via ?firm_id= (FirmFilter, shared with the other admin
 * pages). Auth: getOperatorSession() in /admin/layout.tsx.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import FirmFilter from '@/components/admin/FirmFilter';
import RoutingConfigPanel from '@/components/admin/RoutingConfigPanel';
import type { LawyerOption } from '@/components/admin/RoutingConfigPanel';

export const dynamic = 'force-dynamic';
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
  return f.branding?.firm_name ?? f.name ?? 'Unknown firm';
}

export default async function AdminRoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ firm_id?: string }>;
}) {
  const { firm_id } = await searchParams;

  const { data: firms } = await supabase
    .from('intake_firms')
    .select('id, name, branding')
    .order('name', { ascending: true })
    .returns<FirmSlim[]>();

  const firmsList = (firms ?? []).map((f) => ({ id: f.id, name: firmDisplayName(f) }));

  return (
    <div className="space-y-5">
      <Header />

      <div className="flex items-center gap-3 flex-wrap">
        <FirmFilter action="/admin/routing" firms={firmsList} active={firm_id ?? null} />
      </div>

      {!firm_id ? (
        <SelectFirmPrompt hasFirms={firmsList.length > 0} />
      ) : (
        <FirmRouting firmId={firm_id} />
      )}
    </div>
  );
}

async function FirmRouting({ firmId }: { firmId: string }) {
  const { data: firm, error } = await supabase
    .from('intake_firms')
    .select('id, name, branding, default_lead_by_practice_area, default_lead_id, default_assignees')
    .eq('id', firmId)
    .maybeSingle();

  if (error) {
    return <ErrorState message={error.message} />;
  }
  if (!firm) {
    return <ErrorState message={`No firm found for id ${firmId}.`} />;
  }

  const { data: lawyerRows } = await supabase
    .from('firm_lawyers')
    .select('id, name, display_name, title, role, email')
    .eq('firm_id', firmId)
    .returns<LawyerRow[]>();

  const lawyers: LawyerOption[] = (lawyerRows ?? [])
    .filter((l) => l.role !== 'operator')
    .map((l) => ({
      id: l.id,
      name: l.display_name?.trim() || l.name?.trim() || l.email?.trim() || l.id,
      role: l.role,
      title: l.title,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <RoutingConfigPanel
      firmId={firm.id}
      firmName={firmDisplayName(firm as FirmSlim)}
      lawyers={lawyers}
      initialConfig={{
        default_lead_by_practice_area:
          (firm.default_lead_by_practice_area as Record<string, string> | null) ?? {},
        default_lead_id: (firm.default_lead_id as string | null) ?? null,
        default_assignees: Array.isArray(firm.default_assignees)
          ? (firm.default_assignees as string[])
          : [],
      }}
    />
  );
}

function Header() {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Lead routing</h1>
      </div>
    </div>
  );
}

function SelectFirmPrompt({ hasFirms }: { hasFirms: boolean }) {
  return (
    <div className="bg-white border border-black/8 px-6 py-10 text-center">
      <p className="text-sm text-black/60">
        {hasFirms
          ? 'Select a firm above to view and edit its lead routing defaults.'
          : 'No firms found. Create a firm in intake_firms first.'}
      </p>
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
