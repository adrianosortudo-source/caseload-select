"use client";

import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import {
  QUESTIONS,
  CONTACT_HEADING,
  CONSENT_LABEL,
  SUBMIT_LABEL,
  BOOKING_HEADING,
  BOOKING_BODY,
  REPLY_HEADING,
  REPLY_BODY,
  resolveOutcome,
  optionRevealsText,
  type QuestionId,
} from "@/lib/start-conversation/questions";
import { PROVINCES, HONEYPOT_FIELD } from "@/lib/start-conversation/validate";

type Phase =
  | { kind: "question"; index: number }
  | { kind: "contact" }
  | { kind: "consent" }
  | { kind: "submitting" }
  | { kind: "outcome"; outcome: "booking" | "reply" };

interface Answers {
  practice_area: string;
  practice_area_other: string;
  firm_size: string;
  prompt_reason: string;
  prompt_reason_other: string;
  decision_role: string;
  timeline: string;
}

const EMPTY_ANSWERS: Answers = {
  practice_area: "",
  practice_area_other: "",
  firm_size: "",
  prompt_reason: "",
  prompt_reason_other: "",
  decision_role: "",
  timeline: "",
};

interface Props {
  /** Set only when CASELOAD_CALCOM_URL resolves to a valid https Cal.com config. */
  bookingUrl: string | null;
}

