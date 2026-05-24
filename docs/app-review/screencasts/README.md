# Meta App Review screencasts

This directory holds the demo screencasts the App Review form requires. Each clip shows a single Meta permission being exercised end-to-end on the test assets created in Block 2 of the Meta App Creation runbook.

## Naming convention

Each clip is named for the permission slot it occupies in the App Review form, all lower-case, hyphenated, MP4 container:

| Filename | Permission it demonstrates | Test asset used |
|---|---|---|
| `caseload-select-messenger-demo.mp4` | `pages_messaging` + `pages_show_list` + `pages_manage_metadata` + `business_management` (Messenger half) | Test Facebook Page `DRG Law Test` |
| `caseload-select-instagram-demo.mp4` | `instagram_business_basic` + `instagram_business_manage_messages` | Test IG Business `@drg_law_test` linked to the test Page |
| `caseload-select-whatsapp-demo.mp4` | `whatsapp_business_messaging` + `whatsapp_business_management` | Meta-provisioned test phone on the test WABA |
| `caseload-select-business-manager-config.mp4` | `business_management` (admin half) + `whatsapp_business_management` (read half) | Operator-side Business Manager browsing |

Four clips total: three channel demos (one per Meta surface) plus one admin clip for the read-side permissions that have no end-user interaction.

## Spec

| Setting | Value |
|---|---|
| Container | MP4 (H.264 video, AAC audio) |
| Resolution | 1920 × 1080 minimum; native screen resolution preferred |
| Frame rate | 30 fps |
| Duration | 60 to 180 seconds per clip; under 3 minutes is a hard ceiling for App Review upload |
| File size | Under 100 MB per clip (App Review upload cap) |
| Audio | No narration required; if used, captions match the annotation block in `Phase11_Submission_Package.md` Section 2 |
| Sensitive info | No reviewer credentials, no API keys, no personal phone numbers other than the test number on screen |

If any clip exceeds 100 MB, re-encode with HandBrake at CRF 24 (H.264) to compress without visible quality loss.

## Recording tools (operator's choice)

- **OBS Studio** (free, recommended for the screen + window-source setup)
- **Loom** (paid, cloud-hosted, easy share links — but download the MP4 locally before uploading to Meta)
- **macOS QuickTime / Windows Game Bar** (built-in screen recording, fine for short clips)

## Per-clip shot list

Each shot list below is a literal sequence the operator follows during recording. Times are approximate. The annotation timecodes in `Phase11_Submission_Package.md` Section 2 line up with these.

---

### 1. `caseload-select-messenger-demo.mp4`

| Time | Shot | Action |
|---|---|---|
| 0:00 | Title card (3 sec) | "CaseLoad Select — Facebook Messenger intake demo" on a navy background with the gold-on-navy logo |
| 0:03 | Facebook Messenger on a phone or desktop (logged in as a personal account, NOT the test Page admin) | Search for `DRG Law Test`, open conversation |
| 0:10 | Compose the inbound message | Type: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline." |
| 0:18 | Hit send | Message lands; the Page indicator shows the AI processing (5-15 seconds of waiting) |
| 0:30 | Cut to inbound reply | The Page replies with the clarifying question asking for name and a reachable email or phone |
| 0:40 | Compose the contact reply | Type: "Sarah Patel, sarah.patel.test@example.com" |
| 0:48 | Hit send | The Page acknowledges with the brief routing-confirmation message |
| 0:55 | Cut to the triage portal (operator browser) | Show `app.caseloadselect.ca/portal/[test-firm-id]/triage` with the new brief at the top of the queue |
| 1:05 | Click into the brief | Show the rendered brief: Band badge, NAP block at top, four-axis breakdown, matter snapshot, call openers |
| 1:18 | Highlight the channel chip | Brief header shows "Channel: Facebook Messenger" |
| 1:25 | End card (3 sec) | "Permission scope: pages_messaging · pages_show_list · pages_manage_metadata · business_management" |

Duration target: ~90 seconds

---

### 2. `caseload-select-instagram-demo.mp4`

| Time | Shot | Action |
|---|---|---|
| 0:00 | Title card (3 sec) | "CaseLoad Select — Instagram DM intake demo" |
| 0:03 | Instagram app on a phone (logged in as a personal IG account, NOT the test Business account admin) | Search for `@drg_law_test`, open DM |
| 0:10 | Compose the inbound message | Type: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline." |
| 0:18 | Hit send | Same processing delay as Messenger |
| 0:30 | Cut to inbound reply | Clarifying question asking for name and a reachable email or phone |
| 0:40 | Compose the contact reply | Type: "Sarah Patel, sarah.patel.test@example.com" |
| 0:48 | Hit send | Acknowledgment lands |
| 0:55 | Cut to the triage portal (operator browser) | Same portal as Messenger, new brief at the top of the queue |
| 1:05 | Click into the brief | Show channel chip says "Channel: Instagram" |
| 1:18 | End card (3 sec) | "Permission scope: instagram_business_basic · instagram_business_manage_messages" |

