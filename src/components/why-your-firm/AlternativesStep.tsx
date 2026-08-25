"use client";

import { ALTERNATIVES, ALTERNATIVE_OTHER_ID } from "@/lib/why-your-firm/profiles";
import { copy } from "@/lib/why-your-firm/compliance";
import type { WizardData } from "./WhyYourFirm";

interface Props {
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
}

export default function AlternativesStep({ data, onPatch, onContinue }: Props) {
  const otherPicked = data.alternativeIds.includes(ALTERNATIVE_OTHER_ID);
  const canContinue =
    data.alternativeIds.length > 0 &&
    (!otherPicked || data.alternativeOther.trim().length > 0);

  function toggle(id: string) {
    onPatch((prev) => {
      const has = prev.alternativeIds.includes(id);
      return {
        alternativeIds: has
          ? prev.alternativeIds.filter((x) => x !== id)
          : [...prev.alternativeIds, id],
      };
    });
  }

  return (
    <div className="card p-6">
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step1.title}</h1>
      <p className="text-sm text-body leading-relaxed mb-1">{copy.step1.prompt}</p>
      <p className="text-xs text-muted leading-relaxed mb-5">{copy.step1.helper}</p>

      <div className="flex flex-col gap-2 mb-4">
        {ALTERNATIVES.map((alt) => {
          const selected = data.alternativeIds.includes(alt.id);
          return (
            <button
              key={alt.id}
              type="button"
              onClick={() => toggle(alt.id)}
              aria-pressed={selected}
              className={[
                "text-left border px-4 py-3 transition",
                selected ? "border-gold bg-highlight" : "border-border-brand bg-white hover:border-gold",
              ].join(" ")}
            >
              <span className="block text-sm font-semibold text-navy">{alt.label}</span>
              <span className="block text-xs text-muted mt-1 leading-relaxed">{alt.clientCost}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => toggle(ALTERNATIVE_OTHER_ID)}
          aria-pressed={otherPicked}
          className={[
            "text-left border px-4 py-3 transition",
            otherPicked ? "border-gold bg-highlight" : "border-border-brand bg-white hover:border-gold",
          ].join(" ")}
        >
          <span className="block text-sm font-semibold text-navy">{copy.step1.otherLabel}</span>
        </button>

        {otherPicked && (
          <textarea
            className="input min-h-[72px] resize-y"
            placeholder={copy.step1.otherPlaceholder}
            value={data.alternativeOther}
            onChange={(e) => onPatch({ alternativeOther: e.target.value })}
          />
        )}
      </div>

      {data.alternativeIds.length === 0 && (
        <p className="text-xs text-red-fail mb-4">{copy.step1.empty}</p>
      )}

      <button type="button" className="btn-gold" disabled={!canContinue} onClick={onContinue}>
        {copy.tool.next}
      </button>
    </div>
  );
}
