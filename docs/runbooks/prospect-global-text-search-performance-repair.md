# Global prospect text-search performance repair

## Baseline

The protected run `37404882958` installed migration `20261006003626` once. Its
post-apply evidence recorded 264 installed migrations and zero pending, so that
migration must never be replayed. The post-apply firm-filter acceptance passed.

Production `pg_stat_statements` then recorded the global text-hit diagnostic at
about 10 seconds and the global RPC at about 7.9 seconds before cancellation.
The database contained 78,796 searchable chunks. The saved plan showed the
search-chunk GIN index was used, but the old function still materialized broad
terms before identity scoping. The six original service observations and all
held or rejected candidate evidence remain outside this repair and are not
rewritten.

## Forward repair

Migration `20261006111650_prospect_candidate_global_text_search_scoped.sql`
replaces only the global text-search function. It chooses one deterministic
anchor token, resolves identities for those anchor hits, expands only verified
firm groups, and evaluates every requested term within that bounded candidate
scope. Unresolved and conflicted anchor candidates remain candidate-scoped.
Projection-issue raw JSON and history metadata fallbacks remain available in
both the anchor and scoped checks.

The first protected release of that function passed CI, the ledger/catalog
read-back, and the post-apply firm-filter check, but the live Admin Prospects
request still returned the protected `Candidate research could not be loaded.
Coverage is unverified.` state for `Adil Law`. No import or candidate write
occurred. The follow-up migration
`20261006133000_prospect_candidate_global_text_search_set_identity.sql`
keeps the same group semantics while resolving all anchor and expanded-member
identity links through one bounded, candidate-set query. It removes the
per-expanded-member lateral revalidation that can exceed the request timeout
for firms with large retained histories. The follow-up must use the same
protected two-review release process.

The migration is additive and forward-only. Release it through the existing
CI, protected preflight, protected apply, ledger read-back, and function
privilege read-back gates. Do not replay `20261006003626` or any earlier
migration.

## Acceptance

CI must pass the migration contract and the real-Postgres performance fixture.
The fixture checks both `rare Law` and `Law rare` token order, preserves the
same three group-wide results and verified firm identity, and keeps each read
under the existing 4.5-second target with a five-second statement timeout.

After the follow-up protected release, run one live `Adil Law` request with
limit 25, null cursor, and no requested coverage. Verify rendered results,
completion, filtered count, and coverage revision. Then request the next page
with that same coverage revision and reconcile the result against the saved
post-apply evidence. Do not label the reader repaired from a deployment status
alone.
