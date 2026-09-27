# Desired Client Tool V2: build specification
Date: 24 September 2026
Status: Astra-authored build specification for review. No implementation or release performed.
Owner: Adriano. Product, content and architecture decisions: Astra. Implementation: Luna.

## Start here
Build an assistant that helps a lawyer choose and explain one pattern of work the firm wants more of. The lawyer should recognise relevant choices, inspect what the tool understood, and leave with a useful working brief. Do not require the lawyer to arrive with a finished marketing strategy.

This package fixes the design decisions. It is not permission to merge, publish or change production configuration.

Read in this order:
1. [01_BUILD_PLAN.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/01_BUILD_PLAN.md>) (this file)
2. [02_PRODUCT_CONTENT_AND_AI_SPEC_FINAL.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/02_PRODUCT_CONTENT_AND_AI_SPEC_FINAL.md>) (exact flow, questions, options, state, interpretation and copy)
3. [03_ENGINEERING_AND_RELEASE.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/03_ENGINEERING_AND_RELEASE.md>) (repositories, routes, files, request boundary, implementation sequence)
4. [04_ACCEPTANCE_AND_REVIEW.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/04_ACCEPTANCE_AND_REVIEW.md>) (fixtures, rendered checks, release gates)
5. [05_EVIDENCE_AND_DECISIONS.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/05_EVIDENCE_AND_DECISIONS.md>) (research and why these choices were made)
6. [06_LUNA_EXECUTION_PROMPT.md](<D:/00_Work/01_CaseLoad_Select/09_Internal/Desired_Client_Tool_V2_Plan_2026-09-24/06_LUNA_EXECUTION_PROMPT.md>) (ready-to-use implementation instruction)

Only the six files linked here form the specification. The numbered files are one specification. The technical API/security/release details in 03 take precedence over incidental engineering notes in 02. Exact product choices and question wording in 02 take precedence over summaries elsewhere. A direct contradiction between them is a STOP condition, not permission for Luna to choose.

## The product to build
Public name: **Desired Client**.
Page title: **Find the clients and matters you want more of**.
Result name: **Your Desired Client Brief**.
Primary audience: a lawyer or small law-firm owner who understands legal work but may have little marketing experience.
Unit of analysis: one combination of work, client situation, client goal and conditions that make delivery worthwhile.
Output status: a working marketing direction for the lawyer to review.

The experience has three movements:
- **Recognise:** choose a practice area, a concrete kind of work, a client situation and desired outcome.
- **Decide:** consider value relative to effort, delivery conditions, present capacity, evidence and future direction. An undecided user can compare two kinds of work before choosing one.
- **Refine:** review the tool's interpretation, answer up to two targeted clarification questions, and export a brief with clear unknowns and practical next actions.

Every required answer has useful choices and an uncertainty option. No required essay fields. Small optional text fields let the lawyer correct a choice rather than carry the entire reasoning burden.

## Locked product decisions
| Decision | Specification |
|---|---|
| Guided interface | A sequence of question pages with Back, Next and a visible stage label. No unrestricted chat window. |
| Scope | One work pattern per brief. Optional comparison of exactly two work patterns, followed by the user's choice. |
| AI role | Read the answers together, identify a material tension, request bounded clarification, and draft a faithful interpretation. |
| AI boundary | Cannot manufacture evidence, determine profit from fee alone, rate people, decide legal merits, or accept/reject clients. |
| Progress feedback | Deterministic draft summary during the questionnaire; no hidden AI calls. |
| Review calls | Explicit Generate action; initial analysis plus at most two clarification analyses in one review run. |
| Uncertainty | Valid answer throughout. Visible in the brief. Never replaced with a confident invention. |
| No-AI mode | Complete guided flow, deterministic brief, copy/download/print all work. |
| Storage | Browser-local draft with seven-day expiry from the last edit; no answer database. Explain this before starting. |
| Identification | No account, email gate, firm name, client names, file upload or CRM connection. |
| Public location | Keep `https://caseloadselect.ca/tools/desired-client-matter.html`. |
| Runtime | Existing Next.js portal hosts the application; the static marketing page embeds it. |
| AI provider | Existing server-side Google Gemini infrastructure. No new provider, agent platform or API key in the browser. |
| Infrastructure | Existing Vercel projects, app SDK, rate limiter and shared design tokens. No Supabase migration or new runtime dependency. |
| Export | Copy brief; UTF-8 Markdown download; browser print/save as PDF. No PDF generation service. |
| Analytics | No new analytics endpoint or session recording in this release. Assess usability with consented human testing. |
| Release | Two small PRs, app first and website wrapper second. Explicit approval is required to merge each PR. |

