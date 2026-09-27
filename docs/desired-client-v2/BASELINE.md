# Desired Client V2 app baseline

Preflight date: 2026-09-24

## Shared source and isolated worktree

- Repository: `https://github.com/adrianosortudo-source/caseload-select.git`
- Expected origin verified in the canonical checkout: `https://github.com/adrianosortudo-source/caseload-select.git`.
- Fresh GitHub `main` lookup, independently verified by Astra and released for this preflight: `18b51a62ff79d19d0a5706deebfcd7087cfa288d`.
- Freshness substitution: `git fetch origin` and direct `git ls-remote` stalled silently on this host. Astra verified that live GitHub `main` matched the cached `origin/main` SHA above. Local `git cat-file -t 18b51a62ff79d19d0a5706deebfcd7087cfa288d` returned `commit`.
- New worktree: `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app-worktrees/desired-client-v2`.
- Branch: `codex/desired-client-v2-app`.
- Worktree HEAD: `18b51a62ff79d19d0a5706deebfcd7087cfa288d`, equal to the verified remote SHA.
- Initial worktree status: clean; `git status --short --branch` returned only `## codex/desired-client-v2-app`.
- Canonical checkout HEAD observed: `74d48e051b9ef27c44c194e20c17f42fef4db17b`. Canonical status is unavailable: the read-only no-optional-lock status call stalled and was stopped after Astra approved proceeding without it. No canonical files or refs were changed.
- Before creation, the specified destination was absent, no local or remote-tracking branch ref with the requested name was present, and `.git/worktrees/desired-client-v2` was absent. The worktree was created from the verified SHA, not from a potentially stale branch name.

## Required shared interfaces on fresh main

- Next.js `^16.2.3`; React `^19.2.5`.
- Existing `@google/generative-ai` `^0.24.1`, `@fontsource-variable/dm-sans` `5.3.0`, and `@upstash/redis` `^1.38.0`.
- `public/fonts/Manrope-VF.ttf`, `src/lib/rate-limit.ts`, `src/app/tools/firm-voice-builder/page.tsx`, `src/lib/firm-voice-builder/gemini.ts`, and `next.config.ts` are present.
- Existing public-tools embed header pattern and catch-all exclusion are present. Fresh `next.config.ts` retains strict headers outside the named embedded tool routes.
- The fresh limiter uses `ALWAYS_FAIL_CLOSED_BUCKETS`; Astra amended engineering §16 to place the three new Desired Client buckets in that set and scope required log redaction to those buckets. Follow the amended copy in `spec/03_ENGINEERING_AND_RELEASE.md`.

## Vercel association

- Canonical `.vercel/project.json` identifies Vercel project `caseload-select` (`prj_nsulX2POrn1tSwTze8KwrvRsIecn`) under team `team_qS5LzYPKszR4AeCUSHXi9yW3`.
- Read-only Vercel project lookup returned the same project ID and lists `app.caseloadselect.ca` among its domains. No credential values were read or displayed.

## Applicable repository instructions and release boundary

- Fresh `AGENTS.md`: production changes ship through PR merge only; never use direct production deploy/promote/rollback commands; merge only after all required CI passes and Adriano explicitly approves that specific PR. Use a fresh D: worktree. UI copy must wrap within the full component width and avoid single-word final lines.
- Fresh `CLAUDE.md`: preserve server-only handling for sensitive data and do not widen database access. This tool adds no database or persistence service.
- Workspace `AGENTS.md` also requires token-file Vercel authentication with the matching scope and forbids exposing token values. No production configuration, database mutation, merge, or deployment is part of this implementation authorization.
- All six authoritative plan files are copied verbatim to `docs/desired-client-v2/spec/` for reviewer traceability.
