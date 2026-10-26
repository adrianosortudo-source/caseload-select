# Agency CRM temporary database access

The Agency release can use the existing protected Supabase management token when no saved database password is available. Preparing or merging this change authorizes no production operation. The owner must explicitly approve the exact run and creation of temporary write-capable access before approving its protected environment.

## Exact dispatch

Use `Agency follow-up production migration release` on the exact reviewed current `main` SHA. Select `use_temporary_database_credential` and supply `CREATE-TEMPORARY-AGENCY-DATABASE-ACCESS` as `temporary_credential_confirmation`. Keep `apply_confirmation` blank for the first preflight. The apply job is then skipped entirely.

The protected environment remains `Production prospect migrations`. Only the acquisition step receives existing secret `CASELOAD_PRODUCTION_SUPABASE_MIGRATOR_TOKEN`; its permissions must include `database_write`. No new saved password, GitHub secret, or password reset is required. A missing/insufficient token fails closed; never replace it with an API key or bypass the environment.

Although the preflight SQL and dry run are read-only, authentication creates a WRITE-CAPABLE temporary login using the official fixed production-project login-role endpoint. The helper masks the password, its encoded form and URL before placing the credential in the runner's ephemeral environment. Its safe summary contains no credential. No raw provider error response, connection URI or password belongs in logs, evidence or this repository.

Before authentication, both jobs verify manual dispatch, repository, main branch, first run attempt, exact reviewed/current source SHA, clean checkout and all 18 pinned migration bytes. Apply additionally verifies its immutable preflight artifact and exact apply confirmation before requesting a fresh credential. Temporary login uses only the pinned IPv4 session pooler, project-suffixed cli_login role, port 5432 and verified TLS with the reviewed Supabase root CA. Credential mode is bound in the content-hashed preflight manifest; saved-password and temporary evidence cannot be interchanged.

Review preflight ledger/plan artifacts and the migration effects/recovery packet before authorizing apply. A later apply dispatch requires `APPLY-AGENCY-FOLLOWUP-MIGRATIONS-V1` and its separate protected approvals. Any needed fresh preflight temporary login is part of that exact run's authorization; each protected job gets fresh temporary authentication. The preflight login need not remain valid when its artifact is reviewed.

The helper accepts the returned lifetime only between 60 and 86400 seconds. Each database operation rechecks at least 30 seconds remain. It never renews credentials or automatically retries. If authentication expires or an apply result is uncertain, retain the existing partial-result artifact, keep dispatch off and reconcile the actual ledger before planning a separately approved recovery. Do not claim expired password access means the role was deleted; never invoke project-wide login-role deletion.

The standard saved-password mode remains available, off by default for temporary access, and preserves its existing direct-endpoint restrictions. Do not select a pooler manually in saved-password mode. No application, migration bytes, provider settings, approval rules, production records or email sends are changed by this source patch.

Official API: https://supabase.com/docs/reference/api/v1-create-login-role (experimental/beta, requires database_write). Shared pinned helper: scripts/prospect-enrichment/temporary-credential.mjs. Source authority and immutable evidence: scripts/agency-followup-production-release-gate.mjs.

## GitHub environment propagation and diagnostic evidence

The TLS helper persists its secured connection through GITHUB_ENV. GitHub exposes that value only to subsequent steps, so connection-evidence capture must be a separate following step in both jobs. Capturing it inside the configuration step reads the old URL and correctly fails the strict pinned-certificate evidence check. Never weaken certificate validation to accept that stale proof.

When preflight fails, its fixed evidence directory is retained under a distinct agency-followup-preflight-failure artifact name. This diagnostic artifact provides no trusted preflight outputs and cannot authorize apply. Successful manifests and artifact IDs remain success-only; a failure requires diagnosis and a separately approved new run, not an automatic credential refresh or replay.
