# Qualified prospect cohort import

The September 7, 2026 cohort is stored in `src/data/qualified-gta-prospects.json`. It contains 20 firm dossiers and 94 registered public evidence records. The source-controlled artifact is the runtime input for the Firm expansion view.

## Identity and reconciliation

`mergeQualifiedProspects` in `src/lib/qualified-gta-prospects.ts` compares each dossier with the reviewed Firm expansion records by normalized canonical domain.

- One domain match enriches that record and preserves its existing record ID, display name, location, practice areas and legacy provenance.
- No domain match adds one source-controlled Firm expansion record.
- Multiple domain matches hold the dossier as ambiguous and add no duplicate.
- Reprocessing an already enriched result does not add another firm.

The route returns an explicit reconciliation report with added, updated and ambiguous counts. The governed `firmId` remains separate from an existing source record ID so the qualified cohort and evidence registry share one identity without rewriting earlier provenance.

## Qualification contract

Every qualified dossier retains:

- An accepted observation of exactly two or three named lawyers, including source, observation time, confidence and completeness limit.
- Observable current, recent or historical advertising activity, including the exact evidence source types, with no spending or investment claim.
- A supported Google Business Profile opportunity and its public source.
- Registered website and visible-intake observations.
- The internal audit ID, readiness state, marketing review priorities, claim boundaries and evidence references. Review priorities remain questions for verification, not performance or outcome claims.
- Source URLs and SHA-256 capture hashes for every registered evidence record.

Contact, sending, outreach, form submission, delivery, publication, implementation and PDF generation controls are false in the aggregate artifact and in every dossier.

## Rebuild from the reviewed source package

The committed artifact can be rebuilt when a newly completed source package is available:

```powershell
node scripts/build-qualified-gta-prospects.mjs --source-root "C:\path\to\_agent_tmp"
```

The builder fails before writing if the source does not contain exactly 20 linked dossiers, 94 unique evidence records, accepted two-or-three-lawyer observations, supported GBP opportunities, registered website evidence, ready internal audits and disabled external-action controls.

No database write, CRM import, CRM action, contact, deployment or publication is performed by the builder or the runtime merger.
