/**
 * Pure aggregation for the three productized dashboard boards (WP-5,
 * CaseLoad_CRM_Migration_Plan_v1.md §6.1 note 3: "Ship three productized
 * default boards (Triage, Pipeline, Health) with role-scoped visibility, and
 * let each lawyer Save-As a personal copy"). "View" is the query primitive;
 * these three functions ARE the views the saved dashboard_views rows bind to.
 *
 * No I/O. The route (api/portal/[firmId]/boards) does the Supabase reads and
 * passes rows into these.
 */

export type Band = 'A' | 'B' | 'C' | 'D' | null;

export interface TriageRow {
  band: Band;
  decision_deadline: string | null;
  submitted_at: string;
}

export interface TriageBoard {
  total: number;
  bandCounts: Record<string, number>; // 'A'|'B'|'C'|'D'|'unrated' -> count
  overdueCount: number; // decision_deadline already passed
  dueSoonCount: number; // decision_deadline within the next 12h
  agingBuckets: { under4h: number; between4And24h: number; over24h: number };
}

/**
 * Triage board: queue health for the operator's daily attention. `now`
 * injectable for tests; defaults to the current time.
 */
export function computeTriageBoard(rows: TriageRow[], now: Date = new Date()): TriageBoard {
  const bandCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, unrated: 0 };
  let overdueCount = 0;
  let dueSoonCount = 0;
  const agingBuckets = { under4h: 0, between4And24h: 0, over24h: 0 };
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  for (const r of rows) {
    const key = r.band ?? 'unrated';
    bandCounts[key] = (bandCounts[key] ?? 0) + 1;

    if (r.decision_deadline) {
      const deadline = new Date(r.decision_deadline).getTime();
      if (deadline <= now.getTime()) overdueCount += 1;
      else if (deadline - now.getTime() <= twelveHoursMs) dueSoonCount += 1;
    }

    const ageMs = now.getTime() - new Date(r.submitted_at).getTime();
    if (ageMs <= fourHoursMs) agingBuckets.under4h += 1;
    else if (ageMs <= twentyFourHoursMs) agingBuckets.between4And24h += 1;
    else agingBuckets.over24h += 1;
  }

  return { total: rows.length, bandCounts, overdueCount, dueSoonCount, agingBuckets };
}

export type MatterStage = 'intake' | 'retainer_pending' | 'active' | 'closing' | 'closed';

export interface PipelineMatterRow {
  matter_stage: MatterStage;
  matter_stage_changed_at: string;
  created_at: string;
}

export interface PipelineBoard {
  total: number;
  stageCounts: Record<MatterStage, number>;
  avgDaysInCurrentStage: Record<MatterStage, number | null>;
  promotionRate: number | null; // matters that reached at least 'active' / total
}

const STAGE_KEYS: MatterStage[] = ['intake', 'retainer_pending', 'active', 'closing', 'closed'];

/**
 * Pipeline board: matters by stage plus how long each has sat in its current
 * stage (a proxy for full historical time-in-stage, computed from the single
 * matter_stage_changed_at timestamp rather than the full matter_stage_events
 * history, which keeps this a query over client_matters alone).
 */
export function computePipelineBoard(rows: PipelineMatterRow[], now: Date = new Date()): PipelineBoard {
  const stageCounts = Object.fromEntries(STAGE_KEYS.map((s) => [s, 0])) as Record<MatterStage, number>;
  const stageDaysSum = Object.fromEntries(STAGE_KEYS.map((s) => [s, 0])) as Record<MatterStage, number>;

  for (const r of rows) {
    stageCounts[r.matter_stage] += 1;
    const days = (now.getTime() - new Date(r.matter_stage_changed_at).getTime()) / (24 * 60 * 60 * 1000);
    stageDaysSum[r.matter_stage] += days;
  }

  const avgDaysInCurrentStage = Object.fromEntries(
    STAGE_KEYS.map((s) => [s, stageCounts[s] > 0 ? stageDaysSum[s] / stageCounts[s] : null]),
  ) as Record<MatterStage, number | null>;

  const promoted = rows.filter((r) => r.matter_stage !== 'intake').length;
  const promotionRate = rows.length > 0 ? promoted / rows.length : null;

  return { total: rows.length, stageCounts, avgDaysInCurrentStage, promotionRate };
}

export interface HealthConsentRow {
  email_consent_status: string;
}
export interface HealthChannelRow {
  channel: string | null;
}
export interface HealthBoard {
  totalLeads: number;
  consentCoverageRate: number | null; // share with email_consent_status in (explicit, implied)
  channelMix: Array<{ channel: string; count: number }>;
  shadowCadenceVolume: number; // count of outbound_messages rows (shadow ledger size)
  notificationFailureCount: number;
}

/**
 * Health board: system-level signal, not lead-level. Reads span four tables
 * (screened_leads for consent + channel, outbound_messages for shadow
 * volume, notification_outbox for failures); the route fetches each
 * separately and this just tallies.
 */
export function computeHealthBoard(input: {
  consentRows: HealthConsentRow[];
  channelRows: HealthChannelRow[];
  shadowMessageCount: number;
  notificationFailureCount: number;
}): HealthBoard {
  const consentedCount = input.consentRows.filter(
    (r) => r.email_consent_status === 'explicit' || r.email_consent_status === 'implied',
  ).length;
  const consentCoverageRate = input.consentRows.length > 0 ? consentedCount / input.consentRows.length : null;

  const channelCounts = new Map<string, number>();
  for (const r of input.channelRows) {
    const key = r.channel ?? 'web';
    channelCounts.set(key, (channelCounts.get(key) ?? 0) + 1);
  }
  const channelMix = Array.from(channelCounts.entries())
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLeads: input.consentRows.length,
    consentCoverageRate,
    channelMix,
    shadowCadenceVolume: input.shadowMessageCount,
    notificationFailureCount: input.notificationFailureCount,
  };
}
