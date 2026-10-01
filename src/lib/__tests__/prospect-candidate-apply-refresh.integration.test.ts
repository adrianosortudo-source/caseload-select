import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrlRaw = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
const databaseUrl = databaseUrlRaw?.trim().replace(/^["']|["']$/g, "") ?? "";
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["127.0.0.1", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, "")) ||
      !parsed.port || parsed.pathname !== "/postgres") {
    throw new Error("prospect apply-refresh integration test requires direct disposable loopback Postgres");
  }
}

const integrationDescribe = databaseUrl ? describe : describe.skip;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

integrationDescribe("prospect enrichment first-authority legacy refresh gate", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  afterAll(async () => { await pool.end(); });

  it("refreshes only on first authority and excludes current-package audit and identity evidence", async () => {
    const db = await pool.connect();
    const suffix = randomUUID().replaceAll("-", "");
    const sourceKey = `pe-gate-${suffix}`;
    const digest = sha256(suffix);
    const firmIds: string[] = [];
    const packageIds: string[] = [];
    let inTransaction = false;

    const addFirm = async (index: number) => {
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status)
         VALUES ($1,$2,$2,'provisional_new') RETURNING id`,
        [`${sourceKey}-${index}`, `Refresh Gate Test ${suffix} ${index}`],
      );
      firmIds.push(inserted.rows[0].id);
      return inserted.rows[0].id;
    };

    const addPackage = async (firmId: string | null, index: number) => {
      const id = randomUUID();
      const payloadHash = sha256(`${suffix}-package-${index}`);
      if (!packageIds.length) {
        await db.query(
          `INSERT INTO public.prospect_enrichment_runs(submitted_by,run_key,source_system,source_name)
           VALUES ($1,$2,'integration-test','apply-refresh-gate')`,
          [`refresh-gate-${suffix}`, `run-${suffix}`],
        );
      }
      const run = await db.query<{ id: string }>(
        `SELECT id FROM public.prospect_enrichment_runs WHERE submitted_by=$1 AND run_key=$2`,
        [`refresh-gate-${suffix}`, `run-${suffix}`],
      );
      await db.query(
        `INSERT INTO public.prospect_enrichment_packages(
           id,run_id,client_package_id,submitted_by,idempotency_key,raw_body,raw_body_sha256,payload,
           payload_sha256,schema_version,research_key,firm_id,identity_state,state
         ) VALUES ($1,$2,$3,$4,$5,'{}',$6,'{}'::jsonb,$6,'prospect-enrichment/v1',$7,$8,'resolved','ready_for_review')`,
        [id, run.rows[0].id, `package-${suffix}-${index}`, `refresh-gate-${suffix}`,
          `pe-v1-${payloadHash}`, payloadHash, `${sourceKey}-${index}`, firmId],
      );
      packageIds.push(id);
      return { id, payloadHash };
    };

    const addIdentity = async (packageId: string, firmId: string) => {
      const candidate = await db.query<{ candidate_id: string }>(
        `SELECT candidate_id FROM public.prospect_research_candidate_history
         WHERE package_id=$1 AND source_table='prospect_enrichment_packages'
         ORDER BY coverage_revision DESC LIMIT 1`, [packageId],
      );
      expect(candidate.rows[0]?.candidate_id).toBeTruthy();
      const revision = await db.query<{ revision: string }>(
        `SELECT nextval('prospect_candidate_private.coverage_seq')::bigint AS revision`,
      );
      const revisionId = revision.rows[0].revision;
      const proofHash = sha256(`${suffix}-identity-${packageId}`);
      await db.query(
        `INSERT INTO public.prospect_research_candidate_coverage(revision,source_table,source_key,source_sha256,snapshot)
         VALUES ($1,'prospect_refresh_gate_test',$2,$3,'{}'::jsonb)`,
        [revisionId, packageId, proofHash],
      );
      await db.query(
        `INSERT INTO public.prospect_research_candidate_history(
           candidate_id,coverage_revision,item_kind,source_table,source_key,package_id,payload_sha256,
           original_json,original_json_sha256,recorded_at,verified_firm_id
         ) VALUES ($1,$2,'identity_link','verified_identity',$3,$4,$5,'{}'::jsonb,$5,clock_timestamp(),$6)`,
        [candidate.rows[0].candidate_id, revisionId, `refresh-gate-${packageId}`, packageId, proofHash, firmId],
      );
    };

    const addAppliedCoreAudit = async (firmId: string, batchName: string, batchHash: string) => {
      const batch = await db.query<{ id: string }>(
        `INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count,state,applied_at)
         VALUES ($1,$2,1,'applied',clock_timestamp()) RETURNING id`, [batchName, batchHash],
      );
      await db.query(
        `INSERT INTO public.gta_prospect_import_audit(
           import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,
           firm_id,validation_errors,canonical_record
         ) VALUES ($1,$2,$3,'accepted','created',$4,'[]'::jsonb,'{}'::jsonb)`,
        [batch.rows[0].id, `${sourceKey}-audit-${batch.rows[0].id}`, digest, firmId],
      );
    };

    const addFixture = async (id: string, state: string, firmId: string | null, payloadHash: string) => {
      await db.query(
        `INSERT INTO prospect_refresh_gate_fixture(id,state,firm_id,payload_sha256) VALUES ($1,$2,$3,$4)`,
        [id, state, firmId, payloadHash],
      );
    };
    const apply = async (id: string, firmId: string | null) => {
      await db.query(`UPDATE prospect_refresh_gate_fixture SET state='applied',firm_id=$2 WHERE id=$1`, [id, firmId]);
    };
    const callCount = async () => (await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.prospect_enrichment_refresh_gate_test_calls`,
    )).rows[0].count;

    try {
      await db.query("BEGIN");
      inTransaction = true;
      await db.query("CREATE TABLE public.prospect_enrichment_refresh_gate_test_calls(firm_id uuid NOT NULL)");
      await db.query(`
        CREATE OR REPLACE FUNCTION prospect_candidate_private.refresh_legacy_firm(p_firm uuid)
        RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
        BEGIN INSERT INTO public.prospect_enrichment_refresh_gate_test_calls(firm_id) VALUES (p_firm); END;
        $$;
        CREATE TEMP TABLE prospect_refresh_gate_fixture(id uuid PRIMARY KEY,state text NOT NULL,firm_id uuid,payload_sha256 text NOT NULL);
        CREATE TRIGGER prospect_refresh_gate_fixture_trigger AFTER INSERT OR UPDATE ON prospect_refresh_gate_fixture
          FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.enrichment_firm_refresh_trigger();
      `);
      // Fixture imports must not invoke the real legacy projection trigger;
      // this test records only calls made by the package refresh gate.
      await db.query(`
        ALTER TABLE public.gta_prospect_import_batches DISABLE TRIGGER candidate_legacy_projection;
        ALTER TABLE public.gta_prospect_import_audit DISABLE TRIGGER candidate_legacy_projection;
      `);

      // An applied INSERT is not the writer transition and must not refresh.
      const insertFirm = await addFirm(0);
      const insertedPackage = await addPackage(insertFirm, 0);
      await addFixture(insertedPackage.id, "applied", insertFirm, insertedPackage.payloadHash);
      expect(await callCount()).toBe("0");

      // Non-applied updates and applied updates without a firm are inert.
      const pendingFirm = await addFirm(1);
      const pendingPackage = await addPackage(pendingFirm, 1);
      await addFixture(pendingPackage.id, "ready_for_review", pendingFirm, pendingPackage.payloadHash);
      await db.query(`UPDATE prospect_refresh_gate_fixture SET state='ready_for_review' WHERE id=$1`, [pendingPackage.id]);
      const noFirmPackage = await addPackage(null, 2);
      await addFixture(noFirmPackage.id, "ready_for_review", null, noFirmPackage.payloadHash);
      await apply(noFirmPackage.id, null);
      expect(await callCount()).toBe("0");

      // No independent authority means first-authority catch-up still runs.
      const firstFirm = await addFirm(3);
      const firstPackage = await addPackage(firstFirm, 3);
      await addFixture(firstPackage.id, "ready_for_review", firstFirm, firstPackage.payloadHash);
      await apply(firstPackage.id, firstFirm);
      expect(await callCount()).toBe("1");
      await db.query(`UPDATE prospect_refresh_gate_fixture SET firm_id=$2 WHERE id=$1`, [firstPackage.id, firstFirm]);
      expect(await callCount()).toBe("1"); // repeated UPDATE of an already-applied row

      // A new-firm apply's own core audit is not prior authority.
      const newFirm = await addFirm(4);
      const newPackage = await addPackage(newFirm, 4);
      await addAppliedCoreAudit(newFirm, `pe-${newPackage.id.replaceAll("-", "")}`, newPackage.payloadHash);
      await addFixture(newPackage.id, "ready_for_review", newFirm, newPackage.payloadHash);
      expect(await callCount()).toBe("1");
      await apply(newPackage.id, newFirm);
      expect(await callCount()).toBe("2");

      // The projection written by this package is not independent prior identity.
      const ownIdentityFirm = await addFirm(5);
      const ownIdentityPackage = await addPackage(ownIdentityFirm, 5);
      await addIdentity(ownIdentityPackage.id, ownIdentityFirm);
      await addFixture(ownIdentityPackage.id, "ready_for_review", ownIdentityFirm, ownIdentityPackage.payloadHash);
      await apply(ownIdentityPackage.id, ownIdentityFirm);
      expect(await callCount()).toBe("3");

      // An unrelated prior verified identity is independent authority and skips refresh.
      const linkedFirm = await addFirm(6);
      const priorPackage = await addPackage(linkedFirm, 6);
      const currentPackage = await addPackage(linkedFirm, 7);
      await addIdentity(priorPackage.id, linkedFirm);
      await addFixture(currentPackage.id, "ready_for_review", linkedFirm, currentPackage.payloadHash);
      await apply(currentPackage.id, linkedFirm);
      expect(await callCount()).toBe("3");

      // A separate accepted, applied core import is also independent authority.
      const coreFirm = await addFirm(8);
      const corePackage = await addPackage(coreFirm, 8);
      await addAppliedCoreAudit(coreFirm, `core-${suffix}`, digest);
      await addFixture(corePackage.id, "ready_for_review", coreFirm, corePackage.payloadHash);
      await apply(corePackage.id, coreFirm);
      expect(await callCount()).toBe("3");
    } finally {
      if (inTransaction) await db.query("ROLLBACK");
      db.release();
    }
  });
});
