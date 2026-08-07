/**
 * /admin/firms/[firmId]/ownership
 *
 * Operator console for the firm asset ownership register (DR-111). Same
 * shape as the routing and assist consoles: firmId from the URL segment,
 * auth enforced by /admin/layout.tsx (getOperatorSession).
 *
 * A current-state diagnostic, distinct from ACTS_Day1_OwnershipMatrix
 * (the go-forward decision of who owns a surface during the engagement).
 * This page answers one question: does the firm currently control the
 * marketing assets its growth depends on.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getOwnershipRegister } from "@/lib/asset-ownership";
import OwnershipRegisterPanel from "@/components/admin/OwnershipRegisterPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface FirmSlim {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
}

function firmDisplayName(f: { name: string | null; branding: { firm_name?: string } | null }): string {
  return f.branding?.firm_name ?? f.name ?? "Unknown firm";
}

export default async function FirmOwnershipPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const { data: firm, error } = await supabase
    .from("intake_firms")
    .select("id, name, branding")
    .eq("id", firmId)
    .maybeSingle();

  if (error) return <ErrorState message={error.message} />;
  if (!firm) return <ErrorState message={`No firm found for id ${firmId}.`} />;

  const f = firm as unknown as FirmSlim;
  const register = await getOwnershipRegister(firmId, "onboarding");

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Asset ownership register</h1>
        <p className="mt-1 text-sm text-black/60">{firmDisplayName(f)}</p>
        <p className="mt-2 text-sm text-black/50 max-w-2xl">
          Does the firm currently control the marketing assets its growth depends on. This
          records who controls each asset today, never a password or credential. See
          ACTS_Day1_OwnershipMatrix for the separate go-forward decision of who owns a
          surface during the engagement.
        </p>
      </div>

      <OwnershipRegisterPanel firmId={f.id} initialRegister={register} initialPhase="onboarding" />
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
