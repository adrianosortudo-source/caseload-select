import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import DiagnosticCompareDetail from "../_components/DiagnosticCompareDetail";
import { compareDiagnostics, type SavedRunLike } from "../_lib/compare";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ before?: string; after?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ProspectingDiagnosticComparePage({ searchParams }: PageProps) {
  const session = await getOperatorSession();
  if (!session) redirect("/portal-login");

  const params = await searchParams;
  const beforeId = params.before || "";
  const afterId = params.after || "";
  if (!UUID_RE.test(beforeId) || !UUID_RE.test(afterId) || beforeId === afterId) notFound();

  const { data, error } = await supabase
    .from("seo_audit_runs")
    .select("*")
    .in("id", [beforeId, afterId]);

  if (error || !data || data.length !== 2) notFound();

  const before = data.find((r) => r.id === beforeId) as SavedRunLike | undefined;
  const after = data.find((r) => r.id === afterId) as SavedRunLike | undefined;
  if (!before || !after) notFound();

  const comparison = compareDiagnostics(before, after);

  return (
    <div>
      <PageHeader
        title="Diagnostic comparison"
        subtitle={`Before/after comparison for ${after.primary_domain}. Review movement in scores, issues, competitors, and target-intent evidence.`}
      />
      <DiagnosticCompareDetail comparison={comparison} />
    </div>
  );
}
