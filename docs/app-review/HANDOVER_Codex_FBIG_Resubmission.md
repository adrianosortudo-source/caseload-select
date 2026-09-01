# Handover: Meta App Review, Facebook and Instagram resubmission

**For:** Codex, executing in `05_Product/caseload-select-app`
**From:** Claude session 2b1b96f2, 2026-09-01
**Status of task:** open. WhatsApp is approved and shipped. Facebook and Instagram were rejected on evidence quality and need a second submission.

You have no prior context on this task. Everything you need is in this file. Read it top to bottom before acting. Section 3 carries a decision that changes what you build, so do not start work at section 5 without resolving it.

---

## 0. Scope fence

**Do not touch these paths.** A parallel session owns the CaseLoad Screen launch work and will conflict with you:

- `src/lib/screen-engine/**` (byte-for-byte mirrored with an external sandbox, DR-033)
- `src/app/api/voice-intake/**`, `src/lib/voice-realtime/**`
- `src/app/portal/[firmId]/triage/**` scoring, banding, or brief-rendering logic

Reading them is fine. Editing them is not.

**Operator-only actions. Never perform these, and never write instructions that assume you did:**

- Recording any screencast
- Sending test messages from a personal Facebook, Instagram, or WhatsApp account
- Any click inside `developers.facebook.com` or `business.facebook.com`: uploading MP4s, editing the submission, accepting terms, clicking Request again or Submit
- Uploading verification documents

Your output for those steps is a click-by-click runbook the operator follows. Adriano Domingues is the operator and the only person who touches Meta's UI.

**Operator inbox is `adriano@caseloadselect.ca`.** Never substitute a personal gmail in any doc, env var, or copy.

**Writing rules apply to every file you author here.** No em dashes anywhere. No banned AI vocabulary (delve, tapestry, landscape, pivotal, testament, vibrant, intricate, meticulous, garner, interplay, underscore, bolstered, fostering, showcasing, highlighting, emphasizing, enhance, crucial, enduring, boasts, align with, valuable). No italics. No "not just X, but Y" reframes.

---

## 1. What happened

Submission `1016624077686960` on app `1007304805285554` was filed 2026-08-13 and answered 2026-08-25 with a split verdict.

| Permission | Result |
|---|---|
| `whatsapp_business_messaging` | Approved, advanced access live |
| `whatsapp_business_management` | Approved |
| `public_profile` | Approved |
| `pages_messaging` | Rejected, evidence only |
| `pages_show_list` | Rejected, evidence only |
| `pages_manage_metadata` | Rejected, evidence only |
| `business_management` | Rejected, evidence only |
| `instagram_basic` | Rejected, evidence only |
| `instagram_manage_messages` | Rejected, evidence only |
| `pages_read_engagement` | Rejected on substance: "Disallowed Use Case: not needed to support core functionality" |

The six evidence rejections all carried the same line: "We have determined that your apps' use case is allowed, however, the submitted screencast fails to demonstrate the end-to-end experience." Policy 1.6, "Screencast Not Aligned with Use Case Details." Nothing about the product was refused.

The reviewer added a human note, verbatim:

> "Hello team! We were unable to approve this submission because the screencast does not show a message being sent from your app UI and the same message appearing in the native client(Messenger, Instagram, or WhatsApp). Please re-record showing: (1) asset selection (Page, account, or number visible), (2) a live send action from your app, and (3) the delivered message in the native client. Thank you"

Meta's boilerplate also included this, which the first submission never answered:

> "If your app is a server-to-server app OR your app is using system user token to access Meta API, please indicate it in your next submission so that we're aware that frontend Meta login authentication flow is not visible."

**Diagnosis.** The v1 clips filmed the inbound journey: a lead messages the Page, the bot replies, a brief appears in the triage portal. The reviewer wanted the outbound proof with the app as the visible sender. Bot replies were on screen, but nothing on screen attributed them to this app, and there was no asset-selection shot and no captions.

`pages_read_engagement` is a fair rejection. The app never calls it. Concede it.

---

