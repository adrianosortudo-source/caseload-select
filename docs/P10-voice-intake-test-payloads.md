# P10 Voice Intake — Test Payloads

Copy-paste-ready curl commands for verifying `/api/voice-intake` end-to-end. Resolve `$FIRM_UUID` first (see `P10-voice-ai-build-guide.md` Prerequisites). `$ENDPOINT` is `https://app.caseloadselect.ca/api/voice-intake` for production or your staging URL.

Three scenarios cover the three engine paths: in-scope corporate (Band A), in-scope real-estate (Band B), and out-of-scope detection.

---

## Test 1 — Band A shareholder dispute (corporate, urgent, documented)

**Scenario:** locked-out shareholder, money concern, has documents, urgency signals.
**Expected matter classification:** `matter_type='shareholder_dispute'`, `practice_area='corporate'`.
**Expected band:** A (high value + high urgency + readiness signals present).
**Expected response status:** 200, `persisted=true`, `lead_id` matching `^L-\d{4}-\d{2}-\d{2}-[A-Z0-9]{3}$`, `band='A'` (or B if readiness scoring lands lower than expected on this transcript), `whale_nurture=false` (readiness too high for nurture flag).

```bash
curl -sS -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "{
    \"caller_phone\": \"+14165550199\",
    \"caller_name\": \"Jordan Reyes\",
    \"transcript\": \"Hi, I'm calling because I'm in a really difficult situation with my business partner. We started a company together about three years ago, fifty-fifty, and over the last few months he's basically locked me out of the bank accounts and won't show me the books. I'm pretty sure he's taking money out of the company because revenue is up but our accounts keep getting drawn down. I have my original shareholder agreement and the incorporation documents. The amount we're talking about is probably north of two hundred thousand dollars over the last year. I need this sorted out quickly because I think he's about to do something with our biggest client. I want to know what my options are.\",
    \"recording_url\": \"https://example.ghl.recording/test1\",
    \"call_duration_sec\": 92,
    \"call_id\": \"smoke-test-001\",
    \"firmId\": \"$FIRM_UUID\"
  }" | jq
```

**Expected response shape:**

```json
{
  "persisted": true,
  "mode": "live",
  "id": "<uuid>",
  "lead_id": "L-YYYY-MM-DD-XXX",
  "brief_id": "<uuid>",
  "status": "triaging",
  "decision_deadline": "<ISO8601 timestamp, ~12h from now given urgency >= 8>",
  "whale_nurture": false,
  "completeness": "<integer 0-100>",
  "band": "A"
}
```

**Verify in Supabase:**

```sql
SELECT lead_id, channel, matter_type, practice_area, band, status, contact_name, contact_phone, decision_deadline
FROM screened_leads
WHERE lead_id = '<lead_id from response>';
-- expect: channel='voice', matter_type='shareholder_dispute', practice_area='corporate', contact_phone='+14165550199'
```

---

## Test 2 — Band B residential purchase (real estate, planned timing, low complexity)

**Scenario:** first-time home buyer, mortgage approved, closing date set, no signed AOS yet.
**Expected matter classification:** `matter_type='residential_purchase_sale'`, `practice_area='real_estate'`.
**Expected band:** B (clear value, low urgency, high readiness).
**Expected response status:** 200, `persisted=true`, `band='B'` (or A if the engine reads "closing date set for end of next month" as higher urgency than expected).

```bash
curl -sS -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "{
    \"caller_phone\": \"+16475550144\",
    \"caller_name\": \"Sam Patel\",
    \"transcript\": \"Yeah, hi. I'm buying my first home and I need a lawyer to handle the closing. It's a condo in downtown Toronto, the purchase price is just under seven hundred thousand. We have a closing date set for the end of next month. I haven't signed anything yet beyond the agreement of purchase and sale. My mortgage is approved. I just need someone to take it from here, do the title insurance, the land transfer tax, the keys-handover, all the closing work.\",
    \"recording_url\": \"https://example.ghl.recording/test2\",
    \"call_duration_sec\": 64,
    \"call_id\": \"smoke-test-002\",
    \"firmId\": \"$FIRM_UUID\"
  }" | jq
```

**Expected response shape:**

```json
{
  "persisted": true,
  "mode": "live",
  "id": "<uuid>",
  "lead_id": "L-YYYY-MM-DD-XXX",
  "brief_id": "<uuid>",
  "status": "triaging",
  "decision_deadline": "<ISO8601 timestamp, ~24-48h from now given moderate urgency>",
  "whale_nurture": false,
  "completeness": "<integer 0-100>",
  "band": "B"
}
```

**Verify in Supabase:**

```sql
SELECT lead_id, channel, matter_type, practice_area, band, status, contact_name, contact_phone
FROM screened_leads
WHERE lead_id = '<lead_id from response>';
-- expect: channel='voice', matter_type='residential_purchase_sale', practice_area='real_estate'
```

