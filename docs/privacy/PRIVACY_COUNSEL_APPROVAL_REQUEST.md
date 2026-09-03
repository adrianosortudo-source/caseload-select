# Privacy counsel approval request: deletion audit envelope

**Draft only. Do not send without Adriano's approval.**

## Decision requested

Please review the controlled-redaction design and provide a written decision on:

1. whether the retained fields and available joins can reasonably identify or single out a person;
2. whether the proposed maximum of three years from each retained event's original event time is appropriate;
3. how long the deletion tombstone and salted channel-suppression hashes may remain; and
4. whether the public deletion wording accurately describes CaseLoad Select's obligations across operational data, processors, firm-controlled legal files, and backups.

Meta submission remains blocked until these decisions are recorded and the other operational gates are closed.

## Implemented and rehearsed outcome

PRs #198 and #199 shipped a service-only, tenant-scoped, idempotent redaction workflow. PR #202 shipped strict completion semantics, PR #203 recorded the fictional local restore/replay rehearsal and external-registry gap, and PR #204 aligned the release record, this counsel request, and the public deletion wording with those boundaries. Production commit `a05520e3b9d08d82bd81c42779907cbd2c807757` is READY, and migrations through `20260903011450_privacy_provider_evidence_required` are applied. The fictional production rehearsal recorded in `docs/app-review/deletion-flow-verification.md` verified the tested CaseLoad Select database, Storage, authorization, tenant-isolation, append-only, pending-message, suppression, and expiry-invocation controls.

After `20260903011450` was applied, a second fictional production verification ran entirely inside one rollback-only transaction. It verified the live production functions and triggers without exposing the fixture to application workers: `provider_managed` was rejected as completion evidence and left the request pending; a complete/not-applicable disposition completed the request idempotently; Messenger-style direct identifiers and content were removed from the screened lead, conversation event, channel session, unconfirmed inquiry, and processed-message claim; suppression prevented those Meta-derived CaseLoad Select operational copies from being recreated; and rollback left zero fixture rows. No external provider send or deletion was attempted. This closes the strict-completion and Meta-derived CaseLoad Select operational-copy engineering gates only.

For the screened lead and linked operational stores, the workflow removes or replaces names, email addresses, phone numbers, message bodies, transcripts, attachments, channel sender IDs, Meta message IDs, IP addresses, user agents, advertising identifiers, provider selectors, free-text errors, and free-text notes. Ordinary ledger updates and deletes remain prohibited. The deletion function permits one irreversible redaction transition.

Neither production verification proves external-provider deletion, account-specific backup expiry, safe restore replay from an external durable registry, legal sufficiency of the retained envelope, or final supportability of the public wording. Account verification identified the production Supabase organization as Free, with WAL-G enabled, PITR disabled, no listed backups, and no physical-backup metadata.

PR #203 records a separate fictional local restore/replay rehearsal. It proved that redaction is idempotently reapplied when a deletion request is supplied from outside the restored database. It also proved that restoring a pre-deletion snapshot removes an in-database request tombstone and leaves the database recovery list empty. An external durable deletion registry and a restore procedure that blocks operational access until replay is verified remain release gates.

## Retained audit envelope

After redaction, a channel audit event can retain:

- event UUID;
- screened-lead coordinator UUID;
- firm UUID;
- channel, direction, source, status, and non-personal actor type;
- outbound client-request UUID where applicable;
- original event timestamp and database creation timestamp;
- fixed body marker `[redacted]`;
- fixed failure marker `[redacted]` only when the event status is failed;
- redaction timestamp, allowed fixed redaction reason, and deletion-request UUID.

The service-only expiry function makes an already-redacted channel event eligible for removal after three years from its original `occurred_at` timestamp and removes eligible records when it is invoked. The same eligibility rule uses `captured_at` for retained consent evidence and `observed_at` for retained attribution evidence. The production rehearsal proved invocation, not a guaranteed maximum under scheduling or backlog conditions. The release target of removal no later than three years therefore still requires operational proof.

