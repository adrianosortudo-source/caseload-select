"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DecisionCard } from "@/components/intake-v2/DecisionCard";
import { Shell } from "@/components/intake-v2/Shell";
import { TextCard } from "@/components/intake-v2/TextCard";
import type { ScreenItem } from "@/components/intake-v2/types";

type Question = {
  id: string;
  text: string;
  options: Array<{ value: string; label: string }>;
};

type View = {
  revision: number;
  status: string;
  question: Question | null;
};

const missingLinkMessage = "Open the link in the text message from your firm to continue.";

export function VoiceContinuation() {
  const token = useRef("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(true);

  async function load() {
    const response = await fetch("/api/voice-screen/continue", {
      headers: { Authorization: `Bearer ${token.current}` },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("This link is unavailable right now. Please contact the firm if you need help.");
    }

    setView(await response.json());
  }

  useEffect(() => {
    // The bearer token remains in the URL fragment until this component reads
    // it. Fragments never reach server access logs; then remove it from the
    // address bar and keep it only in memory for the rest of the journey.
    token.current ||= window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);

    if (!/^[A-Za-z0-9_-]{43}$/.test(token.current)) {
      setError(missingLinkMessage);
      setBusy(false);
      return;
    }

    void load()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "This link is unavailable right now.");
      })
      .finally(() => setBusy(false));
  }, []);

  async function save(value: string, skip = false, finish = false) {
    if (!view || busy) return;

    setBusy(true);
    setError("");

    try {
      const payload = finish
        ? { revision: view.revision, finish: true }
        : { revision: view.revision, slotId: view.question?.id, value, skip };
      const response = await fetch("/api/voice-screen/continue", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.current}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 409) {
        await load();
        setAnswer("");
        throw new Error("Your inquiry changed in another window. Please review the current question.");
      }

      if (!response.ok) {
        throw new Error("Your answer could not be saved. Please try again or contact the firm.");
      }

      setView(await response.json());
      setAnswer("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const item = useMemo<ScreenItem | null>(() => {
    if (!view?.question) return null;

    const hasOptions = view.question.options.length > 0;
    return {
      id: view.question.id,
      question: view.question.text,
      presentation: hasOptions ? "card" : "text",
      options: hasOptions ? view.question.options : undefined,
      placeholder: "Answer in your own words...",
    };
  }, [view?.question]);

  const completed = view?.status === "completed";
  const showQuestion = !!item && !completed;

  return (
    <Shell
      totalScreens={1}
      currentScreen={0}
      roundLabel="Continue your inquiry"
      onSkip={showQuestion ? () => void save("", true) : undefined}
    >
      <section className="flex flex-col gap-8 py-2" data-ui-component-content="voice-continuation-widget">
        <div className="flex flex-col gap-2.5">
          <p
            className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_58%,transparent)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="supporting"
          >
            Continue your inquiry
          </p>
          <h1
            className="text-[30px] sm:text-[34px] leading-[1.08] font-extrabold text-[var(--cls-text,#1E2F58)]"
            style={{ fontFamily: "var(--cls-font-display, Manrope, sans-serif)" }}
            data-ui-copy="heading"
          >
            Pick up where you left off.
          </h1>
          <p
            className="max-w-[60ch] text-[16px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="body"
          >
            We have the essentials from your call. Share only what you can. Please avoid confidential details or documents before the firm reviews your inquiry.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] leading-relaxed text-red-800"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="body"
          >
            {error}
          </p>
        )}

        {busy && !view && (
          <p
            role="status"
            className="text-[15px] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_65%,transparent)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="supporting"
          >
            Opening your inquiry...
          </p>
        )}

        {completed && (
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] bg-[var(--cls-surface,#FFFFFF)] px-6 py-7">
            <h2
              className="text-[24px] leading-tight font-extrabold text-[var(--cls-text,#1E2F58)]"
              style={{ fontFamily: "var(--cls-font-display, Manrope, sans-serif)" }}
              data-ui-copy="heading"
            >
              Thank you. Your answers are ready for the firm.
            </h2>
            <p
              className="mt-3 max-w-[58ch] text-[16px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
              style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
              data-ui-copy="body"
            >
              The firm can review the information you shared with your original callback request.
            </p>
          </div>
        )}

        {showQuestion && item.options?.length ? (
          <DecisionCard
            contained
            item={item}
            onChange={next => void save(Array.isArray(next) ? next.join(", ") : next)}
          />
        ) : showQuestion && item ? (
          <TextCard
            contained
            item={item}
            value={answer}
            onChange={setAnswer}
            onSubmit={() => void save(answer)}
            submitLabel="Save and continue"
          />
        ) : null}

        {view && !completed && (
          <button
            type="button"
            onClick={() => void save("", false, true)}
            disabled={busy}
            className="self-start rounded-full px-1 py-2 text-[14px] font-medium text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_72%,transparent)] underline decoration-[color-mix(in_srgb,var(--cls-text,#1E2F58)_35%,transparent)] underline-offset-4 transition hover:text-[var(--cls-text,#1E2F58)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
          >
            Finish with what I have shared
          </button>
        )}

        <p
          className="max-w-[64ch] text-[13px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
          style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
          data-ui-copy="supporting"
        >
          You can stop at any time. Reopen the link in your text message to continue while it remains valid. This form does not provide legal advice.
        </p>
      </section>
    </Shell>
  );
}