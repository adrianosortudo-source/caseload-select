# Session wrap — 2026-05-26 overnight

Operator left at ~23:30 with "do everything you can tonight." This doc covers what shipped between then and ~00:15.

## Net change at a glance

- Tests: 2089 → 2370 (+281 new, 0 broken across the whole run)
- Typecheck: clean
- Engine sync: byte-for-byte mirror verified twice
- Migration applied to production Supabase: 1 (token expiry columns)
- Local DB cleanup: 6 stale unconfirmed_inquiries rows purged
- Files touched: ~22 (mix of new + edited)

Nothing was pushed. All changes are local. Run `git status` tomorrow to inspect, then hand to @devops for the deploy.

## What was already in flight when the operator left

Search tool v2 (quoted phrases, negation, history, arrow nav, user views) was already merged into the working tree. That work and the NAP-first triage card redesign are also part of the uncommitted diff. Nothing changed on those tonight.

## Engine fixes shipped tonight

### #94 — Contact slots `applies_to` covered only Corporate matter types
- Before: client_name / phone / email / postal had `applies_to` listing 7 Corporate matter types. Real estate, employment, estates, OOS, and unknown all silently fell through the slot machinery. Web channel contact gate caught it (rows went to unconfirmed_inquiries), but the failure was invisible at the slot layer.
- After: `ALL_MATTER_TYPES` constant (26 in-scope types plus `out_of_scope` + `unknown`), used for all 4 contact slots. Compile-time exhaustiveness guard catches drift if a new MatterType is added to the union.
- Sandbox sync: applied.
- Tests: 128 new (4 contact slots × 28 matter types + structure checks).

### #92 — Contact-capture exhaustion silently drops the lead
- Before: when `MAX_FOLLOW_UPS=3` was reached, the processor moved the lead to `unconfirmed_inquiries` without any final message. From the user's side: bot asked 3 times, then silence. That's the "OOS infinite loop" symptom in production logs.
- After: new `buildContactCaptureExhaustedMessage(missing)` in `lib/channel-send.ts`. The processor sends this gracefully before persisting to `unconfirmed_inquiries`. Tone matches brand voice: no em dashes, no LSO-prohibited "specialist" / "expert" / "guarantee" wording, leaves the door open ("Reply with that when you're ready").
- Tests: 8 new (exhaustion-flow lock-in + exhausted-message phrasing).

### #96 — Phase C discovery asks slots already inferred from turn 1
- Root cause: the merge layer's `NON_ANSWER_LITERALS` filter dropped "Not sure" / "Don't know" extractions as Gemini hedging, even when the lead's own text said "I'm not sure on the amount." Slot stayed empty; discovery loop re-asked.
- After: new `leadExpressedUncertainty(text)` helper detects markers ("not sure", "don't know", "no idea", "haven't decided", "still figuring out", "TBD", etc.). When present, the merge preserves the LLM's "Not sure" as a legitimate answer. Slot stays answered; discovery moves on.
- Sandbox sync: applied.
- Tests: 16 new.

## Token-expiry monitoring shipped (#90)

The May 25 production incident (1 Facebook OOS row in unconfirmed_inquiries with `follow_up_attempts=0` and `reason='no_contact_provided'`) was a Send API failure, possibly an expired Page token. There was no surface to know.

What's new:

- Migration `20260526_intake_firms_token_expiry.sql` applied to production. Adds 6 columns:
  - `facebook_page_token_expires_at` / `_alert_sent_at`
  - `whatsapp_cloud_token_expires_at` / `_alert_sent_at`
  - `voice_api_token_expires_at` / `_alert_sent_at`
  - Plus partial index for the cron sweep.
- `lib/token-expiry.ts` — pure helper. `computeFirmTokenStatus(firm, now)` returns per-token `{ status, daysUntilExpiry, shouldAlert }`. `buildTokenAlertBody(status)` builds the operator email text.
- `GET /api/cron/token-expiry-check` — daily sweep. Reads firms with any tracked expiry, computes status, emails operator (adriano@caseloadselect.ca, never gmail) for any expiring-within-14-days or already-expired tokens. `ALERT_SUPPRESSION_DAYS=3` blocks repeat alerts until the operator rotates and resets the row.
- Tests: 17 new.

