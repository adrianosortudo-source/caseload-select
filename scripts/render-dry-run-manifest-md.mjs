// Renders the Workstream 5 dry-run JSON manifest as markdown. Never a
// second source of truth: every field printed here is read straight from
// the JSON file, nothing is recomputed or re-asserted.
import { readFileSync, writeFileSync } from "node:fs";

const jsonPath = process.argv[2];
const mdPath = process.argv[3];
if (!jsonPath || !mdPath) {
  console.error("usage: node render-dry-run-manifest-md.mjs <input.json> <output.md>");
  process.exit(1);
}

const m = JSON.parse(readFileSync(jsonPath, "utf8"));
const lines = [];

lines.push(`# Dry-run evidence assessment — ${m.period_theme}`);
lines.push("");
lines.push(`**This is a dry-run evidence assessment, not a reconciliation record.** No publication receipt was invented anywhere in this file.`);
lines.push("");
lines.push("## Read this first");
lines.push("");
for (const point of m.read_this_first ?? []) lines.push(`- ${point}`);
lines.push("");
lines.push(`- Firm: ${m.firm_name} (\`${m.firm_id}\`)`);
lines.push(`- Period: \`${m.period_id}\` — ${m.period_dates}`);
lines.push(`- Generated: ${m.generated_at} · Reconfirmed against production: ${m.reconfirmed_against_production_at}`);
lines.push(`- Live production lifecycle: \`${m.period_lifecycle_confirmed_live}\` (confirmed ${m.period_lifecycle_confirmed_live_at})`);
lines.push(`- \`publication_artifacts\` rows registered for this period: **${m.publication_artifacts_registered_for_this_period}**`);
lines.push("");
lines.push(m.note);
lines.push("");
lines.push("## Original pre-migration production state (historical record)");
lines.push("");
lines.push(
  `${m.original_production_summary_before_migration.active} active, ${m.original_production_summary_before_migration.ready} ready, ${m.original_production_summary_before_migration.blocked} blocked, ${m.original_production_summary_before_migration.excluded_archived} excluded.`,
);
lines.push("");
lines.push(m.original_production_summary_before_migration.note);
lines.push("");
lines.push("## State confirmed live in production (predicted by this dry run, then verified)");
lines.push("");
const s = m.display_summary_confirmed_live;
lines.push(
  `${s.historical_unreconciled} historical (not reconciled), ${s.setup_required} setup required, ${s.blocked} blocked, ${s.ready} ready, ${s.excluded} excluded.`,
);
lines.push("");
lines.push(s.note);
lines.push("");
lines.push("## Evidence classification, per active deliverable");
lines.push("");
lines.push(
  "Classification vocabulary: `verified_and_bindable` (confirmed real, an operator can register it as evidence in a separate reviewed step) · `missing` (confirmed absent) · `inaccessible_with_current_permissions` (this dry run has no access to check, e.g. no LinkedIn/GBP account, or checking would require an unauthorized live action like submitting a client form) · `ambiguous` · `pending_legal_approval` · `not_applicable`.",
);
lines.push("");

for (const d of m.deliverables) {
  lines.push(`### ${d.title}`);
  lines.push("");
  lines.push(`- ID: \`${d.deliverable_id}\``);
  lines.push(`- Role: ${d.deliverable_role ?? "unknown"} · Locale: ${d.locale ?? "unknown"} · Destination: ${d.intended_destination ?? "unknown"}`);
  lines.push(`- Current version: ${d.current_version_number ?? "none"} · Approval: ${d.approval_status}`);
  lines.push(`- Display state after migration: **${d.evaluator_output.display_state_after_migration}**`);
  if (d.evaluator_output.missing_requirements.length) {
    lines.push(`- Requirements not yet met: ${d.evaluator_output.missing_requirements.join(", ")}`);
  }
  lines.push(`- Classification: **${d.classification}**`);
  lines.push(`- Website route: ${d.evidence.verified_website_route}`);
  if (d.evidence.verified_pdf !== "not_applicable") lines.push(`- PDF: ${d.evidence.verified_pdf}`);
  if (d.evidence.verified_image_asset !== "not_applicable") lines.push(`- Image: ${d.evidence.verified_image_asset}`);
  if (d.evidence.verified_linkedin_evidence !== "not_applicable") lines.push(`- LinkedIn: ${d.evidence.verified_linkedin_evidence}`);
  if (d.evidence.verified_gbp_evidence !== "not_applicable") lines.push(`- GBP: ${d.evidence.verified_gbp_evidence}`);
  lines.push(`- Human confirmation required: ${d.evidence.human_confirmation_required}`);
  lines.push("");
}

if (m.remaining_work) {
  lines.push("## Remaining work for real historical evidence/placement reconciliation");
  lines.push("");
  lines.push(m.remaining_work.summary);
  lines.push("");
  m.remaining_work.items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
  lines.push("");
}

writeFileSync(mdPath, lines.join("\n"));
console.log("wrote", mdPath);
