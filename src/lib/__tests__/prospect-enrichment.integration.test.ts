import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { ProspectEnrichmentEnvelope } from "@/lib/prospect-enrichment-contract";
import { buildProspectEnrichmentClientItems } from "@/lib/prospect-enrichment-contract";
import {
  prospectEnrichmentIdempotencyKey,
  prospectEnrichmentPayloadSha256,
  prospectEnrichmentProtocolHash,
  prospectEnrichmentSha256,
} from "@/lib/prospect-enrichment-hash";

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
if (process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1" && !databaseUrl) {
  throw new Error("prospect enrichment integration tests require a direct local Postgres URL");
}
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe("prospect enrichment v1 PostgreSQL contract", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  afterAll(async () => { await pool.end(); });

  it("keeps package history private and append-only, and invalidates a review when an import batch completes", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const sourceRecordKey = `pe-test-${suffix}`;
    const sourceName = `prospect-enrichment-test-${suffix}`;
    const sourceDigest = createHash("sha256").update("{}", "utf8").digest("hex");
    const writerA = await pool.connect();
    const writerB = await pool.connect();
    const observer = await pool.connect();
    let firmId: string | null = null;
    let batchId: string | null = null;
    let writerAPending = false;
    try {
      const firm = await writerA.query<{ id: string }>(
        `INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status)
         VALUES ($1,$2,$3,'update_existing') RETURNING id`,
        [sourceRecordKey, "Enrichment Test Firm", "enrichment test firm"],
      );
      firmId = firm.rows[0].id;
      const batch = await writerA.query<{ id: string }>(
        `INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count,state)
         VALUES ($1,$2,1,'staged') RETURNING id`,
        [sourceName, sourceDigest],
      );
      batchId = batch.rows[0].id;
      await writerA.query(
        `INSERT INTO public.gta_prospect_import_audit(
           import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,validation_errors,canonical_record
         ) VALUES ($1,$2,$3,'accepted','created',$4,'[]'::jsonb,'{}'::jsonb)`,
        [batchId, sourceRecordKey, sourceDigest, firmId],
      );

      const runKey = `run-${suffix}`;
      const run = await writerA.query<{ id: string }>(
        `INSERT INTO public.prospect_enrichment_runs(submitted_by,run_key,source_system,source_name)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [`integration-${suffix}`, runKey, "integration-test", "private-contract-test"],
      );
      const clientPackageId = `package-${suffix}`;
      const envelope: ProspectEnrichmentEnvelope = {
        schemaVersion: "prospect-enrichment/v1",
        runId: runKey,
        packageId: clientPackageId,
        supersedesPackageId: null,
        sourceSystem: "integration-test",
        sourceName: "private-contract-test",
        generatedAt: "2026-09-23T16:00:00.000Z",
        mode: "propose",
        subject: {
          researchKey: sourceRecordKey,
          databaseFirmId: firmId,
          stableFirmId: null,
          sourceRecordKey,
          canonicalDomain: null,
          displayName: "Enrichment Test Firm",
          identityState: "resolved",
        },
        sources: [{
          sourceId: "firm-site",
          url: "https://example.test/team",
          requestedUrl: "https://example.test/team",
          finalUrl: "https://example.test/team",
          policyState: "public-source",
          publicationLabel: null,
          publicationPrecision: "unknown",
          publisher: "Example Test Firm",
          observedAt: null,
          observedOn: "2026-09-23",
          retrievedAt: "2026-09-23T16:00:00.000Z",
          retrievalMethod: "manual-public-web",
          retrievalOutcome: "success-positive",
          httpStatus: 200,
          bodySha256: "b".repeat(64),
          excerpt: "Public team page reviewed for this integration fixture.",
          missingProvenanceReason: null,
        }],
        observations: [{
          observationId: `research-${suffix}`,
          evidenceState: "asserted",
          retractionReason: null,
          retractionSourceIds: [],
          missingProvenanceReason: null,
          kind: "research_attempt",
          observedAt: null,
          observedOn: "2026-09-23",
          sourceIds: ["firm-site"],
          data: { provider: "integration-test", queryOrUrl: "https://example.test/team", outcome: "success-positive", coverage: "complete", failureReason: null },
          existingRecord: null,
        }],
        assessment: null,
        originalResearch: {
          sourcePath: `fixtures/${suffix}.json`,
          sourceSha256: sourceDigest,
          sourcePointer: "/firms/0",
          contentSha256: prospectEnrichmentProtocolHash({ fixture: suffix }),
          content: { fixture: suffix },
          unmappedPaths: [],
        },
        controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
      };
      const expectedItems = buildProspectEnrichmentClientItems(envelope);
      const sourceEventKey = expectedItems.find((item) => item.itemKind === "observation")!.sourceEventKey;
      const clientItemId = expectedItems.find((item) => item.itemKind === "observation")!.clientItemId;
      const payloadSha256 = prospectEnrichmentPayloadSha256(envelope);
      const packageEntry = {
        entryId: `entry-${prospectEnrichmentProtocolHash(["package", suffix])}`,
        researchKey: sourceRecordKey,
        clientPackageId,
        expectedPayloadSha256: payloadSha256,
        itemCount: expectedItems.length,
        clientItems: expectedItems,
        initialDisposition: "ready_for_review",
        source: { sourceRoot: null, relativePath: `fixtures/${suffix}.json`, sourcePointer: "/firms/0", fileSha256: sourceDigest },
        errorCodes: [],
      };
      const heldEntry = {
        entryId: `entry-${prospectEnrichmentProtocolHash(["held", suffix])}`,
        researchKey: null,
        clientPackageId: null,
        expectedPayloadSha256: null,
        itemCount: 0,
        clientItems: [],
        initialDisposition: "source_read_failed",
        source: { sourceRoot: null, relativePath: `missing/${suffix}.json`, sourcePointer: "", fileSha256: null },
        errorCodes: ["source_read_failed"],
      };
      const entries = [packageEntry, heldEntry].sort((a, b) => a.entryId.localeCompare(b.entryId));
      const sourceManifestSha256 = "a".repeat(64);
      const generatedAt = "2026-09-23T16:00:00.000Z";
      const manifestBase = {
        schemaVersion: "prospect-enrichment-run-manifest/v1",
        runId: runKey,
        sourceSystem: "integration-test",
        sourceName: "private-contract-test",
        sourceManifestSha256,
        generatedAt,
        expectedPackageCount: 1,
        entries,
      };
      const manifestSha256 = prospectEnrichmentProtocolHash(manifestBase);
      const chunk = {
        schemaVersion: "prospect-enrichment-run-manifest-chunk/v1",
        adapterVersion: "integration-test/v1",
        runId: runKey,
        sourceSystem: "integration-test",
        sourceName: "private-contract-test",
        sourceManifestSha256,
        runManifestSha256: manifestSha256,
        generatedAt,
        expectedPackageCount: 1,
        expectedEntryCount: entries.length,
        chunkIndex: 0,
        chunkCount: 1,
        chunkSha256: prospectEnrichmentProtocolHash(entries),
        entries,
      };
      const registerManifest = async (finalize: boolean) => {
        const result = await writerA.query<{ receipt: Record<string, unknown> }>(
          `SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,$3) AS receipt`,
          [`integration-${suffix}`, JSON.stringify(chunk), finalize],
        );
        return result.rows[0].receipt;
      };
      expect(await registerManifest(false)).toMatchObject({
        outcome: "chunk_registered", runId: runKey, runKey, sourceManifestSha256,
        manifestSha256, registeredChunkCount: 1, expectedChunkCount: 1,
        receivedEntryCount: 2, expectedEntryCount: 2, receivedPackageCount: 1,
        expectedPackageCount: 1, manifestState: "open",
      });
      expect(await registerManifest(false)).toMatchObject({ outcome: "chunk_replayed", manifestState: "open" });
      expect(await registerManifest(true)).toMatchObject({ outcome: "finalized", manifestState: "finalized" });
      expect(await registerManifest(true)).toMatchObject({ outcome: "already_finalized", manifestState: "finalized" });

      const conflictChunk = { ...chunk, entries: [{ ...entries[0], source: { ...entries[0].source, sourcePointer: "/changed" } }, entries[1]] };
      conflictChunk.chunkSha256 = prospectEnrichmentProtocolHash(conflictChunk.entries);
      const conflictReceipt = await writerA.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,false) AS receipt`,
        [`integration-${suffix}`, JSON.stringify(conflictChunk)],
      );
      expect(conflictReceipt.rows[0].receipt).toMatchObject({ outcome: "chunk_conflict", manifestState: "finalized" });

      const lineageById = new Map(expectedItems.map((item) => [item.clientItemId, item]));
      const stageSources = envelope.sources.map((source) => {
        const lineage = lineageById.get(`src:${source.sourceId}`)!;
        return {
          sourceId: source.sourceId, clientItemId: lineage.clientItemId, sourceEventKey: lineage.sourceEventKey,
          semanticSha256: lineage.semanticSha256, data: source, observedAt: source.observedAt,
          observedOn: source.observedOn, provenanceState: "complete",
        };
      });
      const stageItems = envelope.observations.map((observation) => {
        const lineage = lineageById.get(`obs:${observation.observationId}`)!;
        return {
          clientItemId: lineage.clientItemId, itemKind: lineage.itemKind, sourceEventKey: lineage.sourceEventKey,
          semanticSha256: lineage.semanticSha256, data: observation, sourceIds: observation.sourceIds,
          observedAt: observation.observedAt, observedOn: observation.observedOn, provenanceState: "complete",
        };
      });
      const rawBody = JSON.stringify(envelope);
      const stageArguments = [
        `integration-${suffix}`, runKey, envelope.sourceSystem, envelope.sourceName, clientPackageId,
        prospectEnrichmentIdempotencyKey(envelope.sourceSystem, runKey, clientPackageId), rawBody,
        prospectEnrichmentSha256(rawBody), JSON.stringify(envelope), payloadSha256, envelope.subject.researchKey,
        envelope.subject.identityState, JSON.stringify(stageItems), JSON.stringify(stageSources), null,
      ];
      const stagePackage = async () => {
        const result = await writerA.query<{ receipt: Record<string, unknown> }>(
          `SELECT public.stage_prospect_enrichment_package_v1(
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15
           ) AS receipt`,
          stageArguments,
        );
        return result.rows[0].receipt;
      };

      const stageBeforeManifest = async (lateRunKey: string, latePackageId: string) => {
        const lateSourceId = `firm-site-${latePackageId}`;
        const lateEnvelope: ProspectEnrichmentEnvelope = {
          ...envelope,
          runId: lateRunKey,
          packageId: latePackageId,
          sources: envelope.sources.map((source) => ({ ...source, sourceId: lateSourceId })),
          observations: envelope.observations.map((observation) => ({
          ...observation, observationId: `research-${latePackageId}`, sourceIds: [lateSourceId],
          })),
        };
        const lateItems = buildProspectEnrichmentClientItems(lateEnvelope);
        const lateLineage = new Map(lateItems.map((item) => [item.clientItemId, item]));
        const lateSources = lateEnvelope.sources.map((source) => {
          const item = lateLineage.get(`src:${source.sourceId}`)!;
          return {
            sourceId: source.sourceId, clientItemId: item.clientItemId, sourceEventKey: item.sourceEventKey,
            semanticSha256: item.semanticSha256, data: source, observedAt: source.observedAt,
            observedOn: source.observedOn, provenanceState: "complete",
          };
        });
        const lateObservations = lateEnvelope.observations.map((observation) => {
          const item = lateLineage.get(`obs:${observation.observationId}`)!;
          return {
            clientItemId: item.clientItemId, itemKind: item.itemKind, sourceEventKey: item.sourceEventKey,
            semanticSha256: item.semanticSha256, data: observation, sourceIds: observation.sourceIds,
            observedAt: observation.observedAt, observedOn: observation.observedOn, provenanceState: "complete",
          };
        });
        const raw = JSON.stringify(lateEnvelope);
        const latePayloadSha256 = prospectEnrichmentPayloadSha256(lateEnvelope);
        const result = await writerA.query<{ receipt: Record<string, unknown> }>(
          `SELECT public.stage_prospect_enrichment_package_v1(
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15
           ) AS receipt`,
          [
            `integration-${suffix}`, lateRunKey, lateEnvelope.sourceSystem, lateEnvelope.sourceName, latePackageId,
            prospectEnrichmentIdempotencyKey(lateEnvelope.sourceSystem, lateRunKey, latePackageId), raw,
            prospectEnrichmentSha256(raw), JSON.stringify(lateEnvelope), latePayloadSha256,
            lateEnvelope.subject.researchKey, lateEnvelope.subject.identityState,
            JSON.stringify(lateObservations), JSON.stringify(lateSources), null,
          ],
        );
        expect(result.rows[0].receipt).toMatchObject({ outcome: "created", clientPackageId: latePackageId, runId: lateRunKey });
        return { envelope: lateEnvelope, items: lateItems, payloadSha256: latePayloadSha256 };
      };
      const finalizeInventory = async (
        lateRunKey: string,
        lateEnvelope: ProspectEnrichmentEnvelope,
        inventoryEntries: Array<Record<string, unknown>>,
        expectedPackageCount: number,
        sourceManifestSha256: string,
      ) => {
        const generatedAt = "2026-09-23T16:00:00.000Z";
        const sortedEntries = [...inventoryEntries].sort((a, b) => String(a.entryId).localeCompare(String(b.entryId)));
        const manifestBase = {
          schemaVersion: "prospect-enrichment-run-manifest/v1", runId: lateRunKey,
          sourceSystem: lateEnvelope.sourceSystem, sourceName: lateEnvelope.sourceName,
          sourceManifestSha256, generatedAt, expectedPackageCount, entries: sortedEntries,
        };
        const lateChunk = {
          schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: "integration-test/v1",
          runId: lateRunKey, sourceSystem: lateEnvelope.sourceSystem, sourceName: lateEnvelope.sourceName,
          sourceManifestSha256, runManifestSha256: prospectEnrichmentProtocolHash(manifestBase), generatedAt,
          expectedPackageCount, expectedEntryCount: sortedEntries.length, chunkIndex: 0, chunkCount: 1,
          chunkSha256: prospectEnrichmentProtocolHash(sortedEntries), entries: sortedEntries,
        };
        const args = [`integration-${suffix}`, JSON.stringify(lateChunk)];
        const registered = await writerA.query<{ receipt: Record<string, unknown> }>(
          `SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,false) AS receipt`, args,
        );
        expect(registered.rows[0].receipt).toMatchObject({ outcome: "chunk_registered", manifestState: "open" });
        await writerA.query(
          `SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,true)`, args,
        );
      };

      const orphanRunKey = `orphan-run-${suffix}`;
      const orphanPackageId = `orphan-package-${suffix}`;
      const orphanStaged = await stageBeforeManifest(orphanRunKey, orphanPackageId);
      const orphanHeldEntry = {
        entryId: `entry-${prospectEnrichmentProtocolHash(["orphan-held", suffix])}`,
        researchKey: null, clientPackageId: null, expectedPayloadSha256: null, itemCount: 0,
        clientItems: [], initialDisposition: "source_read_failed",
        source: { sourceRoot: null, relativePath: `orphan/${suffix}.json`, sourcePointer: "", fileSha256: null },
        errorCodes: ["source_read_failed"],
      };
      await expect(finalizeInventory(orphanRunKey, orphanStaged.envelope, [orphanHeldEntry], 0, "c".repeat(64)))
        .rejects.toThrow(/staged packages do not reconcile/i);

      for (const mismatchKind of ["payload", "research_key"] as const) {
        const mismatchRunKey = `${mismatchKind}-mismatch-run-${suffix}`;
        const mismatchPackageId = `${mismatchKind}-mismatch-package-${suffix}`;
        const mismatchStaged = await stageBeforeManifest(mismatchRunKey, mismatchPackageId);
        const expectedResearchKey = mismatchKind === "research_key" ? `${sourceRecordKey}-wrong` : sourceRecordKey;
        const expectedClientItems = mismatchKind === "research_key"
          ? mismatchStaged.items.map((item) => ({
              ...item, sourceEventKey: `${item.itemKind}:${prospectEnrichmentProtocolHash([expectedResearchKey, item.clientItemId])}`,
            }))
          : mismatchStaged.items;
        const mismatchEntry = {
          entryId: `entry-${prospectEnrichmentProtocolHash([mismatchKind, suffix])}`,
          researchKey: expectedResearchKey, clientPackageId: mismatchPackageId,
          expectedPayloadSha256: mismatchKind === "payload" ? "f".repeat(64) : mismatchStaged.payloadSha256,
          itemCount: expectedClientItems.length, clientItems: expectedClientItems,
          initialDisposition: "ready_for_review",
          source: { sourceRoot: null, relativePath: `${mismatchKind}/${suffix}.json`, sourcePointer: "/firms/0", fileSha256: sourceDigest },
          errorCodes: [],
        };
        const sourceManifestHash = mismatchKind === "payload" ? "d".repeat(64) : "e".repeat(64);
        await expect(finalizeInventory(mismatchRunKey, mismatchStaged.envelope, [mismatchEntry], 1, sourceManifestHash))
          .rejects.toThrow(/staged packages do not reconcile/i);
      }

      const stageReceipt = await stagePackage();
      expect(stageReceipt).toMatchObject({
        outcome: "created", clientPackageId, runId: runKey, payloadSha256, state: "ready_for_review",
        identityState: "resolved", counts: { sources: 1, observations: 1, assessments: 0, items: 2 },
      });
      const packageId = String(stageReceipt.packageId);
      expect(await stagePackage()).toMatchObject({ outcome: "replayed", packageId, payloadSha256 });
      const sourceEvent = await writerA.query<{ id: string }>(
        `SELECT id FROM public.prospect_enrichment_source_events WHERE source_system='integration-test' AND source_event_key=$1`,
        [sourceEventKey],
      );
      const item = await writerA.query<{ id: string }>(
        `SELECT id FROM public.prospect_enrichment_items WHERE package_id=$1 AND client_item_id=$2`,
        [packageId, clientItemId],
      );
      expect(sourceEvent.rows).toHaveLength(1);
      expect(item.rows).toHaveLength(1);

      const allPackageItems = await writerA.query<{ id: string; client_item_id: string }>(
        `SELECT id,client_item_id FROM public.prospect_enrichment_items WHERE package_id=$1 ORDER BY client_item_id`, [packageId],
      );
      const operatorId = randomUUID();
      const packageVerification = {
        visibilityScope: "package", payloadSha256, readbackSha256: "1".repeat(64), expectedReceiptSha256: null,
        sourceCount: 1, itemCount: 2, targetCount: 0, verificationVersion: "prospect-enrichment-readback/v1",
      };
      const packageVerificationReceipt = await writerA.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.record_prospect_enrichment_verification_v1($1,$2,'package',$3::jsonb) AS receipt`,
        [packageId, payloadSha256, JSON.stringify(packageVerification)],
      );
      expect(packageVerificationReceipt.rows[0].receipt).toMatchObject({ verified: true, visibilityScope: "package", payloadSha256, readbackSha256: "1".repeat(64) });
      await expect(writerA.query(
        `SELECT public.record_prospect_enrichment_verification_v1($1,$2,'package',$3::jsonb)`,
        [packageId, payloadSha256, JSON.stringify(packageVerification)],
      )).resolves.toBeTruthy();

      const review = {
        payloadSha256,
        identity: { choice: "existing", firmId, coreInput: null },
        items: allPackageItems.rows.map((storedItem) => ({
          itemId: storedItem.id, disposition: "retain_only", reason: "Synthetic integration evidence remains retained without changing the profile.", profileChoice: null,
        })),
      };
      const reviewSha256 = prospectEnrichmentProtocolHash(review);
      const reviewExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
      const reviewed = await writerA.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.review_prospect_enrichment_package_v1($1,$2,$3::jsonb,$4,$5,$6::timestamptz) AS receipt`,
        [packageId, payloadSha256, JSON.stringify(review), reviewSha256, operatorId, reviewExpiry],
      );
      expect(reviewed.rows[0].receipt).toMatchObject({ outcome: "reviewed", state: "ready_for_review", reviewSha256 });
      const expectedRevisionSha256 = String(reviewed.rows[0].receipt.expectedRevisionSha256);
      const applied = await writerA.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.apply_prospect_enrichment_package_v1($1,$2,$3,$4) AS receipt`,
        [packageId, reviewSha256, expectedRevisionSha256, operatorId],
      );
      expect(applied.rows[0].receipt).toMatchObject({ outcome: "applied", schemaVersion: "prospect-enrichment-apply-receipt/v1", packageId, firmId });
      const storedReceipt = await writerA.query<{ apply_receipt: Record<string, unknown> }>(
        `SELECT apply_receipt FROM public.prospect_enrichment_packages WHERE id=$1`, [packageId],
      );
      const applyReceipt = storedReceipt.rows[0].apply_receipt;
      const canonicalVerification = {
        visibilityScope: "canonical", payloadSha256, readbackSha256: "2".repeat(64),
        expectedReceiptSha256: prospectEnrichmentProtocolHash(applyReceipt),
        sourceCount: 1, itemCount: 2, targetCount: 0, verificationVersion: "prospect-enrichment-readback/v1",
      };
      const canonicalVerificationReceipt = await writerA.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.record_prospect_enrichment_verification_v1($1,$2,'canonical',$3::jsonb) AS receipt`,
        [packageId, payloadSha256, JSON.stringify(canonicalVerification)],
      );
      expect(canonicalVerificationReceipt.rows[0].receipt).toMatchObject({ verified: true, visibilityScope: "canonical", payloadSha256, readbackSha256: "2".repeat(64) });
      await expect(writerA.query(
        `SELECT public.record_prospect_enrichment_verification_v1($1,$2,'canonical',$3::jsonb)`,
        [packageId, payloadSha256, JSON.stringify({ ...canonicalVerification, expectedReceiptSha256: "9".repeat(64) })],
      )).rejects.toThrow(/receipt_mismatch/i);

      const privileges = await observer.query<{ anon_select: boolean; auth_select: boolean; service_insert: boolean }>(
        `SELECT has_table_privilege('anon','public.prospect_enrichment_packages','SELECT') AS anon_select,
                has_table_privilege('authenticated','public.prospect_enrichment_packages','SELECT') AS auth_select,
                has_table_privilege('service_role','public.prospect_enrichment_packages','INSERT') AS service_insert`,
      );
      expect(privileges.rows[0]).toEqual({ anon_select: false, auth_select: false, service_insert: true });

      const summary = await observer.query<Record<string, unknown>>(
        `SELECT * FROM public.get_prospect_enrichment_run_summary_v1($1)`, [run.rows[0].id],
      );
      expect(summary.rows[0]).toMatchObject({
        run_id: run.rows[0].id, manifest_state: "finalized", manifest_expected_entry_count: 2,
        manifest_received_entry_count: "2", manifest_expected_package_count: 1, manifest_received_package_count: "1",
        candidate_count: "1", package_count: "1", missing_package_count: "0", payload_mismatch_count: "0",
        research_key_mismatch_count: "0", orphan_package_count: "0",
        visibility_counts: { packageVerified: 1, packageNotVerified: 0, canonicalVerified: 1, canonicalNotVerified: 0 },
        needs_attention_count: "1",
      });
      const manifestPage = await observer.query<Record<string, unknown>>(
        `SELECT * FROM public.list_prospect_enrichment_run_manifest_items_v1($1,NULL,1)`, [run.rows[0].id],
      );
      expect(manifestPage.rows).toHaveLength(1);
      const allManifestEntries = await observer.query<Record<string, unknown>>(
        `SELECT * FROM public.list_prospect_enrichment_run_manifest_items_v1($1,NULL,10)`, [run.rows[0].id],
      );
      expect(allManifestEntries.rows).toHaveLength(2);
      const packageManifestRow = allManifestEntries.rows.find((row) => (row.manifest_entry as { clientPackageId?: string }).clientPackageId === clientPackageId);
      expect(packageManifestRow).toMatchObject({
        package_id: packageId, actual_payload_sha256: payloadSha256, package_state: "applied",
        reconciliation_state: "applied", package_visibility_verified: true, canonical_visibility_verified: true,
      });
      const manifestItems = packageManifestRow?.items as Array<Record<string, unknown>>;
      expect(manifestItems).toHaveLength(2);
      expect(manifestItems.find((manifestItem) => manifestItem.clientItemId === clientItemId)).toMatchObject({
        clientItemId, itemKind: "observation", itemId: item.rows[0].id,
        actualSourceEventKey: sourceEventKey,
        actualSemanticSha256: expectedItems.find((expectedItem) => expectedItem.clientItemId === clientItemId)?.semanticSha256,
        disposition: "retain_only", targets: [],
      });
      const heldManifestRow = allManifestEntries.rows.find((row) => (row.manifest_entry as { clientPackageId?: string | null }).clientPackageId === null);
      expect(heldManifestRow).toMatchObject({ package_id: null, reconciliation_state: "source_hold", items: [] });
      await expect(writerA.query(
        `UPDATE public.prospect_enrichment_run_manifest_items SET initial_disposition='provenance_only' WHERE run_id=$1 AND entry_id=$2`,
        [run.rows[0].id, packageEntry.entryId],
      )).rejects.toThrow(/append-only/i);

      await expect(writerA.query(`UPDATE public.prospect_enrichment_items SET data='{"edited":true}'::jsonb WHERE id=$1`, [item.rows[0].id])).rejects.toThrow(/immutable/i);

      const before = await writerA.query<{ enrichment_revision: string }>(
        `SELECT enrichment_revision::text FROM public.gta_prospect_firms WHERE id=$1`, [firmId],
      );
      const reviewedRevision = BigInt(before.rows[0].enrichment_revision);
      await writerA.query("BEGIN");
      writerAPending = true;
      await writerA.query("SELECT id FROM public.gta_prospect_firms WHERE id=$1 FOR UPDATE", [firmId]);
      const backend = await writerB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const pendingCompletion = writerB.query(`UPDATE public.gta_prospect_import_batches SET state='failed' WHERE id=$1`, [batchId]);
      let completionWaitingForFirmLock = false;
      const deadline = Date.now() + 10_000;
      while (!completionWaitingForFirmLock && Date.now() < deadline) {
        const waiting = await observer.query<{ wait_event_type: string | null }>(
          `SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`, [backend.rows[0].pid],
        );
        completionWaitingForFirmLock = waiting.rows[0]?.wait_event_type === "Lock";
        if (!completionWaitingForFirmLock) await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(completionWaitingForFirmLock).toBe(true);
      await writerA.query("COMMIT");
      writerAPending = false;
      await pendingCompletion;
      const after = await writerA.query<{ enrichment_revision: string }>(
        `SELECT enrichment_revision::text FROM public.gta_prospect_firms WHERE id=$1 FOR UPDATE`, [firmId],
      );
      expect(BigInt(after.rows[0].enrichment_revision)).toBeGreaterThan(reviewedRevision);
      expect(BigInt(after.rows[0].enrichment_revision)).not.toBe(reviewedRevision);
    } finally {
      if (writerAPending) await writerA.query("ROLLBACK").catch(() => undefined);
      writerA.release();
      writerB.release();
      observer.release();
    }
  }, 30_000);
});
