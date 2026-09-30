# Desired Client Blueprint update: Luna execution package

> Historical plan: this package describes an earlier blueprint version. For the current six-section practice-direction amendment, use [AMENDMENT_PRACTICE_EXPERIENCE_2026-09-30.md](AMENDMENT_PRACTICE_EXPERIENCE_2026-09-30.md). That amendment supersedes conflicting report and discovery details for the current implementation only; this history remains unchanged below.

Prepared by Astra on 26 September 2026. Status: implementation plan, not an implemented or released change.

## Outcome

Turn the existing guided discovery into a useful one-page Desired Client Blueprint. The profile must explain who the firm wants to attract, what brings that person or organization to a lawyer, what they want to achieve, why the firm wants this work, and how marketing and future inquiry screening should use that understanding.

The accepted Option 2 report is the fixed destination. Its layout and information hierarchy are preserved: a synthesized portrait, context strip, Client need and Firm value, Marketing direction, four proposed Screen rows, and important unknowns. We are not reopening template selection or adding more research sections.

## Fixed product decisions

| Decision | Instruction |
|---|---|
| Discovery | Keep six sections and Review, in the existing order. |
| Required input | Increase from 11 to 13 answer groups: add a concrete trigger in Situation and up to three early fit signals in Delivery. A supported custom answer or Not sure counts as an answer. |
| Optional input | Add one optional decision-needs question in Client goal. Existing optional questions stay optional and visibly open. |
| Time | Design for a roughly ten-minute ordinary first draft. This is a target to test, not a measured completion claim. The optional comparison route takes longer. |
| Guidance | Explain each section, distinguish trigger from timing, and show an example relevant to the selected practice area. Do not preselect substantive answers. |
| Writing | No new required essay. Every new selection group supports a short custom answer. |
| Intelligence | AI synthesizes the portrait, client need, firm value and marketing direction. The application constructs the context strip and proposed Screen checks from explicit inputs. |
| Follow-ups | Keep the existing bank and at most two follow-up opportunities; a total of three AI attempts per review run includes retries. Do not add an open-ended chat. |
| Output | One readable Letter-size PDF, the same blueprint on screen, and a complete supporting Markdown download. Supporting answers and sources are outside the one-page PDF. |
| Review | Review the synthesized profile after generation. Confirming the wording does not activate Screen rules. |
| Screen | Derive a versioned, source-linked proposal in memory from saved answers/report metadata and include it in supporting Markdown. Do not persist a separate Screen record. No scoring weights, automatic acceptance, live configuration, database or lead mutations. |
| Infrastructure | Reuse the existing Next.js tool, Gemini route, storage, validation, state machine, CSS and installed PDF library. No new package, model, service or API endpoint. |
| Existing drafts | Migrate valid old answers without losing them or extending their expiry. Old generated reports require regeneration. |

## Read and execute in this order

1. [01_DISCOVERY_SPEC.md](01_DISCOVERY_SPEC.md): exact sections, question copy, choices, guidance, limits and branching.
2. [02_BLUEPRINT_CONTRACT.md](02_BLUEPRINT_CONTRACT.md): report payload, source rules, deterministic Screen translation, review, PDF and exports.
3. [03_ENGINEERING_AND_ACCEPTANCE.md](03_ENGINEERING_AND_ACCEPTANCE.md): exact implementation surfaces, migration, state transitions, tests and release boundaries.
4. [04_LUNA_EXECUTION_PROMPT.md](04_LUNA_EXECUTION_PROMPT.md): ready-to-use execution instruction and required completion report.

These files supersede conflicting instructions in the original 24 September Desired Client V2 build plan for this update only. In particular, do not create new clones/worktrees, reinstall the tool, restore the historical page, or use the original answer-list result as the target. Repository governance and unrelated behavior remain in force.

## Verified starting point

- Worktree: `D:/00_Work/01_CaseLoad_Select/05_Product/caseload-select-app-worktrees/desired-client-v2`.
- Branch: `codex/desired-client-v2-app`.
- Audited clean HEAD: `ce209f3456ffe3b531401c764af63612510b497a`. Recheck before changing files; do not reset later work to this SHA.
- Existing draft PR: [#317](https://github.com/adrianosortudo-source/caseload-select/pull/317). Reuse if still open and representing this branch. See execution instructions if state has changed.
- Accepted visual reference: `D:/00_Work/01_CaseLoad_Select/09_Internal/Prototypes/Desired_Client_Report_Options_2026-09-26/output/pdf/02_Desired_Client_Blueprint.pdf`.
- Source recommendation: `D:/00_Work/01_CaseLoad_Select/09_Internal/Prototypes/Desired_Client_Report_Options_2026-09-26/RECOMMENDATION.md`.
- The prototype's severance fees, hours and capacity are fictional. None may become defaults or report facts.

## Why this scope

The $100 bill idea requires a specific client/matter the particular firm wants more of, with reasons grounded in the firm's work and preferences. It does not establish that a larger fee is always better, or that this tool has proved one segment is the most profitable. The existing discovery already captures most of the necessary firm-side information. The missing event prompting contact, decision needs and early observable signals help connect that information into a marketing profile and useful intake questions.

Use the approved research as rationale, not as additional instructions. Fihn's specificity and commercial desirability, Fontenele's preferred-client discussion, the law-marketing intake material, and the firm's pain bank informed this scope. The buyer pain bank describes law-firm buyers of CaseLoad Select; do not insert those pains as if they were the law firm's own clients' motives.

## Definition of done

A lawyer can complete an ordinary preset path with 13 short required answer groups, understand why each section matters, obtain a coherent and grounded profile, correct it through the relevant answers, and download a readable one-page document. The report distinguishes preferences and hypotheses from reported experience and unresolved information. It contains useful proposed inquiry checks without changing a live Screen. Old drafts, custom answers, unknowns, keyboard use and the embedded tool continue to work. Tests and rendered evidence substantiate these claims before a release is proposed.

Planning alone does not authorize merging PR #317 or changing production. Implementation authorization, when given, covers building and testing this package; the repository's explicit approval for the specific PR merge remains required.
