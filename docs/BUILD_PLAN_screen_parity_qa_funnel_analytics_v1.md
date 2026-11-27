# BUILD PLAN - Screen parity, QA matrix, and funnel analytics (v1)

Date: 2026-08-22

Author: Codex, direction from Adriano

Status: DRAFT - implementation-ready

Primary repository: `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app`

Related repositories: `caseload-screen-sandbox`, `caseloadselect-site`

## 1. Outcome

Execute the next three Screen workstreams in this order:

1. Lock DRG and Main Screen behavioral parity.
2. Establish a repeatable, evidence-producing QA matrix.
3. Measure funnel friction with content-free telemetry.

The result must tell us, with evidence:

- whether both public experiences obey the same question and routing rules;
- whether representative inquiries produce relevant questions and trustworthy reports;
- where people stop, how many questions they receive, and how long completion takes;
- whether any change improves the experience without collecting legal descriptions or contact details in analytics.

This plan does not change scoring doctrine. The Screen organizes information and attention. The lawyer decides.

## 2. Confirmed baseline

### 2.1 Shared engine, different operating modes

DRG and the Main Screen already use the same engine core in `src/lib/screen-engine/`:

- The DRG public widget mounts `ScreenEnginePublicWidget`. It adds live extraction, abandonment checkpoints, contact capture, consent, and submission.
- The Main Screen demo mounts `ScreenDemoWidget`. Its `screen-demo.ts` adapter uses the deterministic engine only and deliberately excludes extraction, checkpointing, contact capture, consent, and persistence.
- Both surfaces call the same `getNextStep`, `applyAnswer`, selector, band, evidence, and report code.
- The Screen sandbox is the engine source of truth. Its engine is ported into the app and guarded by `scripts/check-engine-sync.sh` plus the DR-058 CI manifest.

Parity therefore means the same policy and visible discovery behavior, not identical infrastructure or identical wording at the terminal step. The Main demo must remain fictional and non-submitting. DRG must remain a real intake path.

### 2.2 Rules already live

The current engine publishes and tests:

- typical web discovery: 5 to 7 adaptive questions after the opening description;
- hard maximum: 8 visible discovery questions;
- a visible routing choice counts toward the question budget;
- Business routing: four primary categories and one free-text escape;
- no more than one progressive routing-detail screen;
- progressive detail screens contain two or three choices;
- business formation routes directly after the primary category screen;
- routing scaffolding is excluded from the lawyer report.

Existing engine tests protect the raw policy. This build extends protection to both rendered surfaces, representative journeys, production smoke evidence, and funnel measurement.

### 2.3 Existing abandonment persistence

The live public widget already posts best-effort checkpoints to `/api/intake-v2/checkpoint`, backed by `web_intake_sessions`. That operational record contains engine state and is used to recover reachable leads or classify abandoned inquiries. It is not the analytics model proposed here.

The analytics work must not copy legal descriptions, answers, contact fields, report content, or engine state into a second event stream.

## 3. Non-negotiable constraints

1. **One engine policy.** Do not create DRG-specific or demo-specific question budgets, routing lists, or selector logic.
2. **No autonomous legal judgment.** Analytics and reports must not describe leads as accepted, rejected, qualified, good, bad, or suitable. Report bands organize attention only.
3. **No analytics content.** Telemetry must never include opening descriptions, answer values, question text, slot IDs, matter type, practice area, names, email, phone, IP address, report text, or free-text content.
4. **No direct browser database access.** The browser posts a small allowlisted event to a server route. The server performs validation and the database write.
5. **Demo promise integrity.** Telemetry remains disabled for the Main demo until its disclosure accurately distinguishes fictional content from content-free interaction metrics.
6. **Engine sync.** Author engine changes in `caseload-screen-sandbox`, port them into the app, refresh the manifest, and pass both repositories' suites.
7. **Migration discipline.** A migration is created with the repository's Supabase workflow, committed, pushed, and validated by the real-Postgres CI job before it can be applied anywhere.
8. **Database isolation.** Any new public-schema analytics table has RLS enabled and forced, with all access revoked from `anon`, `authenticated`, and `PUBLIC`. Only server-side code may write or read it.
9. **Production via PR.** Portal changes ship through a pushed PR and protected `main`. No direct Vercel production deployment.
10. **Evidence before optimization.** Do not change the 5 to 7 target or hard cap of 8 during this build. Reconsider them only after the observation window and minimum sample are met.

