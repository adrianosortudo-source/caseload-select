"use strict";
// Local regression only: refuses remote DBs and fixtures below one million rows.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith("--") || !process.argv[i + 1])
    throw Error("invalid_arguments");
  options[key.slice(2)] = process.argv[i + 1];
}
for (const name of [
  "connection",
  "fixture-spec",
  "reference-sql",
  "migration",
  "evidence",
])
  if (!options[name]) throw Error("missing_" + name);
const url = new URL(options.connection);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55439" ||
  url.pathname !== "/postgres"
)
  throw Error("owned_loopback_fixture_required");
const { Client } = require(options["pg-module"] ?? "pg");
const reference = fs.readFileSync(options["reference-sql"], "utf8"),
  migration = fs.readFileSync(options.migration, "utf8");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const report = {
  schemaVersion: "projection-insert-repair-regression/v1",
  productionWrites: 0,
  statementBudgetSeconds: 8,
  referenceSha256: sha(reference),
  migrationSha256: sha(migration),
  limits: [
    "Production-sized local candidate fields/search fixture; full stage API validation and production storage differ",
    "All measurements retain FK/unique constraints, live indexes and advisory coverage lock",
  ],
  probes: [],
  assertions: [],
};
const save = () =>
  fs.writeFileSync(options.evidence, JSON.stringify(report, null, 2) + "\n");
