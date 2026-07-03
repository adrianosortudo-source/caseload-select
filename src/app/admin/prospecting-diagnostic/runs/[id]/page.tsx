import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import SavedDiagnosticDetail, { type SavedDiagnosticRunPayload } from "../../_components/SavedDiagnosticDetail";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SavedProspectingDiagnosticPage({ params }: PageProps) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal-login");

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { data, error } = await supabase
    .from("seo_audit_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();

  const run = data as SavedDiagnosticRunPayload;
  const { data: priorRuns } = await supabase
    .from("seo_audit_runs")
    .select("id")
    .eq("primary_domain", run.primary_domain)
    .neq("id", run.id)
    .lt("created_at", run.created_at)
    .order("created_at", { ascending: false })
    .limit(1);
  const priorRunId = priorRuns?.[0]?.id as string | undefined;

  return (
    <div>
      <PageHeader
        title={run.prospect_firm_name}
        subtitle={`Saved prospecting diagnostic for ${run.primary_domain}. Review the audit, copy outreach assets, or export the saved JSON package.`}
      />
      <SavedDiagnosticDetail run={run} priorRunId={priorRunId} />
    </div>
  );
}
