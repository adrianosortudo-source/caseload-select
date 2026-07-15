// Reproduces the evaluator_output fields (raw_ready, display_state,
// missing_requirements) inside
// docs/reconciliation/relocation-clause-dry-run-manifest-2026-07-15.json.
// Read-only against production: no writes, no publishes, no evidence
// registered. Same style and same caveat as the pre-existing
// scripts/acceptance-test-founder-vesting.ts -- a plain relative-import TS
// script, run with a TS-capable loader (tsx/ts-node), not part of the
// vitest suite (vitest.config.ts's include globs are src/**/__tests__/**
// and src/**/__evals__/**, which scripts/ deliberately falls outside of,
// so this never runs as part of `npm test`).
//
// The metadata overlay below (locale/deliverable_role/publication_destination/
// publication_path) is copied verbatim from
// supabase/migrations/20260715193201_20260715120500_relocation_clause_publication_metadata.sql
// (already applied to production as of 2026-07-15). It is hardcoded here,
// not re-derived from a live query, because the whole point of this script
// is to answer "what does the evaluator compute for this known metadata
// set", not "what is currently in the locale/deliverable_role columns
// today" (those two now agree, confirmed separately, but the overlay is
// the migration's claim, which is what a reviewer needs to check the
// evaluator against).
//
// Usage: npx tsx scripts/generate-relocation-clause-dry-run-manifest.ts
import { createClient } from "@supabase/supabase-js";
import { evaluateDeliverableReadiness, deriveDisplayState } from "../src/lib/publication-readiness";
import type { ContentDeliverable, DeliverableVersion } from "../src/lib/types";

const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const PERIOD_ID = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";

const migrationOverlay: Record<
  string,
  { locale: string; deliverable_role: string; publication_destination: string; publication_path: string | null }
> = {
  "b767ef14-dd4e-405e-9c54-1f7f9364f13c": { locale: "pt-BR", deliverable_role: "article", publication_destination: "firm_website", publication_path: null },
  "e3fb60fe-08c5-45ee-854b-889beaaa9136": { locale: "en-CA", deliverable_role: "article", publication_destination: "firm_website", publication_path: "/journal/demolition-clause-ontario" },
  "ba1f4aeb-54ef-442a-8d8c-e5ae99a54bb9": { locale: "pt-BR", deliverable_role: "article", publication_destination: "firm_website", publication_path: null },
  "22dde96c-9400-403c-8314-1402bcaaab23": { locale: "en-CA", deliverable_role: "article", publication_destination: "firm_website", publication_path: "/journal/relocation-clause-ontario" },
  "303151e3-68ae-40a1-b2fe-4e4733b3b17a": { locale: "en-CA", deliverable_role: "gbp_post", publication_destination: "google_business_profile", publication_path: null },
  "b0b11b43-de75-430e-8728-f2e52de882fb": { locale: "en-CA", deliverable_role: "gbp_post", publication_destination: "google_business_profile", publication_path: null },
  "78b56c81-30ae-4cfc-914e-006a616912d3": { locale: "en-CA", deliverable_role: "gbp_post", publication_destination: "google_business_profile", publication_path: null },
  "f952ce27-67f9-4813-9d04-418ebd37aeba": { locale: "en-CA", deliverable_role: "lead_magnet_pdf", publication_destination: "firm_website", publication_path: "/resources/relocation-clause-checklist.pdf" },
  "3a15ec4d-c2d9-4d36-b912-eb6c5128f914": { locale: "pt-BR", deliverable_role: "lead_magnet_pdf", publication_destination: "firm_website", publication_path: "/resources/pt/relocation-clause-checklist.pdf" },
  "897e8ce9-2175-4d9d-811b-30dba72b61cc": { locale: "en-CA", deliverable_role: "landing_page", publication_destination: "firm_website", publication_path: "/resources/relocation-clause-checklist" },
  "e3fa2f5e-d1fb-4011-92a8-089817b2c9c1": { locale: "pt-BR", deliverable_role: "landing_page", publication_destination: "firm_website", publication_path: "/pt/resources/relocation-clause-checklist" },
  "23661929-b4f8-489e-b022-96d98ad04384": { locale: "en-CA", deliverable_role: "social_post", publication_destination: "linkedin", publication_path: null },
  "e8218afe-6d7a-483f-b3ec-68888a14a703": { locale: "en-CA", deliverable_role: "social_post", publication_destination: "linkedin", publication_path: null },
};

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

  const { data: deliverables } = await supabase
    .from("content_deliverables")
    .select("id, title, status, content_kind, current_version_id, approved_version_id")
    .eq("period_id", PERIOD_ID)
    .order("created_at", { ascending: true });
  if (!deliverables) {
    console.error("no deliverables found for period", PERIOD_ID);
    process.exit(1);
  }

  const versionIds = deliverables.map((d) => d.current_version_id).filter(Boolean) as string[];
  const { data: versions } = versionIds.length
    ? await supabase.from("deliverable_versions").select("*").in("id", versionIds)
    : { data: [] as DeliverableVersion[] };
  const versionById = new Map((versions ?? []).map((v: any) => [v.id, v as DeliverableVersion]));

  const deliverableIds = deliverables.map((d) => d.id);
  const { data: artifacts } = await supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds);

  console.log("=== Relocation clause dry-run evaluator reproduction ===");
  console.log("firm:", FIRM_ID, "period:", PERIOD_ID);
  console.log("live publication_artifacts rows for this period:", (artifacts ?? []).length);
  console.log("");

  for (const raw of deliverables) {
    const overlay = migrationOverlay[raw.id];
    const deliverable = {
      id: raw.id,
      firm_id: FIRM_ID,
      period_id: PERIOD_ID,
      title: raw.title,
      status: raw.status,
      content_kind: raw.content_kind,
      current_version_id: raw.current_version_id,
      approved_version_id: raw.approved_version_id,
      locale: overlay?.locale ?? null,
      deliverable_role: overlay?.deliverable_role ?? null,
      publication_destination: overlay?.publication_destination ?? null,
      publication_path: overlay?.publication_path ?? null,
      publish_date: null,
    } as unknown as ContentDeliverable;

    const currentVersion = raw.current_version_id ? (versionById.get(raw.current_version_id) ?? null) : null;

    const readiness = evaluateDeliverableReadiness({
      deliverable,
      currentVersion,
      artifacts: (artifacts ?? []).filter((a: any) => a.deliverable_id === raw.id),
      latestValidationByArtifactId: {},
    });
    const displayState = deriveDisplayState(readiness, "legacy_unreconciled");

    console.log(
      `${raw.title.slice(0, 55).padEnd(55)} | excluded=${readiness.excluded} raw_ready=${readiness.ready} display=${displayState} missing=[${readiness.missingRequirements.join(",")}]`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
