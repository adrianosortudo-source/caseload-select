# GTA prospect research — batch 011, west/north lane

## Scope

This lane is a **50-record public-source screen**, not an import manifest. It
collects firm-controlled roster, team, office, and contact pages for west/north
GTA candidates (Peel, Halton, York Region, Vaughan, Markham, North York, and
closely related GTA offices). It deliberately includes baseline collisions as
`held_baseline_collision` so the central reconciliation process can prove that
matching domains are not treated as net-new firms.

The screen currently contains 33 distinct-domain discovery candidates and 17
baseline collision controls. Only records with a complete, current, firm-wide
lawyer roster and a resolved identity can later be considered for staging.

## Boundaries

- Public, firm-controlled pages only; search results were discovery aids.
- No login, anti-bot bypass, form submission, chat, booking, call, email, or
  outreach occurred.
- A published email is recorded only when visibly displayed by the firm. No
  email pattern is inferred.
- A title such as `managing partner`, `principal`, or `founding partner` is
  leadership evidence only. It is never silently converted into an ownership
  claim.
- `at_least` and `unknown` counts cannot satisfy a capped lawyer-count filter.
- The source-date reflects the lane observation. Held baseline records retain
  their earlier source date rather than pretending they were re-verified today.

## Handoff

`lanes/west-north.json` is intentionally an evidence queue. Central
reconciliation must: compare all canonical domains, firm names, and office
identities against the live registry; independently reopen any candidate before
acceptance; resolve all `at_least`/`unknown` counts; and collect an actual
ownership assertion only where the firm publishes one.

No database write or operator-console change is authorized by this packet.
