"use client";

/**
 * Pass one, one category per screen.
 *
 * The old build put all eight groups on a single screen and asked the lawyer
 * to work down thirty-eight claims in one sitting. Splitting them is the same
 * mitigation that grouping was, taken further: choice-overload effects hit
 * hardest when options are unfamiliar and effortful to compare, and a screen
 * holding four or five claims from one group is a question a person can
 * actually answer.
 *
 * Nothing is required here. A category can be genuinely empty for a firm, and
 * a screen that refuses to advance until something is picked would teach the
 * lawyer to pick anything. The keep screen is where an empty run is named.
 */

import { CATEGORIES, cardsInCategory, type Category } from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";
import type { WizardData } from "@/lib/why-your-firm/screens";
import ClaimCard from "./ClaimCard";
import CustomClaimEntry from "./CustomClaimEntry";

interface Props {
  category: Category;
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function PassOneStep({ category, data, onPatch, onContinue, onBack }: Props) {
  const meta = CATEGORIES.find((c) => c.id === category);
  const cards = cardsInCategory(category);

  function toggle(cardId: string) {
    onPatch((prev) => {
      const has = prev.passOneIds.includes(cardId);
      return {
        passOneIds: has
          ? prev.passOneIds.filter((x) => x !== cardId)
          : [...prev.passOneIds, cardId],
      };
    });
  }

  return (
    <div className="card p-6">
      {meta && <p className="label">{meta.label}</p>}
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step2.titlePassOne}</h1>
      {meta && <p className="text-sm text-body leading-relaxed mb-1">{meta.prompt}</p>}
      <p className="text-xs text-muted leading-relaxed mb-5">{copy.step2.helperPassOne}</p>

      <div className="flex flex-col gap-2 mb-5">
        {cards.map((card) => (
          <ClaimCard
            key={card.id}
            card={card}
            selected={data.passOneIds.includes(card.id)}
            onToggle={() => toggle(card.id)}
          />
        ))}

        <CustomClaimEntry category={category} data={data} onPatch={onPatch} />
      </div>

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