export default function StartConversationFlow({ bookingUrl }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "question", index: 0 });
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [name, setName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [province, setProvince] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Honeypot: never rendered visibly, never focusable in tab order for a
  // sighted or screen-reader visitor. A form-filling script fills it anyway.
  const [honeypot, setHoneypot] = useState("");

  function selectOption(id: QuestionId, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (!optionRevealsText(id, value)) {
      advanceFromQuestion();
    }
  }

  function advanceFromQuestion() {
    setPhase((prev) => {
      if (prev.kind !== "question") return prev;
      const next = prev.index + 1;
      return next < QUESTIONS.length ? { kind: "question", index: next } : { kind: "contact" };
    });
  }

  function goBack() {
    setPhase((prev) => {
      if (prev.kind === "question") {
        return prev.index > 0 ? { kind: "question", index: prev.index - 1 } : prev;
      }
      if (prev.kind === "contact") {
        return { kind: "question", index: QUESTIONS.length - 1 };
      }
      if (prev.kind === "consent") {
        return { kind: "contact" };
      }
      return prev;
    });
  }

  function handleContactSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !firmName.trim() || !email.trim() || !province) return;
    setPhase({ kind: "consent" });
  }

  async function handleSubmit() {
    if (!consentChecked) return;
    setError(null);
    setPhase({ kind: "submitting" });

    const payload = {
      ...answers,
      practice_area_other: answers.practice_area_other || null,
      prompt_reason_other: answers.prompt_reason_other || null,
      name,
      firm_name: firmName,
      email,
      province,
      consent: { granted: consentChecked },
      [HONEYPOT_FIELD]: honeypot,
    };

    try {
      const res = await fetch("/api/start-conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; outcome?: "booking" | "reply"; error?: string };
      if (!res.ok || !json.ok) {
        setError("Something went wrong sending your answers. Please try again.");
        setPhase({ kind: "consent" });
        return;
      }
      const outcome = json.outcome ?? resolveOutcome(answers);
      setPhase({ kind: "outcome", outcome });
    } catch {
      setError("Something went wrong sending your answers. Please try again.");
      setPhase({ kind: "consent" });
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Honeypot field: visually hidden, aria-hidden, tabIndex -1. A real
          visitor never reaches or fills it; a scripted filler does. */}
      <input
        type="text"
        name={HONEYPOT_FIELD}
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      {phase.kind === "question" && (
        <QuestionScreen
          index={phase.index}
          answers={answers}
          setAnswers={setAnswers}
          onSelect={selectOption}
          onBack={goBack}
          onContinue={advanceFromQuestion}
        />
      )}

      {phase.kind === "contact" && (
        <div className="card p-6">
          <p className="label mb-2">
            Question {QUESTIONS.length + 1} of {QUESTIONS.length + 2}
          </p>
          <h2 className="text-xl font-display font-semibold text-navy mb-5">{CONTACT_HEADING}</h2>
          <form onSubmit={handleContactSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="label">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Firm name</span>
              <input
                className="input"
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                required
                maxLength={160}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Province</span>
              <select
                className="input"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a province
                </option>
                {PROVINCES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn-ghost" onClick={goBack}>
                Back
              </button>
              <button type="submit" className="btn-gold">
                Continue
              </button>
            </div>
          </form>
        </div>
      )}

      {phase.kind === "consent" && (
        <div className="card p-6">
          <p className="label mb-2">
            Question {QUESTIONS.length + 2} of {QUESTIONS.length + 2}
          </p>
          <label className="flex items-start gap-3 mb-5">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-body leading-relaxed">{CONSENT_LABEL}</span>
          </label>
          {error && (
            <p className="text-sm bg-red-fail/10 border border-red-fail text-red-fail px-3 py-2 mb-4">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="btn-gold"
              disabled={!consentChecked}
              onClick={handleSubmit}
            >
              {SUBMIT_LABEL}
            </button>
          </div>
        </div>
      )}

      {phase.kind === "submitting" && (
        <div className="card p-6 text-center">
          <p className="text-sm text-body">Sending...</p>
        </div>
      )}

      {phase.kind === "outcome" && phase.outcome === "booking" && (
        <div>
          <div className="card p-6 mb-4">
            <h2 className="text-xl font-display font-semibold text-navy mb-3">{BOOKING_HEADING}</h2>
            <p className="text-sm text-body leading-relaxed">{BOOKING_BODY}</p>
          </div>
          {bookingUrl ? (
            <div className="card" style={{ padding: 0 }}>
              <iframe
                src={bookingUrl}
                title="Pick a time with Adriano"
                style={{ width: "100%", height: "80vh", border: "none", display: "block" }}
              />
            </div>
          ) : (
            <div className="card p-6">
              <p className="text-sm text-body leading-relaxed">{REPLY_BODY}</p>
            </div>
          )}
        </div>
      )}

      {phase.kind === "outcome" && phase.outcome === "reply" && (
        <div className="card p-6">
          <h2 className="text-xl font-display font-semibold text-navy mb-3">{REPLY_HEADING}</h2>
          <p className="text-sm text-body leading-relaxed">{REPLY_BODY}</p>
        </div>
      )}
    </div>
  );
}

interface QuestionScreenProps {
  index: number;
  answers: Answers;
  setAnswers: Dispatch<SetStateAction<Answers>>;
  onSelect: (id: QuestionId, value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

function QuestionScreen({ index, answers, setAnswers, onSelect, onBack, onContinue }: QuestionScreenProps) {
  const question = QUESTIONS[index];
  const currentValue = answers[question.id as keyof Answers];
  const revealsText = question.otherField && optionRevealsText(question.id, currentValue);
  const otherValue = question.otherField ? answers[question.otherField as keyof Answers] : "";

  return (
    <div className="card p-6">
      <p className="label mb-2">
        Question {index + 1} of {QUESTIONS.length + 2}
      </p>
      <h2 className="text-xl font-display font-semibold text-navy mb-5">{question.prompt}</h2>
      <div className="flex flex-col gap-2">
        {question.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={[
              "text-left px-4 py-3 text-sm border transition",
              currentValue === option.value
                ? "border-navy bg-navy text-white"
                : "border-border-brand bg-white text-navy hover:border-navy",
            ].join(" ")}
            onClick={() => onSelect(question.id, option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {revealsText && question.otherField && (
        <div className="mt-4 flex flex-col gap-2">
          <input
            className="input"
            placeholder="Say a bit more"
            value={otherValue}
            onChange={(e) => {
              const field = question.otherField as "practice_area_other" | "prompt_reason_other";
              setAnswers((prev) => ({ ...prev, [field]: e.target.value.slice(0, 300) }));
            }}
          />
          <button type="button" className="btn-gold self-start" onClick={onContinue}>
            Continue
          </button>
        </div>
      )}

      {index > 0 && (
        <button type="button" className="btn-ghost mt-4" onClick={onBack}>
          Back
        </button>
      )}
    </div>
  );
}
