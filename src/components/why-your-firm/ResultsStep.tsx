"use client";

/**
 * Step 5: results and the gate.
 *
 * The brief is assembled locally with the same pure engine.assembleBrief()
 * the API route calls, so the visitor sees their real brief immediately and
 * a network failure never blocks that view (same posture as screen-demo's
 * ScreenQuiz: the report renders regardless of whether the email send
 * succeeds). The API call's only job is the PDF and the Resend delivery.
 *
 * GATE_MODE controls presentation only, per the build plan: the same brief
 * data renders in both modes, just gated at a different point in the
 * viewport.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GATE_MODE } from "@/lib/why-your-firm/config";
import { assembleBrief, capAndRank, type AlternativeSelection, type CardWork } from "@/lib/why-your-firm/engine";
import { copy } from "@/lib/why-your-firm/compliance";
import { trackEvent, EVENTS } from "@/lib/why-your-firm/analytics";
import type { WizardData } from "./WhyYourFirm";
import BriefView from "./BriefView";

interface Props {
  data: WizardData;
  onBack: () => void;
}

function buildBriefInput(data: WizardData) {
  const rankedIds = capAndRank(data.passTwoIds);
  const work: CardWork[] = rankedIds.map((cardId) => ({
    cardId,
    ...(data.cardEntries[cardId] ?? { inputValue: "", proof: "", tests: { provable: false, inDemand: false, unique: false } }),
  }));
  const alternatives: AlternativeSelection[] = data.alternativeIds.map((id) => ({
    id,
    otherText: id === "other" ? data.alternativeOther : undefined,
  }));
  return {
    alternatives,
    work,
    patternId: data.patternId,
    statementValues: data.statementValues,
    firmName: data.firmName,
  };
}

export default function ResultsStep({ data, onBack }: Props) {
  const briefInput = useMemo(() => buildBriefInput(data), [data]);
  const brief = useMemo(() => assembleBrief(briefInput), [briefInput]);

  const [firstName, setFirstName] = useState("");
  const [firmName, setFirmName] = useState(data.firmName);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  // In no_gate mode the brief is unlocked from the first render: nothing is
  // collected and no server call is made. Reaching this step IS completion,
  // so wyf_complete fires here instead of on a gate submit that never happens.
  const [unlocked, setUnlocked] = useState(GATE_MODE === "no_gate");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const gateViewFiredRef = useRef(false);
  const completeFiredRef = useRef(false);

  const gateVisible = GATE_MODE !== "no_gate" && !unlocked;
  useEffect(() => {
    if (gateVisible && !gateViewFiredRef.current) {
      gateViewFiredRef.current = true;
      trackEvent(EVENTS.gateView, { gateMode: GATE_MODE });
    }
  }, [gateVisible]);

  useEffect(() => {
    if (GATE_MODE === "no_gate" && !completeFiredRef.current) {
      completeFiredRef.current = true;
      trackEvent(EVENTS.complete, { profileId: brief.profile?.id ?? null, gateMode: GATE_MODE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitGate(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) {
      setError("Please enter your first name.");
      return;
    }
    if (!firmName.trim()) {
      setError("Please enter your firm's name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/tools/why-your-firm/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...briefInput,
          // These three win over briefInput's own firmName: the gate form is
          // the last thing the lawyer edited, and briefInput.firmName only
          // tracks wizard state, which lags behind an edit made right here.
          firstName: firstName.trim(),
          firmName: firmName.trim(),
          email: email.trim(),
        }),
      });
      const json = (await res.json()) as { ok: boolean; emailed?: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "We could not email the PDF, but your brief is ready below.");
        setDelivered(false);
      } else {
        setDelivered(!!json.emailed);
      }
    } catch {
      setError("We could not reach the mail server, but your brief is ready below.");
      setDelivered(false);
    } finally {
      setSubmitting(false);
      setHasSubmitted(true);
      setUnlocked(true);
      trackEvent(EVENTS.complete, { profileId: brief.profile?.id ?? null });
    }
  }

  const gateForm = (
    <form onSubmit={submitGate} className="flex flex-col gap-3">
      <div>
        <label className="label">{copy.gate.firstName}</label>
        <input type="text" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
      </div>
      <div>
        <label className="label">{copy.gate.firmName}</label>
        <input type="text" className="input" value={firmName} onChange={(e) => setFirmName(e.target.value)} autoComplete="organization" />
      </div>
      <div>
        <label className="label">{copy.gate.email}</label>
        <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <p className="text-xs text-muted mt-1">{copy.gate.emailHelper}</p>
      </div>
      {error && <p className="text-xs text-red-fail">{error}</p>}
      <button type="submit" className="btn-gold self-start" disabled={submitting}>
        {submitting ? copy.gate.sending : copy.gate.submit}
      </button>
    </form>
  );

  const deliveredBanner = hasSubmitted && (
    <div className={`border px-3 py-2 mb-6 ${delivered ? "border-green-pass" : "border-gold"}`}>
      <p className="text-sm font-semibold text-navy">
        {delivered ? copy.gate.delivered : copy.gate.failed}
      </p>
      {delivered && <p className="text-xs text-muted mt-0.5">{copy.gate.deliveredBody}</p>}
    </div>
  );

  if (GATE_MODE === "gate_before_brief" && !unlocked) {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.gate.directTitle}</h1>
        <p className="text-sm text-body leading-relaxed mb-5">{copy.gate.directBody}</p>
        {gateForm}
        <button type="button" className="btn-ghost mt-3" onClick={onBack}>
          {copy.tool.back}
        </button>
      </div>
    );
  }

  return (
    <div className="card p-6">
      {brief.profile && (
        <>
          <p className="label mb-1">{copy.brief.profileEyebrow}</p>
          <h1 className="text-2xl font-display font-bold text-navy mb-2">{brief.profile.name}</h1>
          <p className="text-sm text-body leading-relaxed mb-3">{brief.profile.oneLiner}</p>
          <p className="text-sm text-body leading-relaxed mb-1">{brief.profile.strength}</p>
          <p className="text-xs text-muted leading-relaxed mb-6">{brief.profile.watchout}</p>
        </>
      )}

      {brief.statement && (
        <div className="bg-navy p-5 mb-6">
          <p className="text-lg font-display font-bold text-white leading-snug">{brief.statement}</p>
        </div>
      )}

      {GATE_MODE === "teaser_then_gate" && !unlocked && (
        <div className="border-t border-border-brand pt-6 mt-2">
          <h2 className="text-lg font-display font-bold text-navy mb-2">{copy.gate.teaserTitle}</h2>
          <p className="text-sm text-body leading-relaxed mb-5">{copy.gate.teaserBody}</p>
          {gateForm}
        </div>
      )}

      {unlocked && (
        <div className="border-t border-border-brand pt-6 mt-2">
          {deliveredBanner}
          {GATE_MODE === "no_gate" && (
            <div className="flex justify-end mb-4 wyf-no-print">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => window.print()}
              >
                Print or save as PDF
              </button>
            </div>
          )}
          <BriefView brief={brief} />
        </div>
      )}

      <button type="button" className="btn-ghost mt-6 wyf-no-print" onClick={onBack}>
        {copy.tool.back}
      </button>
    </div>
  );
}