## 2. The architectural fact that blocks a naive re-record

Before planning anything, understand this. Every Meta-channel outbound message in this codebase is issued server-side. Most sends are reached from an inbound webhook, but the expiry cron also enters the shared finalization path and can issue a closing message without a new inbound event.

- `src/lib/channel-send.ts` exports `sendChannelMessage`, the channel-agnostic dispatcher.
- Its seven production call sites are inside `src/lib/channel-intake-processor.ts` as of this writing.
- The processor runs from the three webhook receivers: `/api/messenger-intake`, `/api/instagram-intake`, `/api/whatsapp-intake`.
- `src/app/api/cron/expire-channel-intake-sessions/route.ts` also calls the exported `finalizeChannelLead` path. That path can reach the closing-message send after the cron selects a session whose sliding 24-hour expiry has passed.
- `src/lib/messenger-send.ts` and `src/lib/instagram-send.ts` are the per-channel Graph clients.

**Existing enforcement gap.** Neither `sendChannelMessage` nor the shared closing-message path enforces Meta's 24-hour customer-service window before dispatch. The expiry cron can therefore attempt a closing send after 24 hours of silence and rely on Graph to reject it. Option B must add server-side enforcement for every send path, including suppression of that expired-session closing send, rather than treating the UI's disabled state as the compliance control.

There is no button, form, or compose box anywhere in the product that an operator or lawyer clicks to send a message on a Meta channel. The triage portal shows the resulting brief. It does not show the conversation and it does not show the app's outbound reply.

So the reviewer's beat 2, "a live send action from your app," has nothing to film today. This is the whole problem, and it is why a re-record with better captions may fail again on the same ground.

---

## 3. Decision the operator must make before you build

Two routes to satisfying beat 2. Present both, recommend B, and wait for the operator's answer.

### Option A: document-only, no code

Re-record with the existing behaviour and add an on-screen caption during the automatic reply that names the app as the sender, plus the server-to-server disclosure in the reviewer notes.

- Cost: one operator recording session, roughly 45 minutes. No engineering.
- Risk: the reviewer asked in plain words for a send from the app UI. A caption over an automatic reply asserts what they asked to see demonstrated. Their server-to-server boilerplate excuses a missing login flow, not a missing send action. Moderate chance of a second evidence rejection.

### Option B: ship a channel reply panel, then record (recommended)

Add a Conversation panel to the channel-sourced brief page in the triage portal: the message history for the session, plus a compose box that sends through the existing `sendChannelMessage` dispatcher inside the 24 hour customer-service window.

- Cost: one focused build. Reuses the dispatcher, the tokens, and the session row that already exist. No new Meta scope is required beyond what is already being requested.
- Payoff: beat 2 becomes literal. The operator types in the app, clicks Send, and the message appears in Messenger, in one unbroken shot with the Page name visible. Beats 1, 2 and 3 land in a single take with no cuts, which is exactly the recipe.
- Independent merit: a lawyer replying to a Messenger or Instagram lead from the portal is a real product gap. The app already messages the lead automatically during contact capture, so a human-composed reply on the same thread is the same capability with the lawyer in control. It is not a review prop.
- Product decision the operator owns: whether a lawyer-composed reply on a public social channel is something DRG should have at all, given LSO Rule 4.2-1. The panel sends plain text into an existing conversation, so the compliance surface is the same one the automatic replies already occupy, but the operator makes this call, not you.

**Recommendation: Option B.** The reviewer told you what would pass. Option B produces exactly that artifact and leaves a real feature behind. Option A spends an operator recording session on a bet against the reviewer's own words.

If the operator picks A, skip WP-1 and use the Option A caption text in WP-2.

---

## 4. WP-0: discovery, run this first regardless of the decision

Do not trust this document on live state. It was written from a session transcript and the repo, not from Meta's dashboard.

