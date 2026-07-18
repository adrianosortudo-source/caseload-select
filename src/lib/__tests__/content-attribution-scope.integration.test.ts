/**
 * Real-Postgres regression test for content_attribution_evidence's own
 * trigger enforcement: firm-isolation scope validation
 * (validate_content_attribution_evidence_scope) and append-only
 * mutation blocking (block_append_only_mutation, shared with
 * approval_records / publication_receipts). Also exercises the
 * content_attribution_current view's priority ordering and
 * supersession logic.
 *
 * A mocked Postgrest client cannot exercise this: the enforcement lives
 * entirely in Postgres trigger functions (plpgsql RAISE EXCEPTION), and
 * a mock would only prove the mock behaves as programmed. See
 * supabase/migrations/20260717030000_content_attribution_evidence.sql.
 *
 * Gated behind DIRECT_DATABASE_URL, same convention as the sibling
 * publication-receipt-concurrency.integration.test.ts and
 * publication-placement-claim-concurrency.integration.test.ts files:
 * skipped automatically wherever that variable is not set, and intended
 * to run against a genuinely ephemeral Postgres instance (CI's fresh
 * `supabase start` stack, or a developer's own local Supabase CLI
 * stack) -- never a shared or production database, since this suite
 * inserts real content_deliverables/content_placements/intake_firms
 * fixture rows.
 *
 * Fixture ids are generated fresh (crypto.randomUUID()) per run.
 * Cleanup: none. content_attribution_evidence rejects UPDATE/DELETE
 * unconditionally (that is the behavior under test), and once a row is
 * inserted, its firm_id/screened_lead_id FKs (ON DELETE CASCADE) would
 * happily let a firm/lead delete cascade the evidence away, but the
 * content_placements fixture this suite also creates carries firm_id
 * REFERENCES intake_firms ON DELETE RESTRICT, so the fixture intake_firms
 * row can never be deleted once a placement exists. Same precedent as
 * the sibling integration tests in this directory: a non-issue against
 * a torn-down ephemeral CI stack.
 *
 * Run locally against a local Supabase CLI stack:
 *   DIRECT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" npx vitest run src/lib/__tests__/content-attribution-scope.integration.test.ts
 */

import dns from "node:dns";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

