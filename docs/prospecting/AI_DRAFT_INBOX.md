# GTA prospect AI draft inbox

The AI draft inbox lets an approved research system submit a bounded public-evidence package without receiving an operator session, a Supabase service key, importer authority, CRM access, or outreach capability.

## One-time deployment configuration

After the reviewed migration and application code are merged and deployed, configure these server-only production variables:

- `GTA_PROSPECT_AGENT_DRAFT_TOKEN`: a high-entropy secret held only by the approved enrichment runner.
- `GTA_PROSPECT_AGENT_DRAFT_ACTOR`: a stable lowercase identifier such as `claude-research-worker`.

Do not put either value in a browser, committed file, prompt transcript, client bundle, or public documentation. Rotate the token by replacing the server variable and the runner secret together. Removing the variable disables agent staging immediately.

## Agent submission contract

`POST /api/internal/prospect-enrichment/drafts`

Required headers:

- `Authorization: Bearer <GTA_PROSPECT_AGENT_DRAFT_TOKEN>`
- `Idempotency-Key: <16-200 character stable job key>`
- `Content-Type: application/json`

Body:

```json
{
  "sourceName": "gta-prospect-batch-018",
  "records": []
}
```

`records` use the existing GTA operator-import record schema. A client may include `sourceSha256`; the server recalculates it from the submitted records and rejects a mismatch. Packages are limited to 2 MB and 2,000 records. Unknown top-level fields are rejected.

The response is a receipt with a `draftId`, payload SHA-256, and validation summary. A `ready_for_operator` receipt means the current review has no invalid, duplicate, or identity-review rows. A `review_required` receipt means it is held in staging and cannot be imported.

## Operator flow

1. Open **Prospect list** in the authenticated operator console.
2. Inspect the source, receipt, and validation counts in **AI draft inbox**.
3. For a `ready_for_operator` package, check the explicit review confirmation and select **Import staged package**.
4. The server rereads the stored package and compares it against the current ledger. If that review changed, it refreshes the draft and stops. The operator reviews the new state before another click.
5. Only an unchanged, eligible draft passes to the existing protected import writer. The database retains the staging receipt and the canonical import receipt.

## Safety boundary

This inbox only stages or imports public, source-attributed prospect research. It never submits contact forms, starts chats, sends outreach, creates CRM leads, exports contacts, infers an email address, or automatically merges identities. Duplicate and identity collisions remain explicit review states. A staged record is not a prospect-record change until an authenticated operator completes the final action.
