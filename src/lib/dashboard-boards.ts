/**
 * I/O for the three productized dashboard boards (WP-5). Fetches the raw
 * rows each board needs and hands off to dashboard-boards-pure.ts.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  computeTriageBoard,
  computePipelineBoard,
  computeHealthBoard,
  type TriageBoard,
  type PipelineBoard,
  type HealthBoard,
} from '@/lib/dashboard-boards-pure';

export interface AllBoards {
  triage: TriageBoard;
  pipeline: PipelineBoard;
  health: HealthBoard;
}

export async function computeAllBoardsForFirm(firmId: string): Promise<AllBoards> {
  // Audit fix (2026-07-05): the original row-based consent read had no
  // .limit(), and PostgREST clamps un-limited selects at the project's
  // max-rows (Supabase default 1000), so the Health board's consent numbers
  // would silently freeze at 1000 once a firm passed 1000 leads. Consent
  // coverage is now two head-count queries, exact at any scale. The
  // remaining row-based reads (triage queue, matters, channel mix) carry an
  // explicit cap and are accurate for the solo/2-lawyer ICP; at genuine
  // scale the channel mix becomes sampled, and the durable fix there is a
  // grouped view or RPC, not a bigger cap.
  const ROW_CAP = 5000;
  const [triageRows, matterRows, totalLeads, consentedCount, channelRows, shadowCount, notificationFailureCount] = await Promise.all([
    supabase.from('screened_leads').select('band, decision_deadline, submitted_at').eq('firm_id', firmId).eq('status', 'triaging').limit(ROW_CAP).then((r) => r.data ?? []),
    supabase.from('client_matters').select('matter_stage, matter_stage_changed_at, created_at').eq('firm_id', firmId).limit(ROW_CAP).then((r) => r.data ?? []),
    supabase.from('screened_leads').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).then((r) => r.count ?? 0),
    supabase.from('screened_leads').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).in('email_consent_status', ['explicit', 'implied']).then((r) => r.count ?? 0),
    supabase.from('screened_leads').select('channel').eq('firm_id', firmId).limit(ROW_CAP).then((r) => r.data ?? []),
    supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).then((r) => r.count ?? 0),
    supabase.from('notification_outbox').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('status', 'failed').then((r) => r.count ?? 0),
  ]);

  return {
    triage: computeTriageBoard(triageRows as never),
    pipeline: computePipelineBoard(matterRows as never),
    health: computeHealthBoard({
      totalLeads: totalLeads as number,
      consentedCount: consentedCount as number,
      channelRows: channelRows as never,
      shadowMessageCount: shadowCount as number,
      notificationFailureCount: notificationFailureCount as number,
    }),
  };
}

export interface DashboardView {
  id: string;
  firm_id: string;
  owner: string | null;
  board_key: 'triage' | 'pipeline' | 'health';
  name: string;
  filters: Record<string, unknown>;
  is_default: boolean;
}

/** Saved views visible to this actor: firm-wide defaults plus their own. */
export async function listDashboardViews(firmId: string, owner: string | null): Promise<DashboardView[]> {
  const query = supabase.from('dashboard_views').select('*').eq('firm_id', firmId);
  const { data } = owner
    ? await query.or(`owner.is.null,owner.eq.${owner}`)
    : await query.is('owner', null);
  return (data ?? []) as DashboardView[];
}

export async function saveDashboardView(input: {
  firmId: string;
  owner: string | null;
  boardKey: 'triage' | 'pipeline' | 'health';
  name: string;
  filters: Record<string, unknown>;
}): Promise<{ ok: true; view: DashboardView } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('dashboard_views')
    .insert({
      firm_id: input.firmId,
      owner: input.owner,
      board_key: input.boardKey,
      name: input.name,
      filters: input.filters,
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, view: data as DashboardView };
}
