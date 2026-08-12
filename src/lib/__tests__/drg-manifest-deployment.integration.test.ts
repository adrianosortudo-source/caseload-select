/**
 * Real-Postgres acceptance for DR-122 manifest placement. The test proves the
 * migration replays on a fresh Supabase database, concurrent identical calls
 * serialize to one apply plus one no-op, and placement never claims approval
 * or publication. It is skipped unless DIRECT_DATABASE_URL is provided.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;
const SLOTS = [
  "counsel-note-en", "counsel-note-pt", "clause-en", "clause-pt", "minute-en",
  "gbp-counsel-note-en", "gbp-clause-en", "gbp-checklist-en",
  "lead-magnet-en", "lead-magnet-pt", "checklist-en", "checklist-pt",
  "linkedin-counsel-note-en", "linkedin-clause-en",
  "linkedin-post-counsel-note-en", "linkedin-post-clause-en",
];

function parseDirectDatabaseUrl(url: string) {
  const trimmed = url.trim();
  const unquoted = trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) ? trimmed.slice(1, -1) : trimmed;
  const parsed = new URL(unquoted);
  return { host: decodeURIComponent(parsed.hostname), port: parsed.port ? Number(parsed.port) : undefined, user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database: parsed.pathname.replace(/^\//, "") || undefined };
}

function sha(value: string) { return createHash("sha256").update(value).digest("hex"); }

describe.skipIf(!DB_URL)("DR-122 manifest deployment (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let a: import("pg").Client;
  let b: import("pg").Client;
  const firmId = randomUUID();
  const periodId = randomUUID();
  const packageId = randomUUID();
  const deploymentReceiptId = randomUUID();
  const packageEventId = randomUUID();
  const operationId = randomUUID();
  const deploymentKey = `drg-integration-${randomUUID()}`;
  const deliverableIds = Object.fromEntries(SLOTS.map((slot) => [slot, randomUUID()]));
  const versionIds = Object.fromEntries(SLOTS.map((slot) => [slot, randomUUID()]));
  const assetIds = Array.from({ length: 9 }, () => randomUUID());
  const strategyBrief = {
    readerAndSituation: "An Ontario business reader is facing a consequential decision.",
    workSupported: "The package supports a defined, scoped legal review engagement.",
    whyThisWeek: "No dated trigger was verified; the decision has durable importance.",
    practicalAngle: "Collect the actual documents, chronology, costs, and open questions.",
    authorityAndEvidence: "One official primary source supports the bounded legal explanation.",
    websiteAndConversionRole: "A specific query leads a qualified reader to a review decision.",
  };

  const pieces = SLOTS.map((slot) => {
    const isPdf = slot.startsWith("checklist-");
    const isGbp = slot.startsWith("gbp-");
    const isLinkedInPost = slot.startsWith("linkedin-post-");
    const isLinkedInArticle = slot.startsWith("linkedin-") && !isLinkedInPost;
    const isMinute = slot === "minute-en";
    const isLanding = slot.startsWith("lead-magnet-");
    return {
      slotId: slot, deliverableId: deliverableIds[slot], versionId: versionIds[slot],
      formatFamily: isPdf ? "decision_tool" : isGbp ? "google_business_profile_post" : isLinkedInPost ? "linkedin_post" : isLinkedInArticle ? "linkedin_article" : isMinute ? "minute_drg" : isLanding ? "lead_magnet_landing_page" : slot.startsWith("clause-") ? "clause_in_the_margin" : "counsel_note",
      locale: slot.endsWith("-pt") ? "pt-BR" : "en-CA",
      destination: isGbp ? "google_business_profile" : isLinkedInPost ? "linkedin" : isLinkedInArticle ? "linkedin_article" : isMinute ? "email" : "firm_website",
      deliverableRole: isPdf ? "lead_magnet_pdf" : isGbp ? "gbp_post" : isLinkedInPost ? "social_post" : isMinute ? "email_newsletter" : isLanding ? "landing_page" : "article",
      title: `Integration ${slot}`, description: `Integration description for ${slot}`,
      bodyHtml: `<p>Integration body for ${slot}</p>`, bodySha256: sha(`<p>Integration body for ${slot}</p>`),
      source: { path: `sources/${slot}.json`, sha256: sha(slot) }, contentKind: isPdf ? "pdf" : "text",
      publicationPath: null, ctaTargetPath: null,
    };
  });

  const assets = assetIds.map((assetId, index) => {
    const slotId = index === 0 ? "checklist-en" : index === 1 ? "checklist-pt" : SLOTS[index - 2];
    const pdf = index < 2;
    return {
      assetId, localPath: `assets/${index}.${pdf ? "pdf" : "png"}`, sha256: sha(`asset-${index}`),
      mimeType: pdf ? "application/pdf" : "image/png", byteSize: 100 + index, width: pdf ? 0 : 1200, height: pdf ? 0 : 900,
      storagePath: `deliverables/${firmId}/${deploymentKey}/${sha(`asset-${index}`)}-${index}.${pdf ? "pdf" : "png"}`,
      textPolicy: "text_bearing", overlayLanguage: pdf ? null : "en",
      placements: [{ slotId, role: pdf ? "pdf_document" : "gbp_card", databaseRole: pdf ? "pdf_document" : "gbp_card", packageAssetId: randomUUID(), destination: pdf ? "firm_website" : "google_business_profile", locale: slotId.endsWith("-pt") ? "pt-BR" : "en-CA" }],
    };
  });

  const bundle: any = {
    schemaVersion: "drg-deployment-bundle-v1", deploymentKey, deploymentReceiptId, packageEventId, operationId, firmId, operatorWeekNumber: 91,
    calendarKey: "2099-W01", runId: "DRG-INTEGRATION", contentVersion: "v-integration",
    sourcePackage: { path: "run-state.json", sha256: sha("run") }, authority: { releaseId: "DRG-LAW-CSB-4.22", sha256: "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3" },
    period: { id: periodId, startsOn: "2099-01-01", endsOn: "2099-01-05", theme: "Integration deployment theme", details: "A complete integration deployment fixture.", rationale: "Proves transactional manifest placement and replay.", sortIndex: 91, strategyBrief, strategyBriefSource: { path: "weekly-strategy-brief.json", sha256: sha("brief") } },
    publishingPackageId: packageId, pieces, assets,
    approvalEvidence: [{ approvalId: "integration-assets", kind: "operator_placement", source: { path: "approval.json", sha256: sha("approval") }, decision: "approved", approvedBy: "Integration Operator", scope: assetIds }],
    writeAllowlist: { tables: ["content_periods", "content_deliverables", "deliverable_versions", "publishing_packages", "publishing_package_assets", "publishing_package_events", "drg_content_deployments"], storageBucket: "firm-files", storagePrefix: `deliverables/${firmId}/${deploymentKey}/`, maxWrites: 80 },
    publicationAuthorized: false,
  };
  const canonicalSha = sha(JSON.stringify(bundle));
  const packageAssetIds = assets.flatMap((asset) => asset.placements.map((placement) => placement.packageAssetId));
  const destinationRecords = [`content_periods:${periodId}`, `publishing_packages:${packageId}`, `publishing_package_events:${packageEventId}`, `drg_content_deployments:${deploymentReceiptId}`, ...Object.values(deliverableIds).map((id) => `content_deliverables:${id}`), ...Object.values(versionIds).map((id) => `deliverable_versions:${id}`), ...packageAssetIds.map((id) => `publishing_package_assets:${id}`), ...assets.map((asset) => `storage:firm-files:${asset.storagePath}`)];
  const authorization: any = { operation: "deliverables_publishing_kit_placement", approvedBy: "Integration Operator", approvedAt: "2098-01-01T00:00:00Z", planSha256: canonicalSha, allowedTargetIds: [periodId, packageId, deploymentReceiptId, packageEventId, operationId, ...Object.values(deliverableIds), ...Object.values(versionIds), ...assetIds, ...packageAssetIds], allowedDestinationRecords: destinationRecords, maxWriteCount: 80, expiresAt: "2099-12-31T00:00:00Z" };
  const authorizationSha = sha(JSON.stringify(authorization));
  const bundleFileSha = sha(`file:${canonicalSha}`);

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    const options = parseDirectDatabaseUrl(DB_URL!);
    a = new Client(options); b = new Client(options);
    await a.connect(); await b.connect();
    await a.query(`insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'DRG deployment integration', null, $2)`, [firmId, `drg-deployment-${firmId}`]);
  }, 30000);

  afterAll(async () => { if (a) await a.end(); if (b) await b.end(); });

  it("serializes concurrent identical placement, proves exact records, and rejects byte substitution", async () => {
    const sql = `select apply_drg_content_deployment($1::jsonb,$2,$3,$4::jsonb,$5,$6::jsonb) as result`;
    const args = [JSON.stringify(bundle), bundleFileSha, canonicalSha, JSON.stringify(authorization), authorizationSha, JSON.stringify({})];
    const [first, second] = await Promise.all([a.query(sql, args), b.query(sql, args)]);
    expect([first.rows[0].result.status, second.rows[0].result.status].sort()).toEqual(["applied", "verified_noop"]);
    expect([first.rows[0].result.writesPerformed, second.rows[0].result.writesPerformed].sort((x: number, y: number) => x - y)[0]).toBe(0);

    const proof = await a.query(`select
      (select count(*)::int from content_deliverables where period_id=$1) as deliverables,
      (select count(*)::int from content_deliverables where period_id=$1 and (status='approved' or published_at is not null)) as published_or_approved,
      (select strategy_brief from content_periods where id=$1) as strategy_brief,
      (select count(*)::int from drg_content_deployments where firm_id=$2 and deployment_key=$3) as deployments`, [periodId, firmId, deploymentKey]);
    expect(proof.rows[0].deliverables).toBe(16);
    expect(proof.rows[0].published_or_approved).toBe(0);
    expect(proof.rows[0].strategy_brief).toEqual(strategyBrief);
    expect(proof.rows[0].deployments).toBe(1);

    await expect(a.query(sql, [JSON.stringify(bundle), "f".repeat(64), canonicalSha, JSON.stringify(authorization), authorizationSha, JSON.stringify({})])).rejects.toThrow(/different bundle bytes or authorization content hash/);
  }, 30000);
});
