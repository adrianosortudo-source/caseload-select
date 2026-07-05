/**
 * Matter activity timeline (WP-9, CaseLoad_CRM_Migration_Plan_v1.md §11
 * "360 brief card on one polymorphic activity timeline"). Server component:
 * renders whatever readActivities() (crm-dual-read.ts) returns, which is
 * already the canonical activities table when populated (WP-2's dual-write
 * hooks) or a derived aggregate of matter_promotion_events + matter_stage_events
 * + matter_messages when it is not. No new query here; this is the first UI
 * consumer of that already-shipped read layer.
 */

import { readActivities, type MatterActivity } from '@/lib/crm-dual-read';
import { formatTimestamp } from '@/lib/firm-timezone';

const TYPE_LABEL: Record<MatterActivity['activity_type'], string> = {
  intake: 'Intake',
  stage_change: 'Stage change',
  message: 'Message',
  conflict_check: 'Conflict check',
  promotion: 'Promotion',
};

export default async function ActivityTimeline({ firmId, matterId }: { firmId: string; matterId: string }) {
  const activities = await readActivities(matterId, firmId);

  if (activities.length === 0) {
    return <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>No activity recorded yet.</p>;
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid rgba(30,47,88,0.15)' }}>
      {activities.map((a) => (
        <li key={a.id} style={{ position: 'relative', paddingLeft: 18, paddingBottom: 14 }}>
          <span
            style={{
              position: 'absolute', left: -5, top: 4, width: 8, height: 8, borderRadius: '50%',
              background: '#1E2F58',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: '#8a7a5c' }}>
              {TYPE_LABEL[a.activity_type] ?? a.activity_type}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{formatTimestamp(a.occurred_at)}</span>
          </div>
          <p style={{ fontSize: 13, color: '#1E2F58', margin: '2px 0 0', fontWeight: 600 }}>{a.title}</p>
          {a.body && <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', margin: '2px 0 0' }}>{a.body}</p>}
        </li>
      ))}
    </ol>
  );
}
