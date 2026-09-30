# Desired Client and Matter: interview and Blueprint update

Status: proposed execution specification. This document does not implement changes or authorize a merge. It supersedes earlier discovery/report requirements only when this update is executed. Preserve earlier plans as history.

## Product goal

Help a law firm define one specific client-and-matter combination it would gladly serve again, the client's needs and choice of lawyer, and the firm's reasons and ability to deliver that work. Firm context supports this definition. CaseLoad Select buyer qualification, delivery economics, operating procedures, campaign plans, intake scripts and live Screen configuration are outside this tool.

One completed interview produces one profile. Retain the existing optional two-candidate comparison. Another profile is a separate exercise; do not build a profile-management dashboard.

## Execution sequence

1. Reconcile the existing D: worktree changes, local commits and remote branch. Read repository instructions. Preserve previous uncommitted work and prototypes; do not reset or create a clone.
2. Update the HTML example with a complete fictional input fixture and a traceability table before changing the app. Keep the chosen framework styling, branding, numbered sections without leading zeroes, and distinct client decision pathway. Every example statement must trace to fixture information or an explicit labelled interpretation.
3. Update answer and report contracts, migrations and source references together.
4. Implement the six-stage guided questions and bounded clarification behaviour.
5. Connect AI synthesis, deterministic fallback, review, rendering and exports to the same report contract.
6. Update meaningful existing tests for the new contracts, run relevant checks, and inspect the full flow in a browser.
7. Commit and push completed work; create or update the PR, attach it to this chat and review its preview. Merge only after Adriano explicitly approves that specific PR, as required by repository AGENTS.md.

## Interview structure

Brief firm setup is optional contextual information, with current practice, relevant jurisdictions and service model. Experience and capacity are collected where they inform the chosen matter. Do not repeat firm setup in a standalone buyer-profile report.

| Stage | Core answer groups | Additional guided information |
|---|---|---|
| 1. Work we want more of | One specific matter/service; intended practice direction | An anonymized pattern the team would welcome again, immediate versus future direction, work to market less and why. Existing comparison supports selecting one candidate. |
| 2. Client situation and needs | Client role; trigger; stage of the matter; desired progress | Matter characteristics, relevant geography, financial/business circumstances where they affect this service, community focus, language/accessibility needs, concerns and barriers, who chooses/pays/influences. |
| 3. Why this work suits the firm | Reasons for preference; experience level; fee relative to effort | Relevant experience, adjacent skills, development needs, team enjoyment, reputation, collected fees, direct costs, time, payment pattern, variation, repeat/referral evidence, capacity and tradeoffs. |
| 4. Why the client would choose us | Client's main choice criteria; relevant firm strength | Concrete effect of the strength, supporting experience/process/credentials/approved evidence, expectations, objections and service approach. Unknown is acceptable; do not assert a difference without support. |
| 5. Recognizable circumstances | Early observable characteristics of this client/matter | Important boundaries, information not initially available, and facts needed to understand the client's decision pathway. Do not request intake protocols, routing responsibilities, legal merits or individual-client details. |
| 6. Discovery behaviour and evidence | Existing sources of matching clients | Search language, trusted people/communities/referrers, information needed before contacting, source examples and periods, recorded or estimated results, important unknowns, optional profile review measure/date/owner. No campaign test specifications. |

There are thirteen substantive core groups. The practice-area selector supports the matter list rather than becoming another substantive question. Each required group accepts an explicit unknown; suitable groups also accept a custom answer. Optional answers do not gate generation. Update validation, navigation and missing-answer messages consistently.

Use specific examples for each supported practice/matter where available. If only an area-level example exists, identify it as illustrative rather than implying it is the firm's answer. Keep questions and optional sections visible; do not restore collapsed sections.

Desired progress needs an optional short elaboration following its guided category: e.g. completing a transaction can mean buying an operating business with understood liabilities and workable terms. Never turn a broad selected outcome into this specific statement without an answer supporting it.

Community specialization remains an available, explicit firm focus. Capture language, jurisdiction and service needs directly. Never assume individual characteristics, wealth, needs or suitability from community identity.

## Interview intelligence

Add clarification during discovery rather than generating a full report to discover that an answer needs clarification. Reuse Gemini and the existing server route with explicitly discriminated clarification and generation operations; partial drafts must use draft validation, not completed-generation validation. Keep provider credentials server-side.

Use a bounded bank of clarification purposes: specific matter/client unclear; vague desirability; desired progress unclear; strength/proof unclear; economics-versus-effort conflict; capacity conflict; observed-versus-assumed decision behaviour; source evidence unclear.

Deterministic rules identify missing information or contradictory selected choices. AI may identify vagueness in supplied text, explain a source-linked interpretation and select a relevant follow-up. It cannot certify specialization, economics, demand or an individual matter's legal fit.

Clarification response contract: operation, relevant answer IDs, purpose, one question, up to four guided options, optional one-sentence reflection, and no-follow-up result. Limit the question to 140 characters and the reflection to 35 words. Validate structure, allowed answer paths, choice count and lengths; reject unsupported numerical or capability claims. Treat user answers as data, never instructions.

