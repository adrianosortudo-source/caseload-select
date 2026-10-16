# Public privacy and data-deletion copy reconciliation — 2026-09-03

**Status:** Review matrix only. No public copy has been changed. Counsel approval, Terra's registry/restore implementation, and a signed-out rendered check remain required.

## Evidence boundary

The current public route source is `src/app/privacy/page.tsx` and `src/app/data-deletion/page.tsx` at `origin/main` commit `74d48e051b9ef27c44c194e20c17f42fef4db17b`. The exact rendered copy must still be captured from the signed-out production pages after any final release; source parity alone is not proof of live rendering. The operational evidence basis is `docs/privacy/DELETION_OPERATIONS.md`, `docs/privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`, and `docs/app-review/deletion-flow-verification.md`.

| Surface/claim | Verified current behavior/evidence | Proposed post-Terra behavior | Unsupported or unresolved wording | Exact required correction before release |
|---|---|---|---|---|
| Verified request removes message content and direct identifiers from active CaseLoad Select operational systems | Fictional post-ledger rehearsal and rollback-only verification passed for tested CaseLoad Select operational copies | Terra's restore gate must replay the same redaction operation after restore | Do not generalize to Meta, firm systems, or every processor | Say “CaseLoad Select operational copies it controls”; retain tested-store scope in internal evidence |
| `/privacy` says a de-identified row may remain after routine retention | The page currently states this; the deletion evidence supports a minimal redacted envelope, not a blanket claim that every de-identified row is safe | Terra must apply the counsel-approved envelope and join controls | “De-identified” is not counsel-approved and may imply a stronger legal conclusion than evidence supports | Replace with the counsel-approved audit-envelope wording and purpose, or remove the sentence |
| `/privacy` publishes band retention values (A/B 1095 days, C 365, D 180, E 30, unrated 90) | These values are rendered by the current source, but the revised channel-event three-year boundary and counsel decision are separate | Terra must reconcile all retained record classes and clocks | A single band table may conflict with channel, consent, attribution, tombstone, or suppression clocks | Counsel and Terra must confirm each class and publish only the approved schedule |
| Minimal audit envelope may remain | Proposed fields are listed in the counsel packet; non-identifying status remains a counsel decision | Store only counsel-approved fields and joins | “Non-identifying” is not yet legally approved | Keep as conditional language until counsel approves fields, joins, and purposes |
| Three-year removal target | Expiry invocation is deployed and verified; maximum scheduling/backlog performance is not yet proven | Terra must evidence expiry and registry replay under the approved clock | Three years is provisional and not counsel-approved | Label three years as proposed until counsel signs; change clock if counsel requires |
| Deletion tombstone retained | Tombstone prevents reintroduction and supports reconciliation; current maximum is not approved | Apply counsel-approved retention and access controls | Any indefinite-retention implication is unsupported | State maximum and purpose only after counsel decision |
| Channel suppression record retained | Suppression prevents a deleted sender reopening intake; current expiry is not set | Apply counsel-approved hash, rotation, and expiry policy | Indefinite hash retention is unresolved | State exact retention or remove the promise until approved |
| Backups may retain data temporarily | Account evidence shows no account-visible Supabase snapshot/expiry schedule; PR #203 proves only manual external replay semantics | Restore quarantine blocks use until registry replay and verification succeed | Do not promise automatic deletion from backups or a specific provider schedule | Describe encrypted backups as subject to applicable expiry and mandatory replay before restored use; do not name an unverified period |
| `/privacy` says encrypted backups follow the provider's documented expiry schedule | No account-specific Supabase expiry schedule is currently evidenced | Terra must document the applicable schedule or counsel must approve qualified wording | The current sentence can read as an established account-specific fact | Qualify it as provider-dependent and conditional until account-specific evidence exists |
| `/data-deletion` says older records clear linked sessions, queued payloads, and attachment folders | The release record documents tested attachment and ledger coverage for a fictional fixture; it does not establish every historical record path | Terra must preserve recovery-aware behavior and evidence all in-scope stores | Universal “clears” wording exceeds the recorded fixture boundary | Limit the statement to the verified workflow or qualify failure/verification behavior |
| Firm-controlled records | Operations doc distinguishes firm legal/accounting/document systems from CaseLoad Select | Firm remains responsible for its own legal duties | Do not imply CaseLoad Select can erase firm-controlled files | Keep clear ownership sentence and requester direction |
| Meta/platform copies | Current evidence proves only CaseLoad Select's Meta-derived operational copies; no Meta-side deletion proof | Requester uses Meta/platform controls for platform-held copies | Do not say CaseLoad Select deletes Meta's systems | Explicitly state platform-controlled copies are outside CaseLoad Select control |
| Processor cleanup | `provider_managed` is only a routing marker; no provider response is required for Meta submission | Record provider-specific evidence or escalation separately | Do not describe `provider_managed` as completed deletion | Keep provider evidence as separate follow-up and use “available processor step” wording |
| Public URL availability | Prior checks returned 200 for privacy, terms, and data deletion | Recheck after final release and in signed-out mode | HTTP 200 alone does not prove copy parity | Capture rendered text and confirm no operator-only controls |

## Required final sequence

1. Capture exact signed-out production text for `/privacy` and `/data-deletion`.
2. Reconcile each sentence against the approved counsel decision and Terra's deployed registry/restore evidence.
3. Mark every unsupported claim as removed, narrowed, or explicitly conditional.
4. Implement any copy change through a pushed PR; do not edit production directly.
5. Verify signed-out rendering of privacy, terms, and deletion pages after deployment.
6. Attach the rendered evidence to the final Meta readiness record.

Until step 5 is complete, public-copy reconciliation is open.
