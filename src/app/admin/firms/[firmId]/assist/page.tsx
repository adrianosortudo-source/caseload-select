/**
 * /admin/firms/[firmId]/assist
 *
 * Operator console for Firm Assist (DR-100, DR-101). Firm-scoped, same
 * shape as the routing console: firmId from the URL segment, auth
 * enforced by /admin/layout.tsx (getOperatorSession).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import AssistConsolePanel from '@/components/admin/AssistConsolePanel';
import type { AssistPage, AssistQueryLogRow } from '@/components/admin/AssistConsolePanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface FirmSlim {
  id: string;
  name: string | null;
  branding: { firm_name?: string } | null;
}

function firmDisplayName(f: { name: string | null; branding: { firm_name?: string } | null }): string {
  return f.branding?.firm_name ?? f.name ?? 'Unknown firm';
}

export default async function FirmAssistPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const { data: firm, error } = await supabase
    .from('intake_firms')
    .select('id, name, branding, custom_domain')
    .eq('id', firmId)
    .maybeSingle();

  if (error) return <ErrorState message={error.message} />;
  if (!firm) return <ErrorState message={`No firm found for id ${firmId}.`} />;

  const { data: pageRows } = await supabase
    .from('assist_corpus_pages')
    .select('id, url, title, include, exclude_reason, last_crawled_at, last_crawl_status')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false });

  const { data: queryRows } = await supabase
    .from('assist_queries')
    .select('id, question, intent, exit_type, latency_ms, created_at')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(100);

  const f = firm as unknown as FirmSlim & { custom_domain: string | null };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
        <h1 className="text-2xl font-bold text-navy mt-1">Firm Assist</h1>
        <p className="mt-1 text-sm text-black/60">{firmDisplayName(f)}</p>
      </div>

      <AssistConsolePanel
        firmId={f.id}
        customDomain={f.custom_domain}
        initialPages={(pageRows ?? []) as AssistPage[]}
        recentQueries={(queryRows ?? []) as AssistQueryLogRow[]}
      />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-red-200 px-6 py-6">
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}
