/** Runtime circuit breaker used while a backup restore is being reconciled. */
import 'server-only';
import { Redis } from '@upstash/redis';
import { isPrivacyDeletionRegistryEnabled, type RegistryStore } from './privacy-deletion-registry';

const CIRCUIT_KEY = 'privacy:deletion-registry:v2:recovery-circuit';
export type PrivacyRecoveryState = 'open' | 'locked' | 'replaying';

type CircuitValue = { state: PrivacyRecoveryState; changedAt: string };

function store(): RegistryStore { return Redis.fromEnv() as unknown as RegistryStore; }

function parseCircuit(value: unknown): PrivacyRecoveryState | null {
  // Upstash REST returns a JSON object for object values in some clients and
  // the original serialized string in others. Treat both representations the
  // same, but never treat a bare string such as "open" as a valid control
  // record.
  if (typeof value === 'string') {
    try { return parseCircuit(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.state === 'open' || row.state === 'locked' || row.state === 'replaying' ? row.state : null;
}

/** Disabled means this unshipped feature has no runtime effect. Once enabled,
 * absence, malformed state, or registry outage is deliberately closed. */
export async function privacyRecoveryState(client?: RegistryStore): Promise<PrivacyRecoveryState | 'disabled'> {
  if (!isPrivacyDeletionRegistryEnabled()) return 'disabled';
  const state = parseCircuit(await (client ?? store()).get<unknown>(CIRCUIT_KEY));
  return state ?? 'locked';
}

export async function assertPrivacyOperationsOpen(client?: RegistryStore): Promise<void> {
  const state = await privacyRecoveryState(client);
  if (state === 'locked' || state === 'replaying') {
    throw new Error('privacy recovery circuit is closed');
  }
}

/** Only the separately authenticated restore coordinator may call this. */
export async function assertPrivacyRecoveryReplaying(client?: RegistryStore): Promise<void> {
  if (isPrivacyDeletionRegistryEnabled() && await privacyRecoveryState(client) !== 'replaying') {
    throw new Error('privacy recovery replay is not active');
  }
}

/** This only changes the external breaker. The caller must also persist the
 * matching database state through the service-only recovery RPC. */
export async function setPrivacyRecoveryCircuit(state: PrivacyRecoveryState, client: RegistryStore = store()): Promise<void> {
  await client.set(CIRCUIT_KEY, { state, changedAt: new Date().toISOString() });
}
