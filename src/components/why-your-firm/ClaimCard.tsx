"use client";

/**
 * One selectable claim, deck or custom.
 *
 * The card face is the card's own label and claim text, rendered through
 * renderClaim so a slot card reads as a sentence rather than as a template.
 * A custom claim arrives here already materialised by the engine, so this
 * component never needs to know which kind it is holding: that is the whole
 * point of materializeCard, and it is why the custom entry can flow through
 * keep, tests, statement and brief without a second code path.
 */

import { renderClaim, type DifferentiatorCard } from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";

interface Props {
  card: DifferentiatorCard;
  selected: boolean;
  /** True when the cap is reached and this card is not one of the kept ones. */
  disabled?: boolean;
  onToggle: () => void;
  /** Keep screen only: the convergence warning under a selected crowd card. */
  showCrowdWarning?: boolean;
}

export default function ClaimCard({
  card,
  selected,
  disabled,
  onToggle,
  showCrowdWarning,
}: Props) {
  const isDisabled = !selected && !!disabled;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        disabled={isDisabled}
        className={[
          "w-full text-left border px-3.5 py-2.5 transition",
          selected
            ? "border-gold bg-highlight"
            : isDisabled
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
}
