"use client";

import { useState } from "react";

interface TouchCount {
  sent: number;
  total: number;
}

interface ReviewRow {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_email: string | null;
  firm_name: string;
  status: string;
  created_at: string;
  touches: TouchCount;
}

function TouchPips({ touches }: { touches: TouchCount }) {
  return (
    <div className="flex items-center gap-1" title={`${touches.sent} of ${touches.total} touches sent`}>
      {Array.from({ length: touches.total }).map((_, i) => (
        <span
          key={i}
          className={`inline-block w-2 h-2 rounded-full ${
            i < touches.sent ? "bg-gold" : "bg-black/10"
          }`}
        />
      ))}
      <span className="text-[11px] text-black/40 ml-1">
        {touches.sent}/{touches.total}
      </span>
    </div>
  );
}

function statusBadge(status: string) {
  if (status === "completed") {
    return <span className="badge bg-emerald-50 text-emerald-700">Reviewed</span>;
  }
  if (status === "pending") {
    return <span className="badge bg-black/5 text-black/50">Pending</span>;
  }
  return <span className="badge bg-gold/10 text-amber-700 capitalize">{status}</span>;
}

export default function ReviewsClient({ reviews: initial }: { reviews: ReviewRow[] }) {
  const [reviews, setReviews] = useState(initial);
  const [marking, setMarking] = useState<string | null>(null);

  async function markCompleted(id: string, leadId: string) {
    setMarking(id);
    try {
      const res = await fetch(`/api/leads/${leadId}/review/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ review_request_id: id }),
      });
      if (res.ok) {
        setReviews((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "completed" } : r))
        );
      } else {
        alert("Failed to mark as completed.");
      }
    } finally {
      setMarking(null);
    }
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
          <tr>
            <th className="text-left px-4 py-3">Lead</th>
            <th className="text-left">Firm</th>
            <th className="text-left">Touches</th>
            <th className="text-left">Status</th>
            <th className="text-right px-4">Triggered</th>
            <th className="text-right px-4">Action</th>
          </tr>
        </thead>
        <tbody>
          {reviews.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-black/40">
                No review requests yet. They trigger automatically on Client Won.
              </td>
            </tr>
          )}
          {reviews.map((r) => (
            <tr key={r.id} className="border-b border-black/5">
              <td className="px-4 py-3">
                <div className="font-medium">{r.lead_name}</div>
                {r.lead_email && (
                  <div className="text-xs text-black/40">{r.lead_email}</div>
                )}
              </td>
              <td className="text-black/60">{r.firm_name}</td>
              <td>
                <TouchPips touches={r.touches} />
              </td>
              <td>{statusBadge(r.status)}</td>
              <td className="text-right px-4 text-black/50 text-xs">
                {new Date(r.created_at).toLocaleDateString("en-CA")}
              </td>
              <td className="text-right px-4">
                {r.status !== "completed" ? (
                  <button
                    onClick={() => markCompleted(r.id, r.lead_id)}
                    disabled={marking === r.id}
                    className="text-xs px-2.5 py-1 rounded border border-black/15 text-black/50 hover:bg-black/5 disabled:opacity-40"
                  >
                    {marking === r.id ? "Saving..." : "Mark reviewed"}
                  </button>
                ) : (
                  <span className="text-xs text-black/30">Done</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
