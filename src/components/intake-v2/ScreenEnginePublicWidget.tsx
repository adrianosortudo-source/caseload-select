"use client";

import { useMemo, useRef, useState } from "react";
import { Shell } from "@/components/intake-v2/Shell";
import { TextCard } from "@/components/intake-v2/TextCard";
import { DecisionCard } from "@/components/intake-v2/DecisionCard";
import type { ScreenItem } from "@/components/intake-v2/types";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { runEvidencePass } from "@/lib/screen-engine/slotEvidence";
import { computeBand } from "@/lib/screen-engine/band";
import { computeCoreCompleteness, getDecisionGap } from "@/lib/screen-engine/selector";
import { applyAnswer, buildLeadSummary, getNextStep, markInsightShown, startContactCapture } from "@/lib/screen-engine/control";
import { getI18n, type I18nBundle } from "@/lib/screen-engine/i18n/loader";
import { getOptionDisplayLabel, getQuestionDisplayText } from "@/lib/screen-engine/i18n/display";
import type { SupportedLanguage } from "@/lib/screen-engine/types";
import { llmExtract, mergeLlmResults } from "@/lib/screen-engine/llm/extractor";
import { buildReport } from "@/lib/screen-engine/report";
import { renderBriefHtmlServer } from "@/lib/screen-brief-html";
import type { EngineState, SlotDefinition } from "@/lib/screen-engine/types";

interface Props {
  firmId: string;
  firmName: string;
  /**
   * Locale hint from the embedding page, passed through the iframe URL
   * as `?lang=`. The kickoff screen renders before the engine has any
   * typed text to detect language from, so without a hint it defaults
   * to English. When a firm embeds the widget on a Portuguese route
   * (e.g. DRG's /pt/contact), the embedding page passes `lang="pt"` so
   * the very first screen the visitor sees is in their language.
   *
   * This is display-only for the kickoff. Once the visitor types and
   * submits, the engine's own language detection (franc + LLM) sets
   * `state.language` from the actual text, which then drives every
   * subsequent screen. The lawyer brief stays English regardless
   * (DR-036).
   */
  initialLang?: SupportedLanguage;
}

type Stage = "kickoff" | "questions" | "contact" | "done";

function scoreState(state: EngineState): EngineState {
  const band = computeBand(state);
  return {
    ...state,
    band: band.band,
    confidence: band.confidence,
    coreCompleteness: computeCoreCompleteness(state),
    currentGap: getDecisionGap(state),
  };
}

export function slotToItem(
  slot: SlotDefinition,
  language: SupportedLanguage,
  i18n: I18nBundle,
): ScreenItem {
  const options = (slot.options ?? []).map((opt) => ({
    value: opt.value,
    label: getOptionDisplayLabel(opt, slot.id, language, i18n),
  }));

  // Localized label for the synthetic "Something else (I will explain)"
  // affordance DecisionCard renders. When the bundle's widget_strings is
  // missing the key (e.g. EN, or a bundle authored before widget_strings
  // existed), DecisionCard falls back to the English literal.
  const freeTextLabel = i18n.widget_strings?.["free_text_other_label"];

  return {
    id: slot.id,
    question: getQuestionDisplayText(slot.id, slot.question, language, i18n),
    presentation: options.length <= 3 ? "chip" : "card",
    options,
    allowFreeText: true,
    freeTextLabel,
  };
}

function getContactValue(state: EngineState | null, key: string): string {
  return state?.slots[key] ?? "";
}

/**
 * Inline wrapper for free-text slots (no preset options + allowFreeText).
 * Keeps its own text state so navigation between questions resets the
 * textarea cleanly. Submits with the same "other:" prefix the chip/card
 * "Other..." path uses, so the engine treats free-text answers uniformly.
 *
 * The wrapper has its own component identity so mounting it under a
 * `key={currentItem.id}` in the parent guarantees a fresh state hook on
 * every question change without a useEffect dance.
 */
