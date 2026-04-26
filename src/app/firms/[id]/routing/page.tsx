import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import RoutingEditor from "./RoutingEditor";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FirmRoutingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [firmRes, routingRes] = await Promise.all([
    supabase.from("law_firm_clients").select("id, name").eq("id", id).single(),
    supabase.from("matter_routing").select("*").eq("firm_id", id).order("sub_type"),
  ]);

  if (firmRes.error || !firmRes.data) notFound();

  const firm = firmRes.data;
  const rows = routingRes.data ?? [];

  return (
    <div>
      <PageHeader
        title={`Matter Routing  -  ${firm.name}`}
        subtitle="Maps case sub-types to specific GHL pipelines and staff assignments."
      />
      <div className="p-8 max-w-5xl space-y-4">
        <div className="flex items-center gap-2 text-xs text-black/40 mb-2">
          <Link href="/firms" className="hover:underline">Firms</Link>
          <span>/</span>
          <span className="text-black/70">{firm.name}</span>
          <span>/</span>
          <span>Routing</span>
        </div>
        <div className="text-xs text-black/50 bg-sky-50 border border-sky-200 rounded-lg px-4 py-3">
          When a lead finishes intake and has a matched sub-type, these rules override the default GHL pipeline/stage and staff assignment.
          Leave fields blank to use the default routing for that sub-type.
        </div>
        <RoutingEditor firmId={id} initial={rows} />
      </div>
    </div>
  );
}
