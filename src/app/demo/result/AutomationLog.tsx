"use client";

/**
 * AutomationLog  -  animated event log showing what fired after intake.
 *
 * Client component. Events are computed server-side and passed in,
 * so the animation reveals pre-built items rather than fetching.
 */

import { useEffect, useState } from "react";

export interface AutomationEvent {
  time: string;
  text: string;
  sub?: string;
  icon: "check" | "sms" | "alert" | "clock" | "mail" | "crm";
}

const ICON_MAP: Record<AutomationEvent["icon"], React.ReactNode> = {
  check: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  sms: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
    </svg>
  ),
  alert: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
    </svg>
  ),
  clock: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2"/>
    </svg>
  ),
  mail: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    </svg>
  ),
  crm: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
    </svg>
  ),
};

export default function AutomationLog({ events }: { events: AutomationEvent[] }) {
  const [visible, setVisible] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible >= events.length) { setDone(true); return; }
    const t = setTimeout(() => setVisible(v => v + 1), visible === 0 ? 400 : 320);
    return () => clearTimeout(t);
  }, [visible, events.length]);

  return (
    <div className="space-y-0">
      {events.slice(0, visible).map((ev, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2.5 border-b border-black/4 last:border-0 animate-fade-in"
          style={{ animation: "fadeSlideIn 0.25s ease both" }}
        >
          {/* Icon */}
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-emerald-600 bg-emerald-50">
            {ICON_MAP[ev.icon]}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">{ev.text}</span>
              <span className="text-[10px] text-gray-400 font-mono shrink-0">{ev.time}</span>
            </div>
            {ev.sub && (
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{ev.sub}</p>
            )}
          </div>
        </div>
      ))}

      {/* Pending pulses */}
      {!done && visible < events.length && (
        <div className="flex items-center gap-3 py-2.5">
          <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
          </div>
          <span className="text-xs text-gray-400 animate-pulse">Processing…</span>
        </div>
      )}

      {/* All done */}
      {done && (
        <div className="pt-3 flex items-center gap-2 text-xs text-emerald-600 font-medium">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          All automations fired successfully
        </div>
      )}

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
