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

The service-only, tenant-scoped, idempotent redaction workflow and strict provider-completion semantics are deployed. Production merge `fbb6aac6712b28191de5aee79d0d4511aaaf4b59` is deployed, and migrations through `20260904125000_privacy_recovery_open_from_locked` are applied. The fictional production exercises recorded in `docs/app-review/deletion-flow-verification.md` verified the tested CaseLoad Select database, Storage, authorization, tenant-isolation, append-only, pending-message, suppression, and expiry-invocation controls.

The production external encrypted registry was backfilled for the historical scope and a controlled global replay completed with two intents accounted for, zero replay failures, and linked reconciliation. Both recovery circuits were re-locked at the end of replay and audit, before the later controlled activation. The two tested CaseLoad Select records remain redacted. Their Meta provider dispositions remain pending, with zero marked complete and zero completion timestamps. No external provider send or deletion was attempted.

For the screened lead and linked operational stores, the workflow removes or replaces names, email addresses, phone numbers, message bodies, transcripts, attachments, channel sender IDs, Meta message IDs, IP addresses, user agents, advertising identifiers, provider selectors, free-text errors, and free-text notes. Ordinary ledger updates and deletes remain prohibited. The deletion function permits one irreversible redaction transition.

PR #219 passed a fictional real-Postgres transactional logical-restore simulation. It proved that an encrypted external intent survives logical database rollback; the restored database is re-locked first; anonymous and authenticated recovery calls are denied; one replay reapplies redaction; a second replay skips idempotently; and provider cleanup remains pending without Storage or provider-completion calls. This is not a managed Supabase backup or PITR rehearsal and does not prove provider backup expiry.

The bounded current-registry audit and controlled activation/open postflight are complete. PR #219 remains the final fictional end-to-end exercise; closeout created no fresh persistent production fixture. Neither the production evidence nor PR #219 proves deletion inside Meta, legal sufficiency of the retained envelope, managed-backup/PITR expiry, or final supportability of the public wording.

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

For the Meta-focused approval, please answer each question expressly rather than approving the design only in general.

1. Are the firm UUID, screened-lead UUID, deletion-request UUID, exact timestamps, and persistent salted hashes reasonably non-identifying when considered with other CaseLoad Select tables, logs, provider records, and firm knowledge?
2. Must the firm or lead coordinator keys be severed, rotated, replaced, or separately access-controlled after operational cleanup completes?
3. Must event timestamps be coarsened after redaction to reduce singling-out risk?
4. Is retaining `client_request_id` necessary and proportionate for delivery integrity, or should it be cleared or transformed?
5. Is three years from each event's original timestamp an acceptable maximum for the event, consent, and attribution envelopes?
6. Should the clock instead run from the verified deletion request, first inquiry, conversation close, or another event?
7. What maximum applies to the deletion tombstone and channel-suppression hashes? If indefinite retention is required, what purpose and authority support it?
8. Which fixed reasons and status counts may remain without becoming identifying when combined with timestamps or firm-level counts?
9. Is the current distinction sufficient between CaseLoad Select's Meta-derived operational copies and copies controlled by Meta? If app-specific Meta-side evidence is required, what minimum request-specific action, not-found, retention, or escalation record must be preserved without retaining direct identifiers?
10. Is PR #219's fictional transactional logical-restore simulation plus the fail-closed production registry/replay evidence sufficient for the public commitment, or is managed-backup/PITR or account-specific expiry evidence also required?

## Public wording for review

The current live wording says that, after a verified request, CaseLoad Select irreversibly removes message content and direct identifiers from its operational systems. It says that a minimal audit envelope may remain for system security, delivery-integrity checks, proof that deletion was completed, and non-identifying operational counts. It states a target of removing each retained channel audit event within three years of when it occurred.

The merged wording also distinguishes:

- CaseLoad Select operational copies;
- firm-controlled legal files that the firm may need to retain under its own duties;
- processor and external-platform copies, including the distinction between privileged-operator attestations and provider-issued evidence; and
- encrypted backups that require an applicable expiry schedule and deletion replay before restored data returns to use.

It does not promise physical deletion of every database row. However, the live pages also say counsel and backup/restore evidence are required “before this revised commitment is released.” That is self-contradictory because the wording is already public. Please decide the substantive promise and required correction using `docs/app-review/PUBLIC_COPY_RECONCILIATION_MATRIX_2026-09-04.md`.

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

Until this Meta-focused record exists, mark counsel approval **open** and do not submit the Meta App Review package. Even after counsel approval, final submission remains subject to Adriano's explicit action-time approval. Resend, HighLevel, and Supabase provider-support questions are outside this Meta-focused dossier and do not block this review.
