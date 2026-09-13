"use client";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DecisionCard } from "@/components/intake-v2/DecisionCard";
import { Shell } from "@/components/intake-v2/Shell";
import { TextCard } from "@/components/intake-v2/TextCard";
import { ContinuationSummary } from "./ContinuationSummary";
import type { ScreenItem } from "@/components/intake-v2/types";
import type { ContinuationView, ContinuationPayload } from "@/lib/voice-screen-continuation";

export interface ContinuationTransport {
  load(): Promise<ContinuationView>;
  save(payload: ContinuationPayload): Promise<ContinuationView>;
}

/** Production and isolated tests use this same caller component. */
export function ContinuationWidget({ transport }: { transport: ContinuationTransport }) {
  const [view, setView] = useState<ContinuationView | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try { setView(await transport.load()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Your inquiry could not be opened. Please try again."); }
    finally { setBusy(false); }
  }, [transport]);
  useEffect(() => { void load(); }, [load]);
  // A corrected situation or a refresh can select a different question. Keep
  // drafts through same-question failures and summary review, never across IDs.
  useEffect(() => { setAnswer(""); }, [view?.question?.id]);

  async function persist(payload: ContinuationPayload): Promise<boolean> {
    if (!view || busy || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setView(await transport.save(payload));
      if (payload.slotId || payload.finish) setAnswer("");
      return true;
    } catch (reason) {
      if (reason && typeof reason === "object" && "status" in reason && reason.status === 409) {
        try {
          setView(await transport.load());
          setSummaryOpen(true);
          setError("Your inquiry changed in another window. Please review the updated summary before trying again.");
        } catch { setError("Your inquiry could not be refreshed. Reopen your text link to continue."); }
      } else {
        setError(reason instanceof Error ? reason.message : "Your answer could not be saved. Please try again.");
      }
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function save(value: string, skip = false, finish = false) {
    if (!view || (!finish && !view.question)) return;
    await persist(finish
      ? { revision: view.revision, finish: true }
      : { revision: view.revision, slotId: view.question!.id, value, skip });
  }

  async function continueFromSummary() {
    if (!view) return;
    if (view.reviewConfirmed || await persist({ revision: view.revision, confirmReview: true })) setSummaryOpen(false);
  }

  const item = useMemo<ScreenItem | null>(() => {
    if (!view?.question) return null;

    const hasOptions = view.question.options.length > 0;
    return {
      id: view.question.id,
      question: view.question.text,
      presentation: hasOptions ? "card" : "text",
      options: hasOptions ? view.question.options : undefined,
      allowFreeText: hasOptions,
      freeTextLabel: "Something else, I will explain",
      maxFreeTextLength: 1494,
      placeholder: "Answer in your own words...",
    };
  }, [view?.question]);

  const completed = view?.status === "completed";
  const stopped = view?.status === "stopped";
  const showSummary = !!view && (!view.reviewConfirmed || summaryOpen || completed);
  const showQuestion = !!item && !completed && !stopped && !showSummary;

  return (
    <div className="min-h-screen bg-[#F4F3EF] [&_main>div]:mx-auto min-[641px]:[&_h2]:[text-wrap:pretty] max-[640px]:[&_h2]:text-[22px] max-[360px]:[&_h2]:text-[20px]" style={{ "--cls-font-display": "var(--font-manrope)", "--cls-font-body": '"DM Sans Variable", sans-serif' } as CSSProperties}>
    <Shell
      layout="contained"
      totalScreens={1}
      currentScreen={0}
      roundLabel="Continue your inquiry"
      onSkip={showQuestion && !busy ? () => void save("", true) : undefined}
    >
      <section className="flex flex-col gap-8 py-2" data-ui-component-content="live-continuation">
        <div className="flex flex-col gap-2.5" data-ui-component-content="continuation-introduction">
          <p
            className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_58%,transparent)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="supporting"
          >
            Continue your inquiry
          </p>
          <h1
            className="[text-wrap:pretty] text-[30px] sm:text-[34px] leading-[1.08] font-extrabold text-[var(--cls-text,#1E2F58)]"
            style={{ fontFamily: "var(--cls-font-display, Manrope, sans-serif)" }}
            data-ui-copy="heading"
          >
            Pick up where you left off.
          </h1>
          <p
            className="text-[16px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
            data-ui-copy="body"
          >
            Share only what you can. Please avoid confidential details or documents before the firm reviews your inquiry.
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
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] bg-[var(--cls-surface,#FFFFFF)] px-6 py-7 max-[480px]:px-4" data-ui-component-content="continuation-completion">
            <h2
              className="text-[24px] leading-tight font-extrabold text-[var(--cls-text,#1E2F58)]"
              style={{ fontFamily: "var(--cls-font-display, Manrope, sans-serif)" }}
              data-ui-copy="heading"
            >
              Thank you. Your answers are ready for the firm.
            </h2>
            <p
              className="mt-3 text-[16px] max-[480px]:text-[15px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
              style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
              data-ui-copy="body"
            >
              The firm can review the information you shared with your original callback request.
            </p>
          </div>
        )}

        {showSummary && view && (
          <ContinuationSummary
            view={view}
            busy={busy}
            final={completed || stopped}
            onContinue={() => void continueFromSummary()}
            onCorrect={(fieldId, value) => persist({ revision: view.revision, correction: { fieldId, value } })}
          />
        )}

        {view?.reviewConfirmed && !showSummary && !stopped && (
          <button type="button" disabled={busy} onClick={() => setSummaryOpen(true)} className="self-start rounded-full px-1 py-2 text-[15px] font-medium text-[var(--cls-text,#1E2F58)] underline underline-offset-4 disabled:opacity-50">
            View your summary
          </button>
        )}

        {view?.reviewConfirmed && item && !completed && !stopped && <fieldset hidden={!showQuestion} disabled={busy || !showQuestion} className="min-w-0 border-0 m-0 p-0 disabled:opacity-60" aria-busy={busy}>
        {item.options?.length ? (
          <DecisionCard
            contained
            item={item}
            onChange={next => void save(Array.isArray(next) ? next.join(", ") : next)}
          />
        ) : (
          <TextCard
            contained
            item={item}
            value={answer}
            onChange={next => setAnswer(next.slice(0, 1500))}
            onSubmit={() => void save(answer)}
            submitLabel="Save and continue"
          />
        )}
        </fieldset>}

        {view && !item && !completed && !stopped && !showSummary && <p role="status" data-ui-copy="body">That is enough for the initial review. Your answers are saved. You can finish below.</p>}
        {stopped && <p role="status" data-ui-copy="body">This inquiry is now with the team. Please contact the firm if you need to add anything.</p>}
        {view && !completed && !stopped && !showSummary && (
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
          className="text-[13px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
          style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
          data-ui-copy="supporting"
        >
          You can stop at any time. Reopen the link in your text message to continue while it remains valid. This form does not provide legal advice.
        </p>
      </section>
    </Shell>
    </div>
  );
}
