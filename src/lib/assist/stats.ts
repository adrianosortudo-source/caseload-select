/**
 * I/O wrapper for Firm Assist weekly stats. Feeds the operator console
 * (Phase 4) and, later, the weekly reporting system.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { summarizeAssistQueries, type AssistWeeklyStats } from './stats-pure';

export async function getAssistWeeklyStats(firmId: string, since: Date): Promise<AssistWeeklyStats> {
  const { data } = await supabase
    .from('assist_queries')
    .select('question, exit_type')
    .eq('firm_id', firmId)
    .gte('created_at', since.toISOString());

  return summarizeAssistQueries(data ?? []);
}
