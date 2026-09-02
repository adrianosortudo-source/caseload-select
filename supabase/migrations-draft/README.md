# Draft database migrations

Files in this directory are preserved source proposals. They are not part of the active Supabase migration chain and are not approved or authorized for database application.

## Deferred channel conversation ledger

`20260901231830_channel_conversation_ledger.sql` was moved here unchanged before it reached production. Its privacy, deletion and retention behavior, including storage of message bodies, and its role-level access controls require a separate review and approval before it may return to `supabase/migrations/`.

Do not use migration repair or otherwise mark this version as applied. PR #192 and its Secure Import migration must not silently apply this deferred ledger as a predecessor. Promotion requires a separate reviewed PR and explicit database-application authorization.
