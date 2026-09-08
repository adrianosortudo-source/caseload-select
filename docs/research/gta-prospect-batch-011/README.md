# GTA public-roster prospect batch 011 — Toronto discovery

Read-only, first-party public-web research observed on **2026-09-08**.

## What this package is

- A 50-firm Toronto discovery wave, not an import manifest, CRM list, ranking, or contact plan.
- 13 records have a first-party page reviewed in this pass. Twelve contain a count-derived lower bound or bounded count; BSLSC remains count-unknown because its reviewed page did not present an auditable roster total.
- 37 records are first-party source queues. They deliberately carry no lawyer-count, ownership, or email claim until a subsequent reviewer opens and classifies the source page.
- Every row is `candidate` and `accepted=false`. Neither this batch nor a published email authorizes outreach, form submission, data export, CRM creation, or contact.

## Boundaries

- Sources are public, first-party firm pages only. No login, LSO automation, bot bypass, form/chat interaction, email, export, scraping of blocked pages, paid source, or private data was used.
- `exact` requires a bounded lawyer roster that separates non-lawyer roles. `at_least` is a lower bound only; it cannot establish an upper count band. `unknown` makes no count claim.
- A role such as partner or managing partner is recorded only when the source uses that title. It is **not** evidence that the person owns the firm. Only explicitly published email addresses are preserved; no address is inferred.
- The batch excludes every canonical domain in batch 010. It has not yet been compared against all console fixtures, the 5,902 historical address clusters, or later ledger imports. Any eventual collision is `update_existing` or `held`, never silently imported as net-new.

## Next handling

1. Re-open each queue source and populate only the supported roster, office, practice, leadership, and public-contact fields.
2. Reconcile by canonical domain, normalized name, office address, and known aliases against the live console and batch 001–010 ledgers.
3. Send only independently reviewed, source-complete records into a later, separately approved staging manifest.

`gta-prospect-batch-011.json` is the source-of-truth staging artifact.
