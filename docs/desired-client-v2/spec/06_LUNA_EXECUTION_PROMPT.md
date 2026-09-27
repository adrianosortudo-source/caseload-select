# Luna execution prompt
Use this only when Adriano asks to start implementation. Preparing this plan did not start implementation.

---

Implement Desired Client V2 using the specification at:

D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/

Read the six authoritative files linked in01_BUILD_PLAN.md before editing. Use 02_PRODUCT_CONTENT_AND_AI_SPEC_FINAL.md for the product and AI contract. Astra owns product, content, UX, interpretation, architecture and acceptance decisions. You are the implementer. Follow the fixed choices; do not improve, simplify, substitute or expand them on your own.

The required outcome is a complete, reviewable implementation in two isolated D: git worktrees, with pushed branches, draft PRs, tests, rendered proof and an honest verification report. Do not merge or deploy. Do not change production environment variables. Adriano approves each specific production merge.

Start with milestone0 in03. Use freshly fetched origin/main, not the dirty canonical checkout or the unfinished Why Your Firm worktree. Never clean someone else's work. Never clone the portal elsewhere. Record exact baseline refs and applicable instructions.

Build the complete no-AI experience first. Then implement the bounded AI analysis, revision protection, fail-closed limits, public embedding and export. Use the exact question catalogue, clarification bank, schemas, labels and deterministic fallbacks in02. The technical transport/security/release specification in03 governs its incidental technical notes.

Use existing Next.js/React, @google/generative-ai, Upstash, local fonts and Vercel projects. Do not add a database, account system, dependency, analytics collector, PDF service, email gate or model provider. Preserve the public URL /tools/desired-client-matter.html and the approved ACTS website.

Required work:
1. Record baseline and create the two specified worktrees/branches.
2. Translate the exact catalogue and schemas into typed data with invariant checks.
3. Implement all seven guided stages and the optional three-screen comparison branch.
4. Implement local expiry/resume, deterministic preview/result, review and exports.
5. Implement strict stateless AI request/response validation and fixed clarification selection.
6. Implement one-call attempts, at most three attempts per review run, no-AI fallback and stale-response rejection.
7. Implement the secure iframe protocol/CSP and static wrapper/card/privacy updates.
8. Run04's fixture, automated, rendered and accessibility checks.
9. Push all commits, open draft PRs, attach the PR URLs to the current task and prepare the review packet.
10. Stop at the review/merge gate with exact remaining items and their locations.

You may choose local variable names and internal implementation details that do not change externally specified behaviour. You may fix syntax, types, imports, local accessibility defects and tests to meet the explicit acceptance criteria.

STOP the affected work and return a concise Astra decision request if:
- The shared baseline or infrastructure differs materially.
- A question, enum, copy string, interaction, output rule, failure path or test expectation is missing or contradictory.
- You would need to change architecture, provider, limits, dependencies, data handling, method or scope.
- The output is semantically wrong but you cannot repair it without changing the specified rules.
- Required checks fail for reasons outside this feature.
- You need production configuration or merge authorization.

Decision request format:
- Evidence: exact file/line, commit, screenshot or failing test.
- Conflict: the two requirements or missing fact.
- Impact: what cannot safely proceed.
- Work completed: branch, commit, pushed status and review artifact.
- Requested decision: one specific question for Astra.

Continue independent specified work while that question is pending. Do not silently choose an alternative.

Use mock provider responses for automated tests and synthetic preferences for any authorized live smoke test. Never enter real client details. Never display secret values. Do not send emails or messages to recruit test users.

The final implementation report must distinguish preview-ready, release-ready and released. A working local build is not a production release. Include both PR links, actual checks, screenshots, known limitations, live configuration status by setting name only, and worktree/commit/push status.

---