Duration target: ~80 seconds

---

### 3. `caseload-select-whatsapp-demo.mp4`

| Time | Shot | Action |
|---|---|---|
| 0:00 | Title card (3 sec) | "CaseLoad Select — WhatsApp Cloud API intake demo" |
| 0:03 | WhatsApp on an allowlisted phone | Open the contact for the Meta-provisioned test number, start a new conversation |
| 0:10 | Compose the inbound message | Type: "Hi, I just received a study permit refusal letter from IRCC. I need help filing an appeal before the deadline." |
| 0:18 | Hit send | Same processing delay as the other two |
| 0:30 | Cut to inbound reply | Clarifying question |
| 0:40 | Compose contact reply | Type: "Sarah Patel, sarah.patel.test@example.com" |
| 0:48 | Hit send | Acknowledgment lands |
| 0:55 | Cut to the triage portal | Same portal; channel chip says "Channel: WhatsApp" |
| 1:05 | Click into the brief | Show the brief |
| 1:18 | End card (3 sec) | "Permission scope: whatsapp_business_messaging · whatsapp_business_management" |

Duration target: ~80 seconds

If the Meta test phone is outbound-only and cannot receive inbound from the reviewer's phone, record a back-up clip that runs the same flow against a non-test inbound (production number). Note the limitation in the App Review submission notes. See `Phase11_Submission_Package.md` Section 2.7 for the contingency wording.

---

### 4. `caseload-select-business-manager-config.mp4`

Admin-side clip, no end-user interaction. Demonstrates the read-side of `business_management` and `whatsapp_business_management` via the Meta Business Manager UI.

| Time | Shot | Action |
|---|---|---|
| 0:00 | Title card (3 sec) | "CaseLoad Select — Meta Business Manager configuration" |
| 0:03 | Meta Business Suite logged in as the CaseLoad Select Business Portfolio owner | Navigate to Business Settings via the gear icon |
| 0:10 | Accounts → Pages | Show `DRG Law Test` listed with the CaseLoad Select app under "Connected apps" |
| 0:25 | Accounts → Instagram Accounts | Show `@drg_law_test` linked |
| 0:35 | Accounts → WhatsApp Accounts | Show the test WABA with the test phone number listed |
| 0:50 | WhatsApp Manager → Phone Numbers | Show the test number with its display name and quality rating |
| 1:05 | WhatsApp Manager → Message Templates | Show the templates panel (empty or with one approved template) |
| 1:15 | Apps → CaseLoad Select | Show the connected app's permission set |
| 1:25 | End card (3 sec) | "Permission scope: business_management · whatsapp_business_management" |

Duration target: ~90 seconds

---

## Verification checklist before upload

Run through this list once per clip before attaching to the App Review form:

- [ ] Filename matches the convention above
- [ ] Resolution is 1080p or better
- [ ] Duration is under 3 minutes
- [ ] File size is under 100 MB
- [ ] No personal phone numbers, emails, or credentials visible on screen (other than the test asset names and the test email `sarah.patel.test@example.com`)
- [ ] Channel chip in the triage portal matches the channel being demoed
- [ ] Brief is from the test firm only (`DRG Law Test`), not a production firm
- [ ] Audio either matches the annotation block in `Phase11_Submission_Package.md` Section 2 or is muted
- [ ] Title and end cards display correctly

## Where the clips attach in the App Review form

| Permission slot | Clip |
|---|---|
| `pages_messaging` | `caseload-select-messenger-demo.mp4` |
| `pages_show_list` | `caseload-select-business-manager-config.mp4` (or a separate operator-side wizard clip if Meta requires it) |
| `pages_manage_metadata` | `caseload-select-business-manager-config.mp4` |
| `business_management` | `caseload-select-business-manager-config.mp4` |
| `instagram_business_basic` | `caseload-select-instagram-demo.mp4` |
| `instagram_business_manage_messages` | `caseload-select-instagram-demo.mp4` |
| `whatsapp_business_messaging` | `caseload-select-whatsapp-demo.mp4` |
| `whatsapp_business_management` | `caseload-select-business-manager-config.mp4` |

Meta allows the same clip to be attached to multiple permission slots when one demonstration covers several permissions. Use the same MP4 across all slots it applies to; do not re-encode separate copies.
