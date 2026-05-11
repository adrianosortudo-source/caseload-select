# P10 — GHL Voice AI build guide (Voice intake channel)

**Audience:** Operator (Adriano). This document is the operator's checklist for configuring the GHL side of the Voice intake channel. The engineering side (the `/api/voice-intake` endpoint, the engine port, the sandbox Voice tab, the doctrine updates) is complete.

**Sub-account:** staging (`TH71IN0vUaIByLOxnFQY`). Do this in staging first. Production sub-accounts inherit the configuration via snapshot.

**Status:** Voice is the seventh canonical channel (CRM Bible DR-033). Option B architecture: GHL handles the call mechanics, the app handles the screening.

**Prerequisites:**

- The app is deployed and `https://app.caseloadselect.ca/api/voice-intake` is reachable. Run a synthetic POST to confirm before starting the GHL configuration.
- **Look up the staging firm's Supabase UUID before anything else.** Run `SELECT id, name FROM intake_firms WHERE ghl_location_id = 'TH71IN0vUaIByLOxnFQY';` in the Supabase SQL editor. The `id` column is what the endpoint's `firmId` body field expects. The GHL location ID (`TH71IN0vUaIByLOxnFQY`) is NOT the firmId; using it returns a `demo` mode response and skips persistence. Document the resolved UUID in `00_System/06_Setup-Registry/SYSTEM-INVENTORY.md`.
- `GEMINI_API_KEY` is set in the production app's Vercel environment. Without it, the endpoint still works but LLM extraction is disabled (regex-only).
- The PIT for staging exists (the "Claude — full access" PIT, used by the operator for read-back verification, not by the endpoint).

---

## 1. Twilio number provisioning

1. In GHL, go to **Settings → Phone System → Numbers**. Click **Add Number**.
2. Search for a Toronto-area number (`416` or `647` area code). Pick one.
3. Purchase. Confirm the number appears in the Numbers list with both **Voice** and **SMS** capabilities enabled.
4. Note the E.164 form (e.g., `+14165550199`). Document it in `00_System/06_Setup-Registry/SYSTEM-INVENTORY.md` under the staging sub-account's phone section.

---

## 2. Voice AI agent setup

The Voice AI agent is GHL's hosted IVR + ASR + TTS bundle. Its only job is to capture a single utterance from the caller, transcribe it, and post the transcript to the app.

**Path:** Settings → Voice AI → Agents → New Agent.

**Agent name:** `CaseLoad Screen Intake (staging)`.

**Assigned number:** the Toronto number from step 1.

