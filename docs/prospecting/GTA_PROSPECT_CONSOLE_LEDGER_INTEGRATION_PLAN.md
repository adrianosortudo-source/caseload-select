# GTA prospect console ledger integration plan

## Decision

The operator console cannot safely read the governed GTA research ledger from
PR #232 as it stands. This is intentional: its migration revokes all table
privileges from `service_role` and grants only the five import lifecycle
functions. The existing `/admin/prospects/reconciled` route therefore has no
read capability it can use without weakening the ledger's access boundary.

Do not add table grants to make the page work. Do not query
`agency_prospects` or `caseload_prospects`. Neither is this research ledger.

This document is the required source-controlled integration plan. It leaves
the current twenty reviewed, source-controlled records in place as the safe
fallback until a deliberately limited read projection and a complete seed have
both been applied and verified.

## Target read contract

Add one database function in a follow-up migration after PR #232 is merged:

`public.list_gta_prospect_research_for_operator()`

It must be `SECURITY DEFINER`, use `SET search_path = ''`, and return only a
typed public-research projection. Grant `EXECUTE` only to `service_role`; keep
all direct table privileges revoked from `PUBLIC`, `anon`, `authenticated`, and
`service_role`.

Each returned row must map one-to-one to `ReconciledGtaProspect`:

| Console field | Ledger source |
| --- | --- |
| `id` | `gta_prospect_firms.source_record_key` |
| `firmName`, `websiteUrl`, `reconciliationStatus` | `gta_prospect_firms` |
| `city`, `officeCities` | `gta_prospect_offices` (distinct, stable order) |
| `practiceAreas` | empty array until a reviewed, typed practice-area source exists; never infer it from website text |
| roster fields | newest reviewed `gta_prospect_roster_observations` by `observed_on`, then immutable row id as tie-breaker |
| legacy crosswalk and cluster count | the latest reviewed identity-adjudication metadata only when the ledger has a typed field for it; otherwise `null` |
| optional advertising / GBP evidence | newest matching typed `gta_prospect_evidence_links`, or `unknown` and `null` |

The projection must exclude: contact details, email addresses, phone numbers,
form endpoints, messaging/outreach state, CRM IDs, lawyer identities, raw
import JSON, import hashes, and any non-public operational metadata.

The function must return an empty set when the ledger has no applied batches.
It must not write, mutate state, traverse websites, or call external services.

## Cutover and fallback rule

The current `RECONCILED_GTA_PROSPECTS` fixture remains the displayed dataset
until both conditions are true:

1. The projection RPC exists and responds successfully.
2. An applied, reviewed seed batch contains every one of the fixture's twenty
   `sourceRecordKey` values, with no duplicate source keys.

The route should expose a provenance field, not silently mix data sources:

```ts
type RecordsResponse = {
  records: ReconciledGtaProspect[];
  source: "fixture" | "ledger";
  fallbackReason?: "ledger_unavailable" | "fixture_seed_incomplete";
};
```

If the RPC is unavailable because its migration has not been applied, return
the fixture with `source: "fixture"` and `fallbackReason:
"ledger_unavailable"`. If the RPC works but the complete fixture seed is not
present, return the fixture with `fallbackReason: "fixture_seed_incomplete"`.
A successful ledger query with an unexpected error must be a visible 500,
not a fallback, so a real authorization or data-integrity regression cannot be
mistaken for a harmless pre-migration state.

Once the complete fixture seed is present, return only the ledger projection.
That avoids silent duplicates and makes the database the single source of truth
for later reviewed additions. The UI should identify the displayed source in
operator-only copy, for example: "Source: governed research ledger" or
"Source: reviewed source-controlled fixture (ledger cutover pending)."

## Ordered implementation

1. Merge PR #232. Do not apply its migration or import data as part of this
   merge.
2. Create a narrowly scoped follow-up PR containing the read-only projection
   migration, its real-Postgres tests, and no table grants.
3. In the same PR or a dependent console PR, add a server-only
   `gta-prospect-research-reader` adapter. It calls the RPC with
   `supabaseAdmin.rpc`, validates the returned projection at runtime, and
   maps it to `ReconciledGtaProspect`.
4. Change `/admin/prospects/reconciled` only after the adapter exists. Keep
   `getOperatorSession()` as the first operation. The browser continues to
   receive only the route response; it never receives a Supabase credential or
   calls the RPC directly.
5. Prepare, review, and explicitly authorize a source-controlled seed batch
   for the current twenty records. It must use the fixture IDs unchanged and
   preserve the current roster-source dates and qualifiers. This is a data
   import approval gate, separate from PR merge approval.
6. Apply the read-projection migration from its pushed branch, then run the
   authorized seed import. Verify the ledger source returns twenty records and
   the existing filter tests still pass before loading later batches.
7. Import only independently reviewed additions in separately authorized
   batches. The interface becomes ledger-backed only after the fixture seed
   coverage check passes.

## Required verification

- Unit test the adapter with a complete ledger projection, a missing RPC, an
  incomplete fixture seed, malformed RPC data, and an unexpected RPC failure.
- Route tests must prove unauthenticated access is still `401`, no Supabase URL
  or service key is serialized, and the fixture remains the response during
  either allowed fallback state.
- Real-Postgres migration test must prove direct `service_role` table `SELECT`
  fails while `list_gta_prospect_research_for_operator()` succeeds.
- Rendered operator test must show the source label, all twenty fixture records
  in fallback, and the existing lawyer-count/city filters.
- After cutover, verify no fixture-plus-ledger duplicate can be displayed and
  that the legacy iframe is unchanged.

## Boundaries

This is an internal, operator-only public-research surface. It is not a CRM,
contact list, enrichment system, outreach queue, LSO scraper, or authorization
to contact any firm. All imports, migrations, deployment, and merges remain
separate approval gates.
