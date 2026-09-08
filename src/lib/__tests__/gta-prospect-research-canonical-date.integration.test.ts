/**
 * Runs against the ephemeral local Supabase database in CI only. This is a
 * regression guard for the forward-only ISO-date correction migration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function parseDirectDatabaseUrl(url: string) {
  const parsed = new URL(url.trim().replace(/^['"]|['"]$/g, ""));
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

const validRecord = {
  sourceRecordKey: "iso-date-regression-test",
  firmName: "ISO Date Regression LLP",
  normalizedFirmName: "iso date regression llp",
  city: "Toronto",
  practiceAreas: ["Family law"],
  legacyCrosswalk: null,
  legacyClusterLawyerCount: null,
  websiteUrl: "https://example.test",
  officeCities: ["Toronto"],
  roster: {
    sourceUrl: "https://example.test/team",
    observedOn: "2026-09-07",
    lawyerCount: 2,
    qualifier: "exact",
    display: "2 lawyers",
  },
  reconciliation: {
    status: "provisional_new",
    basis: "Regression fixture for the canonical ISO observation-date check.",
  },
  evidence: [
    { type: "roster", sourceUrl: "https://example.test/team", observedOn: "2026-09-07", value: "2 lawyers" },
    { type: "website", sourceUrl: "https://example.test", observedOn: "2026-09-07", value: "https://example.test" },
  ],
};

describe.skipIf(!DB_URL)("GTA prospect canonical ISO date validation (real Postgres)", () => {
  let conn: import("pg").Client;

  beforeAll(async () => {
    const { Client } = await import("pg");
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();
  });

  afterAll(async () => {
    await conn.end();
  });

  it("accepts a normal YYYY-MM-DD roster observation date", async () => {
    const result = await conn.query(
      "select public.gta_prospect_research_canonical($1::jsonb) as canonical",
      [JSON.stringify(validRecord)],
    );

    expect(result.rows[0]?.canonical).toMatchObject({
      roster: { observedOn: "2026-09-07" },
    });
  });

  it("continues to reject invalid calendar dates", async () => {
    const invalid = structuredClone(validRecord);
    invalid.roster.observedOn = "2026-02-30";
    invalid.evidence = invalid.evidence.map((item) => ({ ...item, observedOn: "2026-02-30" }));

    await expect(
      conn.query(
        "select public.gta_prospect_research_canonical($1::jsonb)",
        [JSON.stringify(invalid)],
      ),
    ).rejects.toThrow("canonical GTA record has invalid roster observation date");
  });
});
