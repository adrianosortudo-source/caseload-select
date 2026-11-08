Adds an isolated public website positioning review at `/tools/positioning-check`, backed by bounded same-site evidence collection and structured Gemini analysis. Visitors can inspect eight qualitative assessments and sources, consider optional directions, retain the current direction, and copy a discussion brief. No account, CRM writes, report history, or production release.

Draft integration checkpoint. Acceptance remains incomplete: real feature preview service smoke, full factual/semantic corpus, security/failure matrix, required responsive copy/contrast review, and CI must pass before this becomes test-ready. Current focused backend tests: 8/8; warmed local fixture interaction smoke passed. Full TypeScript recheck and responsive correction confirmation are pending.

Scope, ownership, gates and deviations: `docs/positioning-check/`. The feature is controlled by `POSITIONING_CHECK_ENABLED`; disabling it stops new analyses. Preview service configuration is scoped to this branch; production settings are unchanged. No migration or new dependency.

Do not merge without Adriano's explicit approval for this PR and passing required checks. Production deploys only through approved merge.
