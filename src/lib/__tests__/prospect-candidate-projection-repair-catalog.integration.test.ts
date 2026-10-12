import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REPAIR_PATH, RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE, normalizeProjectionIdentityArguments, verifyProjectionRepairCatalog,
} from "../../../scripts/prospect-enrichment/candidate-projection-repair-gate.mjs";

const databaseUrlRaw = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
const databaseUrl = databaseUrlRaw?.trim().replace(/^["']|["']$/g, "") ?? "";
const integrationDescribe = databaseUrl ? describe : describe.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repairSql = readFileSync(path.join(root, REPAIR_PATH), "utf8");
const originalSql = readFileSync(path.join(root, "supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql"), "utf8");
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const md5 = (value: string) => createHash("md5").update(value, "utf8").digest("hex");
// These hashes pin the checked-in SQL fixture used to create functions in the disposable test catalog.
const CHECKED_IN_BASELINE_FUNCTION_SHA256 = Object.freeze({
  [RECORD_HISTORY_SIGNATURE]: "533856840e6f59b42f68512d06d8cd59a4202e614ff23373e2871c6983fa31a9",
  [STORE_CONTENT_SIGNATURE]: "7de2e7d7eb914d74406876cc4f43f17c45184cf9fc68f7b36a185417b57ceb44",
});
type ProjectionField = {
  pointer: string;
  pointer_sha256: string;
  value_json: unknown;
  source_urls: string[];
  source_url_hashes: string[];
};
type ProjectionContentChunk = { chunk: string; content_sha256: string };
function sourceBodySha(name: string): string {
  const marker = "CREATE FUNCTION prospect_candidate_private." + name + "(";
  const start = originalSql.indexOf(marker);
  const match = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(originalSql.slice(start));
  if (start < 0 || !match) throw new Error("original_projection_function_body_missing");
  const bodyStart = start + match.index + match[0].length;
  const bodyEnd = originalSql.indexOf(match[1] + ";", bodyStart);
  if (bodyEnd < 0) throw new Error("original_projection_function_terminator_missing");
  return sha256(originalSql.slice(bodyStart, bodyEnd));
}

function functionDefinition(source: string, name: string, schema: string): string {
  const marker = "CREATE FUNCTION prospect_candidate_private." + name + "(";
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error("original_projection_function_missing");
  const asMatch = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(source.slice(start));
  if (!asMatch) throw new Error("original_projection_function_body_missing");
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const close = source.indexOf(asMatch[1] + ";", bodyStart);
  if (close < 0) throw new Error("original_projection_function_terminator_missing");
  return source.slice(start, close + asMatch[1].length + 1).replace("CREATE FUNCTION prospect_candidate_private." + name, "CREATE FUNCTION " + schema + "." + name);
}

integrationDescribe("fresh PostgreSQL catalog output using checked-in baseline fixture, separately from production pins", () => {
  const client = new Client({ connectionString: databaseUrl });
  it("validates actual oidvectortypes rows immediately before and after the reviewed migration", async () => {
    const schema = "projection_catalog_" + randomUUID().replaceAll("-", "");
    await client.connect();
    await client.query("BEGIN");
    try {
      await client.query("CREATE SCHEMA " + schema);
      await client.query(functionDefinition(originalSql, "record_history", schema));
      await client.query(functionDefinition(originalSql, "store_revision_content", schema));
      await client.query("REVOKE ALL ON FUNCTION " + schema + ".record_history(uuid,bigint,text,text,text,uuid,text,uuid,jsonb,text,jsonb,jsonb,uuid) FROM PUBLIC");
      await client.query("REVOKE ALL ON FUNCTION " + schema + ".store_revision_content(uuid) FROM PUBLIC");

      const catalog = async () => {
        const result = await client.query(
          "SELECT 'prospect_candidate_private.'||p.proname||'('||replace(oidvectortypes(p.proargtypes), ', ', ',')||')' AS signature, " +
          "p.proname AS \"functionName\", oidvectortypes(p.proargtypes) AS \"identityArguments\", " +
          "r.rolname AS owner, p.prosecdef AS \"securityDefiner\", p.proconfig AS settings, " +
          "p.proacl::text AS acl, encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') AS \"bodySha256\" " +
          "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner " +
          "WHERE n.nspname=$1 AND p.proname IN ('record_history','store_revision_content') ORDER BY p.proname",
          [schema],
        );
        return result.rows;
      };

      const before = await catalog();
      expect(before).toHaveLength(2);
      expect(before[0].identityArguments).toContain(", ");
      expect(before.map(row => normalizeProjectionIdentityArguments(row.identityArguments))).toEqual(
        [RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE].map(signature => signature.slice(signature.indexOf("(") + 1, -1)),
      );
      const baselineHashes = [sourceBodySha("record_history"), sourceBodySha("store_revision_content")];
      expect(baselineHashes).toEqual([CHECKED_IN_BASELINE_FUNCTION_SHA256[RECORD_HISTORY_SIGNATURE], CHECKED_IN_BASELINE_FUNCTION_SHA256[STORE_CONTENT_SIGNATURE]]);
      expect(before.map(row => row.bodySha256)).toEqual(baselineHashes);
      expect(before.every(row => row.owner === "postgres" && row.securityDefiner === false &&
        Array.isArray(row.settings) && row.settings[0] === 'search_path=""' && row.acl === "{postgres=X/postgres}")).toBe(true);

      await client.query(repairSql.replaceAll("CREATE OR REPLACE FUNCTION prospect_candidate_private.", "CREATE OR REPLACE FUNCTION " + schema + "."));
      const after = await catalog();
      expect(after).toHaveLength(2);
      expect(after[0].identityArguments).toContain(", ");
      expect(verifyProjectionRepairCatalog(after, "post", Buffer.from(repairSql)).verified).toBe(true);
      expect(before.map(row => row.signature)).toEqual([RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE]);
      expect(after.map(row => row.bodySha256)).not.toEqual(before.map(row => row.bodySha256));
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });

  it("preserves baseline projection rows for URL edge cases and large payloads, and rolls back failed search writes", async () => {
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL statement_timeout = '8s'");
      const key = "projection-repair-" + randomUUID();
      const revision = (await db.query<{ revision: string }>(
        "INSERT INTO public.prospect_research_candidate_coverage(revision,source_table,source_key,source_sha256,snapshot) " +
        "VALUES((SELECT COALESCE(MAX(revision),0)+1 FROM public.prospect_research_candidate_coverage),'projection_repair_ci',$1,$2,'{}'::jsonb) RETURNING revision", [key, sha256(key)]
      )).rows[0].revision;
      const duplicateUrl = "https://projection-repair.example/shared";
      const raw = {
        noUrl: { value: "empty-url-array" },
        nullUrl: { url: null, value: "null-url" },
        emptyUrl: { url: "", value: "empty-string-url" },
        duplicateUrls: { url: duplicateUrl, sourceUrl: duplicateUrl, pageUrl: duplicateUrl, value: "duplicate-url" },
        pointer: { "x/y~z": false },
        blob: Array.from({ length: 130_000 }, (_, i) => "projectionpayloadword" + i).join(" "),
      };
      const rawBytes = JSON.stringify(raw);
      const payloadHash = sha256(rawBytes);
      const baselineDefinition = functionDefinition(originalSql, "record_history", "prospect_candidate_private")
        .replace("CREATE FUNCTION prospect_candidate_private.record_history(", "CREATE OR REPLACE FUNCTION prospect_candidate_private.record_history(");
      const makeCandidate = async () => {
        const id = randomUUID();
        await db.query(
          "INSERT INTO public.prospect_research_candidates(id,identity_namespace,identity_key,identity_namespace_sha256,identity_key_sha256,created_revision) " +
          "VALUES($1::uuid,'projection-repair-ci',$1::text,encode(extensions.digest(convert_to('projection-repair-ci','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to($1::text,'UTF8'),'sha256'),'hex'),$2)",
          [id, revision],
        );
        return id;
      };
      const writeAndSnapshot = async (candidate: string) => {
        const started = performance.now();
        await db.query(
          "SELECT prospect_candidate_private.record_history($1::uuid,$2::bigint,'research_revision','projection_repair_ci',$3::text,NULL::uuid,NULL::text,NULL::uuid,$4::jsonb,$5::text,$6::jsonb,'[]'::jsonb,NULL::uuid)",
          [candidate, revision, key, rawBytes, payloadHash, JSON.stringify({ sourceItemId: "projection-fixture" })],
        );
        const writeMs = performance.now() - started;
        const history = (await db.query(
          "SELECT item_kind,source_table,source_key,original_status,selection_disposition,processing_disposition,qualification_state,source_root,relative_path,source_pointer,source_file_sha256,payload_sha256,original_json,original_json_sha256,unmapped_paths,observed_at,retrieved_at,recorded_at,read_warnings,verified_firm_id " +
          "FROM public.prospect_research_candidate_history WHERE candidate_id=$1", [candidate]
        )).rows;
        const fields = (await db.query(
          "SELECT pointer,pointer_sha256,scalar_type,value_json,searchable_text,source_item_id,source_ids,source_urls,source_url_hashes,observed_at,retrieved_at,validation_state,observed_day,retrieved_day " +
          "FROM public.prospect_research_candidate_fields WHERE candidate_id=$1 ORDER BY pointer COLLATE \"C\"", [candidate]
        )).rows;
        const search = (await db.query(
          "SELECT pointer_sha256,chunk_ordinal,search_document::text AS search_document FROM public.prospect_research_candidate_search_chunks WHERE candidate_id=$1 ORDER BY pointer_sha256,chunk_ordinal", [candidate]
        )).rows;
        const content = (await db.query(
          "SELECT chunk_offset,chunk,total_characters,content_sha256 FROM public.prospect_research_candidate_content_chunks WHERE candidate_id=$1 ORDER BY chunk_offset", [candidate]
        )).rows;
        return { writeMs, history, fields, search, content };
      };

      await db.query(baselineDefinition);
      const baselineCandidate = await makeCandidate();
      const baseline = await writeAndSnapshot(baselineCandidate);
      await db.query(repairSql);
      const repairedCandidate = await makeCandidate();
      const repaired = await writeAndSnapshot(repairedCandidate);
      expect(repaired.history).toEqual(baseline.history);
      expect(repaired.fields).toEqual(baseline.fields);
      expect(repaired.search).toEqual(baseline.search);
      expect(repaired.content).toEqual(baseline.content);
      expect(repaired.writeMs).toBeLessThan(8_000);
      expect(baseline.writeMs).toBeLessThan(8_000);
      console.info("projection-repair-large-write", JSON.stringify({ baselineMs: baseline.writeMs, repairedMs: repaired.writeMs, rawBytes: Buffer.byteLength(rawBytes), searchChunks: repaired.search.length }));
      expect(Buffer.byteLength(rawBytes)).toBeGreaterThan(1_048_576);
      expect(repaired.search.length).toBeGreaterThan(1);
      expect(repaired.content.length).toBeGreaterThan(1);
      expect(repaired.history[0].original_json).toEqual(raw);
      const byPointer = new Map((repaired.fields as ProjectionField[]).map((field) => [field.pointer, field] as const));
      const fieldAt = (pointer: string): ProjectionField => {
        const field = byPointer.get(pointer);
        if (!field) throw new Error("projection_repair_expected_field_missing: " + pointer);
        return field;
      };
      expect(fieldAt("/noUrl/value").source_urls).toEqual([]);
      expect(fieldAt("/noUrl/value").source_url_hashes).toEqual([]);
      expect(fieldAt("/nullUrl/value").source_urls).toEqual([]);
      expect(fieldAt("/nullUrl/value").source_url_hashes).toEqual([]);
      expect(fieldAt("/emptyUrl/value").source_urls).toEqual([""]);
      expect(fieldAt("/emptyUrl/value").source_url_hashes).toEqual([md5("")]);
      expect(fieldAt("/duplicateUrls/value").source_urls).toEqual([duplicateUrl]);
      expect(fieldAt("/duplicateUrls/value").source_url_hashes).toEqual([md5(duplicateUrl)]);
      const pointer = "/pointer/x~1y~0z";
      expect(fieldAt(pointer).pointer_sha256).toBe(sha256(pointer));
      expect(fieldAt(pointer).value_json).toBe(false);
      const canonical = (await db.query(
        "SELECT public.prospect_enrichment_stable_json_v1(prospect_candidate_private.history_item(id)) AS body FROM public.prospect_research_candidate_history WHERE candidate_id=$1", [repairedCandidate]
      )).rows[0].body;
      const assembled = (repaired.content as ProjectionContentChunk[]).map((row) => row.chunk).join("");
      expect(assembled).toBe(canonical);
      expect((repaired.content as ProjectionContentChunk[]).every((row) => row.content_sha256 === sha256(assembled))).toBe(true);

      const failingFunction = "repair_ci_fail_" + randomUUID().replaceAll("-", "");
      const failingTrigger = "repair_ci_fail_" + randomUUID().replaceAll("-", "");
      await db.query("CREATE FUNCTION prospect_candidate_private." + failingFunction + "() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'projection_repair_rollback_probe'; END$$");
      await db.query("CREATE TRIGGER " + failingTrigger + " BEFORE INSERT ON public.prospect_research_candidate_search_chunks FOR EACH ROW EXECUTE FUNCTION prospect_candidate_private." + failingFunction + "()");
      const failedCandidate = await makeCandidate();
      await db.query("SAVEPOINT projection_repair_rollback");
      let failure: unknown;
      try { await writeAndSnapshot(failedCandidate); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: "P0001" });
      await db.query("ROLLBACK TO SAVEPOINT projection_repair_rollback");
      const remainder = (await db.query(
        "SELECT (SELECT count(*) FROM public.prospect_research_candidate_history WHERE candidate_id=$1)::int AS history, " +
        "(SELECT count(*) FROM public.prospect_research_candidate_fields WHERE candidate_id=$1)::int AS fields, " +
        "(SELECT count(*) FROM public.prospect_research_candidate_search_chunks WHERE candidate_id=$1)::int AS search, " +
        "(SELECT count(*) FROM public.prospect_research_candidate_content_chunks WHERE candidate_id=$1)::int AS content, " +
        "(SELECT count(*) FROM public.prospect_research_candidate_projection_issues WHERE revision_id IN (SELECT id FROM public.prospect_research_candidate_history WHERE candidate_id=$1))::int AS issues", [failedCandidate]
      )).rows[0];
      expect(remainder).toEqual({ history: 0, fields: 0, search: 0, content: 0, issues: 0 });
    } finally {
      await db.query("ROLLBACK");
      await db.end();
    }
  }, 90_000);

});