---

## Test 3 — Out of scope (family law, declined)

**Scenario:** divorce + custody + matrimonial property. OOS detection should fire.
**Expected matter classification:** `matter_type='out_of_scope'`, `practice_area='family'`.
**Expected band:** `null` (OOS leads are not banded).
**Expected response status:** 200, `persisted=true`, `band=null`, `status='declined'` (the engine routes OOS straight to declined at insert via `computeInitialStatus`).

**Webhook parity with `/api/intake-v2`:** the voice-intake endpoint fires the same `declined_oos` GHL webhook the web path fires. Same payload shape, same `idempotency_key = '<lead_id>:declined_oos'`. The downstream GHL workflow does not need to know the lead came from voice rather than web. Test 4 below asserts the webhook fire end-to-end.

```bash
curl -sS -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "{
    \"caller_phone\": \"+14385550177\",
    \"caller_name\": \"Alex Carter\",
    \"transcript\": \"I need to talk to someone about a divorce. My wife and I have been separated for about six months and we have two kids together. I'm trying to figure out what to do about custody and the matrimonial home.\",
    \"recording_url\": \"https://example.ghl.recording/test3\",
    \"call_duration_sec\": 41,
    \"call_id\": \"smoke-test-003\",
    \"firmId\": \"$FIRM_UUID\"
  }" | jq
```

**Expected response shape:**

```json
{
  "persisted": true,
  "mode": "live",
  "id": "<uuid>",
  "lead_id": "L-YYYY-MM-DD-XXX",
  "brief_id": "<uuid>",
  "status": "declined",
  "decision_deadline": "<ISO8601 timestamp>",
  "whale_nurture": false,
  "completeness": "<integer 0-100>",
  "band": null
}
```

**Verify in Supabase:**

```sql
SELECT lead_id, channel, matter_type, practice_area, band, status
FROM screened_leads
WHERE lead_id = '<lead_id from response>';
-- expect: channel='voice', matter_type='out_of_scope', practice_area='family', band=NULL, status='declined'
```

---

## Test 4 — OOS family with webhook parity assertion

**Scenario:** identical to Test 3, but the operator captures the outbound GHL webhook to verify the `declined_oos` payload reached the configured receiver. Use this to confirm webhook parity with `/api/intake-v2` before opening real Voice AI traffic.

**Setup before running:**

1. Configure the staging firm's `intake_firms.ghl_webhook_url` to point at a capture endpoint you can read. Options:
   - `https://webhook.site` — paste the unique URL it generates into the row, do not navigate away from the inspector
   - The firm's actual GHL inbound webhook (staging workflow), if you want to verify GHL ingests it
   - A local listener: `npx http-echo-server 9099` then `ngrok http 9099` and put the ngrok URL into the column
2. SQL update:
   ```sql
   UPDATE intake_firms SET ghl_webhook_url = '<your-capture-url>' WHERE id = '<$FIRM_UUID>';
   ```
3. Fire the curl below (same payload as Test 3, the assertion is on the receiver side).

```bash
curl -sS -X POST "$ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "{
    \"caller_phone\": \"+14385550177\",
    \"caller_name\": \"Alex Carter\",
    \"transcript\": \"I need to talk to someone about a divorce. My wife and I have been separated for about six months and we have two kids together. I'm trying to figure out what to do about custody and the matrimonial home.\",
    \"recording_url\": \"https://example.ghl.recording/test4\",
    \"call_duration_sec\": 41,
    \"call_id\": \"smoke-test-004\",
    \"firmId\": \"$FIRM_UUID\"
  }" | jq
```