## 4. Workstream 1 - Lock DRG/Main Screen parity

### 4.1 Create a typed experience policy

Add a typed `WEB_EXPERIENCE_POLICY` object at the engine level, next to the current discovery constants. Preserve the named constant exports so existing consumers do not break.

The policy records:

```ts
{
  discovery: {
    targetMin: 5,
    targetMax: 7,
    hardCap: 8,
    routingCountsTowardBudget: true,
  },
  businessRouting: {
    primaryCategoryCount: 4,
    freeTextEscapeCount: 1,
    maxProgressiveDetailScreens: 1,
    detailChoiceMin: 2,
    detailChoiceMax: 3,
  },
}
```

The named constants derive from this object, so it controls both surfaces without becoming a second routing implementation. Actual category labels and option-to-route transitions still come from the slot registry and control logic.

Lock this canonical Business truth table in the contract:

| Primary category | Detail step | Choices | Route behavior |
|---|---|---:|---|
| Money owed, supplier billing, or broken agreement | `corporate_dispute_problem_type` | 3 | Unpaid invoice, supplier billing, or contract dispute |
| Partner, co-owner, or internal concern | `corporate_internal_problem_type` | 2 | Shareholder dispute or money/control concern |
| Starting, buying, or restructuring | None | 0 | Direct to business setup advisory |
| Contracts or ongoing legal support | `corporate_support_problem_type` | 2 | Contract work or ongoing counsel |

### 4.2 Add a shared behavioral contract

Create a fixture-driven contract in the sandbox engine test tree and port the same contract into the app test tree. Tests are excluded from the raw sync script, so parity is verified by matching fixture version/hash assertions in both suites.

Contract assertions:

- the published discovery values are 5, 7, and 8;
- a ninth discovery question can never be returned on web;
- Business exposes exactly four primary choices;
- the UI adds exactly one free-text escape, not a duplicate engine option;
- formation routes directly;
- dispute, internal concern, and support expose at most one detail step;
- each detail step has two or three choices;
- every canonical option produces the expected matter route and user-grounded provenance;
- a free-text Business response does not loop back to the category menu;
- routing scaffolding does not inflate captured-fact counts or appear as duplicate report facts.

Extend the existing `web-discovery-and-corporate-routing-policy.test.ts` rather than creating overlapping assertions with different expectations.

### 4.3 Add rendered-surface contract tests

Add component tests for both orchestrators:

- `ScreenDemoWidget`: renders policy-derived question guidance, uses the shared engine step, respects the cap, reaches review, opens the report, and never calls extraction or persistence.
- `ScreenEnginePublicWidget`: renders the same routing cardinality and question guidance, respects the cap, retains clarify/contact behavior, and persists only on the real intake path.

The tests should compare policy outcomes, not exact full question sequences. The live widget may use LLM extraction while the demo is deterministic.

### 4.4 Strengthen CI drift protection

The CI gate must run all of the following on every engine or Screen-surface change:

- app engine unit tests;
- both widget component contract tests;
- `scripts/check-engine-manifest.sh`;
- local cross-repository `scripts/check-engine-sync.sh` before push;
- sandbox engine contract suite on the source branch;
- TypeScript, ESLint, full Vitest, render parity, and real-Postgres jobs.

Do not weaken the existing sync exclusions. `persist.ts` remains the documented runtime-specific exception.

### 4.5 Parity acceptance criteria

