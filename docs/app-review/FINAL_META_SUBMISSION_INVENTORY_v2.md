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
6. `docs/privacy/PRIVACY_COUNSEL_APPROVAL_REQUEST.md`
7. `docs/app-review/META_READINESS_CLOSEOUT_2026-09-04.md`
8. `docs/app-review/PUBLIC_COPY_RECONCILIATION_MATRIX_2026-09-04.md`

Keep `docs/privacy/PROVIDER_ACCOUNT_EVIDENCE_2026-09-02.md` and `docs/privacy/PROVIDER_SUPPORT_REQUEST_DRAFTS.md` as separate privacy-compliance follow-up records. They are not active Meta submission package files.

Treat `Phase11_Submission_Package.md`, `Reviewer_Instructions_Paste.md`, and `screencasts/README.md` as historical first-submission material. Do not paste or execute them for this resubmission.

## Public URLs

Read-only HTTP checks on 2026-09-04 returned status 200 for:

- `https://app.caseloadselect.ca/privacy`
- `https://app.caseloadselect.ca/terms`
- `https://app.caseloadselect.ca/data-deletion`

Before submission, re-open each URL in a signed-out session and confirm the rendered copy matches the merged source and exposes no operator-only controls.

## Verified v2 video files

Two edited v2 files currently exist outside the repository:

| File | Verified technical observation | SHA-256 |
|---|---|---|
| `D:\caseload-select-messenger-resubmission-v2.mp4` | H.264 video only, 1920 x 1080, 30 fps, 30.500 seconds, 1,456,807 bytes | `C729EE8BBB5729EAF5A740B0505106D440A71E10F457AFAC38C37F0D8ACC6DBC` |
| `D:\caseload-select-instagram-resubmission-v2.mp4` | H.264 video only, 1920 x 1080, 30 fps, 31.000 seconds, 1,836,714 bytes | `FFB75B3AA059349511DA09EB8927E8CD8F57295C4AA5AF24DD7B62AC5182780D` |

Both files passed a full decode with no reported error. Content review verified the continuous identity, portal action, native-receipt proof, and required on-screen captions. They have not been uploaded to Meta.

The files, sizes, stream metadata, and SHA-256 values above were independently rechecked on 2026-09-04. Only these two `caseload-select-*-resubmission-v2.mp4` files were found in the intended `D:\` submission-video location.

App-specific reviewer feedback requires on-screen captions for this resubmission. Meta's recording guidance also requires 1080p or better and says to omit audio. These files are video-only and meet the verified technical and content requirements. Before upload, recheck each SHA-256 value so the reviewed file and the uploaded file are identical.

Required captions do not replace visible product evidence. The final watch must still confirm that each file is one continuous take containing authoritative asset identity, the recent fictional inbound message, the matching portal thread, proof text typed on camera, one visible `Send reply` action, `Reply sent.`, and the identical native receipt.

Do not upload the repository's v1 Messenger, Instagram, WhatsApp, or Business Manager videos as proof for these two permissions.

## Meta submission privacy gates

The following Meta-relevant checks must be closed before final submission:

- [x] Production merge `6f6c59330d94d84b1fc3bc63fb76d8830d3c8644` and migrations through `20260903183915` contain the external encrypted deletion registry, service-only recovery controls, and strict `provider_managed` semantics.
- [x] Initial production backfill and a controlled global replay completed with the database reconciliation linked and complete, two intents accounted for, zero replay failures, both circuits re-locked, and Meta provider dispositions still pending.
- [x] PR #219's fictional real-Postgres transactional logical-restore simulation passed immediate-relock, authorization, encrypted-intent, applied replay, idempotent replay, provider-pending, and no-provider-call assertions. This is not a managed backup/PITR or provider-expiry rehearsal.
- [ ] Deploy and pass the bounded current-registry audit, final fictional production end-to-end verification, and controlled production activation/open postflight recorded in `META_READINESS_CLOSEOUT_2026-09-04.md`.
- [ ] Obtain written privacy-counsel approval for the retained envelope, available joins, three-year per-event maximum, deletion-tombstone retention, and suppression-hash retention.
- [ ] Resolve the public-copy decisions in `PUBLIC_COPY_RECONCILIATION_MATRIX_2026-09-04.md` after counsel approval and verify the released pages signed out.

The tested CaseLoad Select redaction and recovery controls are materially implemented. Final submission remains blocked by the current-registry audit and activation/open postflight, privacy-counsel approval, public-copy reconciliation, live Meta draft checks, and Adriano's action-time approval. No evidence claims deletion from Meta's own systems.

### Separate follow-up, not a Meta submission gate

- Resolve the legacy HighLevel selector through the controlled workflow when separately authorized.
- Preserve the Resend, HighLevel, and Supabase account-evidence questions in `docs/privacy/PROVIDER_ACCOUNT_EVIDENCE_2026-09-02.md`.
- Do not send any provider support draft without separate provider-specific approval. Responses from Resend, HighLevel, and Supabase are not required for this Meta submission.

## Upload and paste checks

- [ ] The live permission list contains only the two supported messaging permissions.
- [ ] The exact Instagram permission label is copied from the live form into the reviewer instructions.
- [x] Both local v2 clips passed the content proof and technical checks in `screencasts/SHOTLIST_v2.md`, including required captions, video-only output, 1080p, and a full decode.
- [ ] Recheck both documented SHA-256 values immediately before upload.
- [ ] Each clip is uploaded to the matching permission slot and plays completely in Meta's preview.
- [ ] `Reviewer_Instructions_Paste_v2.md` is re-reviewed after all privacy gates close, then pasted without historical or unsupported claims.
- [ ] Public privacy, terms, and data-deletion URLs render successfully in a signed-out session.
- [ ] A final screenshot captures the permission list, attached clips, reviewer instructions, app identity, and draft submission identifier before submission.

## Final stop

Adriano must review the final draft and give action-time approval immediately before the final Meta submission control. Agents may prepare evidence but must not submit without that approval.
