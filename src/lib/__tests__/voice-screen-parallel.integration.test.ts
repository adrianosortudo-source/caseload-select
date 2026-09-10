/** Real-Postgres coverage. Runs only against CI's ephemeral local Supabase. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function parseDbUrl(raw: string) {
  const trimmed = raw.trim();
  const value = trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1) : trimmed;
  const parsed = new URL(value);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("parallel voice-to-Screen store (real Postgres)", () => {
  let owner: import("pg").Client;
  let workerA: import("pg").Client;
  let workerB: import("pg").Client;
  const firmId = randomUUID();

  beforeAll(async () => {
    const { Client } = await import("pg");
    const options = parseDbUrl(DB_URL!);
    owner = new Client(options); workerA = new Client(options); workerB = new Client(options);
    await Promise.all([owner.connect(), workerA.connect(), workerB.connect()]);
    await owner.query(
      "insert into intake_firms (id,name,custom_domain,subdomain) values ($1,'Voice Screen Fixture',null,$2)",
      [firmId, `voice-screen-${firmId}`],
    );
  }, 30_000);

  afterAll(async () => { await Promise.all([owner?.end(), workerA?.end(), workerB?.end()]); });

  async function service(conn: import("pg").Client, sql: string, values: unknown[] = []) {
    await conn.query("begin");
    try {
      await conn.query("set local role service_role");
      const result = await conn.query(sql, values);
      await conn.query("commit");
      return result;
    } catch (error) { await conn.query("rollback"); throw error; }
  }

  function inquiry(callId: string, hashChar = "a") {
    const ended = new Date();
    return {
      id: randomUUID(), firm_id: firmId, location_id: "location-test",
      agent_id: "parallel-agent-test", call_id: callId, contact_id: `contact-${callId}`,
      caller_facts: {
        callId, locationId: "location-test", agentId: "parallel-agent-test", endedAt: ended.toISOString(),
        endedAtSource: "provider_created_plus_duration", permissionCapturedAtSource: "call_end_bound",
        evidence: { callId, consentQuote: "Yes, text the inquiry link", safeToTextQuote: "Yes, safe to text", callbackQuote: "+1 416 555 0142" },
        callerType: "new", urgency: "routine", humanRequested: false,
        callback: { number: "+14165550142", verifiedOnCallId: callId },
        permission: { value: "granted", callId, capturedAt: new Date(ended.getTime() - 60_000).toISOString() },
        safeToText: { value: "yes", callId },
      },
      engine_state: { slots: {} }, answers: [], token_hash: hashChar.repeat(64),
      token_nonce: "A".repeat(43), ended_at: ended.toISOString(),
      expires_at: new Date(ended.getTime() + 86_400_000).toISOString(), invitation_eligible: true,
    };
  }

  it("deduplicates concurrent delivery of one immutable call event", async () => {
    const payload = inquiry(`call-${randomUUID()}`);
    const [a, b] = await Promise.all([
      service(workerA, "select public.v2s_ingest($1::jsonb) result", [payload]),
      service(workerB, "select public.v2s_ingest($1::jsonb) result", [payload]),
    ]);
    expect([a.rows[0].result.created, b.rows[0].result.created].sort()).toEqual([false, true]);
    expect(a.rows[0].result.id).toBe(b.rows[0].result.id);
    const counts = await owner.query(
      `select (select count(*)::int from voice_screen_inquiries where call_id=$1) inquiries,
       (select count(*)::int from voice_screen_outbox o join voice_screen_inquiries i on i.id=o.inquiry_id where i.call_id=$1) outbox`,
      [payload.call_id],
    );
    expect(counts.rows[0]).toEqual({ inquiries: 1, outbox: 1 });
  }, 30_000);

  it("recomputes current-call eligibility instead of trusting the caller", async () => {
    const payload = inquiry(`call-${randomUUID()}`, "b");
    payload.caller_facts.permission.callId = "stale-call";
    const ingested = await service(workerA, "select public.v2s_ingest($1::jsonb) result", [payload]);
    expect(ingested.rows[0].result.invitation_eligible).toBe(false);
    const count = await owner.query("select count(*)::int n from voice_screen_outbox where inquiry_id=$1", [ingested.rows[0].result.id]);
    expect(count.rows[0].n).toBe(0);
  });

  it("allows one claim and never reopens an ambiguous dispatch", async () => {
    const payload = inquiry(`call-${randomUUID()}`, "c");
    const ingested = await service(workerA, "select public.v2s_ingest($1::jsonb) result", [payload]);
    const row = await owner.query("select id from voice_screen_outbox where inquiry_id=$1", [ingested.rows[0].result.id]);
    const id = row.rows[0].id;
    const [a, b] = await Promise.all([
      service(workerA, "select public.v2s_claim($1) result", [ingested.rows[0].result.id]),
      service(workerB, "select public.v2s_claim($1) result", [ingested.rows[0].result.id]),
    ]);
    expect([a.rows[0].result.claimed, b.rows[0].result.claimed].sort()).toEqual([false, true]);
    const claimed = a.rows[0].result.claimed ? a.rows[0].result : b.rows[0].result;
    expect(claimed).toMatchObject({ token_nonce: payload.token_nonce, token_hash: payload.token_hash });
    expect((await service(workerA, "select public.v2s_finish_dispatch($1,'unknown',null,'ambiguous') result", [id])).rows[0].result).toBe(true);
    expect((await service(workerA, "select public.v2s_claim($1) result", [ingested.rows[0].result.id])).rows[0].result.claimed).toBe(false);
  }, 30_000);

  it("uses optimistic revisions and revokes continuation on takeover", async () => {
    const payload = inquiry(`call-${randomUUID()}`, "d");
    const ingested = await service(workerA, "select public.v2s_ingest($1::jsonb) result", [payload]);
    const id = ingested.rows[0].result.id;
    expect((await service(workerA, "select public.v2s_save($1,$2,0,'{\"step\":1}'::jsonb,'[]'::jsonb,'partial') result", [id, payload.token_hash])).rows[0].result).toBe(true);
    expect((await service(workerB, "select public.v2s_save($1,$2,0,'{\"step\":2}'::jsonb,'[]'::jsonb,'partial') result", [id, payload.token_hash])).rows[0].result).toBe(false);
    expect((await service(workerA, "select public.v2s_takeover($1) result", [id])).rows[0].result).toBe(true);
    expect((await service(workerA, "select public.v2s_save($1,$2,2,'{}'::jsonb,'[]'::jsonb,'completed') result", [id, payload.token_hash])).rows[0].result).toBe(false);
    const state = await owner.query("select status,human_status,invitation_eligible from voice_screen_inquiries where id=$1", [id]);
    expect(state.rows[0]).toEqual({ status: "stopped", human_status: "taken_over", invitation_eligible: false });
  });

  it("denies browser roles all table and RPC access", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const fn of ["v2s_purge_expired(timestamptz,integer)", "v2s_erase_subject(uuid,text,text)", "v2s_reconcile_stale_dispatch(uuid,text,text)"]) {
        const access = await owner.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${fn}`]);
        expect(access.rows[0].allowed).toBe(false);
      }
    }
    for (const role of ["anon", "authenticated"]) {
      const p = await owner.query(
        `select has_table_privilege($1,'public.voice_screen_inquiries','SELECT') read_inquiries,
          has_table_privilege($1,'public.voice_screen_outbox','SELECT') read_outbox,
          has_function_privilege($1,'public.v2s_ingest(jsonb)','EXECUTE') ingest`, [role],
      );
      expect(p.rows[0]).toEqual({ read_inquiries: false, read_outbox: false, ingest: false });
    }
  });
  it("purges expired inquiry facts and cascades its outbox in a bounded batch", async () => {
    const payload = inquiry(`retention-${randomUUID()}`, "e");
    await service(workerA, "select public.v2s_ingest($1::jsonb)", [payload]);
    await owner.query("update voice_screen_inquiries set ended_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1", [payload.id]);
    expect((await service(workerA, "select public.v2s_purge_expired(now(),1) n")).rows[0].n).toBe(1);
    expect((await owner.query("select count(*)::int n from voice_screen_outbox where inquiry_id=$1", [payload.id])).rows[0].n).toBe(0);
    expect((await owner.query("select count(*)::int n from voice_screen_inquiries where id=$1", [payload.id])).rows[0].n).toBe(0);
  });
  it("erases a verified subject only inside the supplied firm and location", async () => {
    const payload = inquiry(`erasure-${randomUUID()}`, "f");
    await service(workerA, "select public.v2s_ingest($1::jsonb)", [payload]);
    expect((await service(workerA, "select public.v2s_erase_subject($1,$2,$3) n", [firmId, "wrong", payload.contact_id])).rows[0].n).toBe(0);
    expect((await service(workerA, "select public.v2s_erase_subject($1,$2,$3) n", [firmId, payload.location_id, payload.contact_id])).rows[0].n).toBe(1);
  });
  it("marks a crashed dispatch unknown without permitting another claim", async () => {
    const payload = inquiry(`crashed-${randomUUID()}`, "0");
    await service(workerA, "select public.v2s_ingest($1::jsonb)", [payload]);
    await service(workerA, "select public.v2s_claim($1)", [payload.id]);
    await owner.query("update voice_screen_outbox set claimed_at=now()-interval '6 minutes' where inquiry_id=$1", [payload.id]);
    expect((await service(workerA, "select public.v2s_reconcile_stale_dispatch($1,$2,$3) n", [firmId, payload.location_id, payload.agent_id])).rows[0].n).toBe(1);
    expect((await service(workerA, "select public.v2s_claim($1) result", [payload.id])).rows[0].result.claimed).toBe(false);
  });
});
