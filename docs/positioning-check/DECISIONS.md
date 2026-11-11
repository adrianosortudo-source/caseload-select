# Current configuration and decisions
Updated2026-11-08. This file supersedes earlier configuration entries in DECISION_HISTORY.md and the initial production plan.

| Setting | Active value |
|---|---|
| Runtime/model/prompt | Node24.x; gemini-3.8-flash; positioning-v6.1; thinking LOW; temperature0.2 |
| Pilot budget |8 analyses/day; conservative estimatedUSD1.25 reservation/run; USD10/day model ceiling, not a provider-enforced billing guarantee |
| Calls/deadline |At most2 generations;105s total;40s collection envelope;45s first model call; retry only within remaining time |
| Input/output |256KiB nonimage serialized request;8192 output tokens; up to8 pages,8000 retained chars/page,48000 total; two navigation hops |
| Visual input |At most2 PNGs,4MiB each; isolated existing renderer; capture clipping/analysis state exposed honestly |
| Abuse control |3 submissions/hour/network; one active analysis/network; distributed limiter fails closed |
| Storage/side effects |Browser-memory report only; no report history, account, email, CRM write, database or migration; user-initiated clipboard only |

Routes: `/tools/positioning-check` and `POST /api/tools/positioning-check`. Renderer follows the entered public HTTPS URL, including its path; origin URLs naturally capture the homepage. Evidence retains the actual resolved capture URL. The report therefore says website/page images, not universally homepage images.

Collector status, coverage, metadata and evidence remain authoritative. The model owns only part1/part2; explicit projection prevents model extras overriding collector fields. Fallback replaces stale primary evidence and records actual source URL, retained characters and truncation. Exact source quotations remain unchanged; only authored punctuation is normalized.

Canonical brand assets/palette/type remain local to the new tool. Reused logo hash matches the canonical asset. Natural wrapping is checked before any bounded repair. Fixed positive font candidates and tiny negative tracking are retained only if actual orphan/line-flow checks pass. No source/fixture rewrite, manual breaks, NBSP, narrow copy track or fitting framework was added.

## Preview operations
Preview-only feature flag/key/limiter settings are branch-scoped. The renderer URL points to the existing stable service. Production settings were not changed. Disabling POSITIONING_CHECK_ENABLED stops new analyses. If abandoning, remove feature-only Preview overrides and restore the prior Upstash Preview branch scope to codex/desired-client-focused-improvement-20261005; do not alter production or expose secret values.

Production is not authorized. PR472 remains draft/open. Merge requires Adriano's approval for that specific PR and all required checks. No direct production deploy/promote/rollback commands.
