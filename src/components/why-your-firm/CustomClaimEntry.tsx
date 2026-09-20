"use client";

/**
 * The lawyer's own words, one per category.
 *
 * The deck holds thirty-eight claims and cannot hold every firm's edge, so
 * every pass-one screen ends with this. A custom claim then runs the exact
 * same route as a deck claim, because the engine materialises it into the
 * same card shape: kept or cut on the keep screen, tested and evidenced on
 * its own test screen, judged by the same filter, ranked into the same brief.
 *
 * TYPING IS NOT SELECTING
 * Text in the box does nothing on its own. The lawyer picks the claim the
 * same way they pick a deck card, which keeps one mental model across the
 * whole screen instead of two. Clearing the text is the inverse and has to
 * unpick it, or the wizard would carry an id whose sentence no longer exists
 * into keep, into a test screen, and into the brief. That removal happens in
 * the SAME updater as the text change, reading `prev`, never a second patch:
 * two patches in one handler is exactly the batching bug WhyYourFirm's
 * patch() comment records.
 *
 * THE ASSIST IS OPT-IN AND ADVISORY
 * It fires on an explicit press and never on blur, on a timer, or on a
 * keystroke, because a tool that quietly ships a lawyer's draft wording
 * somewhere the moment they stop typing has not told them the truth about
 * what it does. The deterministic filter below runs on whichever version
 * wins, suggestion or original, and nothing is gated on the assist: a failed
 * request leaves the typed text exactly where it was.
 */

import { useState } from "react";
import { CATEGORIES, type Category } from "@/lib/why-your-firm/differentiators";
import { copy, COMPLIANCE_RULES, type ComplianceRule } from "@/lib/why-your-firm/compliance";
import { customIdFor, evaluateFreeText } from "@/lib/why-your-firm/engine";
import type { WizardData } from "@/lib/why-your-firm/screens";
import ComplianceNote from "./ComplianceNote";

interface Props {
  category: Category;
  data: WizardData;
  onPatch: (updater: Partial<WizardData> | ((prev: WizardData) => Partial<WizardData>)) => void;
}

interface Suggestion {
  tightenedClaim: string;
  category: Category | null;
  concerns: { rule: ComplianceRule; note: string }[];
}

interface AssistResponse {
  ok?: boolean;
  tightenedClaim?: string;
  category?: string;
  concerns?: { ruleId?: string; note?: string }[];
}

function categoryLabel(id: Category): string | null {
  return CATEGORIES.find((c) => c.id === id)?.label ?? null;
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.some((c) => c.id === value);
}

