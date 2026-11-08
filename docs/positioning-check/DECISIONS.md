# Decisions
- Routes: /tools/positioning-check and POST /api/tools/positioning-check. Standalone /tools tree avoids frozen marketing/shared UI.
- Contract: src/lib/positioning-check/types.ts. Screenshot capture state and analyzed flag remain independent. Error includes feature_disabled. Schema changes require coordinator review.
- No dependencies, database or retention added. Existing compatible dependency installation reused through local untracked junction; no shared writes.
- Model and operational caps: backend constants and coordinator readiness record are authority; Gate 0 remains pending until verified. No public launch with unverified costs.
- Brand: approved prototype composition, canonical palette/type/assets, square geometry. Utility H1 has no terminal square. No global brand changes.
- Preview configuration by coordinator: branch-scoped Google key, enabled switch and existing Upstash settings; global Preview renderer settings. Production unchanged. If abandoning, restore Upstash Preview gitBranch to codex/desired-client-focused-improvement-20261005. No secret values recorded.

## Gate 0 resource freeze (coordinator, 2026-11-08)
- gemini-2.5-flash, at most two calls, 8192 output tokens/call, thinking budget zero.
- Conservative Gemini reservation USD 0.25/run, 40 feature reservations/day = USD 10/day model ceiling. Three submissions/hour/network and one active analysis/network. Existing renderer hosting charges are separate; at most 40 render requests/day.
- Nonimage serialized request cap 256 KiB. Up to eight pages, 48,000 retained characters; max 8000/page. Two PNGs maximum, 4 MiB each; desktop max1440x7800 and mobile max390x7800 (backend common maximum dimension1440x7800).
- Total app deadline105s; collection envelope40s; first model call45s; second call only within remaining time. No infrastructure or provider expansion.
- This replaces the provisional100/day atUSD0.10 before Gate0 acceptance. Live preview verification is still required.

## Preview renderer correction
The first new-route Gene Colman request returned422 before report generation; distributed quota access succeeded. The inherited Preview renderer URL pointed to an obsolete deployment. Coordinator added a branch-specific override to existing stable caseload-render.vercel.app; inherited token unchanged pending live verification. Production/global settings and other branches were untouched. This is a configuration correction, not a functional pass. If abandoning, remove the branch-specific override along with other feature-only Preview settings.

## Analysis v3 decision (not semantic acceptance)
After v1/v2 semantic failures, coordinator approved the same Gemini2.5Flash model/provider with thinking budget1024 and temperature0.2. Output maximum8192 and maximum two calls remain unchanged, as do USD0.25/run reservation and40/day ceiling; reservation covers the reasoning allowance. Terra owns implementation and actual usage checks. No semantic gate has passed. Version/source freeze must be recorded before bounded v3 runs.

## v4 checkpoint provenance and limits
Prompt version positioning-v4. Current gemini.ts source SHA256:857ca51f66c5508d5e2a09de7a02db22b3847762f8d385e7f11ded2fb3b0cc37 (includes approved punctuation postprocessing; original model request/body/candidate artifacts retained outside Git). Repair carries the prior candidate and field-specific feedback as untrusted draft material. Maximum two calls, same model/provider/budget remain. Authored punctuation is normalized; exact source quotations and collected evidence remain unchanged.
Coordinator source-based re-adjudication accepts MHC v4 as supported in its full hypothesis context:41/41 internal prose fields acceptable,8/8 clarity within one point, references resolve, coverage correct. The effective wording is a minor limitation, not a blocker. Gene normalized content is acceptable offline, but an actual live endpoint run remains required. These are agent/coordinator development judgments, not human-reviewed accuracy or a completed release gate. Historical initial flags remain in the evaluation record.

