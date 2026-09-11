# Meta App Review final materials verification — 2026-09-03

**Status:** Preparation and verification checklist only. No Meta draft was opened, edited, uploaded, or submitted.

## Permission set

Retain and re-request exactly:

1. `pages_messaging`
2. the exact live Instagram messaging permission label, expected from the source package to be `instagram_manage_messages`

The Instagram label is **not confirmed until Adriano reads it from the live Meta form**. If Meta shows an equivalent or different label, record the exact text and update only the reviewer instruction's label.

Do not add `pages_show_list`, `pages_manage_metadata`, `business_management`, `instagram_basic`, `pages_read_engagement`, `public_profile`, or the already-approved WhatsApp permissions.

## Runtime evidence to preserve

Use only `docs/app-review/PERMISSION_CODE_PATH_EVIDENCE_v2.md` for code-path claims. The supported runtime operations are:

| Permission | Source path | Evidence claim |
|---|---|---|
| `pages_messaging` | `src/lib/messenger-send.ts`; portal reply route | Server sends operator-authored plain text through the Messenger Send API using a server-side Page token |
| Exact live Instagram label | `src/lib/instagram-send.ts`; portal reply route | Server sends operator-authored plain text through the Instagram Messaging API using the linked Page token |

Do not claim that the portal reads the Page display name or Instagram handle. The recordings must show those identities in authoritative Meta or Instagram UI.

## Videos — only the v2 pair

Use only these files, after immediate pre-upload hash verification:

| Permission | File | Documented SHA-256 | Required check |
|---|---|---|---|
| `pages_messaging` | `D:\caseload-select-messenger-resubmission-v2.mp4` | `C729EE8BBB5729EAF5A740B0505106D440A71E10F457AFAC38C37F0D8ACC6DBC` | Recompute hash; upload to Messenger slot; watch complete Meta preview |
| Exact live Instagram label | `D:\caseload-select-instagram-resubmission-v2.mp4` | `FFB75B3AA059349511DA09EB8927E8CD8F57295C4AA5AF24DD7B62AC5182780D` | Recompute hash; upload to Instagram slot; watch complete Meta preview |

Both files are documented as H.264, video-only, 1920×1080, 30 fps, under three minutes, under 100 MB, fully decoded, captioned, and continuous. Hashes, attachment-slot mapping, and Meta playback remain immediate pre-upload checks.

Do not use the v1 Messenger/Instagram clips, WhatsApp clip, or Business Manager configuration clip.

## Reviewer instructions

Use only `docs/app-review/Reviewer_Instructions_Paste_v2.md` after all privacy gates close. Preserve its current permission names and architecture disclosures. Change only the Instagram permission label if the live form requires it.

The instructions must continue to disclose:

- server-to-server architecture and no Facebook Login;
- authorized test assets `DRG Law Test` and `@drg_law_test`;
- fictional test data and non-segregated DRG workspace context;
- one continuous take per channel from authoritative identity to native receipt;
- the 24-hour reply-window and delivery safeguards;
- the deployed redaction boundary without claiming deletion from Meta;
- the backup/registry, counsel, and public-copy gates;
- provider support, Resend, HighLevel, and Supabase follow-up as non-gating for this submission.

## Adriano-only live actions and stop conditions

Adriano must perform or explicitly authorize the live Meta actions:

1. inventory the existing draft;
2. remove unsupported and already-approved scopes row-by-row;
3. save and reload the permission list;
4. confirm the exact Instagram label;
5. upload the two matching hash-verified v2 clips;
6. watch both previews completely;
7. paste and save the final reviewer instructions;
8. capture the complete draft screenshot before submission.

Stop and return evidence if Meta shows an unclear dependency, a changed permission label, a mismatched app/business identity, missing attachment, failed playback, or any real/unrelated data.

## Final evidence record

Before any submission action, record:

- app ID `1007304805285554` and business ID `2191422434947205`;
- final permission list;
- exact Instagram label;
- both recomputed hashes;
- attachment-to-permission mapping and full-preview result;
- reviewer instructions as pasted;
- signed-out rendered privacy, terms, and data-deletion URLs;
- final draft screenshot and draft/submission identifier.

This checklist cannot authorize submission. Adriano must review the complete draft and give separate action-time approval immediately before clicking **Submit for review**.
