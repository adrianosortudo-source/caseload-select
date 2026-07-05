'use client';

import { useState } from 'react';

export default function RequestReviewButton({ firmId, matterId }: { firmId: string; matterId: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'already' | 'error'>('idle');

  async function handleClick() {
    setStatus('sending');
    try {
      const res = await fetch(`/api/portal/${firmId}/matters/${matterId}/request-review`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'request failed');
      setStatus(json.alreadyEnrolled ? 'already' : 'done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        onClick={handleClick}
        disabled={status === 'sending' || status === 'done' || status === 'already'}
        style={{
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          background: status === 'done' || status === 'already' ? 'rgba(0,0,0,0.06)' : '#1E2F58',
          color: status === 'done' || status === 'already' ? 'rgba(0,0,0,0.5)' : '#fff',
          border: 'none',
          cursor: status === 'sending' ? 'default' : 'pointer',
        }}
      >
        {status === 'sending' ? 'Requesting...' : status === 'done' ? 'Review requested' : status === 'already' ? 'Already requested' : 'Request review'}
      </button>
      {status === 'error' && <span style={{ fontSize: 12, color: '#b91c1c' }}>Something went wrong. Try again.</span>}
    </div>
  );
}
