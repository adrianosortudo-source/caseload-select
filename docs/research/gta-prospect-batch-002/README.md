# GTA public-roster prospect batch 002

Read-only, first-party public-web roster staging for the GTA/Durham target geography. Observed **2026-09-07** from public pages controlled by the named firm/domain.

## Scope and gate

- 25 firms across Toronto proper, Etobicoke, North York, Pickering, Whitby and Oshawa. No qualifying first-party 3–10 roster was accepted from Ajax or Scarborough in this lane.
- A row is a **candidate** only. No CRM, import, outreach, form submission, chat, contact, private data, LSO automation, or identity allocation occurred.
- `count_qualifier=exact` means the first-party page labels the listed people as current lawyers/partners/counsel/associates and non-lawyer staff were excluded. `uncertain` means the page lists a bounded team but lawyer status/cardinality is not explicit or is role-ambiguous.
- **Accepted: 0; candidate: 22; uncertain: 3.** “Accepted” is intentionally zero because no human/regulatory identity gate was run. The 22 exact observations are still workflow candidates; the 3 uncertain observations are Creighton, Ristich and Goldmans.
- Practice areas are included only where published on the same first-party surface or clearly linked first-party content; an empty array means not published in the roster source.
- Observation is a public-site snapshot, not proof of LSO standing, completeness, advertising activity, CRM state, revenue, performance, or contactability.
- Recheck note: Harcourt’s first-party roster was available in first-party indexed content, but its hostname did not resolve in the final local DNS GET check; keep that row as a candidate requiring a fresh live fetch before any acceptance decision.

## Reconciliation

The 20 existing candidate records were read from the local contract reconciliation artifact dated 2026-09-06 and compared by firm name/domain. The legacy source was the inspected `Prospect_Intelligence_Database_2026-08-20/raw/claude-artifact-v13-data.json` artifact, compared by business name/domain. No new row has an exact match to the existing 20. Ten rows have same-domain legacy rows (TAP, Lundy Levy & Eski, Weisberg, Nia Law, Waldman, SBS, ZSRH, KND and Coristine); those are explicitly marked for reconciliation, never silently merged or promoted.

## Files

- `gta-prospect-batch-002.json` — complete machine-readable staging records with roster names, URLs, qualifiers, aliases and duplicate/reconciliation assessment.
- `gta-prospect-batch-002.csv` — flat review/export view of the same rows.
- `README.md` — method and gate notes.

## Source policy

All roster URLs in the JSON/CSV are first-party firm domains. Search/index results were used only to discover candidate URLs; row evidence is the linked first-party page itself. This package does not include third-party directory, LSO, social, CRM or contact evidence.