- [ ] One policy source controls both surfaces.
- [ ] The app and sandbox contract fixtures express the same rules.
- [ ] Main demo and DRG component tests pass against the shared policy.
- [ ] No firm ID, DRG name, demo special case, or surface-side route list appears in engine policy code.
- [ ] The Main demo remains deterministic and non-persisting.
- [ ] The DRG path retains live extraction, contact, consent, checkpoint, and submission behavior.

## 5. Workstream 2 - Build the QA matrix

### 5.1 Test layers

Use three layers, each with a different purpose:

1. **Deterministic engine fixtures:** fast, repeatable, CI-blocking.
2. **Rendered preview journeys:** browser-driven, visual and interaction evidence, CI or release-blocking where stable.
3. **Live production smoke:** small, controlled, fictional, performed after deployment. No real lead is submitted.

Do not make live LLM responses a deterministic unit-test dependency. Use mocked extraction outputs in CI and record live behavior separately.

### 5.2 Canonical scenario matrix

| ID | Opening shape | Required route or behavior | Trust check |
|---|---|---|---|
| QA-01 | `I want to speak to a lawyer` | Clarify, then four-area menu; Business shows four categories plus one free-text escape | No invented matter facts |
| QA-02 | Unpaid $28,000 invoice with signed proposal and emails | Business dispute path; no repeated request for facts already stated | Report separates stated facts from inference |
| QA-03 | Partner or co-owner dispute | Internal concern path; one two-choice detail screen | Relevant control/ownership questions |
| QA-04 | Starting a business with a co-founder | Formation routes directly after primary category | No second routing menu; factual advisory questions are allowed |
| QA-05 | Contract review before signing | Contracts/support path; one detail screen | Deadline and document status asked only if missing |
| QA-06 | Vague Business `Something else` response | Free text accepted without category loop | No forced classification from insufficient text |
| QA-07 | Urgent document with a near deadline | Urgency appears early in discovery | No response-time or outcome promise |
| QA-08 | Complete narrative containing deadline, amount, parties, and documents | Already-stated facts are not asked again | Fewer redundant questions; hard cap still respected |
| QA-09 | Out-of-scope family/criminal/personal-injury matter | Correct scope boundary and contact doctrine | No misleading legal assessment |
| QA-10 | Portuguese contact request and Business path | PT visible interaction; English lawyer brief | Same routing and budget rules as EN |
| QA-11 | Back, skip, restart, and free-text transitions | State/history stays coherent | No duplicated report facts or inflated question count |
| QA-12 | Long final report in marketing iframe | Parent grows to child document height | No nested scrollbar, clipping, or inaccessible report content |

### 5.3 Automated fixture format

Create a versioned typed TypeScript fixture schema containing only fictional content:

```ts
type ScreenQaFixture = {
  id: string;
  layers: Array<"engine" | "component" | "browser_preview" | "production_smoke">;
  locale: "en" | "pt";
  opening: string;
  mockedExtraction?: Record<string, unknown>;
  actions: Array<
    | { type: "answer"; slotId: string; value: string }
    | { type: "back" }
    | { type: "skip" }
    | { type: "restart" }
    | { type: "open_report" }
  >;
  expected: {
    route?: string;
    maxQuestions: number;
    expectedAsked?: string[];
    forbiddenAsked?: string[];
    reportMustContain?: string[];
    reportMustNotContain?: string[];
  };
};
```

Fixture content is test data only and must be obviously fictional. Do not use copied real inquiries.

Layer assignment:

- QA-01 through QA-10: deterministic engine fixtures;
- QA-01, QA-04, QA-10, and QA-11: rendered component journeys;
- QA-01, QA-04, QA-10, and QA-12: protected-preview browser journeys;
- Main production: QA-01, QA-04, and QA-12 may run end to end because the demo does not persist;
- DRG production: load, language, embed sizing, and first-screen rendering only. Do not submit an opening description because the real widget may create an operational checkpoint.

Run the complete DRG path on a protected preview connected to a non-production, `is_demo=true` firm fixture. Do not add a public production `qa` bypass and do not delete production checkpoint rows as test cleanup.

### 5.4 Browser viewport matrix

Run the critical rendered journeys at:

