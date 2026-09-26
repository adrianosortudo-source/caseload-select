# Discovery specification

## 1. Shared interaction rules

Keep the navigation labels `1 Focus`, `2 Situation`, `3 Client goal`, `4 Value`, `5 Delivery`, `6 Direction`, `7 Review`. Keep the existing progress, back/next, local saving, resume, comparison and reset facilities.

All question sections stay expanded. Do not use closed details, accordions or hidden optional panels. Conditional questions may appear when relevant, but there must be no extra click to reveal their options. Show `Optional` beside every optional question. Explain a conditional field where it appears.

Use existing choice controls and keyboard semantics. New radio groups allow either one preset or a write-in; typing a substantive write-in clears the radio. New checkbox groups allow presets plus one write-in within the combined maximum. A substantive selection or write-in clears Not sure; selecting Not sure clears other selections and the write-in. Blank/whitespace text is not an answer. Custom text is at most 180 characters, with a visible counter. No mandatory explanation follows a preset.

Every new custom field uses `Other: write your own answer` and helper `Use a general description. Leave out client names and confidential matter details.` A user may enter only the custom answer. Existing custom-work and custom-role behavior remains supported.

Do not change existing IDs, fee/hour boundaries or optionality unless this file explicitly says to. Preserve existing write-in and exclusive-choice rules. Questions 1.1 through 6.4 below are shown in the listed order within each stage.

## 2. Opening copy

Title: `Define your desired client`

Intro: `Identify the clients and matters your firm wants more of, and turn that direction into a practical marketing profile.`

Visible explanation, using three short blocks:

- **How it works:** `Choose the work you want to grow, the situations that bring clients to you, and the conditions that make that work worthwhile. We will guide you with choices and examples. You can add your own answer or leave something uncertain.`
- **What to have in mind:** `Think about a few matters you would welcome again and why. You do not need records to begin. If you know your usual fees, time commitment or capacity, you can add that detail.`
- **What you will receive:** `A one-page Desired Client Blueprint with a client portrait, reasons the work fits your firm, marketing direction, and proposed questions for recognizing suitable inquiries. You can review it, correct it and download it.`

Time copy: `Plan for about 10 minutes for a first draft. Comparing two types of work or adding more detail will take longer.` This is the only initial estimate; acceptance testing must report measured scripted times separately and must not call them representative user research.

Keep the existing AI versus browser-only choice and accurate privacy/consent copy. Explain the distinction using: `AI helps turn your answers into a connected profile. The basic version organizes your choices without AI interpretation.` Do not imply the basic version has AI insight. Keep AI consent at the existing explicit submission point; no per-question AI calls or transmission on typing.

## 3. Stage copy and question inventory

### Stage 1: Focus

Heading: `What legal work do you want more of?`

Context: `Choose one type of work for this profile. A specific focus helps you describe the right client situation and gives your marketing a clear direction.`

1.1 Practice area: existing area choice, required.

1.2 Work type: existing practice-dependent work choices, required. Keep Other/custom work and the optional comparison route. Add help: `Start with one service or type of matter. You can create another profile for a different part of the practice.`

1.3 Route: existing established/new/exploring question and IDs, required. Existing copy must continue to distinguish experience from intended growth.

1.4 Service area: existing optional field, unchanged. Helper: `Name the location or jurisdiction this profile should cover. Leave this open if it still needs a decision.` No geography inferred from IP, browser locale or a practice label.

### Stage 2: Situation

Heading: `What brings this client to a lawyer?`

Context: `Identify the event behind the inquiry, the stage the matter has reached, and who needs help. This makes the profile recognizable in both marketing and an initial conversation.`

2.1 NEW, required, single choice: `What usually happens that makes this client seek help?`

Helper: `Choose the event that starts the need for advice. The next question asks how far the matter has progressed.`

Use the selected area's exact four trigger options from section 4, followed by `Not sure yet` and the custom field. IDs are `<area>.<suffix>`; the unknown ID is `unknown`. Data path: `situation.trigger`. Write-in path: `write_ins.trigger`. No default selection.

Immediately below the helper, show `Example, not a suggested answer: {area example from section 4}`. Hide the example only when no area is selected. Never store this example as an answer or send it as user evidence.

2.2 Timing: retain existing options/IDs and required status; heading `At what stage do they usually contact you?`. Helper: `The same event can bring someone to you early, partway through, or close to a deadline.`

2.3 Client role: existing practice-dependent role question, required; custom and unknown remain available.

2.4 First contact: existing optional question and existing role-based visibility, unchanged. Never assume the first caller has authority to instruct.

### Stage 3: Client goal

Heading: `What is the client trying to achieve?`

