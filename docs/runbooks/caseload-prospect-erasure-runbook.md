# Runbook: erasing a CaseLoad Select prospect (DR-114)

Covers `caseload_prospects`, the rows the public "Start a conversation" flow
writes. For a client firm's own leads, use `/api/admin/leads/[id]/purge`
instead; that is a different table and a different data subject.

## What this path does, and does not do

- It **anonymises**. It does not delete. `name`, `firm_name`, `email` and
  `province` are replaced with `[anonymized]`, the two free-text `*_other`
  answers are nulled, and `anonymized_at` + `anonymization_reason` are
  stamped. The closed-option answers and `outcome` survive so funnel counts
  stay correct.
- It **leaves the consent evidence alone**, `ip_address` and `user_agent`
  included. That row is the record that consent was given, and CASL section
  13 puts the burden of proving consent on the sender. See DR-114.
- Deleting the prospect row is blocked at the database and will stay blocked.
  If you try, the error names this path.

## Prerequisite: the migration must be live

`20260808120000_caseload_prospect_erasure.sql` creates the function this
runbook calls. Until it is applied, every call below returns a 500 saying the
function does not exist. Per DR-109 the only sanctioned path is: commit, push,
PR into `main`, merge, then a deliberate operator-run `supabase db push`.

Confirm it landed:

```bash
npx supabase migration list
```

## Handling an erasure request

An erasure request normally arrives by email address, and one person may have
submitted more than once, so prefer the `email` selector over `prospect_id`.

```bash
curl -sS -X POST "https://app.caseloadselect.ca/api/admin/caseload-prospects/purge" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"person@theirfirm.ca","reason":"subject_request"}'
```

The response reports `anonymized_count`. A count of `0` means nothing matched:
check the address before replying to the requester, and remember that a row
already anonymised is deliberately not counted again.

To target one specific row instead:

```bash
curl -sS -X POST "https://app.caseloadselect.ca/api/admin/caseload-prospects/purge" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prospect_id":"<uuid>","reason":"subject_request"}'
```

An operator session cookie works in place of the bearer token, so the same
call can be made from the console with `fetch`.

## Retention

`runDataRetention` (daily, 3am, `/api/cron/data-retention`) sweeps prospects
older than `PROSPECT_RETENTION_DAYS` (730) from `submitted_at` with reason
`retention_sweep`. Nothing in the table is old enough to be swept before
2028-08. The count appears in the cron response as
`caseload_prospects_anonymized`.

## First exercise: the three E2E verification rows

Three operator-created verification rows sit in production from the
2026-08-08 end-to-end check of the "Start a conversation" flow. They could not
be cleaned up when they were made, because that is the gap DR-114 exists to
close. All three carry `adriano@caseloadselect.ca`:

| id | name | submitted_at |
|---|---|---|
| `efb976de-9627-463c-9408-2085cf796b56` | E2E Verify Booking | 2026-08-08 03:15:01Z |
| `de9cd70a-d666-4e54-8475-35048f05c82b` | E2E Verify Reply | 2026-08-08 03:15:02Z |
| `cf3b4982-d82a-4121-a0c5-7d7d6cb40a9f` | E2E Booking Render | 2026-08-08 03:20:26Z |

Run this once, immediately after the migration lands. The reason is
`internal_test_record`, not `subject_request`: these are operator fixtures,
not a person exercising a right, and the two should stay distinguishable in
any later audit.

```bash
curl -sS -X POST "https://app.caseloadselect.ca/api/admin/caseload-prospects/purge" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"adriano@caseloadselect.ca","reason":"internal_test_record"}'
```

Expect `anonymized_count: 3` and all three ids in `prospect_ids`. If a real
prospect ever submits from the operator address, target the three ids
individually instead.

Verify:

```sql
select id, name, email, anonymized_at, anonymization_reason
  from caseload_prospects order by submitted_at;

-- The consent evidence must still be there, three rows, ip and user agent intact.
select prospect_id, consent_text_version, ip_address is not null as has_ip,
       user_agent is not null as has_ua
  from caseload_prospect_consent_log;
```
