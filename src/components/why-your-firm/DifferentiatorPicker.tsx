"use client";

/**
 * Step 2: two internal passes inside one wizard step.
 *
 * Pass 1 ("true today"): every category, every card, broad selection.
 * Pass 2 ("provable to a stranger"): only the categories and cards that
 * survived pass 1, capped at KEEP_CAP with a live counter and a standing
 * message once the cap is reached, never a silently dead 7th click.
 *
 * Cards are grouped by category (CATEGORIES order) rather than shown as one
 * flat 38-card grid, per the research behind this build: choice-overload
 * effects hit hardest exactly when options are unfamiliar and effortful to
 * compare, and category chunking is the standard mitigation.
 */

import {
  CATEGORIES,
  cardsInCategory,
  renderClaim,
  KEEP_CAP,
  type Category,
} from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";
import type { WizardData } from "./WhyYourFirm";

interface Props {
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function DifferentiatorPicker({ data, onPatch, onContinue, onBack }: Props) {
  if (!data.passOneConfirmed) {
    return <PassOne data={data} onPatch={onPatch} onContinue={onContinue} onBack={onBack} />;
  }
  return <PassTwo data={data} onPatch={onPatch} onContinue={onContinue} />;
}

function PassOne({ data, onPatch, onBack }: Props) {
  function toggle(cardId: string) {
    onPatch((prev) => {
      const has = prev.passOneIds.includes(cardId);
      return {
        passOneIds: has ? prev.passOneIds.filter((x) => x !== cardId) : [...prev.passOneIds, cardId],
      };
    });
  }

  function confirmPassOne() {
    onPatch({ passOneConfirmed: true, passTwoIds: [] });
  }

  const canContinue = data.passOneIds.length > 0;

  return (
    <div className="card p-6">
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step2.titlePassOne}</h1>
      <p className="text-sm text-body leading-relaxed mb-1">{copy.step2.promptPassOne}</p>
      <p className="text-xs text-muted leading-relaxed mb-5">{copy.step2.helperPassOne}</p>

      <div className="flex flex-col gap-6 mb-5">
        {CATEGORIES.map((cat) => (
          <CategoryGroup
            key={cat.id}
            category={cat.id}
            heading={cat.label}
            subheading={cat.prompt}
            selectedIds={data.passOneIds}
            onToggle={toggle}
          />
        ))}
      </div>

      {data.passOneIds.length === 0 && (
        <p className="text-xs text-red-fail mb-4">{copy.step2.emptyPassOne}</p>
      )}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={onBack}>
          {copy.tool.back}
        </button>
        <button type="button" className="btn-gold" disabled={!canContinue} onClick={confirmPassOne}>
          {copy.tool.next}
        </button>
      </div>
    </div>
  );
}

function PassTwo({ data, onPatch, onContinue }: { data: WizardData; onPatch: Props["onPatch"]; onContinue: () => void }) {
  const atCap = data.passTwoIds.length >= KEEP_CAP;

  function toggle(cardId: string) {
    onPatch((prev) => {
      const has = prev.passTwoIds.includes(cardId);
      if (!has && prev.passTwoIds.length >= KEEP_CAP) return {}; // cap enforced against the latest state, message shown below
      return {
        passTwoIds: has ? prev.passTwoIds.filter((x) => x !== cardId) : [...prev.passTwoIds, cardId],
      };
    });
  }

  function backToPassOne() {
    onPatch({ passOneConfirmed: false });
  }

  const categoriesWithSurvivors = CATEGORIES.filter(
    (cat) => cardsInCategory(cat.id).some((c) => data.passOneIds.includes(c.id)),
  );

  return (
    <div className="card p-6">
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step2.titlePassTwo}</h1>
      <p className="text-sm text-body leading-relaxed mb-1">{copy.step2.promptPassTwo}</p>
      <p className="text-xs text-muted leading-relaxed mb-3">{copy.step2.helperPassTwo}</p>

      <p className="text-xs font-display font-semibold uppercase tracking-wider text-field-label mb-4">
        {data.passTwoIds.length} / {KEEP_CAP} {copy.step2.counterLabel}
      </p>

      {atCap && <p className="text-xs text-gold-on-light mb-4">{copy.step2.capReached}</p>}

      <div className="flex flex-col gap-6 mb-5">
        {categoriesWithSurvivors.map((cat) => (
          <CategoryGroup
            key={cat.id}
            category={cat.id}
            heading={cat.label}
            subheading={null}
            selectedIds={data.passTwoIds}
            restrictToIds={data.passOneIds}
            disableUnselected={atCap}
            onToggle={toggle}
            showCrowdWarning
          />
        ))}
      </div>

      {data.passTwoIds.length === 0 && (
        <p className="text-xs text-muted mb-4">{copy.step2.emptyPassTwo}</p>
      )}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={backToPassOne}>
          {copy.tool.back}
        </button>
        <button type="button" className="btn-gold" onClick={onContinue}>
          {copy.tool.next}
        </button>
      </div>
    </div>
  );
}

function CategoryGroup({
  category,
  heading,
  subheading,
  selectedIds,
  restrictToIds,
  disableUnselected,
  onToggle,
  showCrowdWarning,
}: {
  category: Category;
  heading: string;
  subheading: string | null;
  selectedIds: string[];
  restrictToIds?: string[];
  disableUnselected?: boolean;
  onToggle: (cardId: string) => void;
  showCrowdWarning?: boolean;
}) {
  const cards = cardsInCategory(category).filter(
    (c) => !restrictToIds || restrictToIds.includes(c.id),
  );
  if (cards.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-display font-semibold uppercase tracking-wider text-navy mb-0.5">
        {heading}
      </p>
      {subheading && <p className="text-xs text-muted mb-2.5">{subheading}</p>}
      <div className="flex flex-col gap-2">
        {cards.map((card) => {
          const selected = selectedIds.includes(card.id);
          const disabled = !selected && !!disableUnselected;
          return (
            <div key={card.id}>
              <button
                type="button"
                onClick={() => onToggle(card.id)}
                aria-pressed={selected}
                disabled={disabled}
                className={[
                  "w-full text-left border px-3.5 py-2.5 transition",
                  selected
                    ? "border-gold bg-highlight"
                    : disabled
                      ? "border-border-brand bg-off-white opacity-50 cursor-not-allowed"
                      : "border-border-brand bg-white hover:border-gold",
                ].join(" ")}
              >
                <span className="block text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light mb-0.5">
                  {card.label}
                </span>
                <span className="block text-sm text-navy leading-snug">{renderClaim(card)}</span>
              </button>
              {showCrowdWarning && selected && card.crowdFlag && (
                <div className="mt-1.5 border border-gold px-3 py-2">
                  <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light">
                    {copy.step2.crowdWarning}
                  </p>
                  <p className="text-xs text-muted leading-relaxed mt-0.5">{card.crowdNote}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
