"use client";

/**
 * Step 4: anchor a surviving card, pick a pattern, fill it in.
 *
 * The anchor card's own proof line pre-fills the pattern's final slot (every
 * pattern in compliance.ts ends with "Your proof line"), editable from
 * there. Typed slot values are checked live against the same free-text
 * compliance rules the tests step runs on proof lines, so a superlative
 * typed straight into the statement gets caught before it ever reaches the
 * brief, not after.
 */

import { useEffect, useMemo } from "react";
import { capAndRank, computeSurvivors, evaluateFreeText, buildStatement, proofSlotIndex } from "@/lib/why-your-firm/engine";
import { STATEMENT_PATTERNS, copy } from "@/lib/why-your-firm/compliance";
import type { WizardData } from "./WhyYourFirm";

interface Props {
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function StatementStep({ data, onPatch, onContinue, onBack }: Props) {
  const rankedIds = capAndRank(data.passTwoIds);
  const work = rankedIds.map((cardId) => ({
    cardId,
    ...(data.cardEntries[cardId] ?? { inputValue: "", proof: "", tests: { provable: false, inDemand: false, unique: false } }),
  }));
  const { survivors } = computeSurvivors(work);

  const anchor = survivors.find((s) => s.card.id === data.anchorCardId) ?? survivors[0] ?? null;

  useEffect(() => {
    if (anchor && data.anchorCardId !== anchor.card.id) {
      onPatch({ anchorCardId: anchor.card.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.card.id]);

  const pattern = STATEMENT_PATTERNS.find((p) => p.id === data.patternId) ?? null;

  const statement = useMemo(
    () => (pattern ? buildStatement(pattern.id, data.statementValues) : ""),
    [pattern, data.statementValues],
  );

  const compliance = useMemo(
    () => evaluateFreeText(data.statementValues.join(" ")),
    [data.statementValues],
  );

  function selectPattern(patternId: string) {
    const p = STATEMENT_PATTERNS.find((x) => x.id === patternId);
    if (!p) return;
    const proofIdx = proofSlotIndex(patternId);
    onPatch((prev) => {
      const values = p.slots.map((_, i) => {
        if (i === proofIdx) return anchor?.proof ?? "";
        if (patternId === "P1" && i === 0) return prev.firmName;
        return "";
      });
      return { patternId, statementValues: values };
    });
  }

  function updateSlot(index: number, value: string) {
    onPatch((prev) => {
      const next = [...prev.statementValues];
      next[index] = value;
      const changes: Partial<WizardData> = { statementValues: next };
      if (prev.patternId === "P1" && index === 0) changes.firmName = value;
      return changes;
    });
  }

  if (survivors.length === 0) {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-display font-bold text-navy mb-3">{copy.step4.title}</h1>
        <p className="text-sm text-body leading-relaxed mb-5">{copy.brief.noSurvivors}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={onBack}>
            {copy.tool.back}
          </button>
          <button type="button" className="btn-gold" onClick={onContinue}>
            {copy.tool.next}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step4.title}</h1>
      <p className="text-sm text-body leading-relaxed mb-1">{copy.step4.prompt}</p>
      <p className="text-xs text-muted leading-relaxed mb-5">{copy.step4.helper}</p>

      {survivors.length > 1 && (
        <div className="mb-5">
          <label className="label">Which claim best backs up this sentence?</label>
          <div className="flex flex-col gap-1.5">
            {survivors.map((s) => (
              <label key={s.card.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="anchor"
                  checked={data.anchorCardId === s.card.id}
                  onChange={() => onPatch({ anchorCardId: s.card.id })}
                  className="mt-1"
                />
                <span className="text-sm text-navy">{s.claimText}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mb-5">
        <label className="label">{copy.step4.patternLabel}</label>
        <div className="flex flex-col gap-2">
          {STATEMENT_PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPattern(p.id)}
              aria-pressed={data.patternId === p.id}
              className={[
                "text-left border px-4 py-3 transition",
                data.patternId === p.id ? "border-gold bg-highlight" : "border-border-brand bg-white hover:border-gold",
              ].join(" ")}
            >
              <span className="block text-sm font-semibold text-navy">{p.name}</span>
              <span className="block text-xs text-muted mt-1 leading-relaxed">{p.whenToUse}</span>
              <span className="block text-xs text-body mt-1.5 leading-relaxed">{copy.step4.exampleLabel} {p.example}</span>
            </button>
          ))}
        </div>
      </div>

      {pattern && (
        <div className="mb-5">
          <div className="flex flex-col gap-3 mb-4">
            {pattern.slots.map((slotLabel, i) => (
              <div key={i}>
                <label className="label">{slotLabel}</label>
                {slotLabel === "Your proof line" ? (
                  <textarea
                    className="input min-h-[64px] resize-y"
                    value={data.statementValues[i] ?? ""}
                    onChange={(e) => updateSlot(i, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    className="input"
                    value={data.statementValues[i] ?? ""}
                    onChange={(e) => updateSlot(i, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="border-l-2 border-navy pl-4 py-1 mb-3">
            <p className="label mb-1">{copy.step4.livePreviewLabel}</p>
            <p className="text-base font-display font-semibold text-navy leading-snug">
              {statement || "..."}
            </p>
          </div>

          {compliance.rules.length > 0 && (
            <div className="mb-3 border-l-2 border-red-fail pl-3 py-1">
              {compliance.rules.map((rule) => (
                <p key={rule.id} className="text-xs text-red-fail leading-relaxed">
                  {rule.name}: {rule.explanation}
                </p>
              ))}
            </div>
          )}

          <p className="text-xs text-muted leading-relaxed">{copy.step4.substitutionCheck}</p>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button type="button" className="btn-ghost" onClick={onBack}>
          {copy.tool.back}
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={!pattern || compliance.blocked}
          onClick={onContinue}
        >
          {copy.tool.next}
        </button>
      </div>
    </div>
  );
}
