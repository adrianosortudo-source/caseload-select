"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh-on-focus for server-rendered pages. The triage queue uses this so
 * a lawyer who returns to the tab sees current state without a full reload.
 *
 * Phase 3 hardening upgrades this to a Supabase Realtime subscription on
 * `screened_leads` filtered by firm_id. Focus-refresh is the MVP because
 * triage volume per firm is low (single-digit leads/day) and real-time
 * doesn't justify its weight at that scale.
 *
 * Throttle: at most one refresh per 2s, so rapid tab-switching doesn't
 * hammer the queue endpoint.
 */
export default function RefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - last < 2000) return;
      last = now;
      router.refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onFocus();
    });
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  return null;
}
