import Link from "next/link";
import { notFound } from "next/navigation";
import {
  evidenceForQualifiedProspect,
  getQualifiedProspectByFirmId,
} from "@/lib/qualified-gta-prospects";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function keepLastTwoWordsTogether(value: string): string {
  const words = value.split(" ");
  if (words.length < 3) return value;
  return [...words.slice(0, -2), words.slice(-2).join("\u00a0")].join(" ");
}

function EvidenceIds({ ids }: { ids: readonly string[] }) {
  return (
    <div className="mt-3 w-full">
      <p className="w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Evidence references</p>
      <ul className="mt-2 flex w-full flex-wrap gap-1.5">
        {ids.map((id) => <li key={id} className="break-all rounded bg-parchment px-2 py-1 text-xs text-black/55">{id}</li>)}
      </ul>
    </div>
  );
}

export default async function QualifiedProspectAuditPage({ params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const dossier = getQualifiedProspectByFirmId(firmId);
  if (!dossier) return notFound();
  const evidence = evidenceForQualifiedProspect(dossier.firmId);

  return (
    <div className="space-y-4 [&_[data-ui-copy]]:text-pretty">
      <Link href="/admin/prospects" className="inline-flex text-sm font-semibold text-navy underline underline-offset-2">Back to prospect list</Link>

      <header className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="qualified-audit-header">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-900">Qualified</span>
          <span className="rounded-full bg-navy/10 px-2 py-1 text-xs font-semibold text-navy">Audit ready</span>
          <span className="rounded-full bg-parchment px-2 py-1 text-xs font-semibold text-field-label">Internal review</span>
        </div>
        <h1 className="mt-3 w-full text-balance text-2xl font-bold text-navy" data-ui-copy="heading">{keepLastTwoWordsTogether(dossier.firmName)}</h1>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">Evidence-linked marketing opportunity audit for the Firm expansion list.</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <a href={dossier.websiteUrl} target="_blank" rel="noreferrer" className="font-semibold text-navy underline underline-offset-2">{dossier.canonicalDomain}</a>
          <span className="text-black/60">Firm ID: {dossier.firmId}</span>
          <span className="text-black/60">Observed {dossier.audit.observedOn}</span>
        </div>
      </header>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="qualification-basis">
        <h2 className="w-full text-lg font-bold text-navy" data-ui-copy="heading">Why this firm qualifies</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">The record meets every requirement in qualification rule {dossier.qualification.ruleVersion}.</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded border border-border-brand bg-parchment/30 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-field-label">Lawyer observation</dt><dd className="mt-1 font-semibold text-navy">{dossier.lawyerCount.observedCount} named lawyers</dd><dd className="mt-1 text-sm text-black/60">{label(dossier.lawyerCount.confidence)} confidence</dd></div>
          <div className="rounded border border-border-brand bg-parchment/30 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-field-label">Advertising</dt><dd className="mt-1 font-semibold text-navy">{label(dossier.advertisingActivity.state)}</dd><dd className="mt-1 text-sm text-black/60">Observable activity</dd></div>
          <div className="rounded border border-border-brand bg-parchment/30 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-field-label">GBP review</dt><dd className="mt-1 font-semibold text-navy">Supported opportunity</dd><dd className="mt-1 text-sm text-black/60">{label(dossier.gbpOpportunity.type)}</dd></div>
          <div className="rounded border border-border-brand bg-parchment/30 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-field-label">Website and intake</dt><dd className="mt-1 font-semibold text-navy">Registered evidence</dd><dd className="mt-1 text-sm text-black/60">{dossier.websiteAndIntake.observedChannels.length} visible channels</dd></div>
        </dl>
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="lawyer-observation">
        <h2 className="w-full text-lg font-bold text-navy" data-ui-copy="heading">Lawyer-count observation</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">{dossier.lawyerCount.completenessLimit}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {dossier.lawyerCount.namedLawyers.map((lawyer) => <li key={lawyer} className="rounded border border-border-brand px-3 py-2 text-sm font-medium text-black/80">{lawyer}</li>)}
        </ul>
        <p className="mt-3 w-full text-xs text-black/55" data-ui-copy="supporting">Observed {dossier.lawyerCount.observedAt}. Source type: {label(dossier.lawyerCount.sourceType)}.</p>
        <a href={dossier.lawyerCount.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-navy underline underline-offset-2">Open lawyer-count source</a>
        <EvidenceIds ids={dossier.lawyerCount.evidenceIds} />
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="advertising-activity">
        <h2 className="w-full text-balance text-lg font-bold text-navy" data-ui-copy="heading">{keepLastTwoWordsTogether("Observable advertising activity")}</h2>
        <p className="mt-1 w-full text-sm text-black/70" data-ui-copy="body">{dossier.advertisingActivity.summary}</p>
        <p className="mt-2 w-full text-sm text-black/60" data-ui-copy="supporting">Observed source types: {dossier.advertisingActivity.sourceTypes.map(label).join(", ")}.</p>
        <p className="mt-3 w-full rounded border border-gold/30 bg-gold/5 px-3 py-2 text-sm text-black/70" data-ui-copy="supporting">The evidence supports observable activity. It does not establish spending, investment level, lead volume, conversion or return.</p>
        <EvidenceIds ids={dossier.advertisingActivity.evidenceIds} />
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="gbp-opportunity">
        <h2 className="w-full text-balance text-lg font-bold text-navy" data-ui-copy="heading">{keepLastTwoWordsTogether("Google Business Profile opportunity")}</h2>
        <p className="mt-1 w-full text-sm font-semibold text-navy" data-ui-copy="supporting">{label(dossier.gbpOpportunity.type)}</p>
        <p className="mt-2 w-full text-sm text-black/70" data-ui-copy="body">{dossier.gbpOpportunity.reason}</p>
        <p className="mt-3 w-full text-sm text-black/60" data-ui-copy="supporting">Recommended review: {dossier.gbpOpportunity.recommendedReview}</p>
        <a href={dossier.gbpOpportunity.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-navy underline underline-offset-2">Open observed public profile</a>
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="website-intake-opportunity">
        <h2 className="w-full text-balance text-lg font-bold text-navy" data-ui-copy="heading">{keepLastTwoWordsTogether("Website and intake opportunity")}</h2>
        <p className="mt-1 w-full text-pretty text-sm text-black/70" data-ui-copy="body">{dossier.websiteAndIntake.opportunityContext}</p>
        <div className="mt-4 overflow-x-auto rounded border border-border-brand">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="bg-parchment text-xs uppercase tracking-wide text-field-label"><tr><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Observed state</th></tr></thead>
            <tbody>{dossier.websiteAndIntake.channels.map((channel) => <tr key={channel.channel} className="border-t border-border-brand"><td className="px-3 py-2 font-medium text-navy">{channel.channel}</td><td className="px-3 py-2 text-black/70">{channel.observed_state}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 w-full text-xs text-black/55" data-ui-copy="supporting">{dossier.websiteAndIntake.limitation}</p>
        <a href={dossier.websiteAndIntake.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-semibold text-navy underline underline-offset-2">Open website source</a>
        <EvidenceIds ids={dossier.websiteAndIntake.evidenceIds} />
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="marketing-review-priorities">
        <h2 className="w-full text-lg font-bold text-navy" data-ui-copy="heading">Marketing review priorities</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">These are questions to verify during a CaseLoad Select marketing review. They guide further investigation and do not assert performance, results or deficiencies.</p>
        <ol className="mt-4 space-y-3">
          {dossier.audit.verificationPriorities.map((priority, index) => (
            <li key={priority} className="flex w-full gap-3 rounded border border-border-brand bg-parchment/20 p-3 text-sm text-black/75" data-ui-copy="body">
              <span aria-hidden="true" className="font-semibold text-gold">{index + 1}.</span>
              <span>{priority}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="evidence-register">
        <h2 className="w-full text-lg font-bold text-navy" data-ui-copy="heading">Registered evidence</h2>
        <p className="mt-1 w-full text-sm text-black/60" data-ui-copy="body">{evidence.length} records preserve the public source, observation time and capture hash used by this audit.</p>
        <div className="mt-3 space-y-2">
          {evidence.map((item) => (
            <details key={item.evidenceId} className="rounded border border-border-brand bg-parchment/20 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">{item.evidenceId}: {label(item.sourceType)}</summary>
              <div className="mt-2 space-y-2 text-xs text-black/65">
                <p>Observed {item.observedAt}</p>
                <p className="break-all">SHA-256: {item.captureSha256}</p>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex font-semibold text-navy underline underline-offset-2">Open public source</a>
                {item.registrationScope.length > 0 && <p>Registered scope: {item.registrationScope.join(", ")}</p>}
                {item.limits.length > 0 && <p>Limits: {item.limits.join(", ")}</p>}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border-brand bg-white p-4 sm:p-6" data-ui-component-content="audit-boundaries">
        <h2 className="w-full text-lg font-bold text-navy" data-ui-copy="heading">Claim and action boundaries</h2>
        <ul className="mt-3 space-y-2 text-sm text-black/70">
          {dossier.audit.claimBoundaries.map((boundary) => <li key={boundary} className="w-full" data-ui-copy="body">{boundary}</li>)}
        </ul>
        <p className="mt-3 w-full text-xs font-semibold uppercase tracking-wide text-field-label" data-ui-copy="supporting">Contact, outreach, form submission, delivery, publication, implementation and PDF generation remain disabled.</p>
      </section>
    </div>
  );
}
