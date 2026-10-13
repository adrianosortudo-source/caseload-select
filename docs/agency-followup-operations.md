# Agency follow-up journeys

## Current delivery boundary

The Agency CRM follow-up feature supports versioned template drafts, reviewer approval, versioned journey schedules, one-prospect enrollment, per-message approval, durable scheduling, and a deterministic fake-provider dispatcher. No real email provider is configured. The fake dispatcher is an internal local operation and has no API route or scheduled trigger. It must not be used as evidence that a message was sent.

Before any real provider is considered, add a separately reviewed adapter and operational controls. Keep final eligibility, shared contactability history, conversation stop signals, recipient hash, content hash, reviewer identity, approval timestamp, due time, and minimum spacing checks immediately before provider handoff.

## Authoring and versioning

- Template content is immutable. Create a new `template_key` version for changed copy, then record an operator approval on that version.
- Journey configuration is immutable. Create a new `journey_key` version for changed steps, timezone, business days, local window, or minimum spacing.
- Steps reference approved template versions and have ordered step numbers with business-day delays.
- Activating a draft retires the previous active version for that key in one database transaction. Existing enrollments retain their original journey and template references.
- Review and authoring events are append-only and include the operator identity.

## Scheduling and worker states

Enrollment computes and persists each step's due instant in the configured IANA timezone, using the configured business days and local window start. Step delays and minimum spacing are applied before the individual prospect is released. Message approval moves that message to the durable `scheduled` queue.

The claim function uses `FOR UPDATE SKIP LOCKED` and a bounded lease. A claimed message is reloaded against current prospect and shared Agency history before the fake adapter is called. A changed suppression, eligibility decision, identity, message hash, reviewer, or review timestamp prevents handoff. Definitive retryable failures use the same logical idempotency key and bounded backoff. Permanent failures stop. A provider interruption or expired lease becomes `unknown`; it is quarantined and never automatically retried.

## Migration, release, and rollback

The additive migration is prepared on the pushed PR branch and has not been applied. Do not apply it from a local checkout. Require CI's fresh-Postgres migration checks and code review before any release decision.

After an approved migration, rollback should first disable the worker entrypoint and retire active journey versions. Pause active enrollments and preserve message and event history. Do not drop tables or delete audit records. If a schema correction is needed after rows exist, ship a forward repair migration that preserves foreign keys and immutable history. This branch does not merge or deploy and does not perform production database or provider actions.

## Local verification

Use synthetic prospect, reviewer, and message fixtures. The fake provider must remain network-free. Verify both scheduling and dispatcher outcomes with focused unit tests. Browser checks use the actual queue component with synthetic data at 1440, 1024, 768, 640, 375, and 320 CSS pixels.
