'use client';

import { useState } from 'react';
import type { AllBoards, DashboardView } from '@/lib/dashboard-boards';

type BoardKey = 'triage' | 'pipeline' | 'health';

const TAB_LABEL: Record<BoardKey, string> = { triage: 'Triage', pipeline: 'Pipeline', health: 'Health' };

export default function BoardTabs({
  firmId,
  boards,
  savedViews,
}: {
  firmId: string;
  boards: AllBoards;
  savedViews: DashboardView[];
}) {
  const [active, setActive] = useState<BoardKey>('triage');
  const [viewName, setViewName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSaveAs() {
    const name = viewName.trim();
    if (!name) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/portal/${firmId}/boards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_key: active, name, filters: {} }),
      });
      if (!res.ok) throw new Error('save failed');
      setSaveStatus('saved');
      setViewName('');
    } catch {
      setSaveStatus('error');
    }
  }

  const viewsForActiveBoard = savedViews.filter((v) => v.board_key === active);

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {(['triage', 'pipeline', 'health'] as BoardKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: 'transparent',
              border: 'none',
              borderBottom: active === key ? '2px solid #1E2F58' : '2px solid transparent',
              color: active === key ? '#1E2F58' : 'rgba(0,0,0,0.5)',
              cursor: 'pointer',
            }}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {active === 'triage' && <TriageBoardView board={boards.triage} />}
      {active === 'pipeline' && <PipelineBoardView board={boards.pipeline} />}
      {active === 'health' && <HealthBoardView board={boards.health} />}

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        {viewsForActiveBoard.length > 0 && (
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>
            Saved views: {viewsForActiveBoard.map((v) => v.name).join(', ')}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Name this view..."
            style={{ padding: '6px 10px', fontSize: 13, border: '1px solid rgba(0,0,0,0.15)', flex: 1, maxWidth: 240 }}
          />
          <button
            onClick={handleSaveAs}
            disabled={saveStatus === 'saving' || !viewName.trim()}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
              background: '#1E2F58', color: '#fff', border: 'none', cursor: 'pointer',
              opacity: saveStatus === 'saving' || !viewName.trim() ? 0.5 : 1,
            }}
          >
            Save as
          </button>
          {saveStatus === 'saved' && <span style={{ fontSize: 12, color: '#166534', alignSelf: 'center' }}>Saved</span>}
          {saveStatus === 'error' && <span style={{ fontSize: 12, color: '#b91c1c', alignSelf: 'center' }}>Failed</span>}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.1)', padding: '12px 16px', minWidth: 140 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(0,0,0,0.5)', fontWeight: 700 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: '#1E2F58', marginTop: 4 }}>{value}</p>
    </div>
  );
}

function TriageBoardView({ board }: { board: AllBoards['triage'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <Tile label="In queue" value={board.total} />
      <Tile label="Band A" value={board.bandCounts.A ?? 0} />
      <Tile label="Band B" value={board.bandCounts.B ?? 0} />
      <Tile label="Overdue" value={board.overdueCount} />
      <Tile label="Due within 12h" value={board.dueSoonCount} />
      <Tile label="Over 24h old" value={board.agingBuckets.over24h} />
    </div>
  );
}

function PipelineBoardView({ board }: { board: AllBoards['pipeline'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <Tile label="Open matters" value={board.total} />
      <Tile label="Intake" value={board.stageCounts.intake} />
      <Tile label="Retainer pending" value={board.stageCounts.retainer_pending} />
      <Tile label="Active" value={board.stageCounts.active} />
      <Tile label="Closing" value={board.stageCounts.closing} />
      <Tile
        label="Promotion rate"
        value={board.promotionRate === null ? '–' : `${Math.round(board.promotionRate * 100)}%`}
      />
    </div>
  );
}

function HealthBoardView({ board }: { board: AllBoards['health'] }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Tile label="Total leads" value={board.totalLeads} />
        <Tile
          label="Consent coverage"
          value={board.consentCoverageRate === null ? '–' : `${Math.round(board.consentCoverageRate * 100)}%`}
        />
        <Tile label="Shadow cadence volume" value={board.shadowCadenceVolume} />
        <Tile label="Notification failures" value={board.notificationFailureCount} />
      </div>
      {board.channelMix.length > 0 && (
        <div>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
            Channel mix
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {board.channelMix.map((c) => (
              <li key={c.channel} style={{ fontSize: 13, padding: '4px 0', display: 'flex', justifyContent: 'space-between', maxWidth: 240 }}>
                <span style={{ textTransform: 'capitalize' }}>{c.channel}</span>
                <span style={{ fontWeight: 600 }}>{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
