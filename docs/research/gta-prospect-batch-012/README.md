# GTA prospect Batch 012 — west/north source queue

## Purpose and boundary

This is a bounded, read-only public-evidence screen of west/north GTA firms.
It is a **source queue**, not an import. Every row is explicitly
`accepted: false`, `import_ready: false`, and `baseline_status:
pending_baseline`.

The screen used public first-party roster, team, and contact pages only. It
did not log in, bypass an access control, submit a form, send email, contact a
firm, call a firm, create a CRM record, or change production data. Search was
used for discovery only; each retained observation cites a first-party URL.

## Results

| Outcome | Count |
| --- | ---: |
| Domains screened | 12 |
| Exact 3–20 public-roster candidates | 5 |
| Held: source/count qualification | 3 |
| Held: static baseline/domain collision | 4 |
| Accepted or import-ready | 0 |

The five exact candidates are still only **preliminary source records**. A
later reconciliation must compare identity aliases, the accepted-ledger
manifest, live/current fixtures, and the historical corpus before an import
could even be proposed. The historical 5,902-row artifact has no stable
firm-level crosswalk in the source-controlled baseline, so it is intentionally
not treated as a clearance signal.

## Count rule

Only a public roster that visibly separates lawyer roles from support roles is
labelled `exact`. `at_least` and `unknown` entries are retained as review
leads, but never satisfy a capped lawyer-count band. Published staff,
paralegals, clerks, consultants, and retired people are not counted as lawyers.

## Contact and authority rule

An email is recorded only when visibly published on a first-party page and is
always paired with that source URL. Relationship labels preserve the site’s
explicit title; `unknown` means the site did not explicitly establish one of
owner, managing partner, or partner. Neither a surname nor a biography is used
to infer ownership.

## Static comparison scope

The preliminary domain sweep covered source-controlled research and manifest
JSON reachable from `origin/main`, batches 001–010, and the Batch 011 west and
east lane artifacts. It deliberately does not resolve aliases, current
database state, or the historical 5,902-row corpus. A `preliminary_*` result
therefore remains subordinate to `pending_baseline`.
