import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    database: parsed.pathname.replace(/^\//, '') || undefined,
  };
}

describe.skipIf(!DB_URL)('prospect history trigger row shapes (real Postgres)', () => {
  let client: import('pg').Client;

  beforeAll(async () => {
    const { Client } = await import('pg');
    client = new Client(parseDirectDatabaseUrl(DB_URL!));
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it('logs an activity and updates both row types without resolving fields from the other table', async () => {
    const sourceRecordKey = `trigger-row-shape-${randomUUID()}`;

    await client.query('BEGIN');
    try {
      const organization = await client.query<{ id: string }>(
        `INSERT INTO public.prospect_organizations (display_name)
         VALUES ('Prospect history trigger regression fixture')
         RETURNING id`,
      );
      const organizationId = organization.rows[0].id;

      const source = await client.query<{ id: string }>(
        `INSERT INTO public.prospect_source_links (
           source_system, source_record_key, organization_id, history_coverage
         ) VALUES ('integration_test', $1, $2, 'known_empty')
         RETURNING id`,
        [sourceRecordKey, organizationId],
      );
      const sourceLinkId = source.rows[0].id;

      const conversation = await client.query<{ id: string }>(
        `INSERT INTO public.prospect_conversations (organization_id)
         VALUES ($1)
         RETURNING id`,
        [organizationId],
      );
      const conversationId = conversation.rows[0].id;

      await client.query(
        `INSERT INTO public.prospect_conversation_sources (
           conversation_id, source_link_id, is_primary
         ) VALUES ($1, $2, true)`,
        [conversationId, sourceLinkId],
      );

      const activity = await client.query<{ id: string }>(
        `INSERT INTO public.prospect_activities (
           conversation_id, organization_id, source_link_id,
           kind, channel, direction, delivery_status,
           idempotency_key
         ) VALUES (
           $1, $2, $3,
           'message_sent', 'email', 'outbound', 'sent',
           $4
         )
         RETURNING id`,
        [conversationId, organizationId, sourceLinkId, `activity-${randomUUID()}`],
      );

      expect(activity.rows).toHaveLength(1);

      const state = await client.query<{
        status: string;
        history_coverage: string;
        activity_count: number;
      }>(
        `SELECT conversation.status,
                source_link.history_coverage,
                count(activity.id)::int AS activity_count
         FROM public.prospect_conversations AS conversation
         JOIN public.prospect_conversation_sources AS association
           ON association.conversation_id = conversation.id
         JOIN public.prospect_source_links AS source_link
           ON source_link.id = association.source_link_id
         LEFT JOIN public.prospect_activities AS activity
           ON activity.conversation_id = conversation.id
         WHERE conversation.id = $1
         GROUP BY conversation.status, source_link.history_coverage`,
        [conversationId],
      );

      expect(state.rows).toEqual([
        {
          status: 'awaiting_reply',
          history_coverage: 'evidenced_activity',
          activity_count: 1,
        },
      ]);
    } finally {
      await client.query('ROLLBACK');
    }
  }, 30_000);
});
