/**
 * PlaceholderCard — Muted phase card for Authority, Capture, Target.
 * Shown until BrightLocal / GA4 / Google Ads APIs are connected.
 */

const PHASE_LETTER: Record<string, string> = {
  Authority: "A",
  Capture:   "C",
  Target:    "T",
};

export default function PlaceholderCard({ phase }: { phase: string }) {
  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 space-y-4 opacity-60">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-black/40">
            Phase {PHASE_LETTER[phase] ?? phase[0]}
          </div>
          <div className="text-base font-bold text-black/50 mt-0.5">{phase}</div>
        </div>
        <span className="text-xs bg-black/5 text-black/40 border border-black/10 rounded-full px-2 py-0.5 font-medium">
          Pending
        </span>
      </div>

      <div className="rounded-lg bg-black/[0.03] border border-black/5 px-4 py-5 text-center">
        <div className="text-xs text-black/40 leading-relaxed">
          Connecting {phase} data. Your weekly report covers this phase until the live feed is active.
        </div>
      </div>

      {/* Visual placeholder bars */}
      <div className="space-y-2">
        {[70, 50, 35].map((w, i) => (
          <div key={i} className="h-2.5 rounded-full bg-black/5" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