- 320 px mobile;
- 390 px mobile;
- 1440 px desktop.

At minimum, QA-01, QA-04, QA-10, and QA-12 run at all three widths. Other scenarios may run at 390 px and 1440 px unless a responsive defect is discovered.

Browser assertions:

- no nested vertical scroll container;
- iframe client height matches child document height within 2 px for three consecutive measurements 300 ms apart, within a maximum 3-second settling window;
- keyboard focus advances to the next question heading;
- every choice has an accessible name and a minimum 44 by 44 CSS-pixel target;
- Back and Skip are reachable and correctly labeled;
- no horizontal overflow at 320 px;
- the report heading and final section are both reachable through normal page scrolling.

### 5.5 Evidence package

Each release candidate produces:

- machine-readable fixture results;
- question-count summary by scenario;
- screenshots for the required viewport/scenario pairs;
- exact iframe/child height measurements for QA-12;
- a short exceptions table with expected, actual, severity, owner, and disposition;
- commit SHA, preview URL, test timestamp, and environment.

Store only fictional scenario evidence. Do not capture live user content.

Exception authority:

- Severity 0 or 1: release blocked; no exception acceptance.
- Severity 2: Adriano may accept a time-bounded exception in the evidence record with owner and due date.
- Severity 3: may ship as a recorded follow-up with owner and due date.

### 5.6 QA acceptance criteria

- [ ] QA-01 through QA-10 deterministic engine fixtures pass.
- [ ] QA-01, QA-04, QA-10, and QA-11 rendered component journeys pass.
- [ ] QA-01, QA-04, QA-10, and QA-12 protected-preview browser journeys pass.
- [ ] No scenario exceeds eight discovery questions.
- [ ] Routing rules pass for every Business path.
- [ ] No forbidden repeated question appears when the opening already contains the fact.
- [ ] Report facts and labeled inferences remain separated.
- [ ] EN/PT route and report-language contracts pass.
- [ ] Required viewport journeys pass keyboard, overflow, and height checks.
- [ ] Every exception is resolved or explicitly accepted before release.

## 6. Workstream 3 - Privacy-safe funnel analytics

### 6.1 Measurement questions

The first dashboard must answer:

- How many people start the flow?
- At which visible step do incomplete flows stop?
- What percentage reach review/report or contact capture?
- What percentage of real intake flows submit successfully?
- How many visible discovery questions do completed flows receive?
- What are median and 75th-percentile time-to-terminal-step?
- How often is free text used instead of a listed option?
- Are Main demo and live firm-widget results different?

Main demo and live firm-widget terminal metrics must remain separate. A demo ends at report-opened. A real intake ends at lead-submitted.

Normative metric definitions:

- A flow starts when the visitor submits the opening description, not when the iframe loads.
- The opening description is not a discovery question.
- A visible routing menu is a discovery question and counts when answered.
- `question_count` equals the engine's active `questionHistory.length` after a transition. It includes skipped visible questions and excludes the opening description.
- Back navigation may emit a repeated presentation with `is_revisit=true`; it does not create a new unique question or inflate the terminal question count.
- Restart emits `flow_restarted` on the old flow, then creates a new flow ID, resets sequence to zero, and restarts elapsed time.
- Elapsed time begins at `flow_started` and is measured with a monotonic browser clock.
- A demo reaches terminal success at `report_opened`. A firm widget reaches terminal success at `lead_submitted`; `contact_reached` is intermediate.
- A flow is abandoned when its last event is more than 24 hours old and it lacks the surface's terminal success event.
- Reach and completion rates use distinct started `flow_id` values as the denominator, except old flows explicitly terminated by `flow_restarted`; those are reported in restart rate and excluded from reach/completion denominators. The new post-restart flow is included normally. Event counts are never denominators.
- Cohorts use the server receipt date of `flow_started`. Store UTC; display reporting windows in `America/Toronto`.

### 6.2 Event taxonomy

Use these events only:

