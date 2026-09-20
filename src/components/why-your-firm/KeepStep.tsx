"use client";

/**
 * Pass two: keep up to six, across everything that survived pass one.
 *
 * This is the one screen in the wizard that deliberately shows more than one
 * question's worth of material, because the question itself is comparative:
 * "keep six" cannot be answered a category at a time without the lawyer
 * losing track of what they have already spent. So the survivors are laid out
 * together, grouped in the deck's own category order, with a live count.
 *
 * THE CAP IS ENFORCED AGAINST `prev`, NOT AGAINST THE PROP
 * A lawyer clicking a sixth and a seventh card in the same frame would, under
 * a stale-closure toggle, get both: each click would read the same
 * five-length array and decide there was room. Reading prev inside the
 * updater is what makes the seventh click a no-op instead of a silent
 * seventh keep. Same defect class as the one WhyYourFirm's patch() comment
 * records, same fix.
 */

import { CATEGORIES, KEEP_CAP } from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";
import { customIdFor, materializeCard } from "@/lib/why-your-firm/engine";
import type { WizardData } from "@/lib/why-your-firm/screens";
import ClaimCard from "./ClaimCard";

interface Props {
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
  onBack: () => void;
}

export default function KeepStep({ data, onPatch, onContinue, onBack }: Props) {
  const atCap = data.passTwoIds.length >= KEEP_CAP;

  function toggle(cardId: string) {
    onPatch((prev) => {
      const has = prev.passTwoIds.includes(cardId);
      // The cap is read from the latest state, so a burst of clicks cannot
      // slip past it. The standing message below explains the dead click.
      if (!has && prev.passTwoIds.length >= KEEP_CAP) return {};
      return {
        passTwoIds: has
          ? prev.passTwoIds.filter((x) => x !== cardId)
          : [...prev.passTwoIds, cardId],
      };
    });
  }

  const groups = CATEGORIES.map((meta) => {
    const ids = data.passOneIds.filter((id) => {
      const card = materializeCard(id, data.customClaims);
      return card !== null && card.category === meta.id;
    });
    // The custom claim ranks after the deck within its own category, the same
    // order capAndRank uses, so the keep screen reads in brief order.
    const customId = customIdFor(meta.id);
    const ordered = [...ids.filter((id) => id !== customId), ...ids.filter((id) => id === customId)];
    return { meta, ids: ordered };
  }).filter((g) => g.ids.length > 0);

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
        {groups.map((group) => (
          <div key={group.meta.id}>
            <p className="text-xs font-display font-semibold uppercase tracking-wider text-navy mb-2.5">
              {group.meta.label}
            </p>
            <div className="flex flex-col gap-2">
              {group.ids.map((cardId) => {
                const card = materializeCard(cardId, data.customClaims);
                if (!card) return null;
                return (
                  <ClaimCard
                    key={cardId}
                    card={card}
                    selected={data.passTwoIds.includes(cardId)}
                    disabled={atCap}
                    onToggle={() => toggle(cardId)}
                    showCrowdWarning
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {data.passTwoIds.length === 0 && (
        <p className="text-xs text-muted mb-4">{copy.step2.emptyPassTwo}</p>
      )}

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