**Expected at the capture URL:** within ~2 seconds of the curl returning, the receiver gets a POST with this shape (mirrors `intake-v2`'s `declined_oos` envelope per the GHL webhook contract):

```json
{
  "action": "declined_oos",
  "lead_id": "L-YYYY-MM-DD-XXX",
  "firm_id": "<$FIRM_UUID>",
  "band": null,
  "matter_type": "out_of_scope",
  "practice_area": "family",
  "submitted_at": "<ISO8601>",
  "status_changed_at": "<ISO8601>",
  "status_changed_by": "system:oos",
  "contact": {
    "name": "Alex Carter",
    "phone": "+14385550177"
  },
  "idempotency_key": "L-YYYY-MM-DD-XXX:declined_oos",
  "declined_oos": {
    "decline_subject": "<resolved subject>",
    "decline_body": "<resolved body interpolating 'family law'>",
    "decline_template_source": "system_fallback | firm_default | per_pa | per_lead_override",
    "detected_area_label": "family law"
  }
}
```

**Assertion checklist:**

- [ ] `action === 'declined_oos'`
- [ ] `lead_id` matches the `lead_id` from the curl response
- [ ] `firm_id` matches `$FIRM_UUID`
- [ ] `idempotency_key === lead_id + ':declined_oos'`
- [ ] `practice_area === 'family'`
- [ ] `declined_oos.detected_area_label === 'family law'`
- [ ] `declined_oos.decline_body` contains the interpolated area label (e.g., "...family law sits outside the matters our firm currently handles...")

**Verify the row landed in Supabase regardless of webhook outcome:**

```sql
SELECT lead_id, channel, matter_type, practice_area, band, status
FROM screened_leads
WHERE lead_id = '<lead_id from response>';
-- expect: identical to Test 3 (channel='voice', matter_type='out_of_scope', band=NULL, status='declined')
```

**Cleanup after the test:** unset the staging `ghl_webhook_url` if you do not want subsequent test leads firing to the capture URL:

```sql
UPDATE intake_firms SET ghl_webhook_url = NULL WHERE id = '<$FIRM_UUID>';
```

**If the webhook never arrives:**

- Vercel function logs should show `[voice-intake] declined_oos webhook failed:` followed by the underlying error
- Most common cause: `intake_firms.ghl_webhook_url` is NULL or unreachable. The endpoint skips silently (matches the at-most-once contract documented in `docs/ghl-webhook-contract.md`)
- Second-most-common: the capture URL rejected with 4xx/5xx. The receiver's response code shows up in the function logs

---

## Failure modes to recognise

| Response | Cause | Fix |
|---|---|---|
| `{ persisted: false, mode: 'demo', reason: 'firmId not a uuid' }` | `firmId` was the GHL location ID (`TH71IN0vUaIByLOxnFQY`) instead of the Supabase uuid | Re-run the SQL lookup in P10 Prerequisites; use the `id` column value |
| `{ persisted: false, mode: 'demo', reason: 'firmId not found in intake_firms' }` | UUID is valid but no matching row | Confirm the firm exists in `intake_firms` and the UUID was copied correctly |
| `{ error: 'transcript is required' }`, 400 | Empty or missing transcript | Provide a non-empty `transcript` field |
| `{ persisted: false, mode: 'duplicate', lead_id: 'L-...' }`, 409 | Engine generated a `lead_id` that collided with an existing row | Re-run; the engine's random suffix should resolve |
| `{ error: 'insert failed: ...' }`, 500 | Supabase write rejected | Check Vercel function logs for the specific Supabase error |
| 200 but brief feels thin in the portal | `GEMINI_API_KEY` missing in Vercel; endpoint ran regex-only | Set `GEMINI_API_KEY` in the production app's environment, redeploy |
| 200 for Test 4 but no inbound POST at the capture URL | `intake_firms.ghl_webhook_url` is NULL, unreachable, or the receiver returned 4xx/5xx | Check the firm row's `ghl_webhook_url` column; check Vercel function logs for `[voice-intake] declined_oos webhook failed:`; verify the capture URL responds 200 to a synthetic POST |
| Test 4 webhook arrives but `practice_area !== 'family'` or `detected_area_label` missing | The OOS regex classifier picked a different practice area, or the decline resolver hit the system fallback path | Confirm the transcript trips the family-law regex (the literal word "divorce" is enough); inspect `lib/decline-resolver` for the chain resolution order |
| Test 4 webhook fires twice for the same lead_id | Retry from the operator (curl re-fired) — the endpoint generates a fresh `lead_id` each call, so a true duplicate by `idempotency_key` should be impossible | Compare `idempotency_key` values; if identical the bug is in the engine's `generateLeadId`. If different, this is the expected behaviour for two separate calls |

---

## Order of operations for the operator

1. Resolve `$FIRM_UUID` from Supabase (see P10 Prerequisites).
2. Run Test 1. Confirm 200 + Band A row in `screened_leads`.
3. Run Test 2. Confirm 200 + Band B row.
4. Run Test 3. Confirm 200 + OOS row with `band=null, status='declined'`.
5. Configure a webhook capture URL on the staging firm. Run Test 4. Confirm 200 + the OOS row in Supabase AND an inbound POST at the capture URL with all assertions in the checklist green.
6. Unset the staging `ghl_webhook_url` if you do not want subsequent test traffic firing to the capture URL.
7. If all four pass: proceed with the GHL Voice AI agent + webhook setup in `P10-voice-ai-build-guide.md`.
8. If any fail: check the response against the Failure modes table above; do not proceed to live Voice AI setup until all four smoke tests pass.

**Deploy gate (non-negotiable):** Test 4 must pass before any real-firm Twilio number routes traffic to `/api/voice-intake`. The web intake path already fires `declined_oos` webhooks; voice must be at parity before going live, or OOS voice leads land in `declined` state with no decline-with-grace cadence kicked off and the lead never hears back.
