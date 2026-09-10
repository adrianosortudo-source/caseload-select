import type { ProspectSourceContactState } from '@/lib/prospect-operations-types';

export const GTA_PROSPECT_SOURCE_SYSTEM = 'gta_research';
export const BRAZILIAN_PROSPECT_SOURCE_SYSTEM = 'brazilian_owner_cohort';
export const SOURCE_STATE_BATCH_SIZE = 100;

export type SourceContactStateMap = ReadonlyMap<string, ProspectSourceContactState>;

type SourceStatesPayload = {
  states?: ProspectSourceContactState[];
};

export async function fetchSourceContactStates(
  sourceSystem: string,
  sourceRecordKeys: readonly string[],
  signal?: AbortSignal,
): Promise<SourceContactStateMap> {
  const keys = [...new Set(sourceRecordKeys.map((key) => key.trim()).filter(Boolean))];
  if (!sourceSystem.trim() || keys.length === 0) return new Map();

  const batches: string[][] = [];
  for (let index = 0; index < keys.length; index += SOURCE_STATE_BATCH_SIZE) {
    batches.push(keys.slice(index, index + SOURCE_STATE_BATCH_SIZE));
  }

  const stateBatches = await Promise.all(batches.map(async (batch) => {
    const response = await fetch('/api/admin/prospect-operations/source-states', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_system: sourceSystem, source_record_keys: batch }),
      signal,
    });
    const payload = await response.json().catch(() => ({})) as SourceStatesPayload & { error?: string } | ProspectSourceContactState[];
    const states = Array.isArray(payload) ? payload : payload.states ?? [];
    if (!response.ok) {
      const message = Array.isArray(payload) ? undefined : payload.error;
      throw new Error(message ?? `Could not load contact status (${response.status})`);
    }
    return states;
  }));

  return new Map(stateBatches.flat().map((state) => [state.source_record_key, state]));
}

export function sourceHistoryUrl(sourceSystem: string, sourceRecordKey: string): string {
  return `/api/admin/prospect-operations/conversations/source?source_system=${encodeURIComponent(sourceSystem)}&source_record_key=${encodeURIComponent(sourceRecordKey)}`;
}
