import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REPAIR_PATH, RECORD_HISTORY_SIGNATURE, STORE_CONTENT_SIGNATURE, ORIGINAL_FUNCTION_SHA256, normalizeProjectionIdentityArguments, verifyProjectionRepairCatalog,
} from "../../../scripts/prospect-enrichment/candidate-projection-repair-gate.mjs";

const databaseUrlRaw = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
const databaseUrl = databaseUrlRaw?.trim().replace(/^["']|["']$/g, "") ?? "";
const integrationDescribe = databaseUrl ? describe : describe.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repairSql = readFileSync(path.join(root, REPAIR_PATH), "utf8");
const originalSql = readFileSync(path.join(root, "supabase/migrations/20260924172758_prospect_enrichment_candidate_profiles.sql"), "utf8");
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
// These hashes describe the checked-in baseline SQL fixture used to create scratch-schema functions.
// They are deliberately separate from ORIGINAL_FUNCTION_SHA256, which pins the authorized production catalog.
const CHECKED_IN_BASELINE_FUNCTION_SHA256 = Object.freeze({
  [RECORD_HISTORY_SIGNATURE]: "b33fade20323a279805f7c18ba81f0803217bb4fe4fbb517c51a241f5ae47a56",
  [STORE_CONTENT_SIGNATURE]: "fa2308eb5d0961c29a13e8ffc745785f6e243f7ebe686aaba26ccfe30dc2b520",
});
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
      expect(baselineHashes).not.toEqual([ORIGINAL_FUNCTION_SHA256[RECORD_HISTORY_SIGNATURE], ORIGINAL_FUNCTION_SHA256[STORE_CONTENT_SIGNATURE]]);
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
});