export default function CustomClaimEntry({ category, data, onPatch }: Props) {
  const customId = customIdFor(category);
  const text = data.customClaims[category] ?? "";
  const selected = data.passOneIds.includes(customId);

  const [showEmpty, setShowEmpty] = useState(false);
  const [working, setWorking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const written = text.trim().length > 0;
  const compliance = evaluateFreeText(text);

  /**
   * One updater for the text and for every id that depends on it. Clearing
   * the box has to drop the claim out of both passes, and doing that in a
   * second patch call would read a stale array under React 18 batching.
   */
  function writeClaim(value: string) {
    setShowEmpty(false);
    onPatch((prev) => {
      const claims = { ...prev.customClaims, [category]: value };
      if (value.trim().length === 0) {
        return {
          customClaims: claims,
          passOneIds: prev.passOneIds.filter((id) => id !== customId),
          passTwoIds: prev.passTwoIds.filter((id) => id !== customId),
        };
      }
      return { customClaims: claims };
    });
  }

  function toggleSelected() {
    if (!written) {
      setShowEmpty(true);
      return;
    }
    setShowEmpty(false);
    onPatch((prev) => {
      const has = prev.passOneIds.includes(customId);
      return {
        passOneIds: has
          ? prev.passOneIds.filter((id) => id !== customId)
          : [...prev.passOneIds, customId],
      };
    });
  }

  async function requestAssist() {
    if (!written || working) return;
    setWorking(true);
    setUnavailable(false);
    setSuggestion(null);
    try {
      const proof = data.cardEntries[customId]?.proof?.trim();
      const res = await fetch("/api/tools/why-your-firm/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: text.trim(), proof: proof || undefined }),
      });
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const json = (await res.json()) as AssistResponse;
      const tightened = typeof json.tightenedClaim === "string" ? json.tightenedClaim.trim() : "";
      if (!json.ok || tightened.length === 0) {
        setUnavailable(true);
        return;
      }
      const concerns = (json.concerns ?? [])
        .map((c) => {
          const rule = COMPLIANCE_RULES.find((r) => r.id === c.ruleId);
          const note = typeof c.note === "string" ? c.note.trim() : "";
          return rule && note.length > 0 ? { rule, note } : null;
        })
        .filter((c): c is { rule: ComplianceRule; note: string } => c !== null);
      setSuggestion({
        tightenedClaim: tightened,
        category: isCategory(json.category) ? json.category : null,
        concerns,
      });
    } catch {
      setUnavailable(true);
    } finally {
      setWorking(false);
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    writeClaim(suggestion.tightenedClaim);
    setSuggestion(null);
  }

  const differingLabel =
    suggestion && suggestion.category && suggestion.category !== category
      ? categoryLabel(suggestion.category)
      : null;

  return (
    <div className="border border-border-brand">
      <button
        type="button"
        onClick={toggleSelected}
        aria-pressed={selected}
        className={[
          "w-full text-left border-b border-border-brand px-3.5 py-2.5 transition",
          selected ? "bg-highlight" : "bg-off-white hover:bg-highlight",
        ].join(" ")}
      >
        <span className="block text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light mb-0.5">
          {copy.custom.label}
        </span>
        <span className="block text-sm text-navy leading-snug">{copy.custom.invitation}</span>
      </button>

      <div className="p-3.5">
        <textarea
          className="input min-h-[72px] resize-y"
          placeholder={copy.custom.placeholder}
          value={text}
          onChange={(e) => writeClaim(e.target.value)}
        />

        {showEmpty && <p className="text-xs text-red-fail mt-2">{copy.custom.empty}</p>}

        {compliance.rules.length > 0 && (
          <div className="mt-3">
            {compliance.rules.map((rule) => (
              <ComplianceNote key={rule.id} rule={rule} />
            ))}
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={!written || working}
            onClick={requestAssist}
          >
            {working ? copy.assist.working : copy.assist.button}
          </button>
        </div>

        {unavailable && <p className="text-xs text-muted mt-2 leading-relaxed">{copy.assist.unavailable}</p>}

        {suggestion && (
          <div className="mt-3 border border-border-brand p-3">
            <p className="text-xs text-muted leading-relaxed mb-3">{copy.assist.intro}</p>

            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <p className="label">{copy.assist.yoursLabel}</p>
                <p className="text-sm text-navy leading-snug">{text}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="label">{copy.assist.suggestionLabel}</p>
                <p className="text-sm text-navy leading-snug">{suggestion.tightenedClaim}</p>
              </div>
            </div>

            {suggestion.concerns.length > 0 && (
              <div className="mb-3">
                <p className="label">{copy.assist.concernsLabel}</p>
                {suggestion.concerns.map((c) => (
                  <p key={c.rule.id} className="text-xs text-muted leading-relaxed">
                    {c.rule.name}: {c.note}
                  </p>
                ))}
              </div>
            )}

            {differingLabel && (
              <p className="text-xs text-muted leading-relaxed mb-3">
                {copy.assist.categoryDiffers} {differingLabel}
              </p>
            )}

            <div className="flex gap-2">
              <button type="button" className="btn-ghost text-sm" onClick={() => setSuggestion(null)}>
                {copy.step3.ruleKeepMine}
              </button>
              <button type="button" className="btn-gold text-sm" onClick={acceptSuggestion}>
                {copy.step3.ruleUseConversion}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