**Greeting (the agent's opening line):**

> "You've reached the firm's intake line. This call is recorded and the firm reviews every message. Tell me what's going on and what you want to sort out, then I'll pass it to a lawyer who reviews and reaches out if your matter fits."

Keep it short. No legal advice disclaimers beyond "the firm reviews every message". The brief itself carries the LSO Rule 4.2-1 notice when the lawyer opens it.

**Intake script (single question):**

> "Take your time. When you're done, just stop talking."

The agent listens, transcribes, posts. No second turn. This matches the single-pass architecture (DR-031 Tight tier, budget 3 — though the budget only applies if the engine asks follow-up questions, which it does not for voice; the cap is structural rather than behavioural).

**Off-hours fallback:**

- After hours (firm-configurable, e.g., 7 PM to 8 AM local time): route to voicemail with this prompt: "The firm is closed. Leave a message and a callback number; a team member reviews voicemails first thing in the morning."
- Voicemail recordings are NOT processed by `/api/voice-intake` in this iteration. They sit in the GHL conversation thread for the operator / lawyer to review manually.

**Caller name capture:**

The agent asks the caller's name once at the start, after the greeting and before the intake question: "Quick one first — what's your name?" Captured value posts to the webhook as `caller_name`. Skip on silence.

---

## 3. Post-call webhook configuration

This is the load-bearing piece. Without the webhook, the call lands in the GHL inbox but never reaches the engine.

**Path:** Settings → Voice AI → Webhooks → New Webhook.

**Trigger:** Call ended.

**URL:** `https://app.caseloadselect.ca/api/voice-intake`

**Method:** POST.

**Content-Type:** `application/json`.

**Payload mapping (Voice AI exposes these on the call-end event; map each into the JSON body):**

| Webhook field | Source variable in Voice AI |
|---|---|
| `caller_phone` | `{{from_number}}` (E.164) |
| `caller_name` | `{{captured.caller_name}}` (the name slot value) |
| `transcript` | `{{transcript}}` (full call transcript) |
| `recording_url` | `{{recording_url}}` |
| `call_duration_sec` | `{{duration_sec}}` |
| `call_id` | `{{call_id}}` |
| `firmId` | hardcoded **Supabase UUID** for the firm — NOT the GHL location ID. Look up via `SELECT id, name FROM intake_firms WHERE name ILIKE '%CaseLoad Select%' OR ghl_location_id = 'TH71IN0vUaIByLOxnFQY';` and use that uuid value. The endpoint validates against `intake_firms.id`; passing the GHL location ID returns `{ persisted: false, mode: 'demo', reason: 'firmId not a uuid' }` and silently skips persistence. |

If your version of Voice AI uses different variable names, check **Voice AI → Settings → Available Variables**.

**Auth:** the endpoint accepts the POST with no auth header in the current iteration. The firm ID in the body is the credential gate (the endpoint validates it against `intake_firms`).

---

## 4. Custom field mapping in GHL

The voice-intake endpoint writes directly to `screened_leads` in Supabase. It does NOT write into GHL custom fields directly. The triage portal reads from `screened_leads` and surfaces the brief there.

If the operator wants the call to ALSO land as a GHL contact (so the conversation thread shows up next to SMS and WhatsApp), configure a parallel **Contact Created** action on the Voice AI workflow:

| GHL custom field | Maps from |
|---|---|
| `caller_phone` | `{{from_number}}` |
| `caller_name` | `{{captured.caller_name}}` |
| `Source` | hardcoded "Voice intake" |
| `Active Journey` | hardcoded "J1 New Lead Response" (the standard inbound journey) |

This is optional. Voice intake works end-to-end without it; the parallel contact is for the operator's convenience.

---

## 5. Test-call verification

After steps 1-4, run a test call from a personal phone.

**What to verify:**

1. The call connects, the agent greets, asks for your name, asks the intake question.
2. You speak a Band A-shaped description (e.g., "I'm in a shareholder dispute with my business partner who locked me out of the bank accounts and I have proof of ownership and I need this resolved this week"). Hang up.
3. Within 30 seconds, `/api/voice-intake` should have returned `{ persisted: true, ... }`. Check via Vercel function logs.
4. Open the lawyer triage portal: `/portal/TH71IN0vUaIByLOxnFQY/triage`. The new lead should appear with `channel='voice'` and a complete brief.
5. Click into the brief. Verify:
   - Channel chip reads "Channel: Voice · Transcribed from a phone call. Confirm details on the call back."
   - Open questions section shows "Voice intake: transcribed from a phone call, single-pass extraction."
   - Caller phone is populated, caller name is populated.
   - Band is A, B, or C (not null) for an in-scope matter.

**If the call lands but the brief is thin:**

- `GEMINI_API_KEY` may be missing in Vercel. Regex-only extraction produces fewer slot answers. Check `/api/voice-intake` Vercel logs for `LLM extraction failed` or `mode: 'disabled'` lines.
- The transcript may be too short for the engine to find handles. Voice AI sometimes truncates. Compare `transcript` length in the webhook payload vs the full call.

**If nothing lands:**

- Verify the webhook URL has no typo.
- Verify the firm UUID in the payload matches a row in `intake_firms`.
- Check Vercel function logs for 4xx or 5xx responses. The endpoint returns `{ persisted: false, mode: 'demo', reason: ... }` for firmId mismatches.

---

## 6. GHL Workflow AI Builder — optional shortcut for the call-end workflow

GHL has a Workflow AI Builder feature (rolled out late 2024 / early 2025; sometimes called "AI Workflow Assistant"). If your staging sub-account shows a **✨ AI** button in the workflow editor (typically top-right of the canvas), you can prompt the AI to scaffold the call-end workflow rather than building it by hand.

**Suggested prompt for the AI Builder:**

> "Create a workflow with trigger 'Voice AI Call Ended'. After the trigger, fire an outbound webhook to `https://app.caseloadselect.ca/api/voice-intake` with a JSON body containing `caller_phone`, `caller_name`, `transcript`, `recording_url`, `call_duration_sec`, `call_id` (mapped from the call-end event variables) and `firmId` hardcoded to `TH71IN0vUaIByLOxnFQY`. Method POST, Content-Type application/json. No retries. No further actions in this workflow."

**Verify the AI output before saving.** The GHL Workflow AI Builder is fast (a workflow scaffold in roughly three minutes) but routinely picks the wrong trigger type, misses idempotency guards, or references custom fields by display name instead of field key. After the AI generates, use the PIT (the "Claude — full access" token) to read back what landed: a curl against `https://services.leadconnectorhq.com/workflows/?locationId=TH71IN0vUaIByLOxnFQY` shows the workflow JSON. Confirm the trigger type, the webhook URL, the payload mapping, and the absence of unwanted second actions.

If the AI Builder is not available in your sub-account (no ✨ AI button), build the workflow by hand. The configuration is small enough that hand-building takes roughly the same time as auditing AI output.

---

## 7. Snapshot inclusion

Once the staging configuration is verified by test call:

1. Export a new snapshot from staging: **Agency → Account Snapshots → Create New Snapshot**. Name it `CaseLoad Select · Core Chassis · v[N+1].0` where N is the current production version.
2. The snapshot now carries: Voice AI agent, post-call webhook, optional contact-creation workflow.
3. Apply to client sub-accounts via **Agency → Sub-Accounts → [Client Account] → Actions → Load Snapshot**. The post-apply checklist gains one step: update the webhook URL's hardcoded `firmId` to the new client's UUID.

The Twilio number does NOT transfer via snapshot. Provision a fresh number per client sub-account.

---

## 8. Constraints and DO-NOTs

- **Do not** build a custom realtime voice agent. Option C is deferred (CRM Bible DR-033 reason 1). GHL Voice AI is sufficient until usage signals justify a deeper investment.
- **Do not** activate billing during this build. The Voice channel build does not require the inbound webhook trigger gating that P4 was blocked on.
- **Do not** route voicemail recordings through `/api/voice-intake` in this iteration. Voicemails are operator-handled manually until ASR-confidence scoring is added.
- **Do not** modify the `/api/voice-intake` endpoint to handle multi-turn voice conversations. Multi-turn is Option C territory; the current iteration is single-pass.
- **Do not** add per-call billing tracking, retry-on-failure, or webhook outbox patterns to this endpoint. Best-effort delivery matches `/api/intake-v2`'s contract; outbox hardening is a Phase 4 concern.

---

## 9. Reference

- CRM Bible DR-033 (Voice channel): `Version3_CaseLoadSelect/CaseLoad_Select_CRM_Bible_v5.1.md`
- Endpoint source: `src/app/api/voice-intake/route.ts`
- Engine port: `src/lib/screen-engine/` (mirrors sandbox `src/engine/`)
- Engine sync verification: `scripts/check-engine-sync.sh`
- Sandbox Voice tab: `caseload-screen-v2.vercel.app` (the Voice channel renders pre-recorded transcripts through the engine for demos and iteration)
