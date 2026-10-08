# Desired Client visual update: validation checkpoint

The implementation adapts the SHA256-verified local approved prototype, then applies the user's bounded website-family refinement: a continuous Ink header and hero, compact official logo header, Parchment primary action, integrated six-topic preview, light definition section and Ink closing/footer. The exact approved Desired Client definition and existing real Start/Continue behavior are preserved.

The presentation is scoped to Desired Client. Questions, answers, validation, source coverage, authenticity, economics, AI/provider behavior, request budgets, saved-report semantics, Admin, database and configuration remain unchanged. Exports embed the canonical local fonts, official logo and font licenses for offline use.

## Verified evidence

- Verified base: origin/main 33138b64f1190cde61e477a8117f3835b1dc3dbc (merged PR384).
- Exact prototype SHA256: 6628073ABD2C3D56E75A0DCCF8148050D114A5596F57935DA3574CA220235143. Its actual HTML and 1440/390 pixels were inspected.
- Canonical V2.0.2 font files match the approved prototype's embedded fonts byte for byte.
- Scoped Vitest: 22 files, 318 tests passed. Includes export, evidence/provenance, validation, economics, mixed-payment recovery, provider contract, saved-report storage and component tests. This run preceded the final website-family CSS refinement.
- Scoped lint: zero errors, nine existing warnings. This run preceded the final CSS refinement and embed-test adaptation.
- Self-contained asset contract: passed.
- Baseline screenshots: landing, questionnaire, review and report at 1440, 1024, 768, 640, 390, 375 and 320 pixels, retained in the local task evidence directory.
- Initial after audit: all seven widths, six preview topics, all six questionnaire stages, review and report. No page-level horizontal overflow was reported. Wrapping/content-track defects were reported and received subsequent presentation repairs.

## Incomplete checks: no pass claimed

- Local TypeScript failed because the incomplete Next.js package lacks declaration files. Error examples: TS7016 for next/server and next/dist/lib/metadata/types/metadata-interface.js. A bounded restoration of the exact locked Next 16.2.9 tarball is in progress from integrity-verified local cache. Registry metadata lookup failed ENOTCACHED; no version or configuration change was made.
- The first direct browser run was interrupted after wrapping failures and a local test-output module-resolution issue. The latter was corrected in the external QA harness by writing generated offline route bundles beneath the worktree.
- The first embedded run failed because a temporary Windows fixture root was not normalized before the existing path guard. The external fixture was corrected; the retry was interrupted when the isolated server disconnected.
- The latest website-family refinement needs fresh rendered screenshots and complete browser flow verification, including keyboard/focus, dialog, generation loading/failure, saved report reopen, copy, offline HTML and print. Existing deterministic mocks avoid paid AI calls.
- CI and preview must validate the exact branch head before visual signoff. This draft must not be merged or promoted to production without separate approval.

Local evidence is retained at C:/Users/adria/Documents/Codex/2026-10-08/task-7/visual-evidence. The exact dependency repair log is C:/Users/adria/Documents/Codex/2026-10-08/task-7/next-package-repair.log. No broad rebaseline or exemption for headings was introduced. The copy measurement helper now recognizes intrinsic evidence badges and checks actual report content tracks; it does not demand a change that would turn a two-word final line into the orphan it forbids.
