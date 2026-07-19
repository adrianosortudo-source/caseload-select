"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NotificationPreference, StandingAuthorizationEvent } from "@/lib/standing-publishing-authorization";

/**
 * "How your content works" primary control: turn standing publishing
 * authorization on or off. Confirmation is inline (not a dialog), matching
 * this portal's existing SignOffPanel pattern -- an exact-wording box plus
 * an unchecked confirmation checkbox that must be ticked before the
 * primary action enables.
 *
 * Lawyer sessions get the full interactive card. Operator sessions get a
 * read-only summary only: operators cannot enable or disable standing
 * authorization for a client (enforced independently at the API route and
 * the database RPC), so no control here should even suggest they can.
 */
export default function StandingAuthorizationCard({
  firmId,
  firmName,
  viewerRole,
  active,
  latestEvent,
}: {
  firmId: string;
  firmName: string;
  viewerRole: "lawyer" | "operator";
  active: boolean;
  latestEvent: StandingAuthorizationEvent | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"on" | "off" | null>(null);
  const [notificationPreference, setNotificationPreference] = useState<NotificationPreference>("weekly_digest");
  const [agreed, setAgreed] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorizationText = `By turning this on, you authorize CaseLoad Select to publish future ${firmName} content after it passes the agreed quality and legal-safety checks, without waiting for your individual review of every item. It does not waive consent verification, legal review, live-link verification, sender verification, unsubscribe requirements, or capacity constraints: it only removes the need for your individual per-item review once those other checks are already satisfied. You may turn this off at any time. You can review published content later and request changes.`;

  function resetConfirmState() {
    setConfirming(null);
    setAgreed(false);
    setReason("");
    setError(null);
  }

  async function submitEnable() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/standing-authorization/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_preference: notificationPreference, agreed: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not turn this on.");
        return;
      }
      resetConfirmState();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDisable() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${firmId}/standing-authorization/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null, agreed: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not turn this off.");
        return;
      }
      resetConfirmState();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  if (viewerRole === "operator") {
    return (
      <section className="bg-white border-2 border-navy/15 rounded p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-2">
          <span
            aria-hidden
            className={`inline-block w-2.5 h-2.5 rounded-full ${active ? "bg-green-pass" : "bg-black/25"}`}
          />
          <h2 className="text-base font-bold text-navy">
            Standing publishing authorization is {active ? "on" : "off"}
          </h2>
        </div>
        {!active && (
          <h2 className="text-lg sm:text-xl font-bold text-navy mb-2">Choose how content approval works</h2>
        )}
        <p className="text-sm text-black/70 leading-relaxed mb-4">
          {active
            ? "Future eligible content may be published after it passes the agreed quality and legal-safety checks."
            : "The firm can authorize CaseLoad Select to publish future content after it passes the agreed quality and legal-safety checks."}
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-white bg-green-pass disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {active ? "Turn off authorization" : "Turn on standing publishing authorization"}
        </button>
        <p className="mt-3 text-xs text-black/55">
          This is a read-only operator preview. Only the firm&apos;s authorized lawyer/client
          decision-maker can use this control from their own portal session.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white border-2 border-navy/15 rounded p-5 sm:p-6">
      {!active ? (
        <>
          <h2 className="text-lg sm:text-xl font-bold text-navy mb-2">Choose how content approval works</h2>
          <p className="text-sm text-black/70 leading-relaxed mb-4">
            Review every item before publication, or authorize CaseLoad Select to publish future
            content after it passes the agreed quality and legal-safety checks.
          </p>

          {confirming !== "on" ? (
            <>
              <button
                type="button"
                onClick={() => setConfirming("on")}
                className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-white bg-green-pass"
              >
                Turn on standing publishing authorization
              </button>
              <p className="mt-3 text-xs text-black/55">
                You can turn this off at any time. You will still be able to review published
                content and request changes.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-black/70 leading-relaxed bg-parchment p-3 border border-border-brand">
                {authorizationText}
              </p>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold uppercase tracking-wider text-black/50 mb-1">
                  When published content goes live, notify me
                </legend>
                <label className="flex items-center gap-2 text-sm text-black/75">
                  <input
                    type="radio"
                    name="notification-preference"
                    checked={notificationPreference === "weekly_digest"}
                    onChange={() => setNotificationPreference("weekly_digest")}
                  />
                  Weekly digest (recommended)
                </label>
                <label className="flex items-center gap-2 text-sm text-black/75">
                  <input
                    type="radio"
                    name="notification-preference"
                    checked={notificationPreference === "per_publication"}
                    onChange={() => setNotificationPreference("per_publication")}
                  />
                  After every publication
                </label>
              </fieldset>

              <label className="flex items-start gap-2 text-sm text-black/75">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I understand and authorize this</span>
              </label>

              {error && <p className="text-xs text-red-fail">{error}</p>}

              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={resetConfirmState}
                  disabled={submitting}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-black/60 border border-border-brand disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitEnable}
                  disabled={!agreed || submitting}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-white bg-green-pass disabled:opacity-50"
                >
                  {submitting ? "Turning on..." : "I understand and authorize this"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full bg-green-pass" />
            <h2 className="text-lg sm:text-xl font-bold text-navy">Standing publishing authorization is on</h2>
          </div>
          <p className="text-sm text-black/70 leading-relaxed mb-4">
            Future eligible content may be published after it passes CaseLoad Select&apos;s quality
            and legal-safety checks. You can review it later and request changes at any time.
          </p>

          {latestEvent && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4 bg-parchment p-3 border border-border-brand">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-black/45">Active since</dt>
                <dd className="text-black/75">{new Date(latestEvent.effective_at).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-black/45">Authorized by</dt>
                <dd className="text-black/75">{latestEvent.actor_name}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-black/45">Policy version</dt>
                <dd className="text-black/75">{latestEvent.policy_version}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-black/45">Notifications</dt>
                <dd className="text-black/75">
                  {latestEvent.notification_preference === "per_publication"
                    ? "After every publication"
                    : "Weekly digest"}
                </dd>
              </div>
            </dl>
          )}

          {confirming !== "off" ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <button
                type="button"
                onClick={() => setConfirming("off")}
                className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-navy border border-navy/30"
              >
                Turn off authorization
              </button>
              <Link
                href={`/portal/${firmId}/how-your-content-works/authorization-history`}
                className="text-xs font-semibold uppercase tracking-wider text-navy hover:underline"
              >
                View authorization history
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-black/70 leading-relaxed bg-parchment p-3 border border-border-brand">
                Turning this off means content that has not yet been released will require
                individual approval. Previously published content will not be affected.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Note for the record (optional)"
                className="w-full border border-border-brand px-2 py-1.5 text-sm"
              />
              {error && <p className="text-xs text-red-fail">{error}</p>}
              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={resetConfirmState}
                  disabled={submitting}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-black/60 border border-border-brand disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitDisable}
                  disabled={submitting}
                  className="w-full sm:w-auto px-4 py-3 sm:py-2.5 text-sm font-semibold text-white bg-navy disabled:opacity-50"
                >
                  {submitting ? "Turning off..." : "Turn off authorization"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
