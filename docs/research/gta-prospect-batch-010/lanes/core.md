# GTA public-web research batch 010 — core lane

Observation date: 2026-09-07

This is a private, no-send research lane. It used general public search only for discovery, then recorded firm-owned roster or team URLs as the evidence targets. No regulator directory, form, chat, booking, email/telephone, CRM, advertising, or GBP surface was accessed. No contact data is stored.

Before accessing first-party roster evidence, the lane attempted `robots.txt` for each domain. Where the check showed public paths were allowed, the record says so. Where it failed, redirected, or did not resolve, the record is held rather than accepted. A bounded page review also looked for an evident site-terms restriction; none was found on the allowed pages. That does not replace a fresh check before reuse.

The lane reconciled each discovered firm/domain string against the raw source records from batches 001-009 and the 103-record `gta-prospect-research-accepted-001-009.dry-run.json` manifest. This is string-level dedupe only: it does not claim a historical-row crosswalk.

Counts:

- Accepted: 0. This lane has no authority to accept or import a prospect.
- Candidate: 10. These are new domain/name pairs with a visible 3–20 lawyer count and a successful robots check, but remain review candidates.
- Held: 24. Holds cover access uncertainty, incomplete lawyer-only counts, a landing-page redirect, or observed size outside the 3–20 criterion.

The conservative stopping point was 34 distinct core-Toronto firm/domain records. Records marked `uncertain` deliberately retain no inferred count; a later reviewer must recheck access, count only lawyer roles, and establish the 3–20 ceiling before changing their status.
