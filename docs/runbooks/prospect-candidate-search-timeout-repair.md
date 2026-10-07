# Admin global search timeout repair

This repair owns the reader only. The previous Admin enrichment owner remains
stopped; backlog acceptance and the separate Desired Client branch remain outside
this work. Main baseline: `715bd949e6f9e039746d20e68e0e1c22b01dc2e6` (PR #392).

The protected run `37541670651` installed only `20261006170000` and verified 269
installed / zero pending migrations and 42 catalog checks. None of those installed
migrations may be replayed. The Adil Law incident then exceeded the authenticator's
eight-second statement timeout: database RPC start 23:17:40.461 UTC, PostgreSQL
`57014` at 23:17:48.549 UTC, request
`482tv-1791328660160-fd72ed810b29`. The saved current-coverage diagnosis showed a
decorrelated membership merge join scanning/sorting about 975,264 chunks.

## Selected repair

The forward-only migration `20261006234701` changes only the first
`scoped_text_hits` branch. A correlated `CROSS JOIN LATERAL (... LIMIT 1)` keeps
one membership result per candidate/term. The predicate
`(f.search_document @@ terms.query) IS TRUE` keeps matching as a filter on the
candidate range. PostgreSQL 17 otherwise selected a bitmap intersection which
rebuilt a global GIN bitmap for each lookup of a common term. Both predicates
accept exactly true matches; false and null matches remain excluded.

The existing candidate-leading `(candidate_id,coverage_revision)` index is reused.
There is no index, timeout, role or credential change. The tokenizer stays
`DISTINCT btrim` + `regexp_split_to_table` + simple `plainto_tsquery` + `numnode>0`.
The deterministic longest-term anchor, sorted 128 seed/cap, resolved group and
cross-candidate matching, conflicting/unresolved identities, summary/warnings,
counts, order and frozen coverage cursor remain unchanged. The migration contract
compares the entire function and ACL suffix against the installed source with only
this membership replacement allowed.

## Offline comparison

Native PostgreSQL 17.10 on Windows, loopback-only disposable task cluster. Exact
candidate schema, indexes and installed reader helper definitions were loaded
from current main. This scaffold has minimal foreign-key source tables and does
not emulate Supabase Auth, PostgREST or HTTP. These are full public SQL RPC timings,
including dispatch, warnings, filtering, counts, summaries and serialization;
they are not API/UI timings or live acceptance.

The fixture has 6,000 candidates, 60,004 coverage rows, 1,000,000 chunks, common
Law text in roughly two thirds of background candidates, a heavily retained hot
candidate, 12 Adil anchors and 29 members of one exact firm. Calls use page size
25 and coverage 60004. Seven repeats per mode alternate token order. All six
variants returned identical pages/counts/warnings/cursors.

| Variant | Forced custom range (ms) | Forced generic range (ms) | Automatic cached range (ms) |
| --- | ---: | ---: | ---: |
| Released baseline | 880.4–1699.5 | 955.1–2686.5 | 1054.2–1324.2 |
| Array tokenizer only | 754.8–1077.1 | 881.2–1121.1 | 957.8–1368.5 |
| Plain LATERAL membership | 1814.6–7673.3 | 3732.3–6031.5 | 3161.4–7350.9 |
| Array tokenizer + plain LATERAL | 3421.3–5441.5 | 2874.8–7226.6 | 4499.6–6625.8 |
| Explicit candidate subquery fence (`OFFSET 0`) | 34.9–57.6 | 34.1–50.4 | 28.9–35.2 |
| **Selected LATERAL + truth test** | **35.8–39.3** | **29.0–39.0** | **27.7–54.3** |

The tokenizer estimate is not a cardinality proof. Plain LATERAL is not sufficient
on the realistic common-term fixture. The selected form retains tokenization and
has the smaller SQL change than the explicit subquery fence. Plain EXPLAIN confirms
the membership stage uses the candidate-leading index without a chunk-table
sequential scan or a repeated global chunk GIN bitmap. The released baseline did
not time out on this local machine; this comparison does not claim to reproduce
production's elapsed time.

The committed disposable-database regression seeds its own million chunks and
checks full RPC first/next pages under forced custom, forced generic and automatic
plans (seven calls per mode), token order/whitespace/duplicates/punctuation,
no-lexeme tokenizer behavior, held/unresolved/conflicting identities, exact legacy
proof validity and later invalidation, below/at/above the 128 cap, all-term matching
split across same-firm candidates, counts/order and frozen continuation. It
compares repaired and released responses for the correctness cases. Existing
PR #392 guards and source-writer/governance integration tests remain in place.

## Review and release boundary

The review-only receipt adds this source as the twelfth ordered reader-repair
migration; `productionApplicationApproved` remains false. The protected workflow
retains both human review gates, exact source/main binding, full installed-ledger
statement verification, ordered suffix dry-run, catalog/privilege read-back and
empty post-apply plan. At the verified 269-migration baseline, the reviewed dry-run
must contain **only `20261006234701`**. Any other pending source requires review of
new evidence; do not replay installed SQL or dispatch a broad writer.

This task stops at a draft PR with exact-head CI. Merge and production migration
application require separate approval for this controlled repair. After approval
and the protected singleton release, verify the new stored SQL/hash and unchanged
42 catalog checks, 270 installed/zero pending only if no other separately approved
work has landed, then run authenticated Adil Law in Admin with limit 25, null
cursor and no requested coverage. Record rendered items, expected 29 matches if
the inventory is unchanged, warnings/`complete` state, request latency and coverage.
Request the next page at that exact returned coverage and reconcile IDs/counts.
The reader intentionally retains deferred-audit warnings, so successful search
must not be described as full enrichment/backlog acceptance.
