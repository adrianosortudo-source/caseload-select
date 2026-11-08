# Execution status
Updated2026-11-08. Private user-test preview is usable; production release remains unapproved.

Accepted units:18/28: phases0/1 (8),2.1–2.4 (4),3.1–3.4 (4),4.1 internal agent review and4.3 rendered/regression review (2). Human-reviewed production accuracy is NOT performed. No public accuracy claim.

Runtime under review:2b0bc08c92fedd6f36db77ccd3b70880429bf2c2. UI11/11 PASS in run42509859394; root independently accepted375/320 retained typography. Hosted backend a49bae499 produced Gene/MHC200 reports and uses the same3.8/v6.1 analysis logic;2b0 changes wrapping and image-scope wording only.

Draft PR:https://github.com/adrianosortudo-source/caseload-select/pull/472
Private branch preview:https://caseload-select-git-codex-8126ad-adrianosortudo-7282s-projects.vercel.app/tools/positioning-check
Worktree:D:\00_Work\01_CaseLoad_Select\.worktrees\positioning-check-20261108

Current configuration:DECISIONS.md. Evidence/limitations:CLOSEOUT.md and ACCEPTANCE.md. Historical decisions are explicitly superseded in DECISION_HISTORY.md.

Required CI: a49 all checks passed, including real-Postgres job128814595920 at18:24:32UTC. Runtime2b0 UI/backend job passes; its new real-Postgres run is in progress. A following docs-only head may have queued checks/builds; do not describe all required current-head checks as passed. Private testing proceeds against the verified runtime preview. No merge or production approval question is requested now.

Remaining work belongs to production approval/human validation, final current-head required-CI completion, and any owner feedback after private testing. No further code or UI tuning is planned in this session.
