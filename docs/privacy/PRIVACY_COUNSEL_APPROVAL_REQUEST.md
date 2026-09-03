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

PRs #198 and #199 shipped a service-only, tenant-scoped, idempotent redaction workflow. The fictional production rehearsal recorded in `docs/app-review/deletion-flow-verification.md` verified the tested CaseLoad Select database, Storage, authorization, tenant-isolation, append-only, pending-message, suppression, and expiry-invocation controls.

For the screened lead and linked operational stores, the workflow removes or replaces names, email addresses, phone numbers, message bodies, transcripts, attachments, channel sender IDs, Meta message IDs, IP addresses, user agents, advertising identifiers, provider selectors, free-text errors, and free-text notes. Ordinary ledger updates and deletes remain prohibited. The deletion function permits one irreversible redaction transition.

This rehearsal did not prove external-provider deletion, safe restore replay, or legal sufficiency of the retained envelope. Account verification later identified the production Supabase organization as Free, with WAL-G enabled, PITR disabled, no listed backups, and no physical-backup metadata.

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

Please answer each question expressly rather than approving the design only in general:

1. Are the firm UUID, screened-lead UUID, deletion-request UUID, exact timestamps, and persistent salted hashes reasonably non-identifying when considered with other CaseLoad Select tables, logs, provider records, and firm knowledge?
2. Must the firm or lead coordinator keys be severed, rotated, replaced, or separately access-controlled after operational cleanup completes?
3. Must event timestamps be coarsened after redaction to reduce singling-out risk?
4. Is retaining `client_request_id` necessary and proportionate for delivery integrity, or should it be cleared or transformed?
5. Is three years from each event's original timestamp an acceptable maximum for the event, consent, and attribution envelopes?
6. Should the clock instead run from the verified deletion request, first inquiry, conversation close, or another event?
7. What maximum applies to the deletion tombstone and channel-suppression hashes? If indefinite retention is required, what purpose and authority support it?
8. Which fixed reasons and status counts may remain without becoming identifying when combined with timestamps or firm-level counts?
9. For the broader privacy-compliance program, what provider request-specific or account-specific retention evidence should be retained for Meta, Resend, HighLevel, and Supabase? Responses from Resend, HighLevel, and Supabase are tracked as separate follow-up and are not Meta App Review gates.
10. What backup-expiry and restore-replay evidence is required before the public commitment can be released?

## Public wording for review

The current release-target wording says that, after a verified request, CaseLoad Select irreversibly removes message content and direct identifiers from its operational systems. It says that a minimal audit envelope may remain for system security, delivery-integrity checks, proof that deletion was completed, and non-identifying operational counts. It states a target of removing each retained channel audit event within three years of when it occurred.

The wording also distinguishes:

- CaseLoad Select operational copies;
- firm-controlled legal files that the firm may need to retain under its own duties;
- processor and external-platform copies that require provider-specific action or expiry evidence; and
- encrypted backups that require an applicable expiry schedule and deletion replay before restored data returns to use.

It does not promise physical deletion of every database row. Please confirm whether the wording is accurate, sufficiently specific, and supportable after the operational gates close.

## Approval record requested

Please return a dated written decision that includes:

- approved retained fields and purposes;
- approved retention clock and maximum for each retained record class;
- required changes, if any, to identifiers, hashes, timestamps, or joins;
- approved treatment of deletion tombstones and suppression records;
- minimum acceptable provider and backup evidence;
- any required change to the public privacy or deletion wording; and
- counsel name, capacity, and approval date.

Until that record exists, mark counsel approval **open** and do not submit the Meta App Review package.
