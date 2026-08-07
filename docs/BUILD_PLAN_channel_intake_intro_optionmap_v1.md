# Build Plan: first-ask intro + LLM option-mapping fallback + F2 doc correction

**Authored:** 2026-08-07 (Opus session, after the 2026-08-06/07 production verification of the v1 fixes)
**Executor:** Sonnet session
**Predecessor:** `docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md` (F1/F2/F3, merged to main in PR #118, verified live on WhatsApp 2026-08-07)
**Operator steps:** Adriano approves the client-facing copy if he has not already; push/merge handled per session; Adriano sends the Messenger + Instagram cold-open tests

---

## 1. What this is

Three work items, one PR, three separate commits:

- **C1 (docs):** correct a false claim I shipped in the v1 build plan, the F2 code
  comment, and the F2 test header. The claim was that an `unknown` matter can
  never reclassify on a resume turn. Production disproved it the same day.
- **C2 (feature):** an intro message on the bot's first ask of every fresh
  conversation, so the questioning is framed before it starts. Operator request
  2026-08-07 after the WhatsApp verification: the first question currently lands
  with no setup at all.
- **C3 (feature):** a graceful path for replies to numbered questions that match
  none of the deterministic adapters — an LLM maps the lead's own words onto one
  of the offered options, and only if that also fails does the bot re-ask, with
  softened copy. Operator request, same session: "the system must be able to
  respond if they write anything else that is not listed."

### Production evidence backing C1 (read this before touching the docs)

Live WhatsApp conversation 2026-08-07 (operator's phone, DRG tenant, prod):
"i want to speak to a lawyer" → F2 guard asked for a description → "i have a
business and i want to formalize it" → **reclassified to
`business_setup_advisory`** → name captured lowercase → 10 discovery questions →
proper finalization. Persisted row `screened_leads.6ff7d438-2eda-42b4-be43-758df2c89bb1`:
band B, `multi_turn: true`, `questionHistory` length 10, axes value 5 / urgency 1 /
readiness 8 / complexity 2.

Why the v1 claim was wrong: the analysis covered the regex layers only.
`runEvidencePass` does no-op for `unknown` (slotEvidence.ts:24) and
`initialiseState` runs only on turn 1 — both true. But `llmExtractServer` runs on
resume turns, and `mergeLlmResults` (`src/lib/screen-engine/llm/extractor.ts`,
~lines 186-206) promotes from the `unknown` lane **explicitly ungated** by the
DR-069 `allowGeneralPromotion` option. The comment in that file spells it out:
"The 'unknown' lane is NOT gated by this option." So turn-2 reclassification is a
designed, working path. The only case where turn two finalizes thin is when the
LLM is disabled or errors (graceful degradation) — which is exactly the scenario
the existing F2 test pins, because its `llmExtractServer` mock returns empty.

---

## 2. Read before starting

- `docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md` — the predecessor plan,
  including its § F2 (which C1 corrects) and its stop-lines (inherited here).
- `src/lib/channel-intake-processor.ts` **on origin/main** (the local main
  checkout's working tree is on an unrelated feature branch; do not read the
  processor from there). Phases A/B/C in the header; the F2 guard block with the
  wrong KNOWN LIMITATION comment; the adapter chain on resume turns
  (applyPendingSlotReply → name capture → out-of-range digit → numeric → fuzzy →
  free-text → llmExtractServer).
- `src/lib/pending-slot-reply.ts` — `isUserGroundedFill` (line ~142) and the #172
  sticky-pending doctrine.
- `src/lib/channel-send.ts` — `buildContactCaptureFollowUp` (line ~113), copy
  quoted below.
- `src/lib/screen-llm-server.ts` — the pattern C3's new server helper must
  mirror: lives OUTSIDE `screen-engine/` for DR-033 reasons, GoogleGenerativeAI,
  `GOOGLE_AI_API_KEY` wins over `GEMINI_API_KEY`, model `gemini-2.5-flash`,
  graceful `{mode:'disabled'}` when no key, bounded retries on transient errors.
- `src/lib/screen-engine/types.ts:468` — slots discriminate on
  **`input_type`**: `'single_select' | 'free_text'` (not `type`).
- `src/lib/screen-engine/control.ts:1069` — `applyAnswer` stamps
  `source: 'answered', confidence: 1.0`, which is what makes a C3-mapped answer
  count toward the discovery floor.
- CLAUDE.md § Writing rules — all new copy below has been checked against them;
  do not paraphrase any quoted string.

## 3. Stop-lines (inherited from v1, plus one)

1. **No edits under `src/lib/screen-engine/`** (DR-033 byte-sync). Importing
   engine functions (`applyAnswer`, `SLOT_REGISTRY`, `getNextStep`) is fine;
   editing engine files is not. All three work items are processor-side by
   design. Needing an engine edit means the approach is wrong — stop.
2. **Branch off `origin/main` in a fresh worktree.** Do not touch the main
   checkout (dirty, on `feat/portal-article-hero-overlay`) and do not reuse
   `.wt-meta-channel-fixes` (orphaned directory, file handles stuck; it is dead,
   ignore it). Use a new name, e.g. `05_Product/.wt-intro-optionmap`.
3. **No composed Portuguese.** `pt.json` is a real, authored locale. New i18n
   keys ship with English fallbacks via the existing
   `i18n.widget_strings?.<key> || '<EN>'` pattern; the PT strings are authored by
   the operator from the live PT corpus later. Add a FOLLOWUPS row for each new
   key.
4. **Do not push or merge.** Same as v1.
5. **Do not widen C3 into interjection handling.** If the lead's off-list reply
   is a question back at the bot ("how much do you charge?"), C3 returns null and
   the softened re-ask fires. Actually answering lead questions mid-intake is a
   separate feature (see § 9); do not build it here.

## 4. Environment notes for this machine (learned the hard way in v1)

- Git operations that touch many files on D: (worktree add, reset, checkout) can
  exceed 2-3 minute timeouts. Run them backgrounded, never chained sleeps.
- A killed git operation leaves `index.lock` under
  `.git/worktrees/<name>/` — note the worktree metadata dir name mangles the
  leading dot to a dash (`.wt-foo` → `worktrees/-wt-foo`). Check the real path
  before deleting locks.
- `node_modules`: do not `npm ci` in the worktree. The lockfile matches the main
  checkout; create a junction (PowerShell `New-Item -ItemType Junction`, no admin
  needed — symlinks require admin on this machine) to
  `caseload-select-app/node_modules`. Verified working in v1.
- Full vitest suite ~70s once warm; first vitest invocation in a fresh worktree
  pays a long transform cost. Background anything over 2 minutes.

## 5. Execution flow

```
git fetch origin
git worktree add ../.wt-intro-optionmap -b feat/intake-intro-optionmap origin/main   # backgrounded
# junction node_modules
# C1, C2, C3 as separate commits, tests with each
npx vitest run src/lib/__tests__ src/lib/screen-engine/__tests__
npx tsc --noEmit
npx eslint <changed files>
bash scripts/check-engine-sync.sh          # must stay green (no engine edits)
# open PR; hand off for merge
```

---

## 6. C1 (docs): correct the false F2 limitation claim

Three places state or imply "matter_type can never reclassify on resume." All
three get corrected with the evidence from § 1. The merged v1 commit message
also carries the claim; commit messages are immutable — the correction note in
the v1 plan doc is the durable record.

1. **`docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md` § F2** (and the § 6 test
   spec that told the executor to test turn-2 reclassification as impossible).
   Edit in place, adding a dated correction block: what was claimed, why it was
   wrong (regex layers analyzed, LLM layer missed), the `mergeLlmResults`
   citation, and the 2026-08-07 field evidence. Do not silently rewrite — the
   correction should be visible as a correction.
2. **`src/lib/channel-intake-processor.ts`, the F2 guard's "KNOWN LIMITATION"
   comment block.** Replace with the accurate statement: the regex/evidence
   layers never reclassify on resume, but LLM extraction promotes from
   `unknown` by design (ungated per DR-069's own doc), so the normal outcome of
   the guard is ask → describe → reclassify → full discovery. The thin-finalize
   path on turn two exists only when the LLM is disabled or errors, and that is
   deliberate graceful degradation, not a limitation to fix.
3. **`src/lib/__tests__/channel-intake-processor-unknown-turn-one.test.ts`** —
   the file header's "documented limitation" narrative and the third test's
   name/comments. The test itself is correct for what it actually pins (its
   `llmExtractServer` mock returns empty, so it exercises the LLM-unavailable
   path); reframe it as exactly that: "turn two with LLM extraction unavailable
   finalizes rather than looping." Assertions stay unchanged.

No behavior changes in C1. Commit as `docs:`.

---

## 7. C2 (feature): first-ask intro

### Trigger

The intro fires exactly when `!isResume` (the processor's existing flag: no open
session existed for this sender). On a fresh turn, at most one of three sends can
be the first ask; prefix the intro to whichever fires:

1. **Phase B contact-capture ask** (`followUpText`, ~line 741 region).
2. **F2 unknown-matter opening question** (the guard block C1 just corrected).
3. **Phase C first discovery question** (`questionText` send, ~line 918 region).

A fresh turn that finalizes immediately (e.g. out_of_scope single-turn close)
sends no questions, so no intro — correct behavior, assert it in tests only if
cheap. No new state fields needed; `!isResume` is deterministic and the three
sites are mutually exclusive on a given turn.

### Copy (verbatim — do not paraphrase; checked against the writing rules)

Intro, i18n key `intro_first_ask`:

```
Thanks for reaching out. So a lawyer can review your situation, I will ask a few short questions. You can reply with the number of an option or answer in your own words.
```

Note it promises a review, not contact — "to put you in contact with a lawyer"
was considered and rejected against LSO 4.2-1 and the house CTA doctrine.

### Composition variants (the openers clash when the intro is present)

The existing asks carry their own openers ("Thanks for reaching out." on the F2
ask, "Got it." on the contact asks). With the intro prepended those read twice.
When (and only when) the intro fires, use opener-less variants:

F2 ask with intro, i18n key `describe_situation_short`:

```
To start, could you describe in a sentence or two what your situation is about?
```

Contact asks with intro — extend `buildContactCaptureFollowUp` with an options
arg (`{ firstAsk?: boolean }`) rather than string-stripping, keeping it the
single source of truth. Variants:

```
both:         First, could you share your name and the best phone or email for the firm to reach you?
name:         First, what name should the firm use when they reach out?
reachability: First, what's the best phone or email for the firm to reach you?
```

Phase C questions have no opener; intro + `\n\n` + question text as-is.

Resume-turn behavior is unchanged everywhere: full existing copy, no intro.

### Implementation shape

Small pure helper (suggested `src/lib/channel-intake-intro.ts`) exporting the
intro lookup (i18n-aware, EN fallback), unit-tested directly; the three call
sites compose `${intro}\n\n${body}`. Keep the processor diff minimal.

### Existing test that WILL break, on purpose

`channel-intake-processor-discovery.test.ts:182` asserts the first sent message
`not.toMatch(/^Thanks/)` — that guarded against the *closing* message leading.
The intro legitimately starts with "Thanks for reaching out." Change the
assertion to `not.toContain('reviewing your matter')` (same intent, closing-copy
specific). Do not delete the assertion.

Check the other suites' first-message assertions
(`unknown-turn-one`: `/describe/i` still matches the short variant ✓;
`phase-b-contact-loop`: mocks `buildContactCaptureFollowUp`, so add the
`firstAsk` arg to the mock signature but assertions hold). Verify rather than
trust this paragraph.

### New tests (suggested `channel-intake-processor-first-ask-intro.test.ts`)

- Fresh WhatsApp, classified matter, contact pre-filled (vendor-dispute fixture
  from the discovery suite) → single send, starts with the intro, contains a
  question mark after it.
- Fresh WhatsApp, unknown matter → intro + short describe variant; assert the
  string "Thanks for reaching out." occurs exactly once in the sent text.
- Fresh Messenger, no profile name → intro + "First, could you share your
  name..." variant; assert "Got it." absent.
- Resume turn (any fixture) → sent text does not contain the intro.

---

## 8. C3 (feature): LLM option-mapping fallback for off-list replies

### The gap today

On a resume turn, a reply to a numbered (`input_type: 'single_select'`) question
runs through: `applyPendingSlotReply` (digit, word-number, sentinel, fuzzy via
`fuzzyMatchOption`), then the getNextStep-routed adapters. If all miss, the
pending pointer survives, `isUserGroundedFill` is false, and Phase C fires the
sticky re-ask with "Sorry, I didn't get your last reply..." — which, once C2
promises "answer in your own words," becomes a broken promise for any phrasing
the deterministic matchers can't reach ("maybe my brother will run it with me").

`llmExtractServer` does run on that turn, but values it fills carry
`llm_inferred` provenance, which `isUserGroundedFill` correctly refuses — the
provenance doctrine (engine selector docs) is that the model guessing is not the
user answering. A mapping of the user's own reply to the question we just asked
is different in kind: the user DID answer; the LLM only translates their wording
onto the option list. That earns `answered` provenance via `applyAnswer`.

### New server helper

New file (suggested `src/lib/llm-option-map.ts`, plus a pure sibling for the
prompt/parse so tests don't need the SDK), mirroring `screen-llm-server.ts`
conventions exactly: `server-only` semantics, `GOOGLE_AI_API_KEY` first then
`GEMINI_API_KEY`, `gemini-2.5-flash`, temperature 0, JSON response schema,
graceful `{ value: null, mode: 'disabled' }` with no key, single retry on
transient errors (cheaper than the extractor's 3 — this call is latency-visible
to the lead).

Contract:

```ts
llmMapOptionReply(args: {
  questionLabel: string;
  options: Array<{ label: string; value: string }>;
  reply: string;
  language: string;
}): Promise<{ value: string | null; mode: 'live' | 'disabled' | 'error' }>
```

Prompt rules (the pure builder encodes these): pick an option ONLY when the
reply's meaning clearly selects it; a question back, an off-topic remark, or a
genuinely ambiguous reply returns null; never invent values; reply may be in any
language. Verify the actual option-carrying field name on `SlotDefinition`
before wiring (expected `options` with label/value pairs — confirm in
`types.ts` / `slotRegistry`).

### Processor insertion point

After the `applyFreeTextAnswerMapping` block and **before** the
`llmExtractServer` block (order matters: Phase C computes `getNextStep(state)`
later, so an answer applied here is naturally reflected in the next question —
inserting inside Phase C's pending block instead would leave a stale `nextStep`;
do not put it there).

Guarded shape:

```ts
let pendingLlmMapped = false;
if (isResume && !pendingConsumed && !nameCaptureConsumed) {
  const pid = state.pendingAskedSlotId;
  const pSlot = pid ? SLOT_REGISTRY.find((s) => s.id === pid) : undefined;
  if (
    pSlot &&
    pSlot.tier !== 'contact' &&
    pSlot.input_type === 'single_select' &&
    pSlot.applies_to.includes(state.matter_type as never) &&
    !isUserGroundedFill(state, pid)
  ) {
    const mapped = await llmMapOptionReply({ ... });
    if (mapped.value && pSlot.options?.some((o) => o.value === mapped.value)) {
      state = applyAnswer(state, pid, mapped.value);   // source 'answered' — counts toward the floor
      state = { ...state, pendingAskedSlotId: null };
      pendingLlmMapped = true;
    }
  }
}
```

The membership check before `applyAnswer` is mandatory — never feed an
LLM-invented value into the engine. On success, add `&& !pendingLlmMapped` to
the `llmExtractServer` condition (the turn is consumed, same doctrine as
`nameCaptureConsumed`; also saves the second Gemini call). On null/error, change
nothing — the pointer survives and the sticky re-ask fires as today.

Cost/latency note for the report: one extra Gemini Flash call, only on turns
where every deterministic matcher missed; when it succeeds it replaces the
extractor call that would have run.

### Softened re-ask copy

Update the clarifier fallback in the Phase C `clarifyReask` block (key
`didnt_catch` stays), verbatim:

```
Thanks, I want to make sure I record this correctly. Could you reply with the number of the option that fits best?
```

By the time this fires, the LLM also failed to map — asking for a number at that
point is honest, not a contradiction of the intro.

### Tests (suggested `channel-intake-processor-option-map.test.ts` + pure unit file)

Mock the new helper module. Resume fixture with a pending single_select slot
(pick a real one from SLOT_REGISTRY for the business_setup lane):

- Mapped: helper returns a valid option value → slot filled with
  `source: 'answered'`, pointer cleared, next send is a NEW question (not the
  clarifier), `llmExtractServer` not called, floor counting includes the answer.
- Null: clarifier re-ask sent with the new copy, pointer retained.
- Error/disabled: identical to null — never crashes the turn.
- Membership guard: helper returns a value not in the slot's options → treated
  as null.
- Pure unit tests: prompt builder includes question, all options, the reply;
  parser handles valid value / null / malformed JSON.

---

## 9. Explicitly out of scope (record, don't build)

- **Interjection handling:** answering a lead's own question mid-intake ("do you
  charge for the first call?") secretary-style, then resuming. Real feature,
  own plan. FOLLOWUPS row.
- **Turn-2 thin-finalize when the LLM is down:** deliberate degradation; no
  change.
- **PT strings for the four new/changed keys** (`intro_first_ask`,
  `describe_situation_short`, contact variants, `didnt_catch` revision):
  operator-authored later. FOLLOWUPS row per stop-line 3.
- **Per-firm intro phrasing:** `buildContactCaptureFollowUp`'s own doc already
  anticipates per-firm tone config; same applies to the intro someday. Not now.

## 10. Operator coordination (surface in the delivery report)

1. Push + PR + merge handled per session (branch protection: six required
   checks, strict up-to-date-with-main — expect a re-run if main moves).
2. After deploy: **Messenger and Instagram cold-open tests are still owed from
   v1 § 10** — Instagram has never been tested end-to-end. This PR's intro will
   appear in those tests; verify it reads correctly in the Messenger UI.
3. **Junk-row purge, after those tests pass** (supabase MCP, project
   `ssxryjxifwiivghglqer`):
   - `screened_leads.6464abe5-4f15-4c09-8465-015769a5ae0d` (Aug 6 WhatsApp junk)
   - `channel_intake_sessions` row, channel facebook, sender
     `26924934080492300` (Aug 6 Messenger loop session)
   - `screened_leads.6ff7d438-2eda-42b4-be43-758df2c89bb1` (Aug 7 verification
     run — operator confirms he does not want it kept for reference)
   - the Sarah Patel test leads outstanding since the May App Review prep
   - whatever rows the Messenger/IG cold-opens and any C2/C3 verification
     messages create
4. The intro changes the conversation captured in the **App Review screencasts**
   — record them only after this PR is live so the videos match production
   behavior.

## 11. Delivery report + bookkeeping

Five-section engine-investigation format per CLAUDE.md. Append FOLLOWUPS rows
(PT copy keys; interjection-handling feature; anything left open) to
`00_System/FOLLOWUPS.md` and mirror a Followups block below. Update
`docs/app-review/Operator_Execution_Checklist.md` only if the screencast gating
note needs the new PR reference.

---

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-08-07 | This plan | Intro + LLM option-mapping + F2 doc correction authored for Sonnet; blocks screencast recording (videos must show the intro) | H | src/lib/channel-intake-processor.ts; src/lib/channel-send.ts; src/lib/llm-option-map.ts (new); docs | Execute C1-C3; merge; then Messenger+IG cold-open; then purge; then record | Sonnet | Open |
| 2026-08-07 | C2/C3 copy | Four i18n keys ship EN-only (intro_first_ask, describe_situation_short, contact firstAsk variants, didnt_catch revision); PT must be authored from the live corpus, never composed | M | src/lib/screen-engine/i18n/pt.json; processor fallbacks | Author PT before any PT-language lead hits a first ask | Adriano | Open |
| 2026-08-07 | C3 scope cut | Lead questions/objections mid-intake ("how much do you charge?") still get the re-ask, not an answer; interjection handling is a real missing feature | M | channel-intake-processor.ts; post-finalization-followup.ts (sibling pattern) | Scope a secretary-style interjection feature as its own plan | Adriano | Open |
| 2026-08-07 | C1 evidence | v1 plan § F2, the merged F2 code comment, and the F2 test header all claimed turn-2 reclassification is impossible; production run 6ff7d438 (2026-08-07) and mergeLlmResults' ungated unknown-lane promotion disprove it | M | docs/BUILD_PLAN_meta_channel_intake_fixes_v1.md; channel-intake-processor.ts; channel-intake-processor-unknown-turn-one.test.ts | C1 corrects all three; merged commit message stays wrong (immutable), plan doc carries the correction record | Sonnet | Open |
