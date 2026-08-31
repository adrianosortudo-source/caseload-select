# Secure Import Room activation runbook

The feature ships fail-closed. The migration does not activate any firm and the application cannot create a contact unless all activation gates are true.

## Before activation

1. Confirm the firm lawyer has an active `firm_lawyers` row with role `lawyer` or `admin` and a current portal session containing `lawyer_id`.
2. Confirm `ghl_location_id` and the location-scoped `ghl_contacts_write_token` are configured for the firm. The token needs `contacts.readonly` and `contacts.write`; do not use a wider agency token.
3. With live writes still disabled, make one read-only exact lookup against `GET /contacts/lookup` using the firm token and `Version: v3`. The current HighLevel page labels this endpoint OAuth-channel-only, so this smoke test is a release gate for Private Integration tokens.
4. Audit every location workflow that can start on Contact Created. An imported record must not create an opportunity, start a journey, assign staff, or perform any non-message action. DND prevents messaging; it does not neutralize every possible workflow action.
5. Confirm Upstash is configured and `RATE_LIMIT_FAIL_CLOSED=true`. Production import routes reject requests when the limiter is unavailable even if the feature flags are on.
6. Confirm `CLIENT_IMPORT_HMAC_SECRET` is set to a high-entropy server-only value. The existing `PORTAL_SECRET` is a supported fallback, but a dedicated secret is preferred for rotation.

## Activation order

1. Apply the pushed migration through the normal PR and CI path.
2. Set `intake_firms.secure_client_import_enabled=true` for the exact firm.
3. Set `intake_firms.secure_client_import_live_writes_enabled=true` for the exact firm.
4. Set `CLIENT_IMPORT_LIVE_WRITES_ENABLED=true` only after the exact-lookup and workflow audits pass.
5. Run a two-row controlled import: one clearly new contact and one known existing contact. Verify the new record has global DND plus the hold and batch tags, and verify the existing record is unchanged.
6. Verify the portal receipt, batch audit row, row outcomes, and absence of names, emails, phones, filenames, or upstream response bodies in Supabase and logs.

## Emergency stop

Set `CLIENT_IMPORT_LIVE_WRITES_ENABLED=false`. This stops every new step-up, batch, and row request without changing existing contacts or audit records. For one firm only, set either firm activation flag to false.

Do not delete or retry a `reconcile_required` row. Perform fresh exact email and phone lookups first; HighLevel does not document an idempotency key for contact creation, so a timed-out create may already exist.