| Event | Trigger | Recorded dimensions |
|---|---|---|
| `flow_started` | The opening is accepted and discovery begins: live opening submit succeeds, or Main's `Run fictional Screen` passes validation | surface, locale, viewport bucket |
| `question_presented` | A new visible discovery question becomes active | step index, question count |
| `question_answered` | A visible question is answered | step index, answer mode only |
| `review_reached` | Main demo review or real widget pre-contact review is shown | question count, elapsed time |
| `report_opened` | Main demo report is opened | question count, elapsed time |
| `contact_reached` | Real widget contact form is shown | question count, elapsed time |
| `lead_submitted` | Real widget persistence confirms success | question count, elapsed time |
| `flow_restarted` | User explicitly starts over | prior step index |

Allowed `answer_mode` values: `listed_option`, `free_text`, `skip`. `question_presented` also carries `isRevisit`, default false.

Do not emit an `abandoned` browser event. Derive abandonment as a started flow without the relevant terminal event after 24 hours. This avoids relying on fragile unload behavior.

### 6.3 Event payload

The client payload is versioned and capped at 1 KB:

```ts
type ScreenFunnelEventV1 = {
  schemaVersion: 1;
  eventId: string;
  flowId: string;
  sequence: number;
  contextToken: string;
  event: ScreenFunnelEventName;
  stage: "opening" | "discovery" | "review" | "contact" | "report" | "done";
  stepIndex: number;
  questionCount: number;
  answerMode?: "listed_option" | "free_text" | "skip";
  isRevisit?: boolean;
  locale: "en" | "pt" | "other";
  viewport: "mobile_small" | "mobile" | "desktop";
  elapsedMs: number;
};
```

`flowId` is a random per-flow UUID stored in session memory/sessionStorage. It is not the engine lead ID and is never joined to contact or intake records. Events may arrive out of order; `sequence` reconstructs the client journey and provides idempotency.

The server page mints a short-lived HMAC-SHA-256 `contextToken` containing only `surface`, optional `firm_id`, issued-at, and expiry. The endpoint verifies it with a server-only secret and derives `surface` and `firm_id`; it never trusts those values from the event payload. Tokens expire after two hours and cannot authorize any operation except telemetry context validation.

### 6.4 Explicitly forbidden telemetry fields

The payload is a strict, flat object. Reject every additional property and every object or array value. The server route must reject, rather than ignore, payloads containing any of these fields or semantic equivalents:

- description, opening, answer, answerValue, freeText;
- question, questionId, slotId;
- matterType, practiceArea, band, report;
- name, email, phone, address;
- referrer, UTM values, gclid;
- IP address or user-agent string supplied by the client;
- engine state or lead ID;
- unsigned surface or firm identifiers.

The route must not log the request body on validation failure.

### 6.5 Collection endpoint

Add `POST /api/screen-funnel/event`:

- accepts only the exact allowlisted schema;
- rejects bodies over 1,024 UTF-8 bytes before JSON parsing;
- verifies the signed context token and derives surface/firm attribution from it;
- validates UUIDs, enum values, and these numeric limits: sequence 0 to 64, step index 0 to 8, question count 0 to 8, elapsed time 0 to 7,200,000 ms;
- applies the repository's existing IP-based rate limiter before body parsing, counting every request attempt toward 120 attempts per IP per 10 minutes without persisting the IP in analytics;
- inserts through the server-only Supabase admin client;
- returns `204` on success and a generic `400`, `409`, or `429` on failure;
- never blocks intake progression when telemetry fails;
- treats an identical retry for `(flow_id, sequence)` as success and returns `409` for a conflicting payload at the same sequence, while the widget continues normally.

The endpoint and platform configuration must not log request bodies. Record in the privacy review that transport infrastructure may process IP address and user agent even though neither is stored in `screen_funnel_events`.

### 6.6 Database model

Create `screen_funnel_events` with:

