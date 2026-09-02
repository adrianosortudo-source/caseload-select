/**
 * Real-Postgres regression coverage for the channel conversation ledger ACL.
 * This suite writes fixtures and must run only against CI's ephemeral local
 * Supabase stack (or an explicitly local developer stack), never a shared DB.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DIRECT_DATABASE_URL;

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

describe.skipIf(!DB_URL)("channel conversation ACL (real Postgres)", () => {
  let conn: import("pg").Client;
  let connB: import("pg").Client;
  const firmId = randomUUID();
  const leadId = randomUUID();
  const disabledFirmId = randomUUID();
  const disabledLeadId = randomUUID();
  const pendingId = randomUUID();
  const requestId = randomUUID();

  beforeAll(async () => {
    const { Client } = await import("pg");
    conn = new Client(parseDirectDatabaseUrl(DB_URL!));
    connB = new Client(parseDirectDatabaseUrl(DB_URL!));
    await conn.connect();
    await connB.connect();
    await conn.query(
      "insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Channel ACL Fixture', null, $2)",
      [firmId, `channel-acl-fixture-${firmId}`],
    );
    await conn.query(
      `insert into screened_leads
         (id, firm_id, lead_id, brief_json, brief_html, slot_answers, matter_type, practice_area, decision_deadline)
       values ($1, $2, $3, '{}'::jsonb, '<p></p>', '{}'::jsonb,
         'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours')`,
      [leadId, firmId, `channel-acl-fixture-${leadId}`],
    );
    await conn.query(
      "insert into intake_firms (id, name, custom_domain, subdomain) values ($1, 'Disabled Channel ACL Fixture', null, $2)",
      [disabledFirmId, `channel-acl-disabled-${disabledFirmId}`],
    );
    await conn.query(
      `insert into screened_leads
         (id, firm_id, lead_id, brief_json, brief_html, slot_answers, matter_type, practice_area, decision_deadline)
       values ($1, $2, $3, '{}'::jsonb, '<p></p>', '{}'::jsonb,
         'general_counsel_advisory', 'general_counsel_advisory', now() + interval '48 hours')`,
      [disabledLeadId, disabledFirmId, `channel-acl-disabled-${disabledLeadId}`],
    );
  }, 30000);

  afterAll(async () => {
    await connB.end();
    await conn.end();
  });

  async function asServiceRole(text: string, values: unknown[] = []) {
    await conn.query("begin");
    try {
      await conn.query("set local role service_role");
      const result = await conn.query(text, values);
      await conn.query("commit");
      return result;
    } catch (error) {
      await conn.query("rollback");
      throw error;
    }
  }

  it("grants service_role exactly SELECT and INSERT while browser roles have none", async () => {
    const flagColumn = await conn.query<{
      not_null: boolean;
      default_false: boolean;
    }>(
      `select columns.is_nullable = 'NO' as not_null,
              columns.column_default in ('false', 'false::boolean') as default_false
       from information_schema.columns
       where columns.table_schema = 'public'
         and columns.table_name = 'intake_firms'
         and columns.column_name = 'channel_conversation_ledger_enabled'`,
    );
    expect(flagColumn.rows).toEqual([{ not_null: true, default_false: true }]);

    const browserFlagPrivileges = await conn.query<{
      role_name: string;
      can_select: boolean;
      can_update: boolean;
    }>(
      `select role_name,
              has_column_privilege(
                role_name,
                'public.intake_firms',
                'channel_conversation_ledger_enabled',
                'SELECT'
              ) as can_select,
              has_column_privilege(
                role_name,
                'public.intake_firms',
                'channel_conversation_ledger_enabled',
                'UPDATE'
              ) as can_update
       from unnest(array['anon', 'authenticated']) as role_name
       order by role_name`,
    );
    expect(browserFlagPrivileges.rows).toEqual([
      { role_name: "anon", can_select: false, can_update: false },
      { role_name: "authenticated", can_select: false, can_update: false },
    ]);

    const rls = await conn.query<{
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: number;
    }>(
      `select tables.relrowsecurity as rls_enabled,
              tables.relforcerowsecurity as rls_forced,
              (select count(*)::integer
               from pg_policies policies
               where policies.schemaname = 'public'
                 and policies.tablename = 'channel_conversation_events') as policy_count
       from pg_class tables
       join pg_namespace namespaces on namespaces.oid = tables.relnamespace
       where namespaces.nspname = 'public'
         and tables.relname = 'channel_conversation_events'`,
    );
    expect(rls.rows).toEqual([
      { rls_enabled: true, rls_forced: true, policy_count: 0 },
    ]);

    const direct = await conn.query<{ grantee: string; privilege_type: string }>(
      `select case when acl.grantee = 0 then 'PUBLIC' else roles.rolname end as grantee,
              acl.privilege_type
       from pg_class tables
       join pg_namespace namespaces on namespaces.oid = tables.relnamespace
       cross join lateral aclexplode(tables.relacl) acl
       left join pg_roles roles on roles.oid = acl.grantee
       where namespaces.nspname = 'public'
         and tables.relname = 'channel_conversation_events'
         and (acl.grantee = 0 or roles.rolname in ('anon', 'authenticated', 'service_role'))
       order by grantee, acl.privilege_type`,
    );
    expect(direct.rows).toEqual([
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
    ]);

    const effective = await conn.query<{
      role_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
    }>(
      `select role_name,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'SELECT') as can_select,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'INSERT') as can_insert,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'UPDATE') as can_update,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'DELETE') as can_delete,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'TRUNCATE') as can_truncate,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'REFERENCES') as can_references,
              has_table_privilege(role_name, 'public.channel_conversation_events', 'TRIGGER') as can_trigger
       from unnest(array['anon', 'authenticated', 'service_role']) as role_name
       order by role_name`,
    );
    expect(effective.rows).toEqual([
      {
        role_name: "anon",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      },
      {
        role_name: "authenticated",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      },
      {
        role_name: "service_role",
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      },
    ]);

    const version = await conn.query<{ version_num: number }>(
      "select current_setting('server_version_num')::integer as version_num",
    );
    if (version.rows[0].version_num >= 170000) {
      const maintain = await conn.query<{ allowed: boolean }>(
        "select has_table_privilege('service_role', 'public.channel_conversation_events', 'MAINTAIN') as allowed",
      );
      expect(maintain.rows[0].allowed).toBe(false);
    } else {
      expect(direct.rows.some((row) => row.privilege_type === "MAINTAIN")).toBe(false);
    }
  });

  it("denies direct trigger-function execution to every API role", async () => {
    const functionSafety = await conn.query<{
      function_name: string;
      security_invoker: boolean;
      empty_search_path: boolean;
    }>(
      `select functions.proname as function_name,
              not functions.prosecdef as security_invoker,
              functions.proconfig = array['search_path=""']::text[] as empty_search_path
       from pg_proc functions
       join pg_namespace namespaces on namespaces.oid = functions.pronamespace
       where namespaces.nspname = 'public'
         and functions.proname in (
           'reject_channel_conversation_event_mutation',
           'require_channel_conversation_ledger_enabled',
           'validate_channel_conversation_terminal'
         )
       order by functions.proname`,
    );
    expect(functionSafety.rows).toEqual([
      {
        function_name: "reject_channel_conversation_event_mutation",
        security_invoker: true,
        empty_search_path: true,
      },
      {
        function_name: "require_channel_conversation_ledger_enabled",
        security_invoker: true,
        empty_search_path: true,
      },
      {
        function_name: "validate_channel_conversation_terminal",
        security_invoker: true,
        empty_search_path: true,
      },
    ]);

    const direct = await conn.query<{ function_name: string; grantee: string }>(
      `select functions.proname as function_name,
              case when acl.grantee = 0 then 'PUBLIC' else roles.rolname end as grantee
       from pg_proc functions
       join pg_namespace namespaces on namespaces.oid = functions.pronamespace
       cross join lateral aclexplode(functions.proacl) acl
       left join pg_roles roles on roles.oid = acl.grantee
       where namespaces.nspname = 'public'
         and functions.proname in (
           'reject_channel_conversation_event_mutation',
           'require_channel_conversation_ledger_enabled',
           'validate_channel_conversation_terminal'
         )
         and (acl.grantee = 0 or roles.rolname in ('anon', 'authenticated', 'service_role'))`,
    );
    expect(direct.rows).toEqual([]);

    const effective = await conn.query<{ function_name: string; role_name: string; allowed: boolean }>(
      `select function_name, role_name,
              has_function_privilege(role_name, format('public.%I()', function_name), 'EXECUTE') as allowed
       from unnest(array[
         'reject_channel_conversation_event_mutation',
         'require_channel_conversation_ledger_enabled',
         'validate_channel_conversation_terminal'
       ]) as function_name
       cross join unnest(array['anon', 'authenticated', 'service_role']) as role_name
       order by function_name, role_name`,
    );
    expect(effective.rows.every((row) => row.allowed === false)).toBe(true);
  });

  it("keeps trigger enforcement active after direct function EXECUTE is revoked", async () => {
    await expect(
      asServiceRole(
        `insert into channel_conversation_events
           (id, screened_lead_id, firm_id, channel, direction, source, body, status,
            client_request_id, actor_type, actor_id, occurred_at)
         values ($1, $2, $3, 'facebook', 'outbound', 'operator', 'Blocked body',
           'pending', $4, 'lawyer', 'fixture-lawyer', now())`,
        [pendingId, leadId, firmId, requestId],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const blockedRows = await conn.query<{ count: string }>(
      "select count(*)::text as count from channel_conversation_events where firm_id = $1",
      [firmId],
    );
    expect(blockedRows.rows[0].count).toBe("0");

    await conn.query(
      "update intake_firms set channel_conversation_ledger_enabled = true where id = $1",
      [firmId],
    );

    await expect(
      asServiceRole(
        `insert into channel_conversation_events
           (screened_lead_id, firm_id, channel, direction, source, body, status,
            client_request_id, actor_type, actor_id, occurred_at)
         values ($1, $2, 'facebook', 'outbound', 'operator', 'Other firm body',
           'pending', $3, 'lawyer', 'fixture-lawyer', now())`,
        [disabledLeadId, disabledFirmId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const disabledFirmRows = await conn.query<{ count: string }>(
      "select count(*)::text as count from channel_conversation_events where firm_id = $1",
      [disabledFirmId],
    );
    expect(disabledFirmRows.rows[0].count).toBe("0");

    await asServiceRole(
      `insert into channel_conversation_events
         (id, screened_lead_id, firm_id, channel, direction, source, body, status,
          client_request_id, actor_type, actor_id, occurred_at)
       values ($1, $2, $3, 'facebook', 'outbound', 'operator', 'ACL fixture reply',
         'pending', $4, 'lawyer', 'fixture-lawyer', now())`,
      [pendingId, leadId, firmId, requestId],
    );

    await asServiceRole(
      `insert into channel_conversation_events
         (screened_lead_id, firm_id, channel, direction, source, body, status,
          meta_message_id, client_request_id, actor_type, actor_id, occurred_at)
       values ($1, $2, 'facebook', 'outbound', 'operator', 'ACL fixture reply',
         'sent', $3, $4, 'lawyer', 'fixture-lawyer', now())`,
      [leadId, firmId, `mid.${randomUUID()}`, requestId],
    );

    await expect(
      asServiceRole(
        `insert into channel_conversation_events
           (screened_lead_id, firm_id, channel, direction, source, body, status,
            meta_message_id, client_request_id, actor_type, actor_id, occurred_at)
         values ($1, $2, 'facebook', 'outbound', 'operator', 'Orphan terminal',
           'sent', $3, $4, 'lawyer', 'fixture-lawyer', now())`,
        [leadId, firmId, `mid.${randomUUID()}`, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // service_role cannot reach UPDATE/DELETE because the table ACL denies
    // them; the owner call proves the append-only trigger itself still fires.
    await expect(
      conn.query("update channel_conversation_events set body = 'changed' where id = $1", [pendingId]),
    ).rejects.toThrow("channel_conversation_events is append-only");
    await expect(
      conn.query("delete from channel_conversation_events where id = $1", [pendingId]),
    ).rejects.toThrow("channel_conversation_events is append-only");
  });

  it("serializes ledger inserts with a concurrent firm disable in both lock orderings", async () => {
    const startedBeforeDisableRequest = randomUUID();
    const startedBeforeDisableBody = `Started before disable ${randomUUID()}`;

    await conn.query(
      "update intake_firms set channel_conversation_ledger_enabled = true where id = $1",
      [firmId],
    );

    await conn.query("begin");
    await conn.query("set local role service_role");
    await conn.query(
      `insert into channel_conversation_events
         (screened_lead_id, firm_id, channel, direction, source, body, status,
          client_request_id, actor_type, actor_id, occurred_at)
       values ($1, $2, 'facebook', 'outbound', 'operator', $3,
         'pending', $4, 'lawyer', 'fixture-lawyer', now())`,
      [leadId, firmId, startedBeforeDisableBody, startedBeforeDisableRequest],
    );

    let disableSettled = false;
    const disable = (async () => {
      await connB.query("begin");
      await connB.query(
        "update intake_firms set channel_conversation_ledger_enabled = false where id = $1",
        [firmId],
      );
      disableSettled = true;
      await connB.query("commit");
    })();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(disableSettled).toBe(false);
    await conn.query("commit");
    await disable;

    const committedBeforeDisable = await conn.query<{ count: string }>(
      "select count(*)::text as count from channel_conversation_events where firm_id = $1 and body = $2",
      [firmId, startedBeforeDisableBody],
    );
    expect(committedBeforeDisable.rows[0].count).toBe("1");

    await conn.query(
      "update intake_firms set channel_conversation_ledger_enabled = true where id = $1",
      [firmId],
    );
    await connB.query("begin");
    await connB.query(
      "update intake_firms set channel_conversation_ledger_enabled = false where id = $1",
      [firmId],
    );

    const blockedAfterDisableBody = `Blocked after disable ${randomUUID()}`;
    await conn.query("begin");
    await conn.query("set local role service_role");
    let insertSettled = false;
    const insertBehindDisable = conn
      .query(
        `insert into channel_conversation_events
           (screened_lead_id, firm_id, channel, direction, source, body, status,
            client_request_id, actor_type, actor_id, occurred_at)
         values ($1, $2, 'facebook', 'outbound', 'operator', $3,
           'pending', $4, 'lawyer', 'fixture-lawyer', now())`,
        [leadId, firmId, blockedAfterDisableBody, randomUUID()],
      )
      .then(
        () => ({ ok: true as const, error: null }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => {
        insertSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(insertSettled).toBe(false);
    await connB.query("commit");
    const blockedOutcome = await insertBehindDisable;
    expect(blockedOutcome).toMatchObject({
      ok: false,
      error: { code: "42501" },
    });
    await conn.query("rollback");

    const blockedAfterDisable = await conn.query<{ count: string }>(
      "select count(*)::text as count from channel_conversation_events where firm_id = $1 and body = $2",
      [firmId, blockedAfterDisableBody],
    );
    expect(blockedAfterDisable.rows[0].count).toBe("0");
  });
});
