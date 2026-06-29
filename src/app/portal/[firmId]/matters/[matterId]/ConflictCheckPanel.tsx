'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type CheckStatus = 'pending' | 'potential' | 'cleared' | 'waived' | 'blocked';

interface ConflictCheck {
  id: string;
  check_status: CheckStatus;
  check_type: string;
  disposition: string | null;
  dispositioned_by: string | null;
  dispositioned_at: string | null;
  notes: string | null;
  created_at: string;
}

interface Props {
  firmId: string;
  matterId: string;
  screened_lead_id: string;
  existingCheck: ConflictCheck | null;
}

const STATUS_STYLE: Record<CheckStatus, { bg: string; text: string; label: string }> = {
  pending:   { bg: '#FEF3C7', text: '#92400E', label: 'Pending review' },
  potential: { bg: '#FEE2E2', text: '#991B1B', label: 'Potential conflict' },
  cleared:   { bg: '#D1FAE5', text: '#065F46', label: 'Cleared' },
  waived:    { bg: '#DBEAFE', text: '#1E40AF', label: 'Waived' },
  blocked:   { bg: '#FEE2E2', text: '#7F1D1D', label: 'BLOCKED' },
};

export function ConflictCheckPanel({ firmId, matterId, screened_lead_id, existingCheck }: Props) {
  const router = useRouter();
  const [check, setCheck] = useState<ConflictCheck | null>(existingCheck);
  const [creating, startCreate] = useTransition();
  const [dispositioning, startDisposition] = useTransition();
  const [disposition, setDisposition] = useState<'cleared' | 'waived' | 'blocked'>('cleared');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function createCheck() {
    setError(null);
    startCreate(async () => {
      const res = await fetch(`/api/portal/${firmId}/conflict-checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matter_id: matterId, screened_lead_id, check_type: 'manual' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to create conflict check');
        return;
      }
      setCheck(json.check);
      router.refresh();
    });
  }

  async function disposeCheck() {
    if (!check) return;
    setError(null);
    startDisposition(async () => {
      const res = await fetch(`/api/portal/${firmId}/conflict-checks/${check.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to disposition check');
        return;
      }
      setCheck(json.check);
      setNotes('');
      router.refresh();
    });
  }

  const style = check ? STATUS_STYLE[check.check_status] : null;
  const needsAction = check && (check.check_status === 'pending' || check.check_status === 'potential');

  return (
    <section style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 6, padding: '20px 24px', marginBottom: 20 }}>
      <p style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 10 }}>
        Conflict Check
      </p>

      {!check ? (
        <div>
          <p style={{ fontSize: '0.88rem', color: '#666', marginBottom: 14 }}>
            No conflict check on file for this matter. A check must be completed before advancing to{' '}
            <strong>Retainer pending</strong> or <strong>Active</strong>.
          </p>
          <button
            onClick={createCheck}
            disabled={creating}
            style={{
              background: '#1E2F58', color: '#fff', border: 'none', borderRadius: 4,
              padding: '8px 16px', fontSize: '0.84rem', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? 'Creating…' : 'Create conflict check'}
          </button>
          {error && <p style={{ color: '#B91C1C', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 700,
              background: style?.bg, color: style?.text,
            }}>
              {style?.label}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              {check.check_type} · created {new Date(check.created_at).toLocaleDateString('en-CA')}
            </span>
            {check.dispositioned_by && (
              <span style={{ fontSize: '0.8rem', color: '#888' }}>
                · by {check.dispositioned_by} on {new Date(check.dispositioned_at!).toLocaleDateString('en-CA')}
              </span>
            )}
          </div>

          {check.notes && (
            <p style={{ fontSize: '0.84rem', color: '#555', marginBottom: 12, fontStyle: 'italic' }}>
              &ldquo;{check.notes}&rdquo;
            </p>
          )}

          {check.check_status === 'blocked' && (
            <p style={{ fontSize: '0.84rem', color: '#7F1D1D', background: '#FEE2E2', borderRadius: 4, padding: '8px 12px' }}>
              This matter is blocked. A conflict was identified and cannot be waived without a written consent record.
              Contact the operator to resolve.
            </p>
          )}

          {needsAction && (
            <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 14, marginTop: 14 }}>
              <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#333', marginBottom: 10 }}>
                Disposition this check
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {(['cleared', 'waived', 'blocked'] as const).map((d) => (
                  <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.84rem' }}>
                    <input
                      type="radio"
                      name="disposition"
                      value={d}
                      checked={disposition === d}
                      onChange={() => setDisposition(d)}
                    />
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </label>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)…"
                rows={2}
                style={{
                  width: '100%', borderRadius: 4, border: '1px solid rgba(0,0,0,0.15)',
                  padding: '6px 10px', fontSize: '0.84rem', resize: 'vertical',
                  marginBottom: 10, boxSizing: 'border-box',
                }}
              />
              <button
                onClick={disposeCheck}
                disabled={dispositioning}
                style={{
                  background: disposition === 'blocked' ? '#B91C1C' : '#1E2F58',
                  color: '#fff', border: 'none', borderRadius: 4,
                  padding: '8px 16px', fontSize: '0.84rem', fontWeight: 600,
                  cursor: dispositioning ? 'not-allowed' : 'pointer',
                  opacity: dispositioning ? 0.6 : 1,
                }}
              >
                {dispositioning ? 'Saving…' : `Mark as ${disposition}`}
              </button>
              {error && <p style={{ color: '#B91C1C', fontSize: '0.82rem', marginTop: 8 }}>{error}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