- `event_id uuid primary key`;
- `flow_id uuid not null`;
- `sequence smallint not null`;
- `surface text not null` with a check constraint;
- `firm_id uuid null` referencing `intake_firms(id)` with `ON DELETE SET NULL`;
- `event_name text not null` with a check constraint;
- `stage text not null` with a check constraint;
- `step_index smallint not null`;
- `question_count smallint not null`;
- `answer_mode text null` with a check constraint;
- `is_revisit boolean not null default false`;
- `locale text not null` with a check constraint;
- `viewport_bucket text not null` with a check constraint;
- `elapsed_ms integer not null`;
- `received_at timestamptz not null default now()`;
- unique constraint on `(flow_id, sequence)` for idempotency.

Database constraints also enforce:

- numeric ranges match the API limits;
- `marketing_demo` rows have `firm_id is null`;
- `firm_widget` rows have `firm_id is not null`;
- `report_opened` is valid only for `marketing_demo`;
- `contact_reached` and `lead_submitted` are valid only for `firm_widget`;
- `answer_mode` is present only for `question_answered`;
- `is_revisit=true` is valid only for `question_presented`.

Indexes:

- `(surface, received_at desc)` for dashboard windows;
- `(firm_id, received_at desc)` where `firm_id is not null`;
- `(flow_id, sequence)` is already covered by the unique constraint.

Security in the same migration:

- enable and force RLS;
- revoke all privileges from `anon`, `authenticated`, and `PUBLIC`;
- no public insert policy;
- no browser Supabase client access;
- operator reads only through authenticated server code.

Raw events are retained for 90 days. Add a daily route authenticated by the existing `CRON_SECRET`. It deletes at most 5,000 expired rows per transaction and at most 20,000 rows per invocation, reporting only counts and duration. Do not create long-term rollups in v1; add them only if volume or reporting history requires them.

### 6.7 Instrumentation helper

Create one reusable client helper/hook used by both widgets:

- generates and resets the per-flow ID;
- increments sequence exactly once per semantic transition;
- deduplicates `question_presented` across React rerenders;
- sends best-effort `fetch(..., { keepalive: true })` requests without delaying the UI transition;
- never receives engine state, answer value, question object, report, or contact data;
- is a no-op when the server-resolved `telemetryEnabled` prop is false.

The hook API should accept primitive metrics only. This makes it difficult to accidentally serialize legal content.

Use three server-only controls:

- `SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED`: enables the Main demo only;
- `SCREEN_FUNNEL_TELEMETRY_FIRM_ALLOWLIST`: comma-separated firm UUIDs, initially empty, then DRG only after the Main check;
- `SCREEN_FUNNEL_CONTEXT_SECRET`: signs the short-lived context token.

The server components for `/widget-public/demo` and `/widget-public/[firmId]` resolve their surface against these controls and pass only `telemetryEnabled` plus the signed context token into the client widget. Do not expose database credentials, the signing secret, or a privileged key through a public environment variable.

### 6.8 Disclosure and enablement gate

Before enabling telemetry on the Main demo, update its disclosure from an absolute no-storage statement to a precise distinction:

> Your fictional situation and answers are not submitted, stored, or sent to a firm. We may count content-free interaction steps to improve this demonstration; those events do not include what you type.

Use equivalent plain-language notice for the real widget or link to the firm's approved privacy notice. This plan does not decide the legal basis for analytics collection. Privacy-owner approval is an enablement gate.

Release sequence:

1. Deploy schema and endpoint with collection disabled.
2. Run endpoint security and forbidden-field tests.
3. Approve disclosure and privacy basis.
4. Set `SCREEN_FUNNEL_TELEMETRY_DEMO_ENABLED=true` while the firm allowlist stays empty; observe for 24 hours and confirm event shape and zero forbidden fields.
5. Add only the DRG firm UUID to `SCREEN_FUNNEL_TELEMETRY_FIRM_ALLOWLIST`.
6. Observe for seven days or until at least 30 started flows per surface, whichever is later.

Production flag changes are release actions. Record the approver, old value, new value, timestamp, and deployment that picked up the change.

### 6.9 Operator dashboard

Add a focused Screen Funnel section or route, separate from the existing band dashboard.

