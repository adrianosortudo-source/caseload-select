"use client";

/**
 * Inline rendering of the Firm Positioning Brief. Section order matches
 * brief-pdf.tsx exactly (build plan §3.10); the two must never drift, since
 * the PDF is presented as the same artifact, not a different summary of it.
 */

import { copy } from "@/lib/why-your-firm/compliance";
import type { BriefData } from "@/lib/why-your-firm/engine";

export default function BriefView({ brief }: { brief: BriefData }) {
  return (
    <div className="flex flex-col gap-8">
      {brief.alternatives.length > 0 && (
        <section>
          <p className="label mb-1">{copy.brief.sectionAlternatives}</p>
          <p className="text-xs text-muted leading-relaxed mb-3">{copy.brief.sectionAlternativesIntro}</p>
          <div className="flex flex-col gap-3">
            {brief.alternatives.map((alt) => (
              <div key={alt.id}>
                <p className="text-sm font-semibold text-navy">{alt.label}</p>
                <p className="text-xs text-muted leading-relaxed mt-0.5">{alt.clientCost}</p>
              </div>
            ))}
            {brief.alternativeOtherText && (
              <div>
                <p className="text-sm font-semibold text-navy">In your own words</p>
                <p className="text-xs text-muted leading-relaxed mt-0.5">{brief.alternativeOtherText}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <p className="label mb-2">{copy.brief.sectionDifferentiators}</p>
        {brief.survivors.length > 0 ? (
          <>
            <div className="flex flex-col gap-2">
              {brief.survivors.map((j) => (
                <div key={j.card.id} className="border-l-2 border-gold bg-off-white p-3">
                  <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light mb-1">
                    {j.card.label}
                  </p>
                  <p className="text-sm font-semibold text-navy leading-snug mb-1">{j.claimText}</p>
                  <p className="text-xs text-muted leading-relaxed">{j.proof}</p>
                </div>
              ))}
            </div>
            <p className="text-sm font-semibold text-navy mt-3">{copy.brief.combinationLine}</p>
          </>
        ) : (
          <p className="text-sm text-body leading-relaxed">{copy.brief.noSurvivors}</p>
        )}
      </section>

      {brief.dropped.length > 0 && (
        <section>
          <p className="label mb-1">{copy.brief.sectionDropped}</p>
          <p className="text-xs text-muted leading-relaxed mb-3">{copy.brief.sectionDroppedIntro}</p>
          <div className="flex flex-col gap-2">
            {brief.dropped.map((j) => (
              <div key={j.card.id} className="border-b border-border-brand pb-2">
                <p className="text-sm font-semibold text-navy">{j.card.label}</p>
                <p className="text-xs text-muted leading-relaxed mt-0.5">{j.dropReason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {brief.statement && (
        <section>
          <p className="label mb-2">{copy.brief.sectionStatement}</p>
          <div className="bg-navy p-5">
            <p className="text-lg font-display font-bold text-white leading-snug">{brief.statement}</p>
          </div>
        </section>
      )}

      <section>
        <p className="label mb-2">{copy.brief.sectionSurfaces}</p>
        <div className="flex flex-col gap-2">
          {copy.brief.surfaces.map((surface) => (
            <div key={surface.name}>
              <p className="text-sm font-semibold text-navy">{surface.name}</p>
              <p className="text-xs text-muted leading-relaxed mt-0.5">{surface.line}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="label mb-2">{copy.brief.sectionHomework}</p>
        <p className="text-sm text-body leading-relaxed">{copy.brief.homework}</p>
      </section>

      <section className="bg-navy p-5">
        <p className="text-base font-display font-bold text-white mb-2">{copy.brief.sectionBridge}</p>
        <p className="text-sm text-white/80 leading-relaxed mb-2">{copy.brief.bridge}</p>
        <p className="text-sm text-white/90 leading-relaxed mb-3">{copy.brief.bridgeThreeWay}</p>
        <a href="/screen-demo" className="btn-gold inline-block text-sm">
          {copy.brief.bridgeCta}
        </a>
      </section>

      <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-muted text-center">
        {copy.brief.footerMark}
      </p>
    </div>
  );
}