1. **Build a permission-to-code-path evidence table.** For each permission you intend to re-request, cite the file and line of the code that actually exercises it. `pages_read_engagement` was rejected precisely because no such path exists. Any permission you cannot evidence gets dropped from the request, not defended.

   Expected result, to be verified not assumed:

   | Permission | Expected justification |
   |---|---|
   | `pages_messaging` | `messenger-send.ts` posts to `/{page_id}/messages` |
   | `pages_manage_metadata` | Page webhook subscription (`subscribed_apps`). Find the call. If the operator does this by hand in the dashboard and no code path exists, say so. |
   | `business_management` | System User token access to portfolio assets |
   | `instagram_basic` | IG account identity on the webhook payload |
   | `instagram_manage_messages` | `instagram-send.ts` posts to `/me/messages` |

2. **Recommend the reduced set.** Current thinking is 5 permissions, down from the 7 rejected: drop `pages_read_engagement` (conceded) and `pages_show_list` (the app never enumerates a user's Pages, because there is no Facebook Login flow and the operator sets `facebook_page_id` on `intake_firms` by hand). Confirm or correct this from the code.

3. **Verify the send paths still work.** `instagram-send.ts` carries a fix from 2026-08-13: the endpoint must be Page-scoped `/me/messages`, never `/<ig_business_account_id>/messages`, which returns Graph error #3 with a Page token. Confirm the fix is still in place on `main` before anyone records.

4. **Confirm the live firm config.** DRG row `eec1d25e-a047-4827-8e4a-6eb96becca2b` on `intake_firms` should carry `facebook_page_id = 1179834051874177`, `instagram_business_account_id = 17841411029834507`, and a non-null `facebook_page_access_token`. Report if any is missing or expired.

5. **Flag doc staleness.** `docs/app-review/Operator_Execution_Checklist.md` lines 344 and 350 are wrong. They say screencasts are not recorded. Four were recorded but remained untracked in the canonical checkout when this handover was written; the Option B worktree preserves copies under `docs/app-review/screencasts/` without deleting the originals. The checklist also says business verification needs a document, but verification cleared 2026-08-01 via D-U-N-S. Fix in WP-6.

---

## 5. Work packages

### WP-1 (Option B only): channel reply panel

Build the smallest honest surface that makes beat 2 filmable.

- Surface: the brief page at `/portal/[firmId]/triage/[leadId]`, for leads whose `slot_answers->>'channel'` is `facebook`, `instagram`, or `whatsapp`.
- Render the conversation. `channel_intake_sessions.engine_state` holds the serialized `EngineState` for the session, keyed on `(firm_id, channel, sender_id)`. Determine whether it carries a usable message history. If it does not, decide between a narrow additive column and rendering only the outbound messages you send from the panel forward. Do not build a new table without saying why.
- Compose and send through `sendChannelMessage`. Do not write a fourth Graph client.
- Gate on the 24 hour window. Outside it, disable the control and say why rather than letting a send fail at Graph.
- Mount it with the `ACTION_RAIL_SLOT` pattern (DR-057) if it belongs inline in the brief. Fixed-position overlays for inline affordances are forbidden in this codebase.
- Auth: same posture as the surrounding triage routes. Operator or matching firm lawyer. Client sessions are excluded (DR-063).
- Tests: happy path plus at least one error case per new function, per the repo's standing gate.

Branch naming in this repo follows `codex/<slug>`. Open a PR; do not push to `main`.

### WP-2: v2 shot lists

Author `docs/app-review/screencasts/SHOTLIST_v2.md`. Three clips: Messenger, Instagram, Business Manager configuration. Do not re-record WhatsApp; it is approved and must not be resubmitted.

Every clip follows the reviewer's three beats in one continuous take where possible:

1. **Asset selection.** The Page name `DRG Law Test` or `@drg_law_test` visible on screen, selected inside the app or the Business Suite before anything is sent.
2. **Live send from the app.** Under Option B: the operator types in the portal compose box and clicks Send, on camera. Under Option A: the inbound arrives and the automatic reply fires, with this caption on screen at that moment: `This reply is composed and sent by CaseLoad Select (this app) through the Messenger Send API using the connected Page access token.`
3. **Delivered message in the native client.** The same message text visible in the Messenger or Instagram thread on a phone or in the native web client.

Requirements the first submission missed: on-screen captions or tooltips throughout, English UI, no cuts between the send and the delivery. Carry forward the existing spec from `screencasts/README.md` (MP4 H.264, 1080p or better, under 3 minutes, under 100 MB) and the existing verification checklist.

Write the caption text as literal strings the operator overlays. Do not describe them in the abstract.

### WP-3: v2 reviewer notes

Author `docs/app-review/Reviewer_Instructions_Paste_v2.md`, based on `Reviewer_Instructions_Paste.md`, with these changes:

- Add the architecture disclosure the boilerplate invited. Draft to adapt:

  > ARCHITECTURE DISCLOSURE (server-to-server). CaseLoad Select has no frontend Meta login flow, because none exists anywhere in the product. The app authenticates to the Graph API with a System User access token (System User `CaseLoad Select API`, id `61590400959519`) and with per-Page access tokens held server-side against each firm's tenant record. A reviewer will not see a Facebook Login dialog at any point. Inbound messages arrive on our webhook endpoints, are processed server-side, and replies are issued by our server through the Send API using the stored Page token.

- Update the permission list in the second paragraph to the reduced set from WP-0.
- Remove the WhatsApp reviewer steps and the allowlist coordination paragraph. That channel is approved and is not part of this submission.
- Keep the tenant-separation statement, the operator contact block, the policy URLs, and the reviewer test-data deletion paragraph as they are. They were not the reason for rejection.

### WP-4: submission runbook for the operator

Author `docs/app-review/RUNBOOK_Resubmission_v2.md`. Click-by-click, written for Adriano, assuming he has the three new MP4s on disk.

Cover: where the Request again button lives on the feedback page; which permissions to re-request and which to leave alone; the per-permission screencast attachment map for the reduced set; where the reviewer-notes textarea is; and the pre-submit checklist.

Two traps to state explicitly in the runbook:

- **Do not resubmit the three approved permissions.** Verify the new draft contains only the re-requested ones. Putting an approved permission back into review risks a live capability.
- **There is no discard-draft button.** Only per-permission trash icons. Never advise starting over, because that destroys every saved description.

### WP-5: test data reset and compression

Two operator-support jobs.

**Reset before each recording take** so the flow starts clean. The pattern used previously, adapted per channel and sender:

```sql
WITH deleted_sessions AS (
  DELETE FROM channel_intake_sessions
  WHERE firm_id = 'eec1d25e-a047-4827-8e4a-6eb96becca2b'
    AND channel = 'facebook' AND sender_id = '<PSID>'
  RETURNING id
),
deleted_leads AS (
  DELETE FROM screened_leads
  WHERE firm_id = 'eec1d25e-a047-4827-8e4a-6eb96becca2b'
    AND slot_answers->>'channel' = 'facebook'
    AND created_at > now() - interval '2 hours'
  RETURNING lead_id
)
SELECT (SELECT count(*) FROM deleted_sessions), (SELECT count(*) FROM deleted_leads);
```

Narrow the predicate to the recording session before running it. Do not delete by firm alone.

**Compress after recording.** ffmpeg is on the operator's PATH. The settings that took the v1 clips from roughly 130 MB to under 8 MB with no visible loss:

```bash
ffmpeg -y -i INPUT.mp4 -c:v libx264 -crf 26 -preset medium -c:a aac -b:a 128k -movflags +faststart OUTPUT.mp4
```

If a browser debug banner is captured, crop it: add `-vf "crop=1280:692:0:28"` with the numbers measured from the actual frame.

### WP-6: repair the stale checklist

Update `docs/app-review/Operator_Execution_Checklist.md`: mark screencasts as recorded, mark business verification as cleared 2026-08-01, and add a row for the 2026-08-25 verdict pointing at this handover. Do not rewrite the historical Block 2 and Block 3 steps; they are the record of what was done.

---

## 6. Reference data

| Item | Value |
|---|---|
| Meta App ID | `1007304805285554` |
| Business Portfolio ID | `2191422434947205` |
| Submission ID (v1) | `1016624077686960` |
| Feedback page | `developers.facebook.com/apps/1007304805285554/app-review/submissions/feedback/?submission_id=1016624077686960` |
| Test Facebook Page | `DRG Law Test`, id `1179834051874177` |
| Test Instagram Business | `@drg_law_test`, id `17841411029834507` |
| Test WABA / phone | `1346285637647296` / `1135653749626764` (approved, out of scope for this submission) |
| System User | `CaseLoad Select API`, id `61590400959519` |
| DRG firm row (`intake_firms`) | `eec1d25e-a047-4827-8e4a-6eb96becca2b` |
| Supabase project | `ssxryjxifwiivghglqer` (ca-central-1) |
| Triage portal | `app.caseloadselect.ca/portal/eec1d25e-a047-4827-8e4a-6eb96becca2b/triage` |
| v1 screencasts | `docs/app-review/screencasts/*.mp4` |
| Existing reviewer notes | `docs/app-review/Reviewer_Instructions_Paste.md` |
| Existing shot lists and spec | `docs/app-review/screencasts/README.md` |
| Per-permission write-ups | `docs/app-review/Phase11_Submission_Package.md` section 2 |

Test message body used in the v1 recordings, calibrated to land in-scope for DRG (employment, `wrongful_dismissal`), so reuse it:

> I was let go from my job last week after 6 years. They offered me 8 weeks of severance but I'm not sure if that's fair. I want to understand my options before I sign anything.

---

## 7. Traps already paid for

- **`fblogin-web-1` and its siblings.** A Meta form error of the shape `<section>-<platform>-<n>` names the SECTION, not the product. `fblogin-web-1` was an unanswered Yes/No radio, "Is Facebook Login integrated on this platform?", sitting below a long textarea in the Reviewer instructions section. The answer is No. Roughly two hours were lost changing app OAuth configuration that had nothing to do with it. When a Meta submit fails on a label, scroll that section to the bottom before touching app settings.
- **App config posture, do not change it.** Client OAuth login off, Web OAuth login off, Website platform present with Site URL `https://app.caseloadselect.ca/`. This is consistent with having no Facebook Login, and it is not the cause of any error you will see.
- **Instagram Send API.** Page-scoped `/me/messages` only. The IG-account-ID path belongs to the Instagram Login flow, expects an Instagram User token, and fails with Graph error #3 under a Page token no matter which permissions are granted. `follow_up_attempts = 0` on an `unconfirmed_inquiries` row means the Send API failed, not that the lead abandoned.
- **Verification is done and is not at risk here.** D-U-N-S `243370969` cleared Meta on 2026-08-01 and Apple on 2026-07-16. Canadian sole proprietorships fail document review on both platforms because they do not appear in the registries those platforms query. Nothing in this resubmission touches verification.

---

## 8. Definition of done

1. WP-0 evidence table exists and the requested permission set is justified line by line against code.
2. The operator has answered the Option A or B question, and if B, the panel is merged and deployed to production.
3. `SHOTLIST_v2.md`, `Reviewer_Instructions_Paste_v2.md`, and `RUNBOOK_Resubmission_v2.md` are committed.
4. The stale checklist rows are corrected.
5. The operator has everything needed to record, compress, attach, and click Request again without asking a further question.

Submission itself is the operator's action. Your task ends when he can execute it unaided.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-09-01 | Meta App Review verdict | FB and IG advanced access still pending on evidence resubmission | High | `05_Product/caseload-select-app/docs/app-review/` | Execute WP-0 through WP-6 in this handover | Codex, then operator | Open |
| 2026-09-01 | WP-1 scoping | No operator-facing send surface exists for any Meta channel | Medium | `src/lib/channel-send.ts`, `src/app/portal/[firmId]/triage/` | Operator decides Option A or B before build starts | Adriano | Open |
| 2026-09-01 | Doc audit | `Operator_Execution_Checklist.md` state table is stale on screencasts and verification | Low | `docs/app-review/Operator_Execution_Checklist.md` | Correct in WP-6 | Codex | Open |
