/**
 * /admin/agency-crm
 *
 * Operator-only. Layer B agency CRM: the operator's own pipeline for selling
 * CaseLoad Select retainers. Single-tenant; no client data. Auth is enforced by
 * the parent /admin layout (getOperatorSession + redirect).
 */
import { listProspects, listReminders, listDeals } from '@/lib/agency-crm';
import AgencyCrmClient from './AgencyCrmClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AgencyCrmPage() {
  const [prospects, reminders, deals] = await Promise.all([
    listProspects(),
    listReminders({ openOnly: true }),
    listDeals(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-gold">Operator console</p>
          <h1 className="text-2xl font-bold text-navy mt-1">Agency CRM</h1>
          <p className="text-sm text-black/50 mt-1">Your own pipeline for selling CaseLoad Select retainers.</p>
        </div>
        <div className="text-xs text-black/50 uppercase tracking-wider">
          {prospects.length} prospect{prospects.length === 1 ? '' : 's'}
        </div>
      </div>

      <AgencyCrmClient
        initialProspects={prospects}
        initialReminders={reminders}
        initialDeals={deals}
      />
    </div>
  );
}
