"use client";

/**
 * One kept claim, three tests, one rule check.
 *
 * Every claim the lawyer kept earns its own screen. That is what makes the
 * denominator on the counter move: a run with two kept claims is genuinely
 * shorter than a run with six, and the wizard says so rather than reporting a
 * constant that would be a lie for most lawyers.
 *
 * The verdict is computed with the same engine.computeSurvivors the API route
 * calls, and with the same customClaims, so what the lawyer reads here is
 * exactly what the brief will show. A custom claim is materialised into the
 * identical card shape, which is why there is no second rendering path for
 * one: the only difference is that the filter also scans the claim itself,
 * and that decision lives in the engine where the server shares it.
 */

import { renderClaim, type DifferentiatorCard } from "@/lib/why-your-firm/differentiators";
import { copy } from "@/lib/why-your-firm/compliance";
import {
  computeSurvivors,
  evaluateCardCompliance,
  materializeCard,
  type CardJudgment,
} from "@/lib/why-your-firm/engine";
import type { CardEntry, WizardData } from "@/lib/why-your-firm/screens";
import ComplianceNote from "./ComplianceNote";

interface Props {
  cardId: string;
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

export default function TestStep({ cardId, data, onPatch, onContinue, onBack }: Props) {
  const card = materializeCard(cardId, data.customClaims);
  const entry = data.cardEntries[cardId] ?? EMPTY_ENTRY;

  function updateEntry(changes: Partial<CardEntry>) {
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

  const nav = (
    <div className="flex gap-2">
      <button type="button" className="btn-ghost" onClick={onBack}>
        {copy.tool.back}
      </button>
      <button type="button" className="btn-gold" onClick={onContinue}>
        {copy.tool.next}
      </button>
    </div>
  );

  // Only reachable when a custom claim was kept and its text was then cleared
  // somewhere other than its own screen. The claim has no sentence left to
  // test, so the screen says so instead of testing an empty string.
  if (!card) {
    return (
      <div className="card p-6">
        <h1 className="text-xl font-display font-bold text-navy mb-3">{copy.step3.title}</h1>
        <p className="text-sm text-body leading-relaxed mb-5">{copy.custom.empty}</p>
        {nav}
      </div>
    );
  }

  const { survivors, dropped } = computeSurvivors(
    [{ cardId, ...entry }],
    data.customClaims,
  );
  const judgment: CardJudgment | undefined = survivors[0] ?? dropped[0];

  return (
    <div className="card p-6">
      <h1 className="text-xl font-display font-bold text-navy mb-2">{copy.step3.title}</h1>
      <p className="text-sm text-body leading-relaxed mb-6">{copy.step3.prompt}</p>

      <CardPanel
        card={card}
        entry={entry}
        judgment={judgment}
        onChange={updateEntry}
      />

      <div className="mt-6">{nav}</div>
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

      {compliance.staticRule && <ComplianceNote rule={compliance.staticRule} />}
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
