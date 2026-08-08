/**
 * Real-Postgres regression test for the caseload_prospects erasure path
 * (DR-114, migration 20260808120000_caseload_prospect_erasure.sql).
 *
 * The thing under test is the contradiction this migration exists to fix:
 * 20260807120000_caseload_prospects.sql shipped ON DELETE CASCADE on
 * caseload_prospect_consent_log.prospect_id together with an unconditional
 * append-only trigger on that same table, so a prospect delete raised
 * P0001 from the cascade and the table had no erasure path at all.
 *
 * A mocked Postgrest client cannot exercise any of this. The FK action, the
 * delete guard, the append-only trigger and the anonymisation function all
 * live in Postgres. A mock would only prove the mock behaves as programmed.
 *
 * Gated behind DIRECT_DATABASE_URL, same convention as the sibling
 * content-attribution-scope.integration.test.ts and the two
 * publication-*-concurrency.integration.test.ts files: skipped automatically
 * wherever that variable is not set, and intended to run against a genuinely
 * ephemeral Postgres instance (CI's fresh `supabase start` stack, or a local
 * Supabase CLI stack), never a shared or production database.
 *
 * Cleanup: none, and it cannot be otherwise. Refusing to delete these rows is
 * the behaviour under test. Fixture rows are left anonymised on a stack that
 * is torn down, same precedent as the sibling integration suites.
 *
 * Run locally against a local Supabase CLI stack:
 *   DIRECT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" npx vitest run src/lib/__tests__/caseload-prospect-erasure.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

// Parse DIRECT_DATABASE_URL ourselves and pass discrete fields rather than
// `connectionString`, sidestepping pg-connection-string's dummy-base-URL
// parsing bug that produced a CI-only "getaddrinfo EAI_AGAIN base" failure.
// The full diagnosis lives in the header of
// content-attribution-scope.integration.test.ts; this is the same fix.
function parseDirectDatabaseUrl(url: string) {
  const trimmed = url.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;
  const parsed = new URL(unquoted);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("caseload_prospects erasure path (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let conn: import("pg").Client;

  // One subject with two submissions (the email selector must cover both),
  // one unrelated subject that must never be touched, and one old row for
  // the retention-cutoff selector.
  const subjectEmail = `erasure-fixture-${randomUUID()}@example.test`;
  const bystanderEmail = `erasure-bystander-${randomUUID()}@example.test`;
  const idA = randomUUID();
  const idB = randomUUID();
  const idBystander = randomUUID();
  const idOld = randomUUID();

  async function insertProspect(
    id: string,
    email: string,
    opts: { submittedAt?: string; name?: string } = {},
  ) {
    await conn.query(
      `insert into caseload_prospects
         (id, practice_area, practice_area_other, firm_size, prompt_reason,
          prompt_reason_other, decision_role, timeline, outcome,
          name, firm_name, email, province, submitted_at)
       values ($1, 'employment', 'also some estates work', 'just_me',
               'too_few_inquiries', 'a colleague named Riva suggested it',
               'i_do', 'this_month', 'booking',
               $2, 'Fixture Law', $3, 'ON', coalesce($4::timestamptz, now()))`,
      [id, opts.name ?? "Fixture Person", email, opts.submittedAt ?? null],
    );
    await conn.query(
      `insert into caseload_prospect_consent_log
         (prospect_id, consent_text_version, consent_label, ip_address, user_agent, captured_at)
       values ($1, 'v1-fixture', 'I agree to be contacted', '203.0.113.7', 'vitest-fixture-agent', now())`,
      [id],
    );
  }

  async function readProspect(id: string) {
    const { rows } = await conn.query(
      `select name, firm_name, email, province, practice_area, practice_area_other,
              firm_size, prompt_reason, prompt_reason_other, decision_role, timeline,
              outcome, anonymized_at, anonymization_reason
         from caseload_prospects where id = $1`,
      [id],
    );
    return rows[0];
  }

  async function anonymize(args: {
    prospectId?: string;
    email?: string;
    before?: string;
    reason?: string;
  }) {
    const { rows } = await conn.query(
      `select public.anonymize_caseload_prospects(
                p_prospect_id => $1::uuid,
                p_email       => $2::text,
                p_before      => $3::timestamptz,
                p_reason      => coalesce($4::text, 'subject_request')
              ) as result`,
      [args.prospectId ?? null, args.email ?? null, args.before ?? null, args.reason ?? null],
    );
    return rows[0].result as {
      ok: boolean;
      error?: string;
      anonymized_count?: number;
      prospect_ids?: string[];
    };
  }

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();

    await insertProspect(idA, subjectEmail, { name: "Erasure Subject" });
    await insertProspect(idB, subjectEmail, { name: "Erasure Subject Again" });
    await insertProspect(idBystander, bystanderEmail, { name: "Bystander" });
    await insertProspect(idOld, `erasure-old-${randomUUID()}@example.test`, {
      submittedAt: "2020-01-01T00:00:00Z",
      name: "Ancient Prospect",
    });
  });

  afterAll(async () => {
    await conn?.end();
  });

  it("declares the FK as ON DELETE RESTRICT, matching what the guard enforces", async () => {
    const { rows } = await conn.query(
      `select confdeltype
         from pg_constraint
        where conrelid = 'public.caseload_prospect_consent_log'::regclass
          and contype = 'f'
          and conname = 'caseload_prospect_consent_log_prospect_id_fkey'`,
    );
    expect(rows).toHaveLength(1);
    // 'r' = RESTRICT. 'c' = CASCADE, the dead-letter value this migration
    // replaced: the cascade could never run, because the child's append-only
    // trigger rejected the DELETE it produced.
    expect(rows[0].confdeltype).toBe("r");
  });

  it("refuses to delete a prospect, and the error names the supported path", async () => {
    await expect(
      conn.query(`delete from caseload_prospects where id = $1`, [idBystander]),
    ).rejects.toThrow(/never deleted \(DR-114\)[\s\S]*anonymize_caseload_prospects/);

    // Still there, still carrying its real details.
    const row = await readProspect(idBystander);
    expect(row.name).toBe("Bystander");
    expect(row.anonymized_at).toBeNull();
  });

  it("still refuses a direct DELETE on the consent log", async () => {
    await expect(
      conn.query(`delete from caseload_prospect_consent_log where prospect_id = $1`, [
        idBystander,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("anonymises by id: PII replaced, closed-option answers kept, free text nulled", async () => {
    const result = await anonymize({ prospectId: idA, reason: "subject_request" });
    expect(result.ok).toBe(true);
    expect(result.anonymized_count).toBe(1);
    expect(result.prospect_ids).toEqual([idA]);

    const row = await readProspect(idA);

    // Identifying columns replaced.
    expect(row.name).toBe("[anonymized]");
    expect(row.firm_name).toBe("[anonymized]");
    expect(row.email).toBe("[anonymized]");
    expect(row.province).toBe("[anonymized]");

    // Free text the visitor typed, which can name people, is dropped.
    expect(row.practice_area_other).toBeNull();
    expect(row.prompt_reason_other).toBeNull();

    // Closed-option answers survive so the funnel counts stay correct.
    expect(row.practice_area).toBe("employment");
    expect(row.firm_size).toBe("just_me");
    expect(row.prompt_reason).toBe("too_few_inquiries");
    expect(row.decision_role).toBe("i_do");
    expect(row.timeline).toBe("this_month");
    expect(row.outcome).toBe("booking");

    expect(row.anonymized_at).not.toBeNull();
    expect(row.anonymization_reason).toBe("subject_request");
  });

  it("leaves the consent evidence completely intact, ip and user agent included", async () => {
    const { rows } = await conn.query(
      `select consent_text_version, consent_label, ip_address, user_agent, captured_at
         from caseload_prospect_consent_log where prospect_id = $1`,
      [idA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].consent_text_version).toBe("v1-fixture");
    expect(rows[0].consent_label).toBe("I agree to be contacted");
    // Retained on purpose (DR-114): this is the record that consent was
    // given, and it now points at a subject the data can no longer identify.
    expect(rows[0].ip_address).toBe("203.0.113.7");
    expect(rows[0].user_agent).toBe("vitest-fixture-agent");
    expect(rows[0].captured_at).not.toBeNull();
  });

  it("is idempotent: a repeat call touches nothing and does not restamp", async () => {
    const before = await readProspect(idA);
    const result = await anonymize({ prospectId: idA });
    expect(result.ok).toBe(true);
    expect(result.anonymized_count).toBe(0);
    expect(result.prospect_ids).toEqual([]);

    const after = await readProspect(idA);
    expect(after.anonymized_at).toEqual(before.anonymized_at);
  });

  it("anonymises every row for a subject by email, and nothing else", async () => {
    const result = await anonymize({ email: subjectEmail.toUpperCase() });
    expect(result.ok).toBe(true);
    // idA was already done above, so only idB remains for this subject.
    expect(result.anonymized_count).toBe(1);
    expect(result.prospect_ids).toEqual([idB]);

    expect((await readProspect(idB)).email).toBe("[anonymized]");
    // The unrelated subject is untouched.
    expect((await readProspect(idBystander)).email).toBe(bystanderEmail);
  });

  it("anonymises by retention cutoff", async () => {
    const result = await anonymize({
      before: "2021-01-01T00:00:00Z",
      reason: "retention_sweep",
    });
    expect(result.ok).toBe(true);
    expect(result.prospect_ids).toContain(idOld);

    const row = await readProspect(idOld);
    expect(row.name).toBe("[anonymized]");
    expect(row.anonymization_reason).toBe("retention_sweep");

    // A row submitted after the cutoff is not swept.
    expect((await readProspect(idBystander)).anonymized_at).toBeNull();
  });

  it("refuses a call with no selector or with more than one", async () => {
    const none = await anonymize({});
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/exactly one/);

    const two = await anonymize({ prospectId: idBystander, email: bystanderEmail });
    expect(two.ok).toBe(false);
    expect(two.error).toMatch(/exactly one/);

    // Neither refusal touched the row.
    expect((await readProspect(idBystander)).anonymized_at).toBeNull();
  });

  it("refuses an unrecognised reason", async () => {
    const result = await anonymize({ prospectId: idBystander, reason: "because" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid reason/);
    expect((await readProspect(idBystander)).anonymized_at).toBeNull();
  });

  it("rejects an anonymization_reason that is not one of the three", async () => {
    await expect(
      conn.query(
        `update caseload_prospects set anonymized_at = now(), anonymization_reason = 'whatever' where id = $1`,
        [idBystander],
      ),
    ).rejects.toThrow(/caseload_prospects_anonymization_reason_check/);
  });
});
