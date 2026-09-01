"use client";

/**
 * Notification status panel for a single firm_onboarding_intake row.
 *
 * Renders the current delivery state pulled from the row (sent / failed /
 * pending) and exposes a "Send again" button that hits
 * POST /api/admin/onboarding-submissions/[id]/retry-notification.
 *
 * Used by the admin detail page at /admin/onboarding-submissions/[id]. Sits
 * alongside the verification-doc panel as a sibling "operator action" block.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type RetryResult =
  | { ok: true; messageId: string | null; sentTo: string; attempts: number | null; notification_sent_at: string | null }
  | { ok: false; error: string; sentTo: string; attempts: number | null; notification_error: string | null; notification_last_attempt_at: string | null };

interface Props {
  submissionId: string;
  notificationSentAt: string | null;
  notificationError: string | null;
  notificationAttempts: number;
  notificationLastAttemptAt: string | null;
}

export function OnboardingNotificationPanel({
  submissionId,
  notificationSentAt,
  notificationError,
  notificationAttempts,
  notificationLastAttemptAt,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RetryResult | null>(null);
  const [optimisticSentAt, setOptimisticSentAt] = useState<string | null>(notificationSentAt);
  const [optimisticError, setOptimisticError] = useState<string | null>(notificationError);
  const [optimisticAttempts, setOptimisticAttempts] = useState<number>(notificationAttempts);

  async function onRetry() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/onboarding-submissions/${encodeURIComponent(submissionId)}/retry-notification`,
        { method: "POST" },
      );
      const json = (await res.json()) as RetryResult;
      setResult(json);
      if (json.ok) {
        setOptimisticSentAt(json.notification_sent_at ?? new Date().toISOString());
        setOptimisticError(null);
        setOptimisticAttempts(json.attempts ?? optimisticAttempts + 1);
      } else {
        setOptimisticError(json.notification_error ?? json.error);
        setOptimisticAttempts(json.attempts ?? optimisticAttempts + 1);
      }
      // Refresh the server-rendered detail page so adjacent surfaces pick
      // up the new state on the next interaction.
      router.refresh();
    } catch (err) {
      setResult({
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
        sentTo: "(unknown)",
        attempts: null,
        notification_error: null,
        notification_last_attempt_at: null,
      });
    } finally {
      setBusy(false);
    }
  }

  const status: "sent" | "failed" | "pending" =
    optimisticSentAt ? "sent" : optimisticError ? "failed" : "pending";

  const badge =
    status === "sent"
      ? { text: "Sent", className: "bg-emerald-100 text-emerald-900 border-emerald-300" }
      : status === "failed"
        ? { text: "Failed", className: "bg-red-50 text-red-900 border-red-300" }
        : { text: "Pending", className: "bg-amber-50 text-amber-900 border-amber-300" };

  return (
    <div className="mt-4 bg-parchment border border-gold/40 px-5 py-4">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-gold mb-3">
        Operator notification email
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={`inline-flex items-center font-bold text-[10px] uppercase tracking-wider px-2 py-1 border ${badge.className}`}
        >
          {badge.text}
        </span>
        <span className="text-xs text-black/60">
          {status === "sent" ? (
            <>Last sent {formatTime(optimisticSentAt)}</>
          ) : status === "failed" ? (
            <>Last attempt {formatTime(notificationLastAttemptAt)}</>
          ) : (
            <>Never attempted</>
          )}
          {optimisticAttempts > 0 ? (
            <span className="text-black/40 ml-2">
              · {optimisticAttempts} attempt{optimisticAttempts === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </div>

      {status === "failed" && optimisticError ? (
        <div className="mt-3 text-xs text-black/80 whitespace-pre-wrap bg-white border border-red-200 px-3 py-2 font-mono">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-red-700 mb-1 font-sans">
            Resend error
          </p>
          {optimisticError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Sending..." : status === "sent" ? "Send again" : "Send now"}
        </button>
        <p className="text-[10px] text-black/40 max-w-md">
          Re-sends the operator notification email for this submission. Uses
          the same builder as the original submit endpoint, with a [REPLAY]
          subject prefix and an in-body callout.
        </p>
      </div>

      {result ? (
        <div
          className={`mt-3 text-xs px-3 py-2 border ${
            result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          {result.ok ? (
            <>
              Sent to <code>{result.sentTo}</code>
              {result.messageId ? (
                <>
                  {" "}
                  · Resend id <code>{result.messageId}</code>
                </>
              ) : null}
            </>
          ) : (
            <>Failed: {result.error}</>
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
