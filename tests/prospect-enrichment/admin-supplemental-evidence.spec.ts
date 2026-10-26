import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { renderedManifest, useSyntheticOperator } from "./browser-support";

type Fixture = { sourceRecordKey: string; firmId: string; firmName: string; observedOn: string; sourceUrl: string };
function fixture(): Fixture {
  const path = process.env.PROSPECT_ENRICHMENT_RENDERED_MANIFEST;
  if (!path) throw new Error("The disposable rendered fixture manifest is required.");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { adminSupplemental?: Fixture };
  if (!manifest.adminSupplemental) throw new Error("The Admin synthetic firm fixture was not seeded.");
  return manifest.adminSupplemental;
}

function evidencePackage(input: { fixture: Fixture; packageId: string; observedOn: string; channel: string; unresolved?: boolean; heldOnly?: boolean }) {
  const evidenceId = "source-" + input.packageId;
  return {
    packageType: "caseload-select.prospect-evidence", packageVersion: 1, packageId: input.packageId,
    generatedAt: input.observedOn + "T14:00:00.000Z",
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
    evidence: [{ evidenceId, sourceUrl: input.fixture.sourceUrl, observedOn: input.observedOn, sourceKind: "first_party", note: "Synthetic local acceptance source." }],
    identityMappings: input.unresolved ? [{
      sourceRecordKey: input.fixture.sourceRecordKey, mappingId: "held-" + input.packageId, matchState: "unresolved",
      firmId: null, candidateFirmIds: ["FIRM-00000000000000000000000000", "FIRM-11111111111111111111111111"], distinctFromFirmIds: [], canonicalDomain: null, firmName: input.fixture.firmName,
      confidence: "unknown", observedOn: input.observedOn, reason: "Synthetic identity remains unresolved; no stable identity is asserted.", evidenceIds: [evidenceId],
    }] : [],
    downtownGeography: [],
    websiteIntakeFindings: input.heldOnly ? [] : [{
      sourceRecordKey: input.fixture.sourceRecordKey, observationId: "intake-" + input.packageId,
      websiteUrl: "https://" + new URL(input.fixture.sourceUrl).hostname, observedOn: input.observedOn,
      visibleIntakeChannels: [input.channel], opportunityState: "supported",
      opportunityReason: "Synthetic acceptance fixture; no external site was contacted.", note: null, evidenceIds: [evidenceId],
    }],
    qualificationAssessments: [],
  };
}