Authorization: v1 is operator-only and uses the existing `getOperatorSession` gate. It is not exposed in the firm portal. Server queries use the admin client only after operator authorization succeeds.

Filters:

- date range: 7, 30, 90 days;
- surface: Main demo vs firm widget;
- firm for live widgets only;
- locale and viewport bucket.

Metrics:

- started flows;
- review/report reach rate for demo;
- contact reach and successful submission rate for live widgets;
- median and p75 discovery-question count;
- median and p75 elapsed time;
- drop-off by visible step;
- listed-option vs free-text vs skip share.

Small-sample rule: show `Insufficient sample` instead of optimization guidance when fewer than 30 started flows match the selected filters.

Metric implementation rules:

- count one row per distinct `flow_id` at each reach milestone;
- compute elapsed and question percentiles from terminal events only;
- use the last event per flow for drop-off position after the 24-hour abandonment window;
- exclude restarted old flows from completion-rate denominators and show restart rate separately;
- calculate in UTC and present date boundaries in `America/Toronto`;
- label the output `directional product analytics`, because a public endpoint can still receive synthetic traffic despite signed context and rate limits.

### 6.10 Analytics acceptance criteria

- [ ] Endpoint rejects every forbidden field and nested forbidden field.
- [ ] No telemetry request contains user-entered content, contact data, matter classification, band, or report data.
- [ ] Duplicate `(flow_id, sequence)` events are idempotent.
- [ ] Analytics failure never blocks or changes the Screen flow.
- [ ] Main demo and firm-widget outcomes are reported separately.
- [ ] Abandonment is derived after 24 hours, not trusted from unload events.
- [ ] RLS, revokes, constraints, indexes, rate limiting, and 90-day retention tests pass.
- [ ] Dashboard metric definitions match fixture-derived expected totals.
- [ ] Collection stays disabled until disclosure and privacy approval are recorded.

## 7. Implementation phases and commits

### Phase 0 - Decision and baseline

- Register the experience-contract and content-free telemetry decision in the doctrine repository using the next free DR number.
- Capture current app/sandbox engine hashes, production URLs, and existing policy-test baseline.
- Confirm the analytics disclosure/privacy owner, production flag-change authority, and context-signing secret owner.

Commit: doctrine repository only. Push and PR under that repository's rules.

### Phase 1 - Typed policy and parity contract

- Add `WEB_EXPERIENCE_POLICY` with compatibility exports.
- Extend the existing engine policy test and mirrored fixtures.
- Add both rendered-surface contract tests.
- Port sandbox engine changes and contract fixtures into the app, then refresh the DR-058 manifest.

Commit: `test(screen): lock shared web experience contract [DR-XXX]`

### Phase 2 - QA harness and evidence

- Add the 12 fictional fixtures and runner.
- Add browser viewport checks for the critical scenarios.
- Add evidence output format and release checklist.
- Run app and sandbox suites plus preview journeys.

Commit: `test(screen): add cross-surface QA matrix [DR-XXX]`

### Phase 3 - Telemetry schema and protected API

- Create the migration through the Supabase migration command.
- Add RLS, revokes, constraints, indexes, and retention support.
- Add the event schema, protected API route, forbidden-field guard, rate limit, and route tests.
- Validate against fresh real Postgres in CI before any database application.

Commit: `feat(screen): add content-free funnel event intake [DR-XXX]`

### Phase 4 - Widget instrumentation and disclosure

- Add the primitive-only telemetry hook.
- Instrument Main demo and live widget semantic transitions.
- Update the Main demo disclosure and approved live-widget notice.
- Keep the collection feature flag off.

Commit: `feat(screen): instrument privacy-safe funnel stages [DR-XXX]`

### Phase 5 - Operator dashboard

- Add funnel queries, metric definitions, filters, percentiles, and small-sample handling.
- Add query and rendered-dashboard tests using deterministic event fixtures.

Commit: `feat(analytics): add Screen funnel dashboard [DR-XXX]`

### Phase 6 - Staged release and observation

