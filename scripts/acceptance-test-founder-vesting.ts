// One-off acceptance-test script (Workstream 11). Not part of the shipped
// app; calls the pure evaluator directly against real production data via
// the Supabase JS client (bypassing supabase-admin.ts's "server-only"
// import guard, which only matters for the Next.js bundler, not this
// script). Read-only: no writes, no publishes.
import { createClient } from "@supabase/supabase-js";
import { evaluatePeriodReadiness } from "../src/lib/publication-readiness";

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

  const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

  const { data: period } = await supabase
    .from("content_periods")
    .select("id, firm_id, starts_on, ends_on, theme")
    .eq("firm_id", FIRM_ID)
    .eq("theme", "Founder vesting")
    .single();

  if (!period) {
    console.error("Founder vesting period not found");
    process.exit(1);
  }

  const { data: deliverables } = await supabase.from("content_deliverables").select("*").eq("period_id", period.id);
  const versionIds = (deliverables ?? []).map((d) => d.current_version_id).filter(Boolean);
  const { data: versions } = versionIds.length
    ? await supabase.from("deliverable_versions").select("*").in("id", versionIds)
    : { data: [] as any[] };
  const versionById = new Map((versions ?? []).map((v: any) => [v.id, v]));

  const deliverableIds = (deliverables ?? []).map((d) => d.id);
  const { data: artifacts } = await supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds);
  const artifactIds = (artifacts ?? []).map((a: any) => a.id);
  const { data: validations } = artifactIds.length
    ? await supabase.from("publication_artifact_validations").select("*").in("artifact_id", artifactIds)
    : { data: [] as any[] };
  const latestValidationByArtifactId: Record<string, any> = {};
  for (const v of validations ?? []) if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;

  const inputs = (deliverables ?? []).map((deliverable: any) => ({
    deliverable,
    currentVersion: deliverable.current_version_id ? (versionById.get(deliverable.current_version_id) ?? null) : null,
    artifacts: (artifacts ?? []).filter((a: any) => a.deliverable_id === deliverable.id),
    latestValidationByArtifactId,
  }));

  const { items, summary } = evaluatePeriodReadiness(inputs as any);

  console.log("=== Founder Vesting acceptance test ===");
  console.log("period:", period.theme, period.starts_on, "to", period.ends_on);
  console.log("total deliverables in period (incl. archived):", (deliverables ?? []).length);
  console.log("summary:", JSON.stringify(summary, null, 2));
  console.log("");
  console.log("=== per-deliverable ===");
  for (const item of items) {
    const d = (deliverables ?? []).find((x: any) => x.id === item.deliverableId);
    console.log(
      `- ${d.title.slice(0, 60)} | role=${d.deliverable_role} locale=${d.locale} | excluded=${item.excluded} ready=${item.ready} missing=[${item.missingRequirements.join(",")}] stale=[${item.staleArtifacts.join(",")}]`,
    );
  }

  console.log("");
  console.log("registered artifacts total:", (artifacts ?? []).length);
  console.log(
    "artifacts by type:",
    JSON.stringify((artifacts ?? []).reduce((acc: any, a: any) => ({ ...acc, [a.artifact_type]: (acc[a.artifact_type] ?? 0) + 1 }), {})),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
