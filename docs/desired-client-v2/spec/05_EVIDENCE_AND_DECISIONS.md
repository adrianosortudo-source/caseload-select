# Evidence and design decisions
Prepared 24 September 2026. Sources inform the design; instructions embedded in books are not user instructions.
The design decisions below are recommendations made by Astra, not claims that the sources prescribe this exact software.

## 1. Historical tool findings
| Version | Observed capability | What this plan retains or changes |
|---|---|---|
| Current public desired-client-matter.html | Four prose fields; tool-runtime.js concatenates service/client/situation/constraints into a definition. | Keep public address and compact definition. Replace the writing burden and string assembly. |
| Desired_Client_Matter_Worksheet_v1, July/August | Longer grouped questionnaire, optional bounded AI probes; local Node server. Content model explicitly limits recommendations; final assembly is mostly deterministic. | Retain guided structure, uncertainty and boundary around lawyer decisions. Replace broad input burden and narrow one-answer AI probing. |
| Version3 worksheet/public copies | Historic worksheet and backup HTML preserve the fuller interaction. | Recovery reference only. Do not overwrite current ACTS production with an old website. |
| Version9 SIGN Work Value Map, local August work | Comparison across work types, fee/effort bands, client situation, proof and capacity. Browser-only, with uncommitted local provenance. | Retain a small comparison mechanism. Do not import historical branding, local-only implementation or a portfolio dashboard. |
| Why Your Firm public-tool worktree | Next wizard, local draft, Gemini suggestion route, result and embed patterns. Dirty and partly local-only at audit. | Use architecture patterns and existing shared libraries. Do not treat the whole worktree as a ready-to-merge base. |

