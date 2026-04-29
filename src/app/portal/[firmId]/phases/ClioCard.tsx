/**
 * ClioCard  -  ACTS Phase A (Authority) live card.
 *
 * Shows Clio Manage connection status for the firm.
 *
 * Connected: displays matter count + last 5 matters with status badges.
 * Not connected: muted card with a "Connect Clio" action link.
 *
 * Server component  -  data is fetched in phases/page.tsx and passed as props.
 */

import type { ClioMatter } from "@/lib/clio";

const STATUS_COLORS: Record<string, string> = {
  open:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  closed: "bg-black/5 text-black/50 border-black/10",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

function statusClass(status: string) {
  return STATUS_COLORS[status?.toLowerCase()] ?? "bg-black/5 text-black/40 border-black/10";
}

interface Props {
  connected: boolean;
  firmId: string;
  matters: ClioMatter[];
  matterCount: number | null;
}

export default function ClioCard({ connected, firmId, matters, matterCount }: Props) {
  if (!connected) {
    return (
      <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 space-y-4 opacity-70">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-black/40">Phase A</div>
            <div className="text-base font-bold text-black/50 mt-0.5">Authority</div>
          </div>
          <span className="text-xs bg-black/5 text-black/40 border border-black/10 rounded-full px-2 py-0.5 font-medium">
            Not connected
          </span>
        </div>

        <div className="rounded-lg bg-black/[0.03] border border-black/5 px-4 py-5 text-center space-y-3">
          <p className="text-xs text-black/50 leading-relaxed">
            Connect your Clio Manage account to see matter activity, track signed files, and sync client data directly in this portal.
          </p>
          <a
            href={`/api/clio/connect?firm_id=${firmId}`}
            className="inline-block text-xs font-semibold bg-navy text-white rounded-lg px-4 py-2 hover:opacity-90 transition-opacity"
          >
            Connect Clio
          </a>
        </div>

        <div className="space-y-2">
          {[70, 50, 35].map((w, i) => (
            <div key={i} className="h-2.5 rounded-full bg-black/5" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-black/40">Phase A</div>
          <div className="text-base font-bold text-navy mt-0.5">Authority</div>
        </div>
        <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
          Clio Connected
        </span>
      </div>

      {/* Matter count summary */}
      {matterCount !== null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-2xl font-bold text-navy">{matterCount}</span>
          <span className="text-black/50 text-xs leading-tight">active<br />matters</span>
        </div>
      )}

      {/* Recent matters */}
      {matters.length === 0 ? (
        <div className="text-xs text-black/40 py-2">No matters found in Clio.</div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-medium text-black/60 mb-1">Recent Matters</div>
          {matters.map((m) => (
            <div
              key={m.id}
              className="flex items-start justify-between gap-2 py-2 border-b border-black/5 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-navy truncate">
                  {m.display_number}
                  {m.client?.name && (
                    <span className="font-normal text-black/60"> · {m.client.name}</span>
                  )}
                </div>
                {m.description && (
                  <div className="text-xs text-black/40 truncate mt-0.5">{m.description}</div>
                )}
              </div>
              <span
                className={`shrink-0 text-xs border rounded-full px-2 py-0.5 capitalize ${statusClass(m.status)}`}
              >
                {m.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-black/5 pt-3 flex items-center justify-between">
        <span className="text-xs text-black/40">Powered by Clio Manage v4</span>
        <a
          href={`/api/clio/connect?firm_id=${firmId}`}
          className="text-xs text-navy/70 hover:text-navy underline underline-offset-2"
        >
          Reconnect
        </a>
      </div>
    </div>
  );
}