async function reviewAndApply(page: Page, payload: Record<string, unknown>, expectedMode: string) {
  await page.getByLabel(/Or paste a JSON evidence package/).fill(JSON.stringify(payload));
  const reviewResponse = page.waitForResponse((r) => r.url().includes("/admin/prospects/evidence-import") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Review evidence package", exact: true }).click();
  const reviewed = await (await reviewResponse).json();
  expect(reviewed.rejected).toEqual([]);
  if ((payload.identityMappings as unknown[]).length > 0) expect(reviewed.summary.identityMappings).toBe(1);
  await page.getByRole("checkbox", { name: /I reviewed this source-linked evidence package/ }).check();
  const applyResponse = page.waitForResponse((r) => r.url().includes("/admin/prospects/evidence-import") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Record reviewed evidence", exact: true }).click();
  const response = await applyResponse;
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.mode).toBe(expectedMode);
  await expect(page.getByRole("status").filter({ hasText: "Evidence package recorded with fingerprint" })).toBeVisible();
}

async function evidenceCounts(pool: Pool, data: Fixture, packageIds: string[]) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::text FROM public.gta_prospect_firms WHERE id=$1::uuid AND source_record_key=$2) AS firms,
       (SELECT count(*)::text FROM public.gta_prospect_supplemental_evidence_import_batches WHERE package_id=ANY($3::text[]) AND state='applied') AS "appliedPackages",
       (SELECT count(*)::text FROM public.gta_prospect_supplemental_evidence_import_audit WHERE firm_id=$1::uuid AND source_record_key=$2) AS "auditRows",
       (SELECT count(*)::text FROM public.gta_prospect_website_intake_observations WHERE firm_id=$1::uuid) AS "intakeRows",
       (SELECT count(*)::text FROM public.gta_prospect_website_intake_observations WHERE firm_id=$1::uuid AND source_url=$4 AND observed_on=$5::date) AS "sourceRows",
       (SELECT count(*)::text FROM public.gta_prospect_stable_identity_registry WHERE firm_id=$1::uuid) AS "stableIdentityRows"`,
    [data.firmId, data.sourceRecordKey, packageIds, data.sourceUrl, data.observedOn],
  );
  return result.rows[0];
}

test("mounted supplemental evidence import updates and reads back one synthetic existing firm", async ({ page }) => {
  const data = fixture();
  await useSyntheticOperator(page.context(), renderedManifest());
  await page.goto("/admin/prospects");
  const search = page.getByPlaceholder("Firm, research, source, date, or status");
  await search.fill(data.firmName);
  await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Toronto");
  await page.getByRole("combobox", { name: "Practice area", exact: true }).selectOption("Family Law");
  const row = page.getByRole("row").filter({ hasText: data.firmName });
  await expect(row).toHaveCount(1);
  await row.getByText("Research profile", { exact: true }).click();
  await row.getByRole("link", { name: /^Open this firm’s research profile$/ }).click();
  await expect(page).toHaveURL(new RegExp("/admin/prospects/firms/" + data.firmId));
  await expect(page.getByTestId("prospect-research-detail")).toBeVisible();
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  expect(returnTo).toContain("up_city=Toronto");
  expect(returnTo).toContain("up_practiceArea=Family");
  await page.getByRole("link", { name: "Back to prospect list", exact: true }).click();
  await expect(search).toHaveValue(data.firmName);
  await expect(page.getByRole("combobox", { name: "City", exact: true })).toHaveValue("Toronto");
  await expect(page.getByRole("combobox", { name: "Practice area", exact: true })).toHaveValue("Family Law");

  const packageSuffix = data.sourceRecordKey.slice(-12);
  const first = evidencePackage({ fixture: data, packageId: "admin-first-" + packageSuffix, observedOn: data.observedOn, channel: "contact_form" });
  await reviewAndApply(page, first, "applied");
  await page.reload();
  const firstReadback = await page.context().request.get("/admin/prospects/reconciled");
  expect(firstReadback.ok()).toBeTruthy();
  const firstRecord = (await firstReadback.json()).records.find((candidate: { id: string }) => candidate.id === data.sourceRecordKey);
  expect(firstRecord.supplementalEvidence.websiteIntake).toMatchObject({ observedOn: data.observedOn, channels: ["contact_form"] });
  const updatedRow = page.getByRole("row").filter({ hasText: data.firmName });
  await expect(updatedRow).toHaveCount(1);
  await updatedRow.getByText("Research profile", { exact: true }).click();
  await expect(updatedRow).toContainText("Observed " + data.observedOn);
  await expect(updatedRow).toContainText("contact_form");
  await updatedRow.getByRole("link", { name: /^Open this firm’s research profile$/ }).click();
  await expect(page).toHaveURL(new RegExp("/admin/prospects/firms/" + data.firmId));
  await page.getByRole("link", { name: "Back to prospect list", exact: true }).click();
  await expect(search).toHaveValue(data.firmName);
  await expect(page.getByRole("combobox", { name: "City", exact: true })).toHaveValue("Toronto");
  await expect(page.getByRole("combobox", { name: "Practice area", exact: true })).toHaveValue("Family Law");

  const databaseUrl = process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("The disposable Postgres URL is required for read-only acceptance receipts.");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const second = evidencePackage({ fixture: data, packageId: "admin-second-" + packageSuffix, observedOn: data.observedOn, channel: "phone" });
    await reviewAndApply(page, second, "applied");
    const beforeReplay = await evidenceCounts(pool, data, [first.packageId, second.packageId]);
    await reviewAndApply(page, second, "already_applied");
    expect(await evidenceCounts(pool, data, [first.packageId, second.packageId])).toEqual(beforeReplay);
    const held = evidencePackage({ fixture: data, packageId: "admin-held-" + packageSuffix, observedOn: data.observedOn, channel: "email", unresolved: true, heldOnly: true });
    await reviewAndApply(page, held, "applied");

    const readbackResponse = await page.context().request.get("/admin/prospects/reconciled");
    expect(readbackResponse.ok()).toBeTruthy();
    const body = await readbackResponse.json();
    const record = body.records.find((candidate: { id: string }) => candidate.id === data.sourceRecordKey);
    expect(record).toMatchObject({
      databaseFirmId: data.firmId, firmName: data.firmName, city: "Toronto", websiteUrl: "https://" + new URL(data.sourceUrl).hostname,
      practiceAreas: ["Family Law"], observedLawyerCount: 3, rosterCheckedAt: data.observedOn,
      supplementalEvidence: { identity: { matchState: "unresolved", source: "supplemental_observation" } },
    });
    expect(record.supplementalEvidence.websiteIntake).toMatchObject({ observedOn: data.observedOn, channels: ["phone"] });
    expect(await evidenceCounts(pool, data, [first.packageId, second.packageId, held.packageId])).toEqual({
      firms: "1", appliedPackages: "3", auditRows: "3", intakeRows: "2", sourceRows: "2", stableIdentityRows: "0",
    });
  } finally {
    await pool.end();
  }
});