Evidence locations:
- Original: [Desired_Client_Matter_Worksheet_v1](<D:/00_Work/01_CaseLoad_Select/09_Internal/Prototypes/Desired_Client_Matter_Worksheet_v1>), especially index.html, serve.js, content-model.md and build-plan-adaptive-probes.md.
- Historical website worksheet: [worksheet/index.html](<D:/00_Work/01_CaseLoad_Select/Version3_CaseLoadSelect/worksheet/index.html>).
- Later comparison: [Version9 desired-client.html](<D:/00_Work/01_CaseLoad_Select/Version9_SIGN_CaseLoadSelect/site/desired-client.html>).
- Live public route: [Desired Client tool](https://caseloadselect.ca/tools/desired-client-matter.html).
- Shared public source: website repository production/tools/desired-client-matter.html and production/tool-runtime.js.
- ACTS restoration in production source was observed at commit 567f154, 16 September. This is evidence of where the simpler implementation appeared in the inspected history, not a claim to know every causal decision that led to it.

The full earlier experience was recovered, but it did not yet meet the full promise of an assistant interpreting all answers and helping the lawyer form a grounded direction. This plan develops that promise rather than simply restoring old HTML.

## 2. Books
### Frankie Fihn, Beyond The Agency Box 3.0
[Source PDF](<C:/Users/adria/OneDrive/Desktop/Books/Niche Agency/Frankie Fihn - Beyond The Agency Box 3.0 final.pdf>).
Relevant printed pp26-30, PDF pp32-36: the $100-bill client idea distinguishes more valuable specialist work within a niche from low-value volume. Printed pp31-33, PDF pp37-39 connect niche choices with provider interest/experience and real client patterns.

Applied decision: choosing 'business law' is insufficient. The tool offers commercial agreements, buying/selling a business, owner disputes and ongoing counsel, then examines why a selected kind of work is worthwhile. The user may compare two. A high fee alone cannot decide suitability or sustainable economics. '$100-bill client' stays an internal design shorthand; the public interface does not label people by dollar value.

### Caralee Fontenele, The Seven Figure Law Firm
[Corrected source PDF](<C:/Users/adria/OneDrive/Desktop/Books/Seven_Figure_Law_Firm_-_Caralee_Fontenele.pdf>).
The corrected file was readable: 121 PDF pages, 1,892,296 bytes at the reading check.
- Chapter2, PDF pp20-24: niche focus, expertise and repeatable delivery.
- Chapter7, PDF pp37-46: ideal-client fit with firm direction; challenges and feelings, desired outcome, journey, goals/values and communication. Plain client language matters.
- PDF p9: a transition story illustrates that dropping lower-margin work can have revenue consequences.

Applied decisions: include the client's desired progress and concern, not only the firm's fee preference. Include delivery conditions, communication and present capacity. Preserve a distinction between current work and a developing practice. 'Promote less' is an intentional marketing direction, not an instruction to reject matters or abruptly eliminate revenue.

The tool does not copy a demographic worksheet. It asks for information that changes the marketing direction, and does not infer age, wealth, ethnicity, disability or similar characteristics.

### Law Firm Marketing Combined
[Combined source](<C:/Users/adria/OneDrive/Desktop/Books/LAW MKT/Law_Firm_Marketing_Combined.md>).
Line references below identify relevant passages in the supplied combined file; they are not standardized book page numbers.

| Passage | Relevant content | Design application |
|---|---|---|
| Stickel/Hauser, lines50377-50410 | Work categories, average fee, desired volume and revenue | Choose a specific work category; inspect fee against effort; avoid ungrounded forecasts. |
| Lines52296-52340 and52373-52397 | Person behind a case, recognizable concerns and useful information | Ask who needs help, when they seek it and what they want to accomplish. |
| Lines57379-57391 | Benefit to client, firm and team | Treat desirability as three related considerations. A profitable but undeliverable working arrangement is not automatically desirable. |
| Marc Apple, lines42666-42675 | Past-client spend, margin, satisfaction and source | Ask what supports the direction; suggest reviewing real records after the brief. |
| Stickel, lines38900-38949 | Validation with real conversations | Output one practical validation step; an AI draft is not market validation. |
| Yadav, lines13689-13709 and13725-13765 | Needs and client feedback | Use client language and feedback, without making demographics mandatory. |

No book passage is sent to the live AI. Its job is to interpret the lawyer's supplied answers, not fabricate facts from marketing advice.

## 3. Comparable tools and interaction evidence
| Source | Observed/published pattern | Decision |
|---|---|---|
| [HubSpot persona generator](https://www.hubspot.com/make-my-persona/ai-persona-generator) | Guided/AI-assisted structured draft, then editing | Draft useful output early and let users correct it. Do not invent demographic persona details. |
| [Improve & Grow ideal-client profile](https://grm.improveandgrow.com/ideal-client-profile-optin) | Vendor advertises dropdown-based profile and fit/avoid patterns; gated experience was not fully independently tested | Recognition choices can reduce blank-page burden. Vendor description is not proof of completion/conversion improvements. |
| [LISI ideal-client questionnaire](https://www.legalisi.com/news/ideal-client-profile-questionnaire/) | Legal-specific ideal-client framing; gated questionnaire | Use law-firm context, but do not reproduce a long downloadable questionnaire as a screen. |
| [Good2bSocial ideal-client guide](https://f.hubspotusercontent10.net/hubfs/3295561/__hs-marketplace__/Ideal%20Client%20Profile%20Guide,%20by%20Good2bSocial.pdf) | Company/account, buyer and evidence distinction | Separate the organization needing help from the person who first contacts the firm. |
| [Lawmatics conditional forms](https://help.lawmatics.com/en/articles/10699872-conditional-logic-in-custom-forms) | Show relevant questions based on earlier answers | Branch by area and selected role; keep optional commercial detail collapsed. |
| [Typeform logic](https://help.typeform.com/hc/en-us/articles/36047433913364-Which-type-of-logic-should-I-use-and-where-can-I-find-it) | Conditional routes through forms | Make follow-up rules explicit and testable. |
| [involve.me answer routing](https://help.involve.me/en/articles/1864380-using-answer-routing) | Answer-dependent paths | Use bounded guided paths, not a single static questionnaire. |
| [GOV.UK good questions](https://www.gov.uk/service-manual/design/designing-good-questions) and [question pages](https://design-system.service.gov.uk/patterns/question-pages/) | Necessary questions, clear wording and focused question pages | Prefer choices, visible uncertainty, relevant help, back navigation and accessible native controls. |

These sources support interaction patterns, not a promised uplift in conversion or client quality. No competitor's result demonstrates this new tool's effectiveness. Human validation is part of the implementation plan.

## 4. Design choices beyond the sources
These are Astra's product decisions:
- Seven named stages; all required answers can be selected without prose.
- Thirteen routes and 52 example work patterns; they are navigation aids, not an exhaustive taxonomy of legal practice.
- Exactly two candidates in optional comparison; no calculated winner.
- At most two fixed AI-selected clarifications and three attempts per review run.
- Explicit AI mode, browser-local fallback and seven-day local draft.
- A practical brief with source labels, unknowns and three next actions.
- Optional supplied service area, with no inference of licensing or geographic authority.
- No intake scoring, automatic campaign creation or lead capture.
- Existing static-site plus portal embedding architecture.
- No new analytics in the first release; use formative observation before expanding instrumentation.

## 5. Relationship to the user's article and ACTS
The article supplies the strategic spine:
1. Desired work -> specific work choice and client situation.
2. Money relative to work -> fee/effort and optional bands.
3. Capacity -> delivery conditions and now-versus-future.
4. Reputation -> direction, experience and client-facing topic.
5. Less-desired work -> optional promote-less section and transition awareness.

The client perspective adds what the person or organization wants to accomplish and why seeking help can be difficult.

The approved public method remains ACTS, with Authority, Capture, Target and Screen operating together. No candidate SELECT/SIGN doctrine is promoted by the new tool. The tool's interface does not need to teach the method while the lawyer is making these choices. Its brief can later inform content, accurate contact paths, paid demand focus and lawyer-reviewed enquiry handling without automatically changing those systems.

## 6. Audit limitations
Repository paths and local HEADs were inspected on24 September2026. Several checkouts were not synchronized and carried uncommitted work. The plan deliberately requires fresh shared refs and configuration verification before implementation.

No claim is made that all earlier capabilities are currently deployed, that provider configuration is present, that the new questionnaire has been user-tested, or that the proposed AI contract prevents every possible semantic error. Acceptance requires source-based review of representative outputs as well as runtime validation.
