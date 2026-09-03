# Final Meta submission inventory, v2

**Status:** Preparation inventory only. Meta submission remains blocked. Nothing in this file authorizes an upload, provider mutation, or final submission.

## Submission identity

| Item | Current record | Required final check |
|---|---|---|
| Meta App ID | `1007304805285554` | Confirm the same app is open at submission time |
| Meta Business ID | `2191422434947205` | Confirm the business context has not changed |
| Historical submission ID | `1016624077686960` | Confirm whether the live draft retains this ID or has a new draft ID |
| Facebook Page | `DRG Law Test` | Show the exact Page name in authoritative Meta UI |
| Instagram account | `@drg_law_test` | Show the exact handle in authoritative Meta or Instagram UI |
| Firm workspace | DRG Law Professional Corporation | Keep unrelated leads outside the recording frame |

## Permission scope

Request only:

- `pages_messaging`; and
- the exact live Instagram messaging permission label displayed for this app, expected to be `instagram_manage_messages` or its current equivalent.

Do not add `public_profile`, approved WhatsApp permissions, `pages_show_list`, `pages_manage_metadata`, `business_management`, `instagram_basic`, or `pages_read_engagement` unless a later source-supported runtime requirement is separately approved.

## Active package files

Use these repository documents as the active package:

1. `docs/app-review/RUNBOOK_Resubmission_v2.md`
2. `docs/app-review/Reviewer_Instructions_Paste_v2.md`
3. `docs/app-review/PERMISSION_CODE_PATH_EVIDENCE_v2.md`
4. `docs/app-review/screencasts/SHOTLIST_v2.md`
5. `docs/app-review/deletion-flow-verification.md`
6. `docs/privacy/PROVIDER_ACCOUNT_EVIDENCE_2026-09-02.md`
7. `docs/privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`

Treat `Phase11_Submission_Package.md`, `Reviewer_Instructions_Paste.md`, and `screencasts/README.md` as historical first-submission material. Do not paste or execute them for this resubmission.

## Public URLs

Read-only HTTP checks on 2026-09-02 returned status 200 for:

- `https://app.caseloadselect.ca/privacy`
- `https://app.caseloadselect.ca/terms`
- `https://app.caseloadselect.ca/data-deletion`

Before submission, re-open each URL in a signed-out session and confirm the rendered copy matches the merged source and exposes no operator-only controls.

## Video candidates

Two edited files currently exist outside the repository:

| Candidate | Technical observation | SHA-256 |
|---|---|---|
| `D:\caseload-select-messenger-demo.mp4` | H.264, 1280 x 720, 30 fps, 30.506 seconds, 1,418,640 bytes | `FEDA5651DAF443AF3358253F3433F4E7FEC90ECB0F66B207898FD2A012639E2E` |
| `D:\caseload-select-instagram-demo.mp4` | H.264, 1280 x 720, 30 fps, 31.018 seconds, 1,678,257 bytes | `03675350A58C6EDA0F208EB6068F4A7714F25280090859BC22A0014BE3E2C595` |

These are candidates, not approved uploads. They fail the current shot-list requirement of at least 1920 x 1080. Their filenames also do not match the required v2 upload names:

- `caseload-select-messenger-resubmission-v2.mp4`
- `caseload-select-instagram-resubmission-v2.mp4`

Do not merely rename the candidates. First watch each complete file and prove that it is one continuous take containing authoritative asset identity, the recent fictional inbound message, the matching portal thread, proof text typed on camera, one visible `Send reply` action, `Reply sent.`, and the identical native receipt. Re-record at 1920 x 1080 or better if any requirement is absent. Captions are optional and do not replace visible product evidence.

Do not upload the repository's v1 Messenger, Instagram, WhatsApp, or Business Manager videos as proof for these two permissions.

## Privacy release gates

All of the following must be closed before final submission:

- [ ] Check the DRG HighLevel Contacts > Restore surface for `L-2026-05-14-5EQ` and attach the timestamped account-specific evidence. Current-record API searches are no-match, but the recycle-bin check remains open.
- [ ] If a recoverable GHL record exists, obtain Adriano's action-time confirmation naming the exact contact before deletion, then record the provider action result.
- [ ] Correct and reverify the completion semantics so a `provider_managed` marker cannot by itself produce successful external-cleanup completion.
- [ ] Attach account-specific provider action or retention evidence for Meta, Resend, GHL, and Supabase. Public documentation alone is insufficient.
- [ ] Confirm the applicable backup-expiry schedules and complete a safe restore/replay rehearsal before restored data returns to operational use.
- [ ] Obtain written privacy-counsel approval for the retained envelope, available joins, three-year per-event maximum, deletion-tombstone retention, and suppression-hash retention.
- [ ] Close or correctly disposition deletion request `a932fae3-479d-400c-a94a-ca510c281879` through the controlled workflow with evidence.

The September fictional production rehearsal passed the tested CaseLoad Select operational-store and control checks. It did not clear the provider, backup, counsel, or legacy GHL gates above.

## Upload and paste checks

- [ ] The live permission list contains only the two supported messaging permissions.
- [ ] The exact Instagram permission label is copied from the live form into the reviewer instructions.
- [ ] Both v2 clips pass every item in `screencasts/SHOTLIST_v2.md` and are watched after any final compression.
- [ ] Each clip is uploaded to the matching permission slot and plays completely in Meta's preview.
- [ ] `Reviewer_Instructions_Paste_v2.md` is re-reviewed after all privacy gates close, then pasted without historical or unsupported claims.
- [ ] Public privacy, terms, and data-deletion URLs render successfully in a signed-out session.
- [ ] A final screenshot captures the permission list, attached clips, reviewer instructions, app identity, and draft submission identifier before submission.

## Final stop

Adriano must review the final draft and give action-time approval immediately before the final Meta submission control. Agents may prepare evidence but must not submit without that approval.
