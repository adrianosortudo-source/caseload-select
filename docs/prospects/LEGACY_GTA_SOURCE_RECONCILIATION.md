# Legacy GTA source reconciliation baseline

The historical prospect view contains 5,902 rows. Each row is an LSO-derived
address cluster of one or two licensees, enriched with website, advertising,
language, practice-area and Google Business Profile fields. The preserved
payload has 3,022 rows with a candidate website and 3,307 with a GBP
observation. It is source evidence, not a firm registry.

`src/lib/legacy-gta-prospect-source.ts` extracts the embedded JSON payload
without running the artifact script and produces one immutable source record
per original row. Each record retains every original field, an artifact row
number and a deterministic provenance key of the form
`legacy-gta-directory-2026-07:row-N`.

The adapter sets `firmId` and `canonicalDomain` to `null` and keeps every
record in `identityStatus: unresolved`. A parsed website host is exposed only
as `candidateDomain`, which is a future matching signal rather than identity
evidence. This avoids treating a shared address, an LSO cluster, or a website
as proof that two source rows describe one firm.

The next reconciliation stage may link records only with an explicit reviewed
basis. It must keep the source key, raw fields and field observation dates,
and account for each row as linked, distinct or unresolved. The adapter gives
the combined registry a reproducible 5,902-row baseline without changing the
current legacy display or its existing research evidence.