Context: `Describe the progress the client wants and what may make taking the next step difficult. These answers help the profile speak to the client's situation in language they can recognize.`

3.1 Goals: existing required choice, up to two; keep all IDs and write-in behavior.

3.2 Concerns: existing optional choice, up to two. Keep the established-route question `What concern have you heard from these clients?` and its helper `Choose concerns clients have expressed to you. If you have not heard them directly, say so.` For new/exploring, keep `What might concern these clients?` and helper `These are hypotheses to check with clients.` Keep `I haven't heard this directly yet` exclusive. Established-route substantive concerns are reported experience; new/exploring concerns are hypotheses. Do not use general feedback selected elsewhere to change that distinction.

3.3 NEW optional, up to two including a custom answer: `What would help this client feel ready to take the next step?`

Helper: `Choose what clients need to understand or trust before proceeding. Leave this open if you do not know yet.`

Data path: `client.decision_needs`. Write-in: `write_ins.decision_needs`.

| ID | Exact label |
|---|---|
| scope_cost | A clear explanation of the service and its cost |
| options | An understandable explanation of their options |
| relevant_experience | Confidence in the firm's relevant experience |
| process | Knowing what happens next and what they need to do |
| response | Knowing when someone can respond |
| heard | Feeling that the lawyer understands their situation |
| unknown | Not sure yet |

These are decision needs, not evidence that the firm already meets them. Do not automatically turn `relevant_experience` into a proven-expertise claim or `response` into a response-time promise.

### Stage 4: Value

Heading: `Why does your firm want more of this work?`

Context: `A desirable matter should benefit the client and support the practice you want to build. Consider the effort, the team's strengths and the work you would prefer to take on again.`

4.1 Reasons, required, up to three: change the question to `What makes this work especially desirable for your firm?`. Keep existing reason IDs and route-dependent labels. Helper: `Think about why you would choose more of this work when other inquiries also compete for the team's time.` Do not add a compulsory numerical comparison.

4.2 Fee versus effort: existing required question, options and established/new labels. Clarify in helper: `Consider the fee alongside the total effort needed to deliver the work. A larger fee alone does not establish better value.`

4.3 Commercial details: existing optional collected-fee range, team-hours range and payment pattern, always expanded. Preserve exact units and range endpoints. No profitability calculator, implied margin, salary question or fee recommendation.

### Stage 5: Delivery

Heading: `When is this work a good fit to deliver?`

Context: `Identify what helps your team serve the client well and what should be established early in an inquiry. The profile will turn these answers into practical questions for review.`

5.1 Delivery conditions: existing optional choice, up to three. These describe operating conditions, not automatic rejection rules.

5.2 Capacity: existing required question, unchanged.

5.3 Limit: existing optional question, expanded. No condition is converted into a hard exclusion automatically.

5.4 NEW required, up to three including a custom answer: `Which early signs would make this inquiry worth a closer look?`

Helper: `Choose up to three things you would want to establish in an initial conversation. Missing information should lead to a question.`

Data path: `delivery.fit_signals`. Write-in: `write_ins.fit_signals`.

| ID | Exact label |
|---|---|
| service | They are seeking the kind of work we have chosen |
| stage | The matter is at a stage our service can address |
| information | They can share the information needed for a useful first conversation |
| decision | The people needed for decisions can take part |
| scope | They are open to agreeing the scope and next step |
| fees | They are willing to discuss the proposed service and its fees |
| timing | Their requested timing can be considered against our availability |
| unknown | Not sure yet |

Show a short explanation beneath the group: `These are proposed signals to explore. The firm still decides scope, suitability and whether to accept a matter.` Do not ask for thresholds or scoring weights here.

### Stage 6: Direction

Heading: `What direction should this profile support?`

Context: `Connect the profile to the practice you want to build and identify what supports your choices. This keeps established experience, future preferences and open assumptions clear.`

6.1 Aim: existing required choice, unchanged.

6.2 Evidence: existing required choices, unchanged. Preserve mutually exclusive `repeated`/`few` and exclusive `preference`. Do not infer validation simply because the user completed the tool.

6.3 Work to promote less: existing optional choice, unchanged.

6.4 Optional less-work note: existing field, unchanged. This directs marketing emphasis, not a universal refusal of that work.

### Review before generation

Heading: `Check the direction before we build your profile`

Context: `Review your choices below. We will use them to connect the client situation, the value of the work and the practical conditions for serving it well. Anything uncertain will remain visible in the profile.`

Keep answer review and section-edit links. Include all three new fields and their actual answers. Do not present area examples as user inputs. Retain existing AI consent. AI button: `Build my Desired Client Blueprint`. Browser-only button: `Create my basic blueprint`.

## 4. Trigger catalog and contextual examples

