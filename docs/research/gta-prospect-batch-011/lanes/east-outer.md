# Batch 011 EAST_OUTER research

Observation date: 2026-09-08

## Scope and method

This lane covers private-practice firms with a public presence in Durham/east and approved outer GTA municipalities. Public search was used for discovery; evidence was retained only from accessible firm-owned roster, team, about, office, or contact pages. Counts are visible current lawyer roles only: staff, clerks, retired lawyers, and unbounded directory results are not counted. An exact count means the cited page exposed a bounded current roster; `at_least` means the page exposed a defensible minimum but not a closed roster.

No forms, chats, logins, outreach, ads, GBP, CRM, database, or production-import actions were used. The five provisional enrichment records include only visibly published named/general emails with source URLs and observation date; no email was inferred. No owner, founder, or leadership title was inferred.

## Disposition

- Records researched: 50
- Provisional staging after independent QA: 5
- Held: 45
- Collision/update holds: 5
- Lower-bound count holds: 2
- Rejected: 0

The five provisional records enriched in this pass are Walker Head, Devry Smith Frank, Longo Lawyers, Speigel Nichols Fox, and Deacon Spears Fedson + Montizambert. Their structured enrichment records include only visibly published first-party street addresses, practice labels, leadership titles, and named/general emails, with source URLs and the 2026-09-08 observation date. Longo’s outer-GTA locations remain service-area evidence; its cited street address is the published Toronto office, and the outer-city street address is explicitly unknown.

Independent QA moved Wilson Vukelich, SimpsonWigle, Will Trial Lawyers, Rashidy & Associates, and DeRusha Law Firm to collision/update hold. RZCD and Refcio & Associates moved to lower-bound-count hold. These seven records remain in the JSON for traceability but were not enriched beyond canonical unknowns in this pass. All five provisional records also remain provisional pending full baseline reconciliation and independent review.

## Original candidate count notes

- Walker Head: 21 exact.
- Devry Smith Frank: over 70, treated as a firm-wide `at_least` minimum; Whitby office evidence is separate and does not imply a 70-lawyer Whitby office.
- Wilson Vukelich: 21 exact.
- SimpsonWigle: at least 7 visible current lawyer profiles across Hamilton/Burlington.
- Longo Lawyers: 11 exact visible lawyers; the page exposes multi-city GTA service/office scope.
- Will Trial Lawyers: 4 exact current lawyers; a retired profile was excluded.
- Speigel Nichols Fox: 10 exact current lawyer/counsel profiles.
- Rashidy & Associates: 5 exact Canadian-office lawyers.
- DeRusha Law Firm: 5 exact named lawyers.
- RZCD: at least 10 current profiles; the page is sectioned by partners, associates, and counsel.
- Deacon Spears Fedson + Montizambert: 6 exact current lawyers; Oakville office is public.
- Refcio & Associates: at least 4 firm-wide profiles; Burlington is explicitly an appointment-only satellite office.

## Collision and exclusion controls

The lane was checked against Batch 001-010 canonical domains and the current 103-record manifest before drafting. Known baseline domains were removed from the candidate set. MBB is held because the `mbb.ca` identity may collide with the prior MBBM Lawyers identity. Possible collisions with the parallel Batch 011 Toronto/west lane were not promoted; the central reconciliation step must compare canonical domains, names, aliases, and office scope before staging.

This follow-up pass is based on the pushed lane commit and uses a new enrichment branch. It does not merge, import, deploy, contact, submit a form, or write a database.

The JSON contains source-only office, practice, leadership, and explicitly published email evidence for the five provisional records; it contains no phone numbers, forms, chat, outreach, or inferred contact data. Central reconciliation should re-open the cited first-party pages at staging time and preserve the held status for any record whose office, roster freshness, or collision evidence remains unresolved.
