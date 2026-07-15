// Read-only fetch for the Workstream 5 dry-run reconciliation manifest.
// "The relocation clause" period (950bad0b-fef6-4c5a-b949-fef5d9cbee90),
// DRG Law (eec1d25e-a047-4827-8e4a-6eb96becca2b). Prints a CONDENSED view
// of the CURRENT production state (booleans/lengths instead of full body
// HTML, which is large and not needed for the manifest) of the period's
// deliverables, current versions, and publication_artifacts (expected
// zero: no evidence has been registered for this period yet). No writes.
// New columns from the pending migrations (locale/deliverable_role/
// destination/path/readiness_lifecycle) are NOT read here -- they do not
// exist in production yet. The dry-run manifest overlays those values by
// hand from the verified, already-reviewed migration file text.
import { createClient } from "@supabase/supabase-js";

const PERIOD_ID = "950bad0b-fef6-4c5a-b949-fef5d9cbee90";
const FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: period, error: periodErr } = await supabase
    .from("content_periods")
    .select("id, firm_id, starts_on, ends_on, theme")
    .eq("id", PERIOD_ID)
    .maybeSingle();
  if (periodErr) throw periodErr;
  if (!period || period.firm_id !== FIRM_ID) {
    throw new Error(`period not found or firm mismatch: ${JSON.stringify(period)}`);
  }

  const { data: deliverables, error: delErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, period_id, title, status, content_kind, current_version_id, approved_version_id, created_at")
    .eq("period_id", PERIOD_ID)
    .order("created_at", { ascending: true });
  if (delErr) throw delErr;

  const versionIds = (deliverables ?? []).map((d) => d.current_version_id).filter(Boolean);
  const { data: versions, error: verErr } = versionIds.length
    ? await supabase
        .from("deliverable_versions")
        .select("id, deliverable_id, version_number, body_html, storage_path, asset_mime, asset_size_bytes, asset_sha256")
        .in("id", versionIds)
    : { data: [], error: null };
  if (verErr) throw verErr;

  const condensedVersions = (versions ?? []).map((v) => ({
    id: v.id,
    deliverable_id: v.deliverable_id,
    version_number: v.version_number,
    has_body_html: !!(v.body_html && v.body_html.trim().length > 0),
    body_html_length: v.body_html ? v.body_html.length : 0,
    storage_path: v.storage_path,
    asset_mime: v.asset_mime,
    asset_size_bytes: v.asset_size_bytes,
    asset_sha256: v.asset_sha256,
  }));

  const deliverableIds = (deliverables ?? []).map((d) => d.id);
  const { data: artifacts, error: artErr } = deliverableIds.length
    ? await supabase.from("publication_artifacts").select("id, deliverable_id, version_id, artifact_type, locale, storage_path, public_url").in("deliverable_id", deliverableIds)
    : { data: [], error: null };
  if (artErr) throw artErr;

  console.log(
    JSON.stringify(
      {
        period,
        deliverables,
        versions: condensedVersions,
        artifacts,
        fetched_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