const assert = (value, code) => {
  if (!value) throw Error(code);
};
const fieldsExpected = `WITH expected AS (SELECT $1::uuid candidate_id,1::bigint coverage_revision,f.pointer,encode(extensions.digest(convert_to(f.pointer,'UTF8'),'sha256'),'hex') pointer_sha256,f.scalar_type,f.value_json,f.pointer||' '||CASE WHEN f.scalar_type='string' THEN f.value_json#>>'{}' ELSE f.value_json::text END searchable_text,f.source_item_id,f.source_ids,f.source_urls,ARRAY(SELECT md5(url) FROM unnest(f.source_urls)url) source_url_hashes,f.observed_at,f.retrieved_at,CASE WHEN $3::jsonb='[]'::jsonb THEN 'retained' ELSE 'held' END validation_state,prospect_candidate_private.source_date(f.observed_at) observed_day,prospect_candidate_private.source_date(f.retrieved_at) retrieved_day FROM prospect_candidate_private.walk_fields($2::jsonb,'',$4::text,'[]','{}',NULL,NULL)f), actual AS (SELECT candidate_id,coverage_revision,pointer,pointer_sha256,scalar_type,value_json,searchable_text,source_item_id,source_ids,source_urls,source_url_hashes,observed_at,retrieved_at,validation_state,observed_day,retrieved_day FROM prospect_research_candidate_fields WHERE candidate_id=$1) SELECT (SELECT count(*) FROM expected)::int expected_fields,(SELECT count(*) FROM actual)::int actual_fields,(SELECT count(*) FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected))d)::int field_metadata_mismatches`;
const searchExpected = `WITH f AS(SELECT pointer,encode(extensions.digest(convert_to(pointer,'UTF8'),'sha256'),'hex')pointer_sha256,pointer||' '||CASE WHEN scalar_type='string' THEN value_json#>>'{}' ELSE value_json::text END searchable_text FROM prospect_candidate_private.walk_fields($2::jsonb,'','regression-source','[]','{}',NULL,NULL)),h AS(SELECT id FROM prospect_research_candidate_history WHERE candidate_id=$1),expected AS(SELECT h.id revision_id,$1::uuid candidate_id,1::bigint coverage_revision,f.pointer_sha256,n chunk_ordinal,to_tsvector('simple'::regconfig,substring(f.searchable_text FROM greatest(1,n-2048)FOR 36864))search_document FROM f CROSS JOIN h CROSS JOIN LATERAL generate_series(1,greatest(1,char_length(f.searchable_text)),32768)n),actual AS(SELECT revision_id,candidate_id,coverage_revision,pointer_sha256,chunk_ordinal,search_document FROM prospect_research_candidate_search_chunks WHERE candidate_id=$1)SELECT (SELECT count(*)FROM actual)::int search_chunks,(SELECT count(*)FROM((SELECT * FROM expected EXCEPT SELECT * FROM actual)UNION ALL(SELECT * FROM actual EXCEPT SELECT * FROM expected))d)::int search_mismatches`;
async function main() {
  const db = new Client({ connectionString: options.connection });
  await db.connect();
  try {
    const specs = JSON.parse(fs.readFileSync(options["fixture-spec"], "utf8"));
    const fixtures = specs.map((s) => {
      const input = s.payload ?? JSON.parse(fs.readFileSync(s.path, "utf8"));
      const held = s.transform === "held-request" ? input.heldEvidence : null;
      return {
        ...s,
        payload: held
          ? { envelope: held, research: JSON.parse(held.originalJson) }
          : input,
      };
    });
    report.population = (
      await db.query(
        "SELECT (SELECT count(*) FROM prospect_research_candidate_fields)::int fields,(SELECT count(*) FROM prospect_research_candidate_search_chunks)::int search_chunks,(SELECT count(*) FROM prospect_research_candidates WHERE identity_namespace='isolated-copy')::int owned_copies",
      )
    ).rows[0];
    assert(
      report.population.fields >= 1000000 &&
        report.population.search_chunks >= 1000000 &&
        report.population.owned_copies >= 600,
      "owned_production_sized_fixture_required",
    );
    const catalog = async () =>
      (
        await db.query(
          `SELECT jsonb_build_object('indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)ORDER BY i.indexrelid)FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid WHERE t.relname LIKE 'prospect_research_candidate%'),'constraints',(SELECT jsonb_agg(pg_get_constraintdef(c.oid)ORDER BY c.oid)FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname LIKE 'prospect_research_candidate%'),'policies',(SELECT jsonb_agg(to_jsonb(p)ORDER BY policyname)FROM pg_policies p WHERE tablename LIKE 'prospect_research_candidate%'),'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'acl',p.proacl,'securityDefiner',p.prosecdef,'settings',p.proconfig)ORDER BY p.oid)FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prospect_candidate_private' AND p.proname IN('record_history','store_revision_content'))) data`,
        )
      ).rows[0].data;
    const catalogBefore = await catalog();
    report.catalogBeforeSha256 = sha(JSON.stringify(catalogBefore));
    save();
    async function snapshot(candidate) {
      const result={};
      for(const table of ['prospect_research_candidates','prospect_research_candidate_history','prospect_research_candidate_fields','prospect_research_candidate_search_chunks','prospect_research_candidate_content_chunks','prospect_research_candidate_projection_issues']) {
        const where=table==='prospect_research_candidates'?'id=$1':table==='prospect_research_candidate_projection_issues'?'revision_id IN(SELECT id FROM prospect_research_candidate_history WHERE candidate_id=$1)':'candidate_id=$1';
        result[table]=(await db.query('SELECT to_jsonb(t)::text row FROM '+table+' t WHERE '+where+' ORDER BY to_jsonb(t)::text COLLATE "C"',[candidate])).rows.map(x=>x.row);
      }
      return JSON.stringify(result);
    }
    async function probe(fixture, variant, iteration) {
      const candidate = crypto.randomUUID(),
        raw = JSON.stringify(fixture.payload),
        warnings = JSON.stringify(fixture.warnings ?? []),
        sourceKey = fixture.label;
      await db.query("BEGIN");
      let stage = "candidate_setup";
      try {
        await db.query("SET LOCAL statement_timeout='8s'");
        await db.query(
          "INSERT INTO prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)VALUES($1,'isolated-regression',$2,$2,$2,1)",
          [candidate, candidate],
        );
        const prefix =
            fixture.transform === "held-request"
              ? ",pre_hash AS MATERIALIZED(SELECT prospect_candidate_private.hash_json($3::jsonb))"
              : "",
          suffix =
            fixture.transform === "held-request" ? " CROSS JOIN pre_hash" : "";
        const query = `WITH guard AS MATERIALIZED(SELECT pg_advisory_xact_lock(20260924,314))${prefix} SELECT prospect_candidate_private.record_history($1,1,'research_revision','isolated-regression',$2,NULL,NULL,NULL,$3,'fixture',jsonb_build_object('sourceItemId','regression-source'),$4,NULL)FROM guard${suffix}`;
        stage = "projection";
        const started = performance.now();
        await db.query(query, [candidate, sourceKey, raw, warnings]);
        const queryMs = performance.now() - started;
        stage = "fidelity";
        const fieldChecks = (
          await db.query(fieldsExpected, [
            candidate,
            raw,
            warnings,
            "regression-source",
          ])
        ).rows[0];
        const searchChecks = (await db.query(searchExpected, [candidate, raw]))
          .rows[0];
        const contentChecks = (
          await db.query(
            `WITH h AS(SELECT * FROM prospect_research_candidate_history WHERE candidate_id=$1),assembled AS(SELECT revision_id,string_agg(chunk,''ORDER BY chunk_offset)body,min(content_sha256) digest FROM prospect_research_candidate_content_chunks WHERE candidate_id=$1 GROUP BY revision_id) SELECT (SELECT original_json=$2::jsonb FROM h)exact_original,(SELECT count(*)FROM prospect_research_candidate_content_chunks WHERE candidate_id=$1)::int content_chunks,(SELECT body=public.prospect_enrichment_stable_json_v1(prospect_candidate_private.history_item(h.id))FROM h JOIN assembled a ON a.revision_id=h.id)exact_canonical_content,(SELECT digest=encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex')FROM assembled)content_digest_matches,(SELECT count(*)FROM prospect_research_candidate_projection_issues i JOIN h ON h.id=i.revision_id)::int issues`,
            [candidate, raw],
          )
        ).rows[0];
        assert(
          fieldChecks.field_metadata_mismatches === 0 &&
            fieldChecks.expected_fields === fieldChecks.actual_fields,
          "field_metadata_fidelity_failed",
        );
        assert(searchChecks.search_mismatches === 0, "search_fidelity_failed");
        assert(
          contentChecks.exact_original &&
            contentChecks.exact_canonical_content &&
            contentChecks.content_digest_matches &&
            contentChecks.issues === 0,
          "canonical_content_fidelity_failed",
        );
        stage = "idempotency";
        const beforeReplay=await snapshot(candidate);
        await db.query(query, [candidate, sourceKey, raw, warnings]);
        const afterReplay=await snapshot(candidate);
        assert(beforeReplay===afterReplay,"complete_replay_row_values_changed");
        const histories = (
          await db.query(
            "SELECT count(*)::int n FROM prospect_research_candidate_history WHERE candidate_id=$1",
            [candidate],
          )
        ).rows[0].n;
        assert(histories === 1, "idempotency_failed");
        const result = {
          variant,
          label: fixture.label,
          iteration,
          queryMs,
          fieldChecks,
          searchChecks,
          contentChecks,
          idempotent: true,
          replayCompleteRowValuesExact: true,
          replayCompleteRowsSha256: sha(beforeReplay),
          fieldColumnsCompared: 16,
          searchColumnsCompared: 6,
        };
        report.probes.push(result);
        save();
        console.log(JSON.stringify(result));
        return true;
      } catch (error) {
        report.probes.push({
          variant,
          label: fixture.label,
          iteration,
          stage,
          error: error.message,
          code: error.code,
          context: error.where,
        });
        save();
        if (variant !== "reference" || error.code !== "57014") throw error;
        return false;
      } finally {
        await db.query("ROLLBACK");
      }
    }
    report.comparisonOrder = "alternating paired variants per iteration";
    for (let iteration = 1; iteration <= 4; iteration++) {
      const variants =
        iteration % 2 ? ["reference", "repair"] : ["repair", "reference"];
      for (const variant of variants) {
        await db.query(variant === "reference" ? reference : migration);
        const catalogAfter = await catalog();
        assert(
          JSON.stringify(catalogBefore) === JSON.stringify(catalogAfter),
          "catalog_safeguards_changed",
        );
        for (const fixture of fixtures.filter(
          (f) =>
            variant === "repair" ||
            f.transform === "held-request" ||
            f.label === "Complex",
        ))
          await probe(fixture, variant, iteration);
      }
    }
    await db.query(migration);
    report.assertions.push(
      "indexes_constraints_policies_function_acl_security_and_search_path_unchanged",
    );
    save();
    // Preserve the existing raw-review fallback: field/search writes roll back,
    // while exact history and canonical content survive a program-limit error.
    const heldCandidate = crypto.randomUUID();
    await db.query("BEGIN");
    try {
      await db.query(
        "CREATE FUNCTION prospect_candidate_private.regression_limit_search()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE SQLSTATE '54000' USING MESSAGE='regression_program_limit'; END$$; CREATE TRIGGER regression_limit_search BEFORE INSERT ON prospect_research_candidate_search_chunks FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.regression_limit_search()",
      );
      await db.query(
        "INSERT INTO prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)VALUES($1,'isolated-raw-review',$2,$2,$2,1)",
        [heldCandidate, heldCandidate],
      );
      await db.query(
        "SELECT prospect_candidate_private.record_history($1,1,'research_revision','isolated-raw-review',$2,NULL,NULL,NULL,'{\"scalar\":true}','fixture','{}','[]',NULL)",
        [heldCandidate, heldCandidate],
      );
      const checks = (
        await db.query(
          `WITH h AS(SELECT id,original_json FROM prospect_research_candidate_history WHERE candidate_id=$1),a AS(SELECT string_agg(chunk,''ORDER BY chunk_offset)body FROM prospect_research_candidate_content_chunks WHERE candidate_id=$1) SELECT (SELECT count(*)FROM prospect_research_candidate_fields WHERE candidate_id=$1)::int fields,(SELECT count(*)FROM prospect_research_candidate_search_chunks WHERE candidate_id=$1)::int search_chunks,(SELECT code FROM prospect_research_candidate_projection_issues i JOIN h ON h.id=i.revision_id)issue,(SELECT body=public.prospect_enrichment_stable_json_v1(prospect_candidate_private.history_item(h.id))AND h.original_json='{\"scalar\":true}'::jsonb FROM h CROSS JOIN a)exact_raw_and_content`,
          [heldCandidate],
        )
      ).rows[0];
      assert(
        checks.fields === 0 &&
          checks.search_chunks === 0 &&
          checks.issue === "field_projection_requires_raw_review" &&
          checks.exact_raw_and_content,
        "program_limit_atomic_raw_retention_failed",
      );
      report.assertions.push(
        "program_limit_retains_exact_raw_content_without_partial_fields_or_search",
      );
    } finally {
      await db.query("ROLLBACK");
    }
    // A search failure must abort history, fields, search and content together.
    const failedCandidate = crypto.randomUUID();
    await db.query("BEGIN");
    try {
      await db.query(
        "CREATE FUNCTION prospect_candidate_private.regression_fail_search()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'regression_search_failure'; END$$; CREATE TRIGGER regression_fail_search BEFORE INSERT ON prospect_research_candidate_search_chunks FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private.regression_fail_search()",
      );
      await db.query(
        "INSERT INTO prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision)VALUES($1,'isolated-atomicity',$2,$2,$2,1)",
        [failedCandidate, failedCandidate],
      );
      let failed = false;
      try {
        await db.query(
          "SELECT prospect_candidate_private.record_history($1,1,'research_revision','isolated-atomicity',$2,NULL,NULL,NULL,'{\"scalar\":true}','fixture','{}','[]',NULL)",
          [failedCandidate, failedCandidate],
        );
      } catch (error) {
        failed = error.code === "P0001";
      }
      assert(failed, "atomicity_failure_not_injected");
    } finally {
      await db.query("ROLLBACK");
    }
    const remainder = (
      await db.query(
        "SELECT count(*)::int n FROM prospect_research_candidate_history WHERE candidate_id=$1",
        [failedCandidate],
      )
    ).rows[0].n;
    assert(remainder === 0, "atomicity_rollback_failed");
    report.assertions.push(
      "generic_search_failure_rolls_back_complete_projection",
    );
    report.complete = true;
    report.pass = true;
    save();
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  report.pass = false;
  report.error = { message: error.message, code: error.code };
  save();
  console.error(error.message);
  process.exitCode = 1;
});
