"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Triage-queue auto-refresh — replaces the focus-only `RefreshOnFocus`
 * with three triggers:
 *
 *   1. Window focus / visibilitychange   (the original behaviour)
 *   2. 15-second interval poll WHILE the tab is visible
 *   3. Lightweight fingerprint check via the stream-check endpoint:
 *      only call router.refresh() when the count or latest_updated_at
 *      has changed since our last poll. Saves the heavier server-
 *      rendered page rebuild on idle ticks.
 *
 * Why polling instead of Supabase Realtime:
 *   screened_leads is RLS-forced to service-role-only (correct security
 *   posture). Browser Realtime would need either Supabase auth migration
 *   or an SSE relay on a Vercel function (timeout-fighting). Polling
 *   at 15s scales for the current single-digit-leads-per-firm-per-day
 *   volume and is one swap away from a real Realtime channel when the
 *   RLS posture changes.
 *
 * Throttles overall refresh frequency to once every 2 seconds across
 * all triggers, so rapid tab-switches or rapid Postgres updates don't
 * thrash the page.
 *
 * Configurable via props:
 *   - streamCheckUrl: which endpoint to hit for the fingerprint check.
 *     /api/portal/[firmId]/triage/stream-check for firm-scoped views;
 *     /api/admin/triage/stream-check for the operator console.
 *
 * Polling stops when the tab is hidden (visibilityState !== "visible"),
 * so a backgrounded tab does not generate request load.
 */
export default function TriageRefresh({
  streamCheckUrl,
  intervalMs = 15_000,
  throttleMs = 2_000,
}: {
  streamCheckUrl: string;
  intervalMs?: number;
  throttleMs?: number;
}): null {
  const router = useRouter();
  // Last fingerprint we observed. null means "we haven't checked yet" —
  // first observation establishes the baseline without triggering a
  // refresh (the page was just server-rendered).
  const lastFingerprint = useRef<string | null>(null);
  // Last time we actually fired router.refresh(), for the global throttle.
  const lastRefreshAt = useRef<number>(0);
  // Latest controller so unmount cancels any inflight check.
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function maybeRefresh(reason: string): void {
      const now = Date.now();
      if (now - lastRefreshAt.current < throttleMs) return;
      lastRefreshAt.current = now;
      // eslint-disable-next-line no-console
      console.debug(`[triage-refresh] refreshing (${reason})`);
      router.refresh();
    }

    async function checkFingerprint(): Promise<void> {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      // Cancel any prior in-flight request so we never race two polls.
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const res = await fetch(streamCheckUrl, { signal: controller.signal, cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          count?: number;
          latest_updated_at?: string | null;
        };
        const fingerprint = `${data.count ?? 0}:${data.latest_updated_at ?? "null"}`;
        if (lastFingerprint.current === null) {
          // First check — establish baseline without triggering refresh.
          lastFingerprint.current = fingerprint;
          return;
        }
        if (fingerprint !== lastFingerprint.current) {
          lastFingerprint.current = fingerprint;
          maybeRefresh("fingerprint change");
        }
      } catch {
        // Network error / abort — silent. We'll try again on the next
        // interval. Falls back to focus-refresh meanwhile.
      }
    }

    function onFocus(): void {
      // On focus, force a fingerprint check (which may trigger refresh)
      // AND fire an immediate router.refresh as a belt-and-braces measure
      // for the case where the user has been away for an extended period
      // and the fingerprint check happens to hit a network blip.
      void checkFingerprint();
      maybeRefresh("focus");
    }

    function onVisibility(): void {
      if (document.visibilityState === "visible") {
        onFocus();
        // Restart the interval if it had been stopped.
        if (intervalId === null) {
          intervalId = setInterval(checkFingerprint, intervalMs);
        }
      } else {
        // Pause polling while hidden.
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    // Kick off the interval if the page lands visible (it usually does).
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      intervalId = setInterval(checkFingerprint, intervalMs);
    }

    return () => {
      cancelled = true;
      inflight.current?.abort();
      if (intervalId !== null) clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, streamCheckUrl, intervalMs, throttleMs]);

  return null;
}
