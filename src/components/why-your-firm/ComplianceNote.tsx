"use client";

/**
 * One rule-check note.
 *
 * Extracted from the old multi-card TestsStep so the custom-claim entry and
 * the per-card test screen render the same verdict block. Two renderings of
 * the same rule would drift, and the whole point of the filter is that a
 * lawyer sees the identical judgment wherever the text is read.
 */

import { copy, type ComplianceRule } from "@/lib/why-your-firm/compliance";

export default function ComplianceNote({ rule }: { rule: ComplianceRule }) {
  const isBlocked = rule.verdict === "blocked";
  return (
    <div className={`mb-3 border px-3 py-2 ${isBlocked ? "border-red-fail" : "border-gold"}`}>
      <p
        className={`text-[10px] font-display font-semibold uppercase tracking-wider ${
          isBlocked ? "text-red-fail" : "text-gold-on-light"
        }`}
      >
        {copy.step3.ruleCheckLabel}: {rule.name}
      </p>
      <p className="text-xs text-muted leading-relaxed mt-0.5">{rule.explanation}</p>
      {rule.conversion && (
        <p className="text-xs text-navy leading-relaxed mt-1">{rule.conversion}</p>
      )}
    </div>
  );
}
