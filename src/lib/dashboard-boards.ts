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
  const [triageRows, matterRows, consentRows, channelRows, shadowCount, notificationFailureCount] = await Promise.all([
    supabase.from('screened_leads').select('band, decision_deadline, submitted_at').eq('firm_id', firmId).eq('status', 'triaging').then((r) => r.data ?? []),
    supabase.from('client_matters').select('matter_stage, matter_stage_changed_at, created_at').eq('firm_id', firmId).then((r) => r.data ?? []),
    supabase.from('screened_leads').select('email_consent_status').eq('firm_id', firmId).then((r) => r.data ?? []),
    supabase.from('screened_leads').select('channel').eq('firm_id', firmId).then((r) => r.data ?? []),
    supabase.from('outbound_messages').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).then((r) => r.count ?? 0),
    supabase.from('notification_outbox').select('id', { count: 'exact', head: true }).eq('firm_id', firmId).eq('status', 'failed').then((r) => r.count ?? 0),
  ]);

  return {
    triage: computeTriageBoard(triageRows as never),
    pipeline: computePipelineBoard(matterRows as never),
    health: computeHealthBoard({
      consentRows: consentRows as never,
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
  let query = supabase.from('dashboard_views').select('*').eq('firm_id', firmId);
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
