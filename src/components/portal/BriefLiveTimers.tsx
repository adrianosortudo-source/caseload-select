"use client";

import { useEffect } from "react";
import { snapshot, baselineHoursFromSubmit, type TimerUrgency } from "@/lib/decision-timer";

interface Props {
  /**
   * CSS selector for the wrapper that contains the server-rendered brief HTML.
   * The hydrator scopes its DOM scan to descendants of this element so it
   * never reaches into unrelated parts of the page.
   */
  scopeSelector?: string;
}

/**
 * BriefLiveTimers — hydrates server-rendered live-timer placeholders.
 *
 * The brief HTML is rendered server-side at intake time and stored verbatim
 * in `screened_leads.brief_html`. The decision-window timer placeholders are
 * emitted as `<span class="brief-live-timer" data-deadline-iso="..." data-submitted-at="...">`
 * with a static "window length at submit" string as their initial text. At
 * view time (potentially many hours after the brief was rendered) the static
 * value is no longer accurate.
 *
 * This component mounts once after the brief is hydrated, finds every
 * `.brief-live-timer` inside the configured scope, and replaces its inner
 * text with the running countdown ("23h 12m" / "47m" / "expired"). A
 * 30-second `setInterval` re-snapshots so the displayed value ticks.
 *
 * Visual treatment: the component adds one of `timer-warning` /
 * `timer-critical` / `timer-expired` classes based on the urgency tier. CSS
 * in `brief.css` paints those classes amber / red / red respectively.
 *
 * No React tree manipulation. Pure DOM textContent + classList. Safe inside
 * a dangerouslySetInnerHTML-rendered brief because we touch existing nodes
 * rather than mounting new ones.
 *
 * The tick cadence matches DecisionTimer.tsx (30s). Displayed precision is
 * minutes, so sub-minute ticks would just churn the DOM with no visible
 * change.
 */
export default function BriefLiveTimers({ scopeSelector = ".brief-frame" }: Props) {
  useEffect(() => {
    const scope = typeof document !== "undefined" ? document.querySelector(scopeSelector) : null;
    if (!scope) return;

    const tick = () => {
      const now = new Date();
      const nodes = scope.querySelectorAll<HTMLElement>(".brief-live-timer[data-deadline-iso]");
      nodes.forEach((el) => {
        const deadlineIso = el.dataset.deadlineIso;
        const submittedAtIso = el.dataset.submittedAt ?? "";
        if (!deadlineIso) return;
        try {
          const baseline = submittedAtIso
            ? baselineHoursFromSubmit(submittedAtIso, deadlineIso)
            : 48;
          const snap = snapshot(deadlineIso, now, baseline);
          el.textContent = snap.remainingLabel;
          // Reset urgency tier classes, then apply the current one.
          el.classList.remove("timer-ok", "timer-warning", "timer-critical", "timer-expired");
          const tierClass = urgencyToClass(snap.urgency);
          el.classList.add(tierClass);
        } catch {
          // Silent — leave the static fallback in place if anything throws.
        }
      });
    };

    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [scopeSelector]);

  return null;
}

function urgencyToClass(urgency: TimerUrgency): string {
  switch (urgency) {
    case "expired":
      return "timer-expired";
    case "critical":
      return "timer-critical";
    case "warning":
      return "timer-warning";
    default:
      return "timer-ok";
  }
}