The deletion tombstone currently retains:

- deletion-request UUID;
- firm UUID and screened-lead coordinator UUID;
- salted subject-key hash;
- fixed request reason;
- request, redaction, completion, purge, creation, and update timestamps where populated;
- completion state; and
- a closed count/status summary after provider selectors are cleared.

A private channel-suppression record retains the deletion-request UUID, firm UUID, channel, salted subject-key hash, and suppression timestamp so a deleted sender cannot reopen intake. The present migration does not set a three-year expiry for the deletion tombstone or suppression record.

## Reidentification questions

For the Meta-focused approval, please answer questions 1 through 8 and question 10 expressly rather than approving the design only in general. Question 9 is broader privacy-program follow-up and may remain open without withholding the Meta-focused approval.

1. Are the firm UUID, screened-lead UUID, deletion-request UUID, exact timestamps, and persistent salted hashes reasonably non-identifying when considered with other CaseLoad Select tables, logs, provider records, and firm knowledge?
2. Must the firm or lead coordinator keys be severed, rotated, replaced, or separately access-controlled after operational cleanup completes?
3. Must event timestamps be coarsened after redaction to reduce singling-out risk?
4. Is retaining `client_request_id` necessary and proportionate for delivery integrity, or should it be cleared or transformed?
5. Is three years from each event's original timestamp an acceptable maximum for the event, consent, and attribution envelopes?
6. Should the clock instead run from the verified deletion request, first inquiry, conversation close, or another event?
7. What maximum applies to the deletion tombstone and channel-suppression hashes? If indefinite retention is required, what purpose and authority support it?
8. Which fixed reasons and status counts may remain without becoming identifying when combined with timestamps or firm-level counts?
9. For the broader privacy-compliance program, what provider request-specific or account-specific retention evidence should be retained for Meta, Resend, HighLevel, and Supabase? This question may be answered separately. Responses from Resend, HighLevel, and Supabase are not Meta App Review gates.
10. What backup-expiry and restore-replay evidence is required before the public commitment can be released?

## Public wording for review

The current release-target wording says that, after a verified request, CaseLoad Select irreversibly removes message content and direct identifiers from its operational systems. It says that a minimal audit envelope may remain for system security, delivery-integrity checks, proof that deletion was completed, and non-identifying operational counts. It states a target of removing each retained channel audit event within three years of when it occurred.

The merged wording also distinguishes:

- CaseLoad Select operational copies;
- firm-controlled legal files that the firm may need to retain under its own duties;
- processor and external-platform copies, including the distinction between privileged-operator attestations and provider-issued evidence; and
- encrypted backups that require an applicable expiry schedule and deletion replay before restored data returns to use.

It does not promise physical deletion of every database row. This wording is still an open approval and release gate, not a counsel-approved assurance. Please confirm whether it is accurate, sufficiently specific, and supportable after the backup/registry and other operational gates close.

## Meta-focused approval record requested

Please return a dated written decision that includes:

- approved retained fields and purposes;
- approved retention clock and maximum for each retained record class;
- required changes, if any, to identifiers, hashes, timestamps, or joins;
- approved treatment of deletion tombstones and suppression records;
- minimum acceptable backup and restore-replay evidence;
- any Meta-specific application deletion evidence counsel requires;
- any required change to the public privacy or deletion wording; and
- counsel name, capacity, and approval date.

Until this Meta-focused record exists, mark counsel approval **open** and do not submit the Meta App Review package. A separate answer to question 9 may remain open and does not prevent the Meta-focused approval or submission readiness once every other Meta gate is closed. Even after counsel approval, final submission remains subject to Adriano's explicit action-time approval.

## Broader privacy-program follow-up

Counsel may provide a separate record identifying the minimum provider-specific action, retention, or escalation evidence to preserve for Meta, Resend, HighLevel, and Supabase. That broader record remains desirable privacy-compliance guidance, but responses from Resend, HighLevel, and Supabase are not prerequisites for Meta App Review.