Each row provides four choices in display order. Prefix each suffix with the area ID shown. These are events, not outcomes, legal conclusions, qualifications or acceptance requirements. Show every choice for the selected area, regardless of the work subtype. The selected work still supplies context; do not force a matching trigger.

| Area | Suffix: exact choice label | Example text |
|---|---|---|
| business | agreement: An agreement needs to be made or reviewed; transaction: A business purchase, sale or ownership change is planned; dispute: A disagreement affects the business; ongoing: The business needs ongoing legal support | A business owner considering an acquisition wants help before agreeing to the transaction. |
| employment | exit: Employment has ended or an exit offer has arrived; change: An employment or workforce change is planned; complaint: A workplace complaint or disagreement has arisen; terms: An employment agreement or policy needs attention | An employee receives an exit offer and wants advice before responding. |
| family | separation: A relationship is ending or has ended; parenting: Parenting arrangements need to be made or changed; support_property: Support or property arrangements need attention; planning: A couple wants an agreement for a future change | A separating parent wants help reaching workable arrangements for the children. |
| property | purchase: A property purchase is planned; sale: A property sale is planned; finance: A mortgage or refinancing arrangement needs attention; issue: A property document or issue needs legal attention | A buyer has a planned purchase and needs help completing the legal work. |
| estates | planning: Someone wants to prepare or update an estate plan; death: Someone has died and the estate needs attention; dispute: A disagreement about an estate has arisen; decisions: Help is needed with authority to make decisions | An estate representative needs help understanding what to do after a death. |
| litigation | disagreement: A disagreement has become difficult to resolve; claim: A claim or demand has been received or is being considered; proceeding: An existing proceeding needs legal attention; payment: A payment or performance problem needs attention | A business receives a demand about a contract and wants to understand its options. |
| injury | incident: An injury or accident has occurred; benefits: An insurance or disability benefits issue has arisen; offer: A decision or settlement offer needs review; ongoing: An existing injury matter needs further help | A person receives a benefits decision and wants to understand the available next steps. |
| immigration | move: A move, visit, study or work opportunity is planned; status: An immigration status or permission needs attention; hiring: An employer plans to hire or support a worker; decision: An immigration decision or process needs review | An employer wants guidance on a planned hire involving immigration requirements. |
| criminal | investigation: An investigation or police contact has occurred; charge: A charge or court document has been received; release: A detention or release issue needs attention; decision: A court decision or existing matter needs review | A person receives a court document and wants to understand the next step. |
| regulatory | application: A licence or registration application is planned; investigation: A complaint or investigation has arisen; hearing: A hearing or regulatory decision needs attention; compliance: An organization needs help with compliance | A professional receives notice of a regulatory investigation and seeks advice. |
| ip | protect: A name, creation or invention needs protection; commercial: Rights will be licensed, transferred or used commercially; dispute: A concern about ownership or use of rights has arisen; management: Existing rights or registrations need attention | A business preparing to use a new brand wants help understanding protection options. |
| nonprofit | formation: A nonprofit or charity is being formed; governance: A board or governance matter needs attention; agreement: An agreement or partnership is planned; ongoing: The organization needs ongoing legal support | A board wants help clarifying responsibilities before changing its governance arrangements. |
| other | planned: A planned decision or change needs legal support; problem: A problem or disagreement has arisen; document: A document or decision needs a response; ongoing: Ongoing legal guidance is needed | A client faces a specific decision and wants help understanding what to do next. |

## 5. Branching and length controls

- Established work: retain experience-oriented wording. New/exploring work: retain expected/preferred wording. Never make route-based assumptions about commercial figures.
- Changing practice area, work choice, custom-work text, or comparison winner clears the new trigger, decision-needs and fit-signals selections and their write-ins. They describe the earlier focus. Keep the existing downstream revisit mechanism for other answers. Explain the reset: `Your focus changed. Please check the client situation, decision needs and early fit signals again.`
- Do not add a seventh discovery stage. Do not move existing questions between stages. This prevents a migration/navigation change that provides little benefit.
- Required groups by stage become 3 / 3 / 1 / 2 / 2 / 2 = 13. Optional questions and optional comparison are not counted as required groups. Selection caps are not the number of questions.
- The ordinary journey has no more than two follow-ups after initial AI submission. Preserve the existing five clarification types, with priority: capacity conflict, fee/effort conflict, experience/direction conflict, unclear work, unclear client goal. See engineering instructions for attempt accounting.
- Unknown trigger or fit signals is a valid answer, not grounds to repeat the question indefinitely. The result identifies what remains undefined.
- The final synthesis does not ask the lawyer to write a positioning statement, advertisement, persona essay or screening algorithm.
