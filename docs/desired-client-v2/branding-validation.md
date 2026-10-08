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

## Exact-head CI and correction checkpoint

- Initial draft head af580f25095e45a67b88402974f5aecb66782999 passed the full unit suite (626 files passed, 20 skipped), lint, self-contained assets, render-service checks, Secure Import and operator-login rendered gates, engine sync/language parity and the real Postgres concurrency suite.
- That head failed Desired Client rendered wrapping and two embed-test TypeScript errors. Scoped fixes preserve every functional assertion: correct the evaluate argument and per-test app origin, measure actual hyphenated word fragments, restore natural wrapping, widen narrow-screen choice tracks and use the official logo intrinsic ratios.
- Exact locked Next 16.2.9 was successfully restored from the integrity-verified offline cache. TypeScript subsequently passed locally before these final bounded corrections. No dependency versions, lockfiles or configuration changed.
- Fresh local browser validation encountered a cold Next route compilation timeout under low available memory. That interrupted run is not a pass. The independent seven-width audit also timed out at initial navigation before collecting fresh evidence. The stalled local server was stopped. This delay is not a permanent filesystem failure: subsequent Git reads completed. Full verification will use exact-head remote CI and the deployed preview.
- External local QA uses the standard localhost:3301 origin so the real offline HTTP fixture keeps its existing origin guard. No production route or access control was changed.
- Targeted syntax check: all five changed TypeScript files parsed with zero syntax errors; this does not replace project typecheck.
- Draft PR 395 remains unmerged. Final exact-head CI, fresh screenshots, complete browser flows and deployed preview verification are still pending.

Local evidence is retained at C:/Users/adria/Documents/Codex/2026-10-08/task-7/visual-evidence. The dependency repair log is next-package-repair.log. No broad rebaseline, heading exemption, manual line break or copy-width cap was introduced.
