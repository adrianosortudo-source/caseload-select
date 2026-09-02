# Draft database migrations

Files in this directory are preserved source proposals. They are not part of the active Supabase migration chain and are not approved or authorized for database application.

## Deferred channel conversation ledger

`20260901231830_channel_conversation_ledger.sql` was moved here unchanged before it reached production. Its privacy, deletion and retention behavior, including storage of message bodies, and its role-level access controls require a separate review and approval before it may return to `supabase/migrations/`.

Do not use migration repair or otherwise mark this version as applied. PR #192 and its Secure Import migration must not silently apply this deferred ledger as a predecessor. Promotion requires a separate reviewed PR and explicit database-application authorization.

## Current deployed degradation

PR #191 source is deployed, but this ledger table is absent. The currently deployed page catches that load failure and presents an empty thread with a closed reply-window fallback. This deferral PR replaces that ambiguous display with a distinct unavailable state and a disabled composer. Until a reviewed replacement is applied:

- portal conversation history remains unavailable;
- the portal reply route returns `503` before calling a Graph provider;
- sends that require a ledger fail closed with `ledger_unavailable` and do not call a provider;
- best-effort inbound ledger failures do not abort the core intake path;
- only non-ledger prompts carrying a current authoritative inbound timestamp can still send; and
- Meta review recording and resubmission remain blocked.