- Push branch and open the app PR.
- Run full CI, preview QA, and real-Postgres migration validation.
- Merge only after explicit approval for that PR.
- Verify automatic production deployment.
- Enable telemetry in the staged sequence from section 6.8.
- Publish the seven-day or 30-flow observation report with no user content.

No direct production deploy or unpushed migration is permitted.

### Cross-repository merge order

1. Merge the decision-record PR so later code may cite the registered DR.
2. Push the sandbox engine branch and app branch with the same engine change.
3. Make both repositories' suites green before either engine branch is merged.
4. Merge the sandbox PR first because it is the engine source of truth.
5. Record the sandbox merge SHA in the app PR evidence and re-run app engine sync against that exact commit. App CI continues to use the committed DR-058 manifest; it does not fetch an unmerged sandbox branch.
6. Obtain explicit approval for the app PR and its additive production migration. The approval record must name the PR and authorize the migration version.
7. From the exact pushed app PR SHA, the release executor applies the additive migration through the approved Supabase release path before merging code that queries it. Verify `supabase migration list` shows the same filename version in the production ledger, and save the output in release evidence.
8. Merge the app PR and verify automatic Vercel production deployment with both telemetry flags disabled. The endpoint returns `204` without a database write when its surface is disabled; the dashboard shows `Analytics not initialized` if the table is unavailable during rollback or recovery.
9. Merge any required `caseloadselect-site` disclosure copy before enabling Main-demo telemetry.
10. Enable collection only through the section 6.8 gates.

If any repository advances during this sequence, update through the PR branch and rerun its complete required checks. Do not bypass branch protection or merge stale evidence.

## 8. Verification commands and gates

Executors must discover current package scripts before running them. The minimum gate is:

```text
npm run lint
npm run typecheck
npm test
bash scripts/check-engine-sync.sh
bash scripts/check-engine-manifest.sh
```

Also run:

- sandbox test/build scripts from its current `package.json`;
- focused widget component tests;
- focused telemetry route/security tests;
- fresh real-Postgres migration CI;
- browser QA matrix against the protected preview;
- production smoke after merge.

For Supabase implementation, check the current CLI with `supabase --help` and create the migration through `supabase migration new`. Do not invent or manually reuse a migration version.

## 9. Deliverables

1. Registered decision record.
2. Shared typed web-experience policy.
3. App and sandbox parity contract tests.
4. Twelve-scenario, explicitly layered QA fixture pack.
5. Browser QA runner and evidence package.
6. Content-free telemetry schema and protected server endpoint.
7. Shared widget telemetry helper.
8. Approved analytics disclosure copy.
9. Screen Funnel operator dashboard.
10. Production verification record and first observation report.

## 10. Out of scope

- Changing the 5 to 7 target or hard cap of 8.
- Changing band/scoring logic.
- Recording question text, question identity, answer values, matter type, practice area, or report content for analytics.
- Combining Main demo and live lead conversion into one headline rate.
- Replacing the operational `web_intake_sessions` recovery flow.
- Long-term warehouse, attribution, campaign, or revenue analytics.
- A/B testing before the baseline sample exists.
- DRG website redesign or new intake copy beyond the analytics disclosure.

## 11. Decision rule after observation

After seven days and at least 30 started flows per surface, produce a bounded recommendation using:

- report/contact reach rate;
- successful submission rate for real intake;
- median and p75 question count;
- median and p75 time;
- drop-off by visible step;
- free-text and skip share;
- QA exceptions and lawyer report-quality findings, when available.

Do not optimize from one anecdote or a small denominator. If drop-off concentrates on one step, first test that step's relevance, clarity, and interaction behavior. Change the global question budget only when the evidence points to the budget itself rather than one poor question or route.

## 12. Current security references

- Supabase Data API security: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase breaking-change changelog: https://supabase.com/changelog?types=breaking-change

These references must be refreshed at implementation time. As of 2026-08-22, no listed breaking change alters the table, RLS, or server-only insert design in this plan.
