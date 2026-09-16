/**
 * Real-Postgres security coverage for the preview-only QA registry.
 *
 * The registry is purposely tested against CI's ephemeral Supabase instance:
 * row locks, role grants, security-definer execution and revocation cannot be
 * meaningfully proven through mocked RPC clients.  The suite skips outside a
 * configured direct database connection and leaves only disposable fixture
 * rows in that ephemeral database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function parseDbUrl(raw: string) {
  const trimmed = raw.trim();
  const value = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1)
    : trimmed;
  const parsed = new URL(value);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

describe.skipIf(!DB_URL)("preview QA registry (real Postgres)", () => {
  let owner: import("pg").Client;
  let workerA: import("pg").Client;
  let workerB: import("pg").Client;

  beforeAll(async () => {
    const { Client } = await import("pg");
    const options = parseDbUrl(DB_URL!);
    owner = new Client(options);
    workerA = new Client(options);
    workerB = new Client(options);
    await Promise.all([owner.connect(), workerA.connect(), workerB.connect()]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([owner?.end(), workerA?.end(), workerB?.end()]);
  });

  async function service(client: import("pg").Client, sql: string, values: unknown[] = []) {
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      const result = await client.query(sql, values);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function grant(id: string, nonceHash: string, expiresAtSql = "now() + interval '10 minutes'") {
    await owner.query(
      `insert into public.preview_qa_bootstrap_grants (id, nonce_hash, expires_at)
       values ($1, $2, ${expiresAtSql})`,
      [id, nonceHash],
    );
  }

  async function issue(
    client: import("pg").Client,
    audience: string,
    sessionId: string,
    tokenHash: string,
    grantId: string,
    nonceHash: string,
    previous?: { id: string; tokenHash: string },
  ) {
    const result = await service(
      client,
      `select public.consume_preview_qa_bootstrap_and_issue_session(
         $1, $2, $3, now() + interval '15 minutes', $4, $5, $6, $7
       ) as issued`,
      [
        sessionId,
        audience,
        tokenHash,
        previous?.id ?? null,
        previous?.tokenHash ?? null,
        grantId,
        nonceHash,
      ],
    );
    return result.rows[0].issued as boolean;
  }

  async function active(client: import("pg").Client, audience: string, sessionId: string, tokenHash: string) {
    const result = await service(
      client,
      "select public.verify_preview_qa_session($1, $2, $3) as active",
      [sessionId, audience, tokenHash],
    );
    return result.rows[0].active as boolean;
  }

  it("denies browser roles direct registry and RPC access while preserving only service-role RPC execution", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await owner.query(
        `select
          has_table_privilege($1, 'public.preview_qa_sessions', 'SELECT') as sessions_read,
          has_table_privilege($1, 'public.preview_qa_bootstrap_grants', 'SELECT') as grants_read,
          has_function_privilege($1, 'public.consume_preview_qa_bootstrap_and_issue_session(uuid,text,text,timestamptz,uuid,text,uuid,text)', 'EXECUTE') as consume,
          has_function_privilege($1, 'public.verify_preview_qa_session(uuid,text,text)', 'EXECUTE') as verify`,
        [role],
      );
      expect(result.rows[0]).toEqual({
        sessions_read: false,
        grants_read: false,
        consume: false,
        verify: false,
      });
    }

    const servicePrivileges = await owner.query(
      `select
        has_table_privilege('service_role', 'public.preview_qa_sessions', 'SELECT') as sessions_read,
        has_table_privilege('service_role', 'public.preview_qa_sessions', 'INSERT') as sessions_insert,
        has_table_privilege('service_role', 'public.preview_qa_sessions', 'UPDATE') as sessions_update,
        has_table_privilege('service_role', 'public.preview_qa_sessions', 'DELETE') as sessions_delete,
        has_table_privilege('service_role', 'public.preview_qa_bootstrap_grants', 'SELECT') as grants_read,
        has_table_privilege('service_role', 'public.preview_qa_bootstrap_grants', 'INSERT') as grants_insert,
        has_table_privilege('service_role', 'public.preview_qa_bootstrap_grants', 'UPDATE') as grants_update,
        has_table_privilege('service_role', 'public.preview_qa_bootstrap_grants', 'DELETE') as grants_delete,
        has_function_privilege('service_role', 'public.consume_preview_qa_bootstrap_and_issue_session(uuid,text,text,timestamptz,uuid,text,uuid,text)', 'EXECUTE') as consume,
        has_function_privilege('service_role', 'public.verify_preview_qa_session(uuid,text,text)', 'EXECUTE') as verify`,
    );
    expect(servicePrivileges.rows[0]).toEqual({
      sessions_read: false,
      sessions_insert: false,
      sessions_update: false,
      sessions_delete: false,
      grants_read: false,
      grants_insert: false,
      grants_update: false,
      grants_delete: false,
      consume: true,
      verify: true,
    });
  });

  it("atomically consumes a bootstrap grant exactly once under concurrent issue attempts", async () => {
    const audience = `preview-${randomUUID()}.vercel.app`;
    const grantId = randomUUID();
    const nonceHash = `nonce-${randomUUID()}`;
    await grant(grantId, nonceHash);
    const sessionA = randomUUID();
    const sessionB = randomUUID();

    const [first, second] = await Promise.all([
      issue(workerA, audience, sessionA, `token-a-${randomUUID()}`, grantId, nonceHash),
      issue(workerB, audience, sessionB, `token-b-${randomUUID()}`, grantId, nonceHash),
    ]);
    expect([first, second].sort()).toEqual([false, true]);

    const state = await owner.query(
      `select
        (select count(*)::int from public.preview_qa_sessions where audience = $1 and id = any($2::uuid[])) as sessions,
        (select consumed_at is not null from public.preview_qa_bootstrap_grants where id = $3) as consumed`,
      [audience, [sessionA, sessionB], grantId],
    );
    expect(state.rows[0]).toEqual({ sessions: 1, consumed: true });
  }, 30_000);

  it("rejects replayed, expired, and wrong-nonce grants without issuing a session", async () => {
    const audience = `preview-${randomUUID()}.vercel.app`;
    const replayGrant = randomUUID();
    const replayNonce = `nonce-${randomUUID()}`;
    const firstSession = randomUUID();
    const firstToken = `token-${randomUUID()}`;
    await grant(replayGrant, replayNonce);
    expect(await issue(workerA, audience, firstSession, firstToken, replayGrant, replayNonce)).toBe(true);
    expect(await issue(workerA, audience, randomUUID(), `token-${randomUUID()}`, replayGrant, replayNonce)).toBe(false);

    const wrongNonceGrant = randomUUID();
    await grant(wrongNonceGrant, `expected-${randomUUID()}`);
    expect(await issue(workerA, audience, randomUUID(), `token-${randomUUID()}`, wrongNonceGrant, `wrong-${randomUUID()}`)).toBe(false);

    const expiredGrant = randomUUID();
    const expiredNonce = `nonce-${randomUUID()}`;
    await grant(expiredGrant, expiredNonce, "now() - interval '1 second'");
    expect(await issue(workerA, audience, randomUUID(), `token-${randomUUID()}`, expiredGrant, expiredNonce)).toBe(false);

    const rejected = await owner.query(
      `select count(*)::int as sessions
       from public.preview_qa_sessions
       where audience = $1 and id <> $2`,
      [audience, firstSession],
    );
    expect(rejected.rows[0].sessions).toBe(0);
  });

  it("revokes a replaced session and refuses its former token immediately", async () => {
    const audience = `preview-${randomUUID()}.vercel.app`;
    const firstGrant = randomUUID();
    const firstNonce = `nonce-${randomUUID()}`;
    const firstId = randomUUID();
    const firstToken = `token-${randomUUID()}`;
    await grant(firstGrant, firstNonce);
    expect(await issue(workerA, audience, firstId, firstToken, firstGrant, firstNonce)).toBe(true);
    expect(await active(workerA, audience, firstId, firstToken)).toBe(true);

    const replacementGrant = randomUUID();
    const replacementNonce = `nonce-${randomUUID()}`;
    const replacementId = randomUUID();
    const replacementToken = `token-${randomUUID()}`;
    await grant(replacementGrant, replacementNonce);
    expect(
      await issue(
        workerA,
        audience,
        replacementId,
        replacementToken,
        replacementGrant,
        replacementNonce,
        { id: firstId, tokenHash: firstToken },
      ),
    ).toBe(true);
    expect(await active(workerA, audience, firstId, firstToken)).toBe(false);
    expect(await active(workerA, audience, replacementId, replacementToken)).toBe(true);
  });
});