## What makes this better than the recovered versions
The live four-field page primarily rearranges user text. The older worksheet asks more questions and has limited AI probes, but its result still mostly assembles answers and its content model restricts recommendations. The later Work Value Map adds useful comparison, but remains browser-only.

V2 preserves what is useful from each: a concise final definition, recognition-based guidance, optional comparison, and a lawyer-controlled result. It adds interpretation across answers, explicit evidence and uncertainty, a complete failure path, and a deployable implementation on the existing app.

A high-value client is not simply a wealthy person or the largest file. In this tool it means a desirable pattern of work that serves a meaningful client need, supports the firm's effort, suits delivery capabilities, and advances the practice the firm intends to build.

## What the brief must enable
The lawyer should be able to:
1. Explain the work and situation the firm wants to become known for.
2. Describe what that client is trying to achieve and what makes seeking help difficult.
3. Explain why this work is desirable, and distinguish experience from preference.
4. Recognise current delivery limits and future ambitions.
5. Identify a practical marketing topic, an enquiry question and an assumption to validate.
6. Name work to promote less, if relevant, without an automatic instruction to abandon existing revenue.

The article's five questions remain the strategic coverage: work, money relative to effort, capacity, reputation and less-promoted work. Client circumstances and client goals are an additional layer. These are design inputs, not five large writing assignments.

## Delivery order and completion criteria
| Milestone | Deliverable | Gate |
|---|---|---|
| 0. Confirm source | Fresh remote references, isolated app/site worktrees, recorded baseline and existing helper paths | Stop on missing shared implementation or mismatched deployment roots |
| 1. Guided core | Entire flow, content catalogue, state reducer, deterministic preview and brief, resume and export | Complete all required answers without writing prose |
| 2. Interpretation | Strict server contract, bounded clarification, validated AI result and fallback | All AI/provenance/failure fixtures pass |
| 3. Integration | App route, embed behaviour, stable public wrapper and privacy copy | Direct and embedded paths pass desktop/mobile and keyboard checks |
| 4. Review package | PRs, previews, screenshots, tests, completed acceptance table, known issues | Astra review of product fidelity; no unattended merge |
| 5. Human validation | Five lawyers unfamiliar with the tool use it independently | Target: at least four complete and explain their brief without coaching |
| 6. Release | Approved app PR, verified deployed app, approved site PR, verified public flow | Explicit approval for each merge; GitHub/Vercel normal deployment only |

Treat the five-user result as formative usability evidence, not a statistical claim or a promised completion rate. Do not advertise a completion-time estimate until measured.

## Decision authority
Luna may implement types, functions, imports, semantic HTML and test plumbing to satisfy this specification. Luna may repair a demonstrated defect where the required behaviour is already explicit.

Luna must ask Astra to amend the specification before changing: the question set; choice wording; required answers; flow; output meaning; uncertainty handling; recommendation rules; model/provider; rate limits; persistence; analytics; routes; hosting pattern; visual direction; dependencies; or release sequence.

Adriano retains approval for production merges. Astra's design approval does not substitute for that approval.

## Explicitly deferred
Multiple saved profiles; portfolio planning across many matter types; automatic website scraping; CRM imports; real-client record analysis; voice input; document uploads; public share links; authentication; lead capture; email delivery; automatic campaign creation; legal eligibility checks; financial predictions; tool-triggered client rejection.

Do not add these as helpful extras.

## Known technical uncertainty
The inspected repositories contain stale, diverged and dirty checkouts. Existing source files demonstrate reuse opportunities; they do not establish the state of every deployed environment. Milestone 0 resolves this through fresh shared refs and deployment configuration. If the relevant implementation is absent from shared main, report the exact path and commit mismatch to Astra instead of copying local-only code.

No production secrets, deployment changes or database changes were required to prepare this plan.