function FreeTextAnswerCard({
  item,
  onSubmit,
  submitLabel = "Continue",
}: {
  item: ScreenItem;
  onSubmit: (value: string) => void;
  submitLabel?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <TextCard
      item={item}
      value={value}
      onChange={setValue}
      onSubmit={() => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return;
        onSubmit(trimmed);
      }}
      submitLabel={submitLabel}
      minChars={1}
    />
  );
}

export function ScreenEnginePublicWidget({ firmId, firmName, initialLang = "en" }: Props) {
  const [stage, setStage] = useState<Stage>("kickoff");
  const [description, setDescription] = useState("");
  const [state, setState] = useState<EngineState | null>(null);
  const [history, setHistory] = useState<EngineState[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [persistStatus, setPersistStatus] = useState<string | null>(null);
  const persistedRef = useRef(false);

  const next = state ? getNextStep(state) : null;

  // Language-aware UI chrome. After the LLM extraction sets state.language
  // (turn 1 finishes), every visible chrome string (round labels, button
  // labels, headings, body copy, status badges) reads from the lead's
  // language bundle. Pre-language-detection (kickoff stage) the bundle
  // is seeded by `initialLang`, the locale hint from the embedding page:
  // an English embed leaves it "en", a /pt route passes "pt" so the
  // first screen matches the visitor's chosen site language. Once the
  // visitor types and the engine detects the real language from the
  // text, `state.language` takes over and drives every later screen.
  const language: SupportedLanguage = (state?.language ?? initialLang) as SupportedLanguage;
  const i18n = getI18n(language);
  const ws = (key: string, fallback: string): string =>
    i18n.widget_strings?.[key] ?? fallback;

  const roundLabel =
    stage === "kickoff"
      ? ws("shell_round_your_situation", "Your situation")
      : stage === "contact"
        ? ws("shell_round_your_details", "Your details")
        : ws("shell_round_about_your_case", "About your case");
  const backLabel = ws("shell_back", "Back");
  const skipLabel = ws("shell_skip", "Skip");

  const currentItem = useMemo(() => {
    if (!next?.slot) return null;
    return slotToItem(next.slot, language, i18n);
  }, [next, language, i18n]);

  async function start() {
    const text = description.trim();
    if (text.length < 10) return;

    let nextState = initialiseState(text);
    nextState = runEvidencePass(text, nextState);
    nextState = scoreState(nextState);
    setState(nextState);
    setStage("questions");
    setIsReading(true);

    try {
      const extracted = await llmExtract(text, nextState);
      if (extracted.mode === "live") {
        nextState = scoreState(mergeLlmResults(nextState, extracted.extracted));
        setState(nextState);
      }
    } finally {
      setIsReading(false);
    }
  }

  function mutate(nextState: EngineState) {
    setState(scoreState(nextState));
  }

  function answer(slotId: string, rawValue: string | string[]) {
    if (!state) return;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
    setHistory((items) => [...items, state]);
    mutate(applyAnswer(state, slotId, value));
  }

  function back() {
    const prev = history.at(-1);
    if (!prev) {
      setStage("kickoff");
      return;
    }
    setHistory((items) => items.slice(0, -1));
    setState(prev);
    setStage("questions");
  }

  function skip() {
    if (!next?.slot) return;
    answer(next.slot.id, "Not sure");
  }

  async function persist(finalState: EngineState) {
    if (persistedRef.current) return;
    persistedRef.current = true;
    const report = buildReport(finalState);
    const briefHtml = renderBriefHtmlServer(report, "web", finalState.language ?? "en");

    const payload = {
      lead_id: report.lead_id,
      submitted_at: report.submitted_at,
      matter_type: finalState.matter_type,
      practice_area: finalState.practice_area,
      band: report.band,
      axes: report.four_axis,
      brief_json: report,
      brief_html: briefHtml,
      intake_language: finalState.language ?? "en",
      raw_transcript: finalState.language === "en" ? null : finalState.input,
      slot_answers: {
        slots: finalState.slots,
        slot_meta: finalState.slot_meta,
        slot_evidence: finalState.slot_evidence,
        raw: finalState.raw,
        intent_family: finalState.intent_family,
        dispute_family: finalState.dispute_family,
        advisory_subtrack: finalState.advisory_subtrack,
        questionHistory: finalState.questionHistory,
      },
      contact: {
        name: finalState.slots.client_name ?? undefined,
        email: finalState.slots.client_email ?? undefined,
        phone: finalState.slots.client_phone ?? undefined,
      },
      referrer: typeof document !== "undefined" ? document.referrer : null,
    };

    try {
      const res = await fetch(`/api/intake-v2?firmId=${encodeURIComponent(firmId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      setPersistStatus(body.persisted ? "submitted" : body.reason ?? "submitted");
    } catch (err) {
      setPersistStatus(err instanceof Error ? err.message : "submission issue");
    }
  }

  function submitContact(form: FormData) {
    if (!state) return;
    let nextState = state;
    const answers = {
      client_name: String(form.get("client_name") ?? "").trim(),
      client_phone: String(form.get("client_phone") ?? "").trim(),
      client_email: String(form.get("client_email") ?? "").trim(),
    };
    if (!answers.client_name || (!answers.client_phone && !answers.client_email)) return;
    setHistory((items) => [...items, state]);
    for (const [slotId, value] of Object.entries(answers)) {
      if (value) nextState = applyAnswer(nextState, slotId, value);
    }
    nextState = scoreState(nextState);
    setState(nextState);
    setStage("done");
    void persist(nextState);
  }

  if (stage === "kickoff") {
    // Kickoff language: seeded by `initialLang` (the embedding page's
    // locale hint via ?lang=). English embeds default to "en"; a /pt
    // route passes "pt" so the first screen matches the visitor's chosen
    // site language. The strings read through `ws()` against the
    // language bundle, so a PT embed shows PT kickoff copy. Once the
    // visitor types and submits, the engine detects the real language
    // from the text and drives every later screen.
    //
    // Copy revised 2026-06-08 per operator audit. The previous heading
    // ("Describe your situation") was too passive. The new heading puts
    // the visitor in decision mode, the helper gives explicit permission
    // to use plain language, the placeholder models a real-world
    // commercial-lease scenario, and three quiet starter prompts help
    // visitors who do not know how to begin. The submit label reads as
    // a workflow step ("Continue matter review"), not a generic CTA, so
    // visitors understand they have not finished submitting yet.
    return (
      <Shell totalScreens={1} currentScreen={0} roundLabel={roundLabel}>
        <TextCard
          item={{
            id: "situation",
            question: ws("kickoff_heading", "Start with what you need to decide."),
            description: ws(
              "kickoff_helper",
              "A few plain-language sentences are enough. Include what is happening, any deadline, and the documents you have.",
            ),
            presentation: "text",
            placeholder: ws(
              "kickoff_placeholder",
              "I am about to sign a commercial lease and want to know what risks I should check before committing.",
            ),
          }}
          value={description}
          onChange={setDescription}
          onSubmit={start}
          submitLabel={ws("kickoff_submit", "Continue matter review")}
          minChars={10}
          enableVoice
          examplePrompts={[
            ws("kickoff_example_1", "I am about to sign..."),
            ws("kickoff_example_2", "I received a document and need to know..."),
            ws("kickoff_example_3", "I need to decide whether..."),
          ]}
          examplePromptsLabel={ws("kickoff_examples_label", "You can start with:")}
        />
      </Shell>
    );
  }

  if (!state) return null;

  // Per-firm theme tokens — see lib/widget-theme.ts. Fallbacks match
  // the legacy CaseLoad Select chrome.
  const fontDisplay = "var(--cls-font-display, Manrope, sans-serif)";
  const fontBody = "var(--cls-font-body, DM Sans, sans-serif)";

  if (stage === "done" || next?.type === "stop") {
    if (next?.type === "stop") void persist(state);
    // "Professional Corporation" is the formal LSO legal-entity suffix
    // on the firm's registered name; strip it for the user-facing
    // confirmation so the prospect sees the trade name (e.g. "DRG Law")
    // rather than the entity name.
    const trimmedFirmName =
      firmName?.replace(/\s+Professional Corporation\s*$/i, '').trim() || 'the firm';
    const doneBodyTemplate = ws(
      "done_body_template",
      "A lawyer at {firmName} will read what you shared and reach out directly to talk through the legal side.",
    );
    const doneBody = doneBodyTemplate.replace(/\{firmName\}/g, trimmedFirmName);
    // Translate the "submitted" sentinel; pass other reason strings
    // through verbatim (they are server-supplied and not user-facing
    // copy that we author).
    const statusLabel = persistStatus === "submitted"
      ? ws("status_submitted", "submitted")
      : persistStatus;
    return (
      <Shell
        totalScreens={1}
        currentScreen={0}
        roundLabel={ws("shell_round_submitted", "Submitted")}
        onBack={back}
        backLabel={backLabel}
      >
        <div className="flex flex-col items-center text-center gap-5 py-10">
          <div className="w-16 h-16 rounded-full bg-[var(--cls-accent,#1E2F58)] text-[var(--cls-accent-text,#FFFFFF)] flex items-center justify-center">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-[28px] font-extrabold text-[var(--cls-text,#1E2F58)]" style={{ fontFamily: fontDisplay }}>
            {ws("done_heading", "Your matter review was submitted.")}
          </h2>
          <p
            className="max-w-[460px] text-[15px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
            style={{ fontFamily: fontBody }}
          >
            {doneBody}
          </p>
          {statusLabel && (
            <p className="text-[12px] uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_45%,transparent)]">{statusLabel}</p>
          )}
        </div>
      </Shell>
    );
  }

  if (next?.type === "present_insight") {
    const summary = buildLeadSummary(state, i18n);
    return (
      <Shell
        totalScreens={3}
        currentScreen={2}
        roundLabel={ws("shell_round_review", "Review")}
        onBack={back}
        backLabel={backLabel}
      >
        <div className="flex flex-col gap-5">
          <h2 className="text-[28px] font-extrabold text-[var(--cls-text,#1E2F58)]" style={{ fontFamily: fontDisplay }}>
            {ws("insight_heading", "Here is what we understood.")}
          </h2>
          <p
            className="text-[15px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_70%,transparent)]"
            style={{ fontFamily: fontBody }}
          >
            {summary.intro}
          </p>
          {summary.points.length > 0 && (
            <ul className="rounded-xl bg-[var(--cls-surface,#FFFFFF)] border border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_10%,transparent)] p-4 text-left text-[14px] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_75%,transparent)] space-y-2">
              {summary.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              const nextState = startContactCapture(markInsightShown(state));
              mutate(nextState);
              setStage("contact");
            }}
            className="min-h-[52px] rounded-full bg-[var(--cls-accent,#1E2F58)] px-8 text-[15px] font-semibold text-[var(--cls-accent-text,#FFFFFF)]"
            style={{ fontFamily: fontBody }}
          >
            {ws("insight_cta", "Yes, share my contact details")}
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === "contact" || next?.type === "capture_contact") {
    return (
      <Shell
        totalScreens={1}
        currentScreen={0}
        roundLabel={ws("shell_round_your_details", "Your details")}
        onBack={back}
        backLabel={backLabel}
      >
        <form action={submitContact} className="flex flex-col gap-5">
          <div>
            <h2 className="text-[28px] font-extrabold text-[var(--cls-text,#1E2F58)]" style={{ fontFamily: fontDisplay }}>
              {ws("contact_heading", "How should the firm reach you?")}
            </h2>
            <p
              className="mt-2 text-[15px] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_65%,transparent)]"
              style={{ fontFamily: fontBody }}
            >
              {ws("contact_sub", "Share your contact details so the team can follow up after review.")}
            </p>
          </div>
          {[
            [
              "client_name",
              ws("contact_field_name_label", "Full name"),
              ws("contact_field_name_placeholder", "Your name"),
            ],
            [
              "client_phone",
              ws("contact_field_phone_label", "Phone"),
              ws("contact_field_phone_placeholder", "+1 416 555 0123"),
            ],
            [
              "client_email",
              ws("contact_field_email_label", "Email"),
              ws("contact_field_email_placeholder", "you@example.com"),
            ],
          ].map(([name, label, placeholder]) => (
            <label
              key={name}
              className="flex flex-col gap-2 text-[12px] uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
              style={{ fontFamily: fontBody }}
            >
              {label}
              <input
                name={name}
                defaultValue={getContactValue(state, name)}
                placeholder={placeholder}
                className="h-12 rounded-xl border border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] bg-[var(--cls-surface,#FFFFFF)] px-4 text-[15px] normal-case tracking-normal text-[var(--cls-text,#1E2F58)] outline-none focus:border-[var(--cls-accent,#1E2F58)]"
                style={{ fontFamily: fontBody }}
              />
            </label>
          ))}
          <button
            type="submit"
            className="min-h-[52px] rounded-full bg-[var(--cls-accent,#1E2F58)] px-8 text-[15px] font-semibold text-[var(--cls-accent-text,#FFFFFF)]"
            style={{ fontFamily: fontBody }}
          >
            {ws("contact_submit", "Submit matter review")}
          </button>
        </form>
      </Shell>
    );
  }

  // Hold the question render until the LLM extraction settles. Without this
  // guard, the engine renders Question 1 from the evidence-pass state, then a
  // few seconds later the LLM merge advances `getNextStep` to a different slot
  // and the screen swaps without any user input — the symptom that reads as
  // "two different versions of the widget flashing past." One loading screen,
  // then exactly one question.
  if (isReading || !currentItem) {
    return (
      <Shell
        totalScreens={5}
        currentScreen={Math.min(history.length, 4)}
        roundLabel={roundLabel}
        onBack={back}
        backLabel={backLabel}
      >
        <div className="flex flex-col items-center justify-center text-center gap-4 py-16">
          <div
            aria-hidden="true"
            className="w-10 h-10 rounded-full border-2 border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_20%,transparent)] border-t-[var(--cls-accent,#1E2F58)] animate-spin"
          />
          <p
            className="text-[13px] uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_60%,transparent)]"
            style={{ fontFamily: fontBody }}
          >
            {isReading
              ? ws("loading_reading", "Reading your description...")
              : ws("loading_preparing", "Preparing the next question...")}
          </p>
        </div>
      </Shell>
    );
  }

  // Two render paths only — visual consistency across every option-bearing
  // question. Previously the controller branched on option count (1-3 chips
  // via RapidFire, 4+ rectangles via DecisionCard), which read as two
  // different products inside the same flow. DecisionCard handles any option
  // count cleanly: short lists land in a 2-column grid, longer lists wrap.
  // The widget posts its height to the parent iframe so the extra vertical
  // space taken by short rectangle answers (vs old pill chips) is absorbed
  // without a scrollbar.
  const optionCount = currentItem.options?.length ?? 0;
  const isPureFreeText = optionCount === 0 && !!currentItem.allowFreeText;

  return (
    <Shell
      totalScreens={5}
      currentScreen={Math.min(history.length, 4)}
      roundLabel={roundLabel}
      onBack={back}
      onSkip={skip}
      backLabel={backLabel}
      skipLabel={skipLabel}
    >
      {isPureFreeText ? (
        <FreeTextAnswerCard
          key={currentItem.id}
          item={currentItem}
          onSubmit={(text) => answer(currentItem.id, `other:${text}`)}
          submitLabel={ws("free_text_continue", "Continue")}
        />
      ) : (
        <DecisionCard item={currentItem} onChange={(value) => answer(currentItem.id, value)} />
      )}
    </Shell>
  );
}
