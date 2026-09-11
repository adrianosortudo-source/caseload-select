# Meta App Review privacy counsel packet — 2026-09-03

**Status:** Preparation only. Counsel approval is open. This packet does not authorize sending, production changes, Meta access, or submission.

## Decision requested

Please provide a dated written decision for the Meta-focused release gate. Approve or revise the retained fields, purposes, retention clocks, re-identification assessment, deletion tombstone and suppression treatment, backup/restore evidence, and public privacy/deletion wording. Identify counsel name, capacity, and approval date.

Question 9 in the source approval request concerns broader provider-specific evidence and may remain separate. Resend, HighLevel, and Supabase support responses are not Meta submission prerequisites.

## Verified basis and limits

The following are documented as shipped and verified in the current release record:

- service-only, tenant-scoped, idempotent redaction of the tested CaseLoad Select operational copies;
- strict semantics under which `provider_managed` cannot by itself close external cleanup;
- fictional post-ledger production rehearsal and rollback-only verification;
- removal of tested direct identifiers and message content from Meta-derived CaseLoad Select operational copies;
- expiry invocation and attachment/ledger coverage for the tested fixture.

The evidence does **not** establish deletion inside Meta, a provider-issued deletion certificate, an account-visible Supabase restore point, an account-specific backup-expiry schedule, or safe automatic replay after a database restore. PR #203 demonstrates idempotent manual replay when a request is supplied externally and identifies the need for a durable registry outside the database backup boundary.

Source records: `docs/privacy/DELETION_OPERATIONS.md`, `docs/privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`, and `docs/app-review/deletion-flow-verification.md`.

## Proposed retained envelope — awaiting counsel decision

The following is a proposal, not an approved legal position:

| Record | Proposed fields | Proposed purpose | Decision required |
|---|---|---|---|
| Redacted channel event | event UUID; screened-lead coordinator UUID; firm UUID; channel, direction, source, status, non-personal actor type; outbound client-request UUID where applicable; original event and database timestamps; fixed redaction/failure markers; redaction timestamp, fixed reason, deletion-request UUID | delivery integrity, security, completion evidence, non-identifying counts | Whether keys, timestamps, channel, direction, actor type, and `client_request_id` remain reasonably non-identifying and proportionate |
| Deletion tombstone | deletion-request UUID; firm UUID; screened-lead coordinator UUID; salted subject-key hash; fixed reason; request/redaction/completion/purge/creation/update timestamps; completion state; closed count/status summary | prevent reintroduction, prove request state, reconcile cleanup | Maximum retention and whether UUIDs, timestamps, hash, and counts can be joined to a person |
| Channel suppression | deletion-request UUID; firm UUID; channel; salted subject-key hash; suppression timestamp | prevent a deleted sender from reopening intake | Maximum retention, hash construction, rotation/access controls, and whether indefinite retention is necessary |
| Consent/attribution envelope | event-specific timestamp (`captured_at` or `observed_at`) and only the counsel-approved non-identifying fields | expiry and audit integrity | Whether the same proposed maximum applies and whether fields/joins must be reduced |

The proposed maximum is **three years from each event's original timestamp** (with `captured_at` for consent and `observed_at` for attribution). This period is expressly awaiting counsel approval. Counsel may replace the period or start the clock at verified request, first inquiry, conversation close, or another event.

## Re-identification and join risks for express decision

Please answer expressly whether any of the following creates a reasonable re-identification path when combined with active CaseLoad Select tables, logs, provider records, firm knowledge, or backups:

1. firm UUID, lead-coordinator UUID, and deletion-request UUID;
2. exact event, request, redaction, completion, purge, creation, and update timestamps;
3. persistent salted subject-key hashes;
4. channel, direction, source, status, actor type, and firm-level counts;
5. `client_request_id`;
6. joins to firm-controlled matters, consent, attribution, delivery logs, or provider selectors.

Please specify whether keys must be severed, rotated, separately access-controlled, or replaced; whether timestamps must be coarsened; and which fixed reasons/status counts may remain.

## Backup and restore expectation

Supabase account evidence records Free-plan status, WAL-G enabled, PITR disabled, no listed snapshots, and no physical-backup metadata. WAL-G enablement alone is not proof of a restorable backup or expiry schedule.

The release proposal is therefore:

1. retain completed and pending deletion request IDs in a durable registry outside the database backup boundary;
2. restore into quarantine with operational access and scheduled processing disabled;
3. replay all registry requests idempotently;
4. verify direct identifiers, message content, attachments, and linked operational copies are redacted;
5. verify the retained envelope and suppression records satisfy counsel's boundary;
6. release the restored environment only after replay evidence is complete.

Please confirm whether this evidence is sufficient, what account-specific backup-expiry evidence is required, and whether any additional Meta-derived stores or provider evidence are necessary.

## Meta-specific evidence requested

Please confirm that the following evidence is sufficient for the Meta App Review deletion explanation:

- deployed redaction path for Messenger- and Instagram-derived CaseLoad Select operational copies;
- strict distinction between CaseLoad Select operational copies, Meta-controlled copies, firm-controlled legal files, processors, and encrypted backups;
- no claim that CaseLoad Select physically deletes data from Meta;
- durable deletion registry and fail-closed restore/replay evidence;
- public privacy and data-deletion wording that matches the final deployed controls.

## Counsel response record

Record here only after counsel responds:

- Decision: **OPEN — awaiting counsel**
- Approved/revised fields and purposes: —
- Approved/revised retention clock and maximums: —
- Tombstone/suppression treatment: —
- Backup/restore evidence requirement: —
- Meta-specific evidence requirement: —
- Required public-copy changes: —
- Counsel name/capacity/date: —

Until this record is completed, the Meta submission remains blocked.