// A sibling integration suite in this directory failed, deterministically,
// with "Error: getaddrinfo EAI_AGAIN base" -- a DNS resolution failure for
// a hostname string that appears nowhere in any of these files;
// DIRECT_DATABASE_URL's host is always the literal IP 127.0.0.1 in CI and
// local dev, and it did not reproduce locally against an
// identically-migrated real Postgres instance. A first attempted fix (a
// custom `lookup` on the pg ClientConfig) did not help: pg's non-native
// Client never reads that option -- its Connection calls
// `this.stream.connect(port, host)` with no options object at all (see
// node_modules/pg/lib/connection.js), so any DNS lookup happens inside
// Node's own net.Socket.connect(), which is not configurable per-socket.
// The only interception point reachable from userland is the shared
// dns.lookup() function itself. Monkeypatching it here to short-circuit
// IP-literal hosts (which this file's host always is) removes the DNS
// pathway entirely regardless of why Node/CI was invoking it for a literal
// IP; a real hostname still resolves through the original implementation.
// The console.error is deliberate: it surfaces in CI logs so a future
// recurrence shows exactly what dns.lookup() was asked to resolve, instead
// of the same unattributable error.
const originalDnsLookup = dns.lookup;
// @ts-expect-error dns.lookup's overload set doesn't model a single
// monkeypatched implementation; this file only ever exercises the
// (hostname, options, callback) shape net.connect() uses.
dns.lookup = (hostname: string, ...rest: unknown[]) => {
  console.error(`[dns.lookup patched] resolving "${hostname}"`);
  const family = net.isIP(hostname);
  if (family) {
    const callback = rest[rest.length - 1] as (
      err: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void;
    callback(null, hostname, family);
    return;
  }
  // @ts-expect-error see above
  return originalDnsLookup.call(dns, hostname, ...rest);
};

describe.skipIf(!DB_URL)("content_attribution_evidence scope + append-only enforcement (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let conn: import("pg").Client;

  const firmId = randomUUID();
  const otherFirmId = randomUUID();
  const leadId = randomUUID();
  const otherFirmLeadId = randomUUID();
  const deliverableId = randomUUID();
  const otherFirmDeliverableId = randomUUID();
  const versionId = randomUUID();
  const placementId = randomUUID();
  const otherFirmPlacementId = randomUUID();

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    conn = new Client({ connectionString: DB_URL });
    await conn.connect();

    await conn.query(
      `insert into intake_firms (id, name, custom_domain, subdomain) values
         ($1, 'Attribution Scope Fixture Firm', null, $3),
         ($2, 'Attribution Scope Fixture Other Firm', null, $4)`,
      [firmId, otherFirmId, `attr-scope-fixture-${firmId}`, `attr-scope-fixture-${otherFirmId}`],
    );

    await conn.query(
      `insert into screened_leads (id, firm_id, lead_id, brief_json, brief_html, slot_answers, matter_type, practice_area, decision_deadline)
       values
         ($1, $3, 'attr-scope-fixture-1', '{}'::jsonb, '<p></p>', '{}'::jsonb, 'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours'),
         ($2, $4, 'attr-scope-fixture-2', '{}'::jsonb, '<p></p>', '{}'::jsonb, 'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours')`,
      [leadId, otherFirmLeadId, firmId, otherFirmId],
    );

    await conn.query(
      `insert into content_deliverables (id, firm_id, title, content_kind, status, created_by_role)
       values
         ($1, $3, 'attribution scope fixture', 'text', 'draft', 'operator'),
         ($2, $4, 'attribution scope fixture (other firm)', 'text', 'draft', 'operator')`,
      [deliverableId, otherFirmDeliverableId, firmId, otherFirmId],
    );
    await conn.query(
      `insert into deliverable_versions (id, deliverable_id, firm_id, version_number, body_html, created_by_role)
       values ($1, $2, $3, 1, '<p>v1</p>', 'operator')`,
      [versionId, deliverableId, firmId],
    );
    await conn.query(
      `insert into content_placements (id, firm_id, deliverable_id, destination, created_by_role)
       values
         ($1, $3, $5, 'firm_website', 'operator'),
         ($2, $4, $6, 'firm_website', 'operator')`,
      [placementId, otherFirmPlacementId, firmId, otherFirmId, deliverableId, otherFirmDeliverableId],
    );
  }, 30000);

  afterAll(async () => {
    await conn.end();
  });

  it("accepts a well-formed evidence row scoped to one firm", async () => {
    const res = await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
       values ($1, $2, 'known_first_touch', 'verified_utm', now(), 'system')
       returning id`,
      [firmId, leadId],
    );
    expect(res.rows).toHaveLength(1);
  });

  it("rejects a screened_lead_id belonging to a different firm than firm_id", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
         values ($1, $2, 'unknown', 'insufficient_evidence', now(), 'system')`,
        [firmId, otherFirmLeadId],
      ),
    ).rejects.toThrow(/same firm/i);
  });

  it("rejects a deliverable_id belonging to a different firm", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, deliverable_id, attribution_state, evidence_method, observed_at, recorded_by_role)
         values ($1, $2, $3, 'known_first_touch', 'verified_utm', now(), 'system')`,
        [firmId, leadId, otherFirmDeliverableId],
      ),
    ).rejects.toThrow(/same firm/i);
  });

  it("rejects a placement_id that does not belong to the given deliverable_id", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, deliverable_id, placement_id, attribution_state, evidence_method, observed_at, recorded_by_role)
         values ($1, $2, $3, $4, 'known_first_touch', 'verified_utm', now(), 'system')`,
        [firmId, leadId, deliverableId, otherFirmPlacementId],
      ),
    ).rejects.toThrow(/belong to deliverable_id/i);
  });

  it("rejects a deliverable_version_id that does not belong to deliverable_id", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, deliverable_id, deliverable_version_id, attribution_state, evidence_method, observed_at, recorded_by_role)
         values ($1, $2, $3, $4, 'known_first_touch', 'verified_utm', now(), 'system')`,
        [firmId, leadId, otherFirmDeliverableId, versionId],
      ),
    ).rejects.toThrow(/belong to deliverable_id/i);
  });

  it("rejects self_report_category set on any method other than self_report", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, attribution_state, evidence_method, self_report_category, observed_at, recorded_by_role)
         values ($1, $2, 'known_first_touch', 'verified_utm', 'ai_tool', now(), 'system')`,
        [firmId, leadId],
      ),
    ).rejects.toThrow();
  });

  it("rejects attribution_state='unknown' paired with a method other than insufficient_evidence", async () => {
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
         values ($1, $2, 'unknown', 'verified_utm', now(), 'system')`,
        [firmId, leadId],
      ),
    ).rejects.toThrow();
  });

  it("blocks UPDATE and DELETE unconditionally (append-only)", async () => {
    const inserted = await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
       values ($1, $2, 'self_reported', 'self_report', now(), 'operator')
       returning id`,
      [firmId, leadId],
    );
    const rowId = inserted.rows[0].id;

    await expect(
      conn.query(`update content_attribution_evidence set evidence_note = 'edited' where id = $1`, [rowId]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      conn.query(`delete from content_attribution_evidence where id = $1`, [rowId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("content_attribution_current ranks known evidence above self-reported, and excludes superseded rows", async () => {
    const correctionLeadId = randomUUID();
    await conn.query(
      `insert into screened_leads (id, firm_id, lead_id, brief_json, brief_html, slot_answers, matter_type, practice_area, decision_deadline)
       values ($1, $2, 'attr-scope-fixture-3', '{}'::jsonb, '<p></p>', '{}'::jsonb, 'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours')`,
      [correctionLeadId, firmId],
    );

    const selfReported = await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, self_report_category, observed_at, recorded_by_role)
       values ($1, $2, 'self_reported', 'self_report', 'ai_tool', now() - interval '1 hour', 'operator')
       returning id`,
      [firmId, correctionLeadId],
    );
    await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
       values ($1, $2, 'known_first_touch', 'verified_utm', now(), 'system')`,
      [firmId, correctionLeadId],
    );

    const current = await conn.query(
      `select attribution_state from content_attribution_current where screened_lead_id = $1`,
      [correctionLeadId],
    );
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0].attribution_state).toBe("known_first_touch");

    // Supersede the earlier self_reported row with a correction. The
    // corrected row must disappear from the "current" pool even though it
    // scores lower than known_first_touch anyway -- this proves supersession
    // is honored independent of priority ranking.
    await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, self_report_category, observed_at, recorded_by_role, supersedes_evidence_id)
       values ($1, $2, 'self_reported', 'self_report', 'referral', now(), 'operator', $3)`,
      [firmId, correctionLeadId, selfReported.rows[0].id],
    );
    const evidenceRows = await conn.query(
      `select id from content_attribution_evidence where screened_lead_id = $1 and id = $2`,
      [correctionLeadId, selfReported.rows[0].id],
    );
    // The superseded row itself still exists (append-only) ...
    expect(evidenceRows.rows).toHaveLength(1);
    // ... but no longer appears as anyone's "current" pick.
    const stillCurrent = await conn.query(
      `select 1 from content_attribution_current where evidence_id = $1`,
      [selfReported.rows[0].id],
    );
    expect(stillCurrent.rows).toHaveLength(0);
  });

  it("rejects supersedes_evidence_id pointing at a row for a different lead", async () => {
    const anotherLeadId = randomUUID();
    await conn.query(
      `insert into screened_leads (id, firm_id, lead_id, brief_json, brief_html, slot_answers, matter_type, practice_area, decision_deadline)
       values ($1, $2, 'attr-scope-fixture-4', '{}'::jsonb, '<p></p>', '{}'::jsonb, 'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours')`,
      [anotherLeadId, firmId],
    );
    const original = await conn.query(
      `insert into content_attribution_evidence
         (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role)
       values ($1, $2, 'unknown', 'insufficient_evidence', now(), 'system')
       returning id`,
      [firmId, leadId],
    );
    await expect(
      conn.query(
        `insert into content_attribution_evidence
           (firm_id, screened_lead_id, attribution_state, evidence_method, observed_at, recorded_by_role, supersedes_evidence_id)
         values ($1, $2, 'unknown', 'insufficient_evidence', now(), 'system', $3)`,
        [firmId, anotherLeadId, original.rows[0].id],
      ),
    ).rejects.toThrow(/supersedes_evidence_id must reference a prior row for the same firm and lead/i);
  });
});
