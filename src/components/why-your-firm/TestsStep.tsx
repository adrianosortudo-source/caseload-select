"use client";

/**
 * Step 3: the three tests plus the compliance filter, one card at a time.
 *
 * Every ranked card gets: its input field if it needs one, a proof line, the
 * three test toggles (provable, in demand, unique via the substitution
 * framing), and a live compliance verdict. The verdict runs against both the
 * card's own complianceFlag (static, decided when the card was written) and
 * whatever the lawyer types into the proof line (dynamic, via
 * rulesTriggeredBy: this is the only place R3 can ever fire, since no card
 * claim in the deck itself uses a superlative).
 *
 * Judgments are computed with the same engine.computeSurvivors the API route
 * calls, so what the lawyer sees here is exactly what the brief will show,
 * not a preview that can drift from the real output.
 */

import { getCard, renderClaim, type DifferentiatorCard } from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";
import { capAndRank, computeSurvivors, evaluateCardCompliance, type CardJudgment } from "@/lib/why-your-firm/engine";
import type { CardEntry, WizardData } from "./WhyYourFirm";

interface Props {
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
  onContinue: () => void;
  onBack: () => void;
}

const EMPTY_ENTRY: CardEntry = {
  inputValue: "",
  proof: "",
  tests: { provable: false, inDemand: false, unique: false },
};

export default function TestsStep({ data, onPatch, onContinue, onBack }: Props) {
  const rankedIds = capAndRank(data.passTwoIds);

  function entryFor(cardId: string): CardEntry {
    return data.cardEntries[cardId] ?? EMPTY_ENTRY;
  }

  function updateEntry(cardId: string, changes: Partial<CardEntry>) {
    onPatch((prev) => {
      const current = prev.cardEntries[cardId] ?? EMPTY_ENTRY;
      return {
        cardEntries: {
          ...prev.cardEntries,
          [cardId]: { ...current, ...changes },
        },
      };
    });
  }

  const work = rankedIds.map((cardId) => ({ cardId, ...entryFor(cardId) }));
  const { survivors, dropped } = computeSurvivors(work);
  const judgmentByCardId = new Map<string, CardJudgment>(
    [...survivors, ...dropped].map((j) => [j.card.id, j]),
  );

  if (rankedIds.length === 0) {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-display font-bold text-navy mb-3">{copy.step3.title}</h1>
        <p className="text-sm text-body leading-relaxed mb-5">{copy.step2.emptyPassTwo}</p>
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
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step3.title}</h1>
      <p className="text-sm text-body leading-relaxed mb-6">{copy.step3.prompt}</p>

      <div className="flex flex-col gap-6 mb-6">
        {rankedIds.map((cardId) => {
          const card = getCard(cardId);
          if (!card) return null;
          const entry = entryFor(cardId);
          const judgment = judgmentByCardId.get(cardId);
          return (
            <CardPanel
              key={cardId}
              card={card}
              entry={entry}
              judgment={judgment}
              onChange={(changes) => updateEntry(cardId, changes)}
            />
          );
        })}
      </div>

      <p className="text-xs text-muted mb-4">
        {survivors.length} of {rankedIds.length} held up so far. Keep going, this updates as you answer.
      </p>

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

function CardPanel({
  card,
  entry,
  judgment,
  onChange,
}: {
  card: DifferentiatorCard;
  entry: CardEntry;
  judgment: CardJudgment | undefined;
  onChange: (changes: Partial<CardEntry>) => void;
}) {
  const compliance = evaluateCardCompliance(card, entry.proof);
  const claimText = renderClaim(card, entry.inputValue);
  const proofGiven = entry.proof.trim().length > 0;
  const judged = proofGiven || compliance.blocked;

  return (
    <div className="border border-border-brand p-4">
      <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light mb-1">
        {card.label}
      </p>
      <p className="text-sm font-semibold text-navy leading-snug mb-3">{claimText}</p>

      {card.inputLabel && (
        <div className="mb-3">
          <label className="label">{card.inputLabel}</label>
          <input
            type="text"
            className="input"
            value={entry.inputValue}
            onChange={(e) => onChange({ inputValue: e.target.value })}
          />
        </div>
      )}

      <div className="mb-3">
        <label className="label">{copy.step3.proofPromptLabel}</label>
        <p className="text-xs text-muted mb-1.5">{card.proofPrompt}</p>
        <textarea
          className="input min-h-[64px] resize-y"
          placeholder={copy.step3.proofPlaceholder}
          value={entry.proof}
          onChange={(e) => onChange({ proof: e.target.value })}
        />
      </div>

      {compliance.staticRule && (
        <ComplianceNote rule={compliance.staticRule} />
      )}
      {compliance.textRules
        .filter((r) => r.id !== compliance.staticRule?.id)
        .map((rule) => (
          <ComplianceNote key={rule.id} rule={rule} />
        ))}

      <div className="flex flex-col gap-1.5 mb-3 mt-3">
        <TestToggle
          label={copy.step3.testProvable}
          checked={entry.tests.provable}
          onChange={(v) => onChange({ tests: { ...entry.tests, provable: v } })}
        />
        <TestToggle
          label={copy.step3.testDemand}
          checked={entry.tests.inDemand}
          onChange={(v) => onChange({ tests: { ...entry.tests, inDemand: v } })}
        />
        <TestToggle
          label={copy.step3.testUnique}
          sub={copy.step3.testUniqueHelper}
          checked={entry.tests.unique}
          onChange={(v) => onChange({ tests: { ...entry.tests, unique: v } })}
        />
      </div>

      {judged && judgment && (
        <p
          className={[
            "text-xs font-display font-semibold uppercase tracking-wider",
            judgment.survives ? "text-green-pass" : "text-red-fail",
          ].join(" ")}
        >
          {judgment.survives ? copy.step3.survived : copy.step3.dropped}
          {!judgment.survives && judgment.dropReason ? ` · ${judgment.dropReason}` : ""}
        </p>
      )}
    </div>
  );
}

function ComplianceNote({ rule }: { rule: { id: string; name: string; explanation: string; conversion: string | null; verdict: string } }) {
  const isBlocked = rule.verdict === "blocked";
  return (
    <div className={`mb-3 border-l-2 pl-3 py-1 ${isBlocked ? "border-red-fail" : "border-gold"}`}>
      <p className={`text-[10px] font-display font-semibold uppercase tracking-wider ${isBlocked ? "text-red-fail" : "text-gold-on-light"}`}>
        {copy.step3.ruleCheckLabel}: {rule.name}
      </p>
      <p className="text-xs text-muted leading-relaxed mt-0.5">{rule.explanation}</p>
      {rule.conversion && (
        <p className="text-xs text-navy leading-relaxed mt-1">{rule.conversion}</p>
      )}
    </div>
  );
}

function TestToggle({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm text-navy">{label}</span>
        {sub && <span className="block text-xs text-muted mt-0.5">{sub}</span>}
      </span>
    </label>
  );
}