### Operator action — set the expiry dates after rotating tokens

When you mint or rotate a token, set the matching `*_token_expires_at` to the actual expiry. The cron will warn 14 days out. To enable scheduling, add to Supabase pg_cron:

```sql
SELECT cron.schedule(
  'token-expiry-check-daily',
  '0 12 * * *',  -- noon UTC daily
  $$SELECT cron_internal.call_cron_route('/api/cron/token-expiry-check')$$
);
```

Or trigger manually from the admin shell for now:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://app.caseloadselect.ca/api/cron/token-expiry-check
```

## Database cleanup (#91)

Purged 6 stale `unconfirmed_inquiries` rows from May 21-22 for DRG. All 6 were Adriano voice smoke tests (transcripts mentioned "cleaning business", "marketing agency", "formalizing", Adriano by name). 1 row remains untouched: May 25 facebook/immigration. That one is outside the task's stated range and looks like a real Send API failure worth keeping for audit.

## Screencast test message updated (#93)

The old App Review test message was an immigration scenario ("study permit refusal letter from IRCC"). DRG doesn't practice immigration per the LSO 4 areas (corporate / real estate / employment / estates). The brief that demo produced was a thin OOS template — not what Meta reviewers should see.

Replaced everywhere with:

> "I was let go from my job last week after 6 years. They offered me 8 weeks of severance but I'm not sure if that's fair. I want to understand my options before I sign anything."

This classifies to `wrongful_dismissal` (Phase B sub-type, in scope for DRG), produces a rich brief with proper fee estimates and four-axis scoring, and shows off the Phase B work that landed earlier this week.

Files updated:
- `docs/app-review/screencasts/README.md` (3 occurrences)
- `docs/app-review/Phase11_Submission_Package.md` (3 occurrences)
- `docs/app-review/Reviewer_Instructions_Paste.md` (1 occurrence)
- `docs/app-review/Operator_Execution_Checklist.md` (1 occurrence)
- `docs/Meta_App_Creation_Block2_Runbook.md` (1 occurrence)

`docs/app-review/Session_2026-05-24_Wrap.md` retains the old message as audit-of-the-day; not touched.

New test `app-review-test-message.test.ts` locks the classification result so a future engine change can't silently regress the demo path.

## What's left for the operator tomorrow

Things only you can do on the third-party side:

- **#81-#84** — Record the 4 screencast MP4s using the updated test message. Wrongful dismissal demo flow: send the new test message, bot asks for name + reachability, reply "Sarah Patel, sarah.patel.test@example.com", bot acks, lead lands in triage with rich brief. Open the brief on screen during recording to show the Band, four-axis, snapshot, fee estimate.
- **#85** — Upload to permission slots.
- **#86** — Purge 3 Sarah Patel test leads from `screened_leads` after recording is done.
- **#89** — Mint System User Access Token for WhatsApp Cloud API in Meta Business Manager. Then set `whatsapp_cloud_token_expires_at` on the DRG firm row to whatever Meta returns (System User tokens default to no-expiry; if you set a custom one, record it).
- **#77** — Submit the 8 permissions for Meta App Review once the MP4s are attached.

Triage portal: the new card design + search tool + saved views are all sitting in the working tree. They're shipped to code but not deployed. You may want to deploy + smoke-test before recording the screencasts so the demo shows the new lawyer view.

## Run book if anything is wrong tomorrow morning

| Symptom | First check |
|---|---|
| Tests failing after pull | `npx tsc --noEmit` first; if clean, then `npx vitest run` |
| Engine sync error | `bash scripts/check-engine-sync.sh` — fix in app, copy to sandbox |
| Build error on Windows | Pre-existing Turbopack symlink issue on the D: drive. Vercel Linux build is fine. |
| Cron route returns 401 | `Authorization: Bearer $CRON_SECRET` or `Bearer $PG_CRON_TOKEN` |

## Commit not yet made

I did not commit. The full diff is uncommitted in the working tree so you can see exactly what changed before handing it to @devops. Inspect with:

```
git status
git diff --stat
```

Hand to @devops with `*push` when you're ready.
