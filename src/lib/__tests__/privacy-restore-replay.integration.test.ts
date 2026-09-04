/**
 * Transactional logical-restore simulation for the privacy recovery path.
 *
 * This test is intentionally restricted to the disposable local Supabase
 * container started by CI. It is not a managed backup or PITR rehearsal.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertDatabaseReplaying: vi.fn(),
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  store: undefined as unknown,
}));

vi.mock('server-only', () => ({}));

vi.mock('../supabase-admin', () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  },
}));

vi.mock('../privacy-recovery-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../privacy-recovery-gate')>();
  return {
    ...actual,
    assertPrivacyOperationsOpen: () => actual.assertPrivacyOperationsOpen(
      mocks.store as import('../privacy-deletion-registry').RegistryStore,
    ),
    assertPrivacyRecoveryReplaying: async () => {
      await actual.assertPrivacyRecoveryReplaying(
        mocks.store as import('../privacy-deletion-registry').RegistryStore,
      );
      await mocks.assertDatabaseReplaying();
    },
  };
});

vi.mock('../privacy-deletion-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../privacy-deletion-registry')>();
  const selectedStore = (store?: import('../privacy-deletion-registry').RegistryStore) =>
    store ?? mocks.store as import('../privacy-deletion-registry').RegistryStore;
  return {
    ...actual,
    registerDeletionIntent: (
      intent: import('../privacy-deletion-registry').RegistryIntent,
      store?: import('../privacy-deletion-registry').RegistryStore,
    ) => actual.registerDeletionIntent(intent, selectedStore(store)),
    registerDeletionIntentWhenOpen: (
      intent: import('../privacy-deletion-registry').RegistryIntent,
      store?: import('../privacy-deletion-registry').RegistryAtomicStore,
    ) => actual.registerDeletionIntentWhenOpen(
      intent,
      selectedStore(store) as import('../privacy-deletion-registry').RegistryAtomicStore,
    ),
    registerDeletionAppliedReceipt: (
      receipt: import('../privacy-deletion-registry').RegistryAppliedReceipt,
      store?: import('../privacy-deletion-registry').RegistryStore,
    ) => actual.registerDeletionAppliedReceipt(receipt, selectedStore(store)),
  };
});

import {
  decryptRegistryRecord,
  isPrivacyDeletionRegistryActivated,
  loadRegistryOperationState,
  markPrivacyDeletionRegistryActivated,
  registerDeletionAppliedReceipt,
  registerDeletionIntent,
  type RegistryAtomicStore,
  type RegistryStore,
} from '../privacy-deletion-registry';
import {
  runPrivacyDeletionRegistryWorkerStep,
  type RegistryIntentScanStore,
} from '../privacy-deletion-recovery';
import { setPrivacyRecoveryCircuit } from '../privacy-recovery-gate';
import { eraseScreenedLead } from '../screened-lead-erasure';

const DB_URL = process.env.DIRECT_DATABASE_URL;
const SERVER_IPS = process.env.LOCAL_SUPABASE_DB_CONTAINER_IPS;
const encryptionKey = Buffer.alloc(32, 37).toString('base64');
const registryPrefix = 'privacy:deletion-registry:v2:';
const circuitKey = `${registryPrefix}recovery-circuit`;
const activationKey = `${registryPrefix}activation`;

function parseDirectDatabaseUrl(value: string) {
  const trimmed = value.trim();
  const unquoted = trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const parsed = new URL(unquoted);
  const hostname = decodeURIComponent(parsed.hostname).replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('restore rehearsal requires a PostgreSQL URL');
  }
  if (hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error('restore rehearsal database URL is not numeric loopback');
  }
  if (parsed.pathname !== '/postgres') {
    throw new Error('restore rehearsal database must be the local postgres database');
  }
  if (!parsed.port) throw new Error('restore rehearsal database port is missing');
  return {
    host: hostname,
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: 'postgres',
  };
}

function memoryRegistryStore(): RegistryIntentScanStore & RegistryAtomicStore & {
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    async set(key, value, options) {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get<T>(key: string) {
      const value = values.get(key);
      if (typeof value === 'string') {
        try { return JSON.parse(value) as T; } catch { return value as T; }
      }
      return (value as T | undefined) ?? null;
    },
    async scan() {
      return ['0', [...values.keys()].filter((key) => key.startsWith(`${registryPrefix}intent:`))];
    },
    async eval(script, keys, args) {
      if (keys.length === 2 && script.includes("value['state']~='open'")) {
        const control = values.get(keys[0]);
        const state = typeof control === 'string' ? JSON.parse(control) : control;
        if (!state || (state as { state?: string }).state !== 'open') return -1;
        if (values.has(keys[1])) return 0;
        values.set(keys[1], args[0]);
        return 1;
      }
      if (keys.length === 2 && script.includes("redis.call('del',KEYS[2])")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.delete(keys[1]);
        values.delete(keys[0]);
        return 1;
      }
      if (keys.length === 3 && script.includes("redis.call('set',KEYS[3]")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        values.set(keys[1], args[1]);
        values.set(keys[2], args[2]);
        return 1;
      }
      if (keys.length === 2 && script.includes("redis.call('set',KEYS[2],ARGV[2]")) {
        if (values.get(keys[0]) !== args[0]) return 0;
        if (script.includes("'NX'") && values.has(keys[1])) return 0;
        values.set(keys[1], args[1]);
        return 1;
      }
      if (values.get(keys[0]) !== args[0]) return 0;
      if (script.includes("redis.call('del'")) values.delete(keys[0]);
      return 1;
    },
  };
}

describe.skipIf(!DB_URL || !SERVER_IPS)(
  'privacy restore/replay transactional simulation (disposable real Postgres)',
  () => {
    let Client: typeof import('pg').Client;
    let conn: import('pg').Client;
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    beforeAll(async () => {
      ({ Client } = await import('pg'));
      conn = new Client(parseDirectDatabaseUrl(DB_URL!));
      await conn.connect();

      const boundary = await conn.query(
        `select host(inet_server_addr()) as server_address,
                inet_server_port() as server_port,
                current_database() as database_name`,
      );
      const allowedServerIps = SERVER_IPS!.split(',').filter(Boolean);
      expect(allowedServerIps.length).toBeGreaterThan(0);
      expect(allowedServerIps).toContain(boundary.rows[0].server_address);
      expect(boundary.rows[0].server_port).toBe(5432);
      expect(boundary.rows[0].database_name).toBe('postgres');
    }, 30_000);

    afterAll(async () => {
      process.env = { ...originalEnv };
      globalThis.fetch = originalFetch;
      await conn?.end();
    });

    it('replays an external encrypted intent after a pre-deletion logical snapshot is restored', async () => {
      const store = memoryRegistryStore();
      mocks.store = store;
      mocks.storageFrom.mockReset().mockImplementation(() => {
        throw new Error('Storage must not be reached by recovery replay');
      });
      const networkGuard = vi.fn(async () => {
        throw new Error('non-loopback network is prohibited in the restore rehearsal');
      });
      globalThis.fetch = networkGuard as typeof fetch;
      process.env.PRIVACY_DELETION_REGISTRY_ENABLED = 'true';
      process.env.PRIVACY_DELETION_REGISTRY_ENCRYPTION_KEY = encryptionKey;

      const firmId = randomUUID();
      const leadId = randomUUID();
      const publicLeadId = `restore-fixture-${randomUUID()}`;
      const requestId = randomUUID();
      const deniedRequestId = randomUUID();
      const senderId = `fictional-sender-${randomUUID()}`;
      const messageId = `fictional-message-${randomUUID()}`;
      const pendingRequestId = randomUUID();
      const fictionalMarkers = [
        firmId,
        leadId,
        publicLeadId,
        requestId,
        'Restore Fixture Person',
        'restore.fixture@example.test',
        '+14165550177',
        'fictional restore transcript',
        senderId,
        messageId,
        pendingRequestId,
        'fictional restored inbound body',
        'fictional pending reply body',
        'late fictional private body',
        'late terminal private body',
      ];

      async function serviceRpc<T>(sql: string, params: unknown[] = []): Promise<T> {
        await conn.query('set local role service_role');
        try {
          const result = await conn.query(sql, params);
          return result.rows[0].result as T;
        } finally {
          await conn.query('reset role');
        }
      }

      async function expectRoleDenied(role: 'anon' | 'authenticated') {
        const savepoint = `acl_${role}`;
        await conn.query(`savepoint ${savepoint}`);
        try {
          await conn.query(`set local role ${role}`);
          await expect(conn.query(
            `select public.begin_privacy_registry_reconciliation('replay', true)`,
          )).rejects.toMatchObject({ code: '42501' });
        } finally {
          await conn.query(`rollback to savepoint ${savepoint}`);
          await conn.query(`release savepoint ${savepoint}`);
          await conn.query('reset role');
        }
      }

      mocks.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
        try {
          if (name === 'resolve_screened_lead_privacy_coordinate') {
            const result = await serviceRpc<unknown>(
              `select public.resolve_screened_lead_privacy_coordinate($1,$2,$3) as result`,
              [args.p_firm_id, args.p_lead_id, args.p_deletion_request_id],
            );
            return { data: result, error: null };
          }
          if (name === 'redact_screened_lead_subject_by_id') {
            const result = await serviceRpc<unknown>(
              `select public.redact_screened_lead_subject_by_id($1,$2,$3,$4) as result`,
              [args.p_firm_id, args.p_screened_lead_id, args.p_reason, args.p_deletion_request_id],
            );
            return { data: result, error: null };
          }
          if (name === 'mark_privacy_registry_reconciliation_complete') {
            const result = await serviceRpc<unknown>(
              `select public.mark_privacy_registry_reconciliation_complete($1,$2,$3,$4) as result`,
              [args.p_operation, args.p_operation_id, args.p_cycle_id, args.p_firm_id],
            );
            return { data: result, error: null };
          }
          throw new Error('unexpected local RPC');
        } catch {
          return { data: null, error: { message: 'local RPC failed' } };
        }
      });
      mocks.assertDatabaseReplaying.mockReset().mockImplementation(async () => {
        const state = await conn.query(
          `select state, required_operation from private.privacy_recovery_control where singleton`,
        );
        if (state.rows[0]?.state !== 'replaying' || state.rows[0]?.required_operation !== 'replay') {
          throw new Error('local database replay is not active');
        }
      });

      await conn.query('begin');
      try {
        // Establish a legitimate operational/open state using only the
        // service-role recovery contract before capturing the snapshot.
        await markPrivacyDeletionRegistryActivated(store);
        const registryActivated = await isPrivacyDeletionRegistryActivated(store);
        expect(registryActivated).toBe(true);
        const setup = await serviceRpc<{ ok: boolean; cycle_id: string; cycle_started_at: string }>(
          `select public.begin_privacy_registry_reconciliation('replay', $1) as result`,
          [registryActivated],
        );
        expect(setup.ok).toBe(true);
        const setupOperationId = randomUUID();
        expect(await serviceRpc<{ ok: boolean }>(
          `select public.mark_privacy_registry_reconciliation_complete('replay',$1,$2,null) as result`,
          [setupOperationId, setup.cycle_id],
        )).toMatchObject({ ok: true });
        expect(await serviceRpc<{ ok: boolean; state: string }>(
          `select public.open_privacy_recovery($1,$2) as result`,
          [setup.cycle_id, setupOperationId],
        )).toMatchObject({ ok: true, state: 'open' });
        await setPrivacyRecoveryCircuit('open', store);

        await conn.query(
          `insert into intake_firms (id, name, custom_domain, subdomain)
           values ($1, 'Restore Fixture Firm', null, $2)`,
          [firmId, `restore-${firmId}`],
        );
        await conn.query(
          `insert into screened_leads
             (id, firm_id, lead_id, brief_json, brief_html, slot_answers,
              matter_type, practice_area, decision_deadline, contact_name,
              contact_email, contact_phone, raw_transcript)
           values ($1,$2,$3,'{"name":"Restore Fixture Person"}'::jsonb,
             '<p>Restore Fixture Person</p>',
             '{"email":"restore.fixture@example.test"}'::jsonb,
             'employment','employment',now() + interval '48 hours',
             'Restore Fixture Person','restore.fixture@example.test',
             '+14165550177','fictional restore transcript')`,
          [leadId, firmId, publicLeadId],
        );
        await conn.query(
          `insert into channel_intake_sessions
             (firm_id, channel, sender_id, engine_state, finalized, screened_lead_id)
           values ($1,'facebook',$2,'{"email":"restore.fixture@example.test"}'::jsonb,true,$3)`,
          [firmId, senderId, leadId],
        );
        await conn.query(
          `insert into channel_conversation_events
             (screened_lead_id, firm_id, channel, direction, source, body,
              status, meta_message_id, client_request_id, actor_type, actor_id,
              authoritative_inbound, occurred_at)
           values
             ($1,$2,'facebook','inbound','webhook','fictional restored inbound body',
              'received',$3,null,'lead',$4,true,now()),
             ($1,$2,'facebook','outbound','operator','fictional pending reply body',
              'pending',null,$5,'operator','operator@example.test',false,now())`,
          [leadId, firmId, messageId, senderId, pendingRequestId],
        );
        await conn.query(
          `insert into processed_channel_messages (firm_id, channel, message_mid, sender_id)
           values ($1,'facebook',$2,$3)`,
          [firmId, messageId, senderId],
        );

        await conn.query('savepoint pre_deletion_snapshot');

        const intent = {
          deletionRequestId: requestId,
          firmId,
          screenedLeadId: leadId,
          reason: 'subject_request' as const,
          recordedAt: new Date().toISOString(),
        };
        expect(await registerDeletionIntent(intent, store)).toBe('created');
        const firstRedaction = await serviceRpc<{
          ok: boolean;
          redacted_count: number;
          privacy_redacted_at: string;
        }>(
          `select public.redact_screened_lead_subject_by_id($1,$2,'subject_request',$3) as result`,
          [firmId, leadId, requestId],
        );
        expect(firstRedaction).toMatchObject({ ok: true, redacted_count: 1 });
        await registerDeletionAppliedReceipt({
          deletionRequestId: requestId,
          redactedCount: 1,
          appliedAt: firstRedaction.privacy_redacted_at,
        }, store);
        expect((await conn.query(
          `select contact_email, raw_transcript from screened_leads where id=$1`,
          [leadId],
        )).rows[0]).toMatchObject({ contact_email: null, raw_transcript: null });

        // Lock before the logical restore. Rolling back the DB savepoint then
        // deliberately restores the prior open control row, while the
        // independent in-memory registry remains locked and retains intent.
        await setPrivacyRecoveryCircuit('locked', store);
        expect(await serviceRpc<{ ok: boolean; state: string }>(
          `select public.set_privacy_recovery_state('locked') as result`,
        )).toMatchObject({ ok: true, state: 'locked' });
        await conn.query('rollback to savepoint pre_deletion_snapshot');

        // The snapshot restores its former open control row. Re-lock it as
        // the first database operation after restore, before inspecting any
        // resurrected application data.
        expect(await serviceRpc<{ ok: boolean; state: string }>(
          `select public.set_privacy_recovery_state('locked') as result`,
        )).toMatchObject({ ok: true, state: 'locked' });

        const restored = await conn.query(
          `select contact_name, contact_email, contact_phone, raw_transcript
             from screened_leads where id=$1`,
          [leadId],
        );
        expect(restored.rows[0]).toMatchObject({
          contact_name: 'Restore Fixture Person',
          contact_email: 'restore.fixture@example.test',
          contact_phone: '+14165550177',
          raw_transcript: 'fictional restore transcript',
        });
        expect((await conn.query(
          `select body, meta_message_id from channel_conversation_events
            where screened_lead_id=$1 and direction='inbound'`,
          [leadId],
        )).rows[0]).toMatchObject({
          body: 'fictional restored inbound body',
          meta_message_id: messageId,
        });
        expect(Number((await conn.query(
          `select count(*) as count from privacy_deletion_requests where id=$1`,
          [requestId],
        )).rows[0].count)).toBe(0);
        expect([...store.values.keys()].some((key) => key.startsWith(`${registryPrefix}intent:`))).toBe(true);
        expect(await isPrivacyDeletionRegistryActivated(store)).toBe(true);

        // Prove a normal operational deletion cannot pass while the external
        // circuit is closed.
        const refused = await eraseScreenedLead({
          firmId,
          leadId: publicLeadId,
          reason: 'subject_request',
          deletionRequestId: deniedRequestId,
        });
        expect(refused).toMatchObject({
          ok: false,
          database_redacted: false,
          error: 'external privacy deletion registry is unavailable',
        });
        expect(Number((await conn.query(
          `select count(*) as count from privacy_deletion_requests`,
        )).rows[0].count)).toBe(0);
        await expectRoleDenied('anon');
        await expectRoleDenied('authenticated');

        async function replay(operationId: string) {
          const activated = await isPrivacyDeletionRegistryActivated(store);
          expect(activated).toBe(true);
          const begun = await serviceRpc<{
            ok: boolean;
            cycle_id: string;
            cycle_started_at: string;
          }>(`select public.begin_privacy_registry_reconciliation('replay', $1) as result`, [activated]);
          expect(begun.ok).toBe(true);
          await setPrivacyRecoveryCircuit('replaying', store);
          const result = await runPrivacyDeletionRegistryWorkerStep({
            operation: 'replay',
            operationId,
            cycleId: begun.cycle_id,
            cycleStartedAt: begun.cycle_started_at,
            limit: 10,
            store,
          });
          const state = await loadRegistryOperationState(operationId, store);
          expect(result).toMatchObject({
            status: 'complete',
            hasMore: false,
            scannedCount: 1,
            failedCount: 0,
          });
          expect(state).toMatchObject({
            status: 'complete',
            scanExhausted: true,
            bufferedKeys: [],
            pendingIntents: [],
            failedCount: 0,
          });
          await setPrivacyRecoveryCircuit('locked', store);
          expect(await serviceRpc<{ ok: boolean; state: string }>(
            `select public.set_privacy_recovery_state('locked') as result`,
          )).toMatchObject({ ok: true, state: 'locked' });
          return result;
        }

        const firstOperationId = randomUUID();
        const firstReplay = await replay(firstOperationId);
        expect(firstReplay).toMatchObject({ appliedCount: 1, skippedCount: 0 });

        const leadAfterReplay = await conn.query(
          `select lead_id, contact_name, contact_email, contact_phone, raw_transcript
             from screened_leads where id=$1`,
          [leadId],
        );
        expect(leadAfterReplay.rows[0]).toMatchObject({
          lead_id: `privacy-redacted:${leadId}`,
          contact_name: '[anonymized]',
          contact_email: null,
          contact_phone: null,
          raw_transcript: null,
        });
        const events = await conn.query(
          `select body, meta_message_id, actor_id, status
             from channel_conversation_events where screened_lead_id=$1`,
          [leadId],
        );
        expect(events.rows.every((row) =>
          row.body === '[redacted]' && row.meta_message_id == null && row.actor_id == null,
        )).toBe(true);
        expect(events.rows).toContainEqual(expect.objectContaining({
          body: '[redacted]',
          meta_message_id: null,
          actor_id: null,
          status: 'pending',
        }));
        expect(Number((await conn.query(
          `select count(*) as count from processed_channel_messages
            where firm_id=$1 and message_mid=$2`,
          [firmId, messageId],
        )).rows[0].count)).toBe(0);

        const request = await conn.query(
          `select external_cleanup_status, external_cleanup_completed_at,
                  external_cleanup_manifest
             from privacy_deletion_requests where id=$1`,
          [requestId],
        );
        expect(request.rows[0].external_cleanup_status).toBe('pending');
        expect(request.rows[0].external_cleanup_completed_at).toBeNull();
        expect(request.rows[0].external_cleanup_manifest).toBeTruthy();

        await conn.query('savepoint late_inbound_guard');
        try {
          await expect(conn.query(
            `insert into channel_conversation_events
               (screened_lead_id,firm_id,channel,direction,source,body,status,
                meta_message_id,actor_type,actor_id,authoritative_inbound,occurred_at)
             values ($1,$2,'facebook','inbound','webhook','late fictional private body',
               'received',$3,'lead',$4,true,now())`,
            [leadId, firmId, `late-${randomUUID()}`, senderId],
          )).rejects.toMatchObject({
            code: '23514',
            message: 'channel conversation event rejected: channel subject is privacy-suppressed',
          });
        } finally {
          await conn.query('rollback to savepoint late_inbound_guard');
          await conn.query('release savepoint late_inbound_guard');
        }

        await conn.query(
          `insert into channel_conversation_events
             (screened_lead_id,firm_id,channel,direction,source,body,status,
              meta_message_id,client_request_id,actor_type,actor_id,
              authoritative_inbound,occurred_at)
           values ($1,$2,'facebook','outbound','operator','late terminal private body',
             'sent',$3,$4,'operator','operator@example.test',false,now())`,
          [leadId, firmId, `terminal-${randomUUID()}`, pendingRequestId],
        );
        expect((await conn.query(
          `select body, meta_message_id, actor_id, privacy_deletion_request_id
             from channel_conversation_events
            where screened_lead_id=$1 and client_request_id=$2 and status='sent'`,
          [leadId, pendingRequestId],
        )).rows[0]).toMatchObject({
          body: '[redacted]',
          meta_message_id: null,
          actor_id: null,
          privacy_deletion_request_id: requestId,
        });

        const secondOperationId = randomUUID();
        const secondReplay = await replay(secondOperationId);
        expect(secondReplay).toMatchObject({ appliedCount: 0, skippedCount: 1, failedCount: 0 });
        const firstReplayEvidence = store.values.get(`${registryPrefix}replay-run:${firstOperationId}`);
        const secondReplayEvidence = store.values.get(`${registryPrefix}replay-run:${secondOperationId}`);
        expect(decryptRegistryRecord(String(firstReplayEvidence), 'replay-run', firstOperationId)).toMatchObject({
          replayRunId: firstOperationId,
          candidateCount: 1,
          appliedCount: 1,
          skippedCount: 0,
          failedCount: 0,
          outcome: 'complete',
        });
        expect(decryptRegistryRecord(String(secondReplayEvidence), 'replay-run', secondOperationId)).toMatchObject({
          replayRunId: secondOperationId,
          candidateCount: 1,
          appliedCount: 0,
          skippedCount: 1,
          failedCount: 0,
          outcome: 'complete',
        });
        expect(mocks.storageFrom).not.toHaveBeenCalled();
        expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain(
          'complete_screened_lead_external_cleanup',
        );
        expect(networkGuard).not.toHaveBeenCalled();

        const persistentRegistryValues = [...store.values.entries()]
          .filter(([key]) => key !== circuitKey && key !== activationKey && !key.includes(':worker-lease:'))
          .map(([, value]) => value);
        expect(persistentRegistryValues.length).toBeGreaterThanOrEqual(6);
        expect(persistentRegistryValues.every((value) =>
          typeof value === 'string' && value.startsWith('enc-v2:'),
        )).toBe(true);
        const rawRegistry = JSON.stringify(persistentRegistryValues);
        for (const marker of fictionalMarkers) expect(rawRegistry).not.toContain(marker);
        expect(store.values.get(activationKey)).toBe('v1');

        const finalControl = await conn.query(
          `select state, required_operation from private.privacy_recovery_control where singleton`,
        );
        expect(finalControl.rows[0]).toMatchObject({ state: 'locked', required_operation: 'replay' });
        expect((store.values.get(circuitKey) as { state?: string }).state).toBe('locked');
      } finally {
        await setPrivacyRecoveryCircuit('locked', store).catch(() => undefined);
        await conn.query('rollback');
      }
    }, 60_000);
  },
);