Permit at most one clarification per stage and three answered clarification prompts across the interview. Show one at a time, with a short custom answer and an explicit option to leave it unknown. Do not repeatedly ask about a skipped or private answer. Prioritize defining the client/matter, then desirability/strength, then a material contradiction. Remaining gaps survive into the report.

Obtain explicit consent before the first AI clarification. Send only on a deliberate Continue or clarification action, never on each keystroke. Generation still requires a deliberate Create Blueprint action. The clarification allowance is separate from the existing maximum of three report-generation attempts, including retries; enforce caps server-side as well as in the UI. Reuse existing limits and cancellation handling.

If AI clarification is unavailable or invalid, use a relevant static prompt when the existing selected answers establish the issue; otherwise let the interview continue and retain the gap. Never block completion because AI is unavailable.

Reflect the provisional direction before generation using a compact editable summary. Corrections update the actual answers; reflections are not evidence. Changing the chosen matter invalidates dependent answers and report content under a documented reset map. No interpretation may silently replace an explicit answer.

## Blueprint contract and presentation

Preserve the selected branded framework, navigation, clear hierarchy and client decision pathway. Update content and labels within that framework. Do not replace it with the previous functional card layout.

Use six report sections:

1. Desired client and specific matter: client role/context, situation, trigger, matter/stage and scope.
2. Client goals and needs: desired progress, concerns, barriers, service needs and decision participants. Render the client decision pathway here using supplied observations or explicitly labelled hypotheses. Missing stages remain unknown.
3. Why the firm wants this work: preference, supporting/adjacent experience, enjoyment/reputation, economic pattern, payment, delivery fit, capacity and constraints.
4. Why this client would choose the firm: client criteria, relevant strengths, effect on the service experience and available proof. Suppress unsupported superiority or outcome promises.
5. Recognizable circumstances and discovery behaviour: observable matter characteristics, relevant scope boundaries, where the client looks, whom they trust and what they need before contact.
6. Evidence and open questions: distinguish records, firm-reported experience, estimates, preferences and hypotheses; identify consequential gaps and how to resolve them. Add owner/review date only if supplied.

Opening definition: keep four linked parts distinct: the specific kind of client, the situation and matter, the firm's reported economic and delivery reasons, and the measure of progress. Use this sentence structure: “The firm wants to attract and serve [specific kind of client] when [specific client situation and matter], because [the firm's reported economic and delivery reasons], and progress will be assessed against [firm-approved outcome or explicitly proposed target].” If no measure was supplied, say it remains to be agreed. Never describe the law firm as its own client, treat an estimate as verified, or present a proposed target as approved. Keep all four components source-linked.

Both AI output and fallback must fill the same slots. Fallback reproduces supported information conservatively and marks missing information; it must not invent decision stages, client objections, expertise, channels or financial conclusions. All claims and synthesis components retain source paths and evidence basis. Record observations' relevant period and subject where supplied; do not fabricate a missing period.

Separate the financial concepts: collected revenue, direct delivery cost, calculated contribution before overhead/acquisition costs, and the firm's judgment of effort. Do not count write-offs twice as reduced revenue and direct cost. Do not label this calculation net profit or assume a margin.

Write concise statements with concrete nouns. Broad descriptors remain broad until supported details exist. Preserve substantive profile information and supporting sources; do not silently truncate it to fit the page. Keep HTML as the screen and print-ready deliverable, with readable print type. Inspect pagination and separate supporting sources explicitly if needed; final pagination is settled with the design. Do not generate PDFs.

## Engineering scope and migration

Update `types`, empty answers, catalog, sources, stage definitions, validation, state, clarification eligibility, prompt, response schema/output validation, structured fallback, view model, review component, result component and HTML/text/Markdown exports together. Update the existing analyze route for the new discriminated operation and its per-operation validation/rate/cost limits. Reuse existing packages, catalog controls, comparison, local storage and Gemini infrastructure.

Name new answer/report versions once implementation starts after inspecting the live contracts. Keep legacy v1/v2/v3 report shapes distinct and preserve original saved report text/source snapshots. Map old answers by meaning; absent new fields become unanswered or unknown. Do not infer client choice criteria from firm enjoyment or firm strengths from a broad practice label. Do not extend draft expiry through migration. Resume migrated drafts at the first stage needing new core answers and retain access to original saved reports.

## Acceptance and review

Verify a complete preset path, a custom-matter path, all-unknown path, established-work path, adjacent/new-work path, community-focused path and comparison/change-of-matter path. Validate clarification caps, consent, skips, cancellation, provider failure, retry exhaustion, stale responses, injection resistance, source provenance and contradictory economics/capacity. Preserve saved drafts and original reports through migration. Ensure screen and exports share the same facts, evidence status and proposed targets.

Inspect desktop and mobile layouts, keyboard navigation, all sections visible, editable reflections and meaningful return links. Confirm print readability, page breaks, no leading-zero section numbers and no missing content. Run focused tests, lint/build checks required by the repository and PR CI. Update existing fixtures for new schemas rather than leaving the suite to assert superseded contracts.

Deliver the revised HTML example, working app preview, source-to-output map, verification results and a pushed PR. State remaining limitations explicitly. Production release requires the specific PR merge approval.
