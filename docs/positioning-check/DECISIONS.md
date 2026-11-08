# Decisions
- Routes: /tools/positioning-check and POST /api/tools/positioning-check. Standalone /tools tree avoids frozen marketing/shared UI.
- Contract: src/lib/positioning-check/types.ts. Screenshot capture state and analyzed flag remain independent. Error includes feature_disabled. Schema changes require coordinator review.
- No dependencies, database or retention added. Existing compatible dependency installation reused through local untracked junction; no shared writes.
- Model and operational caps: backend constants and coordinator readiness record are authority; Gate 0 remains pending until verified. No public launch with unverified costs.
- Brand: approved prototype composition, canonical palette/type/assets, square geometry. Utility H1 has no terminal square. No global brand changes.
- Preview configuration by coordinator: branch-scoped Google key, enabled switch and existing Upstash settings; global Preview renderer settings. Production unchanged. If abandoning, restore Upstash Preview gitBranch to codex/desired-client-focused-improvement-20261005. No secret values recorded.
