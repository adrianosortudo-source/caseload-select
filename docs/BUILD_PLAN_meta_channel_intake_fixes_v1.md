# Build Plan: Meta channel intake fixes (WhatsApp zero-question close + Messenger contact loop)

**Authored:** 2026-08-06 (Opus session, from two live field failures)
**Executor:** Sonnet session
**Operator steps:** Adriano pushes and deploys; Adriano sends the live test messages
**Status at authoring:** all three defects reproduced against production, root causes confirmed from source and from persisted rows

---

**CORRECTION (2026-08-07, added by the follow-up session, see
`docs/BUILD_PLAN_channel_intake_intro_optionmap_v1.md` § 1 and C1):** § 6 (F2)
below claims turn-2 reclassification of an `unknown` matter is impossible on
resume turns. That claim analyzed only the regex layers (`initialiseState`
turn-1-only, `runEvidencePass` no-op for `unknown`) and missed that
`llmExtractServer` + `mergeLlmResults` run on every resume turn and promote
matter_type away from `unknown` **explicitly ungated by design** — the DR-069
comment in `screen-engine/llm/extractor.ts` says so directly. The claim is also
internally inconsistent within this document: compare the third test-spec
bullet at the end of § 6 ("the exception still works on turn two", i.e.
finalizes) against the fourth bullet immediately after it ("the matter
reclassifies... and discovery continues") — those two bullets contradict each
other, and the shipped code/comment/test followed the wrong one. Production
disproved it live 2026-08-07: WhatsApp row
`screened_leads.6ff7d438-2eda-42b4-be43-758df2c89bb1` reclassified from
`unknown` to `business_setup_advisory` on the very next turn, in the same
response, and ran a full 10-question discovery to a band B brief. The real,
narrower behavior: reclassification happens in the same turn as the lead's
descriptive reply (LLM extraction runs before Phase C in the same function
call); the finalize-while-still-unknown path fires only when LLM extraction is
unavailable or errors that turn — deliberate graceful degradation, not a gap.
The code comment and the test file have been corrected accordingly; this
document is left as originally written below except for this notice, since the
merged commit message is immutable and this file is the durable record of what
was actually claimed and why it was wrong.

---

## 1. What this is

Three defects that make CaseLoad Screen unusable on all three Meta channels. Both
failures below were produced by the operator on 2026-08-06 against the live DRG
tenant on the test assets. Neither is a plumbing failure: Meta delivered the
message, the webhook fired, the engine ran, and a reply was sent. The conversation
logic is what is wrong.

This work blocks the Meta App Review screencasts. The screencasts must show a
working end-to-end intake, and today they would record these failures.

### Failure 1 — WhatsApp closes after zero questions

Operator sent "i want to speak to a lawyer". The bot replied immediately with the
finalization message ("Thanks there, a lawyer is reviewing your matter...").

Persisted row `screened_leads.6464abe5-4f15-4c09-8465-015769a5ae0d`:

```
matter_type: unknown        band: C
four_axis:   value 0, urgency 0, readiness 0, complexity 0, readinessAnswered false
slots:       client_name "A D" (profile_metadata), client_phone +16475492106 (system_metadata)
multi_turn:  false          follow_up_count: 0        questionHistory: []
```

A worthless brief and a dead-end conversation.

### Failure 2 — Messenger loops on the name

Operator sent "i want to speak to a lawyer", then "adriano\n6475492106", then
"adriano". The bot asked for the name three times and never captured it.

Persisted row `channel_intake_sessions` (channel `facebook`, sender_id
`26924934080492300`):

```
follow_up_count: 3 / max_follow_ups: 3      finalized: false
slots:      client_phone "+16475492106" (source explicit)
            client_name  ABSENT
matter_type: unknown        contactCaptureStarted: false
input: "i want to speak to a lawyer\n\nadriano\n6475492106\n\nadriano"
```

The two failures split on what the platform hands us. WhatsApp supplies name and
phone, so the contact gate passes and the lead falls into Failure 1. Messenger
supplies neither, so the gate fails and the lead falls into Failure 2. Instagram
behaves like Messenger and is expected to loop identically; it has not been
tested yet.

---

## 2. Read before starting

- `src/lib/channel-intake-processor.ts` — the whole file. Phases A/B/C are
  documented in the header comment (lines 1-30). The bugs live in the seam
  between Phase B and Phase C.
- `src/lib/discovery-floor.ts` — the floor doctrine and `EARLY_FINALIZE_MATTERS`.
- `src/lib/contact-extraction.ts` — `BARE_NAME_RE` and
  `tryExtractCaptureContactName`.
- `src/lib/screen-engine/control.ts:960` — READ ONLY. Do not edit (see stop-lines).
- `CLAUDE.md` § Writing rules — the new question copy is subject to all of them.

---

## 3. Stop-lines

Stop and report back rather than working around any of these.

1. **Do not edit anything under `src/lib/screen-engine/`.** That directory is
   byte-for-byte synced with the sandbox at
   `CaseLoadScreen_2.0_2026-05-03/src/engine/` per DR-033, and editing it drags
   in a paired sandbox edit plus both test suites. All three fixes below are
   deliberately scoped to processor-side files so no sync is needed. If a fix
   appears to require `control.ts`, that is a signal the approach is wrong; stop
   and escalate.
2. **Do not branch off the current working branch.** The repo is on
   `feat/portal-article-hero-overlay`, one commit ahead of its remote and
   carrying a large set of untracked files. Cut a clean branch off
   `origin/main`.
3. **Do not invent Portuguese copy.** If the new question string needs a PT
   translation, stop and flag it. PT is authored from the live PT corpus, not
   composed. Ship the English string plus the existing fallback mechanism and
   surface the PT gap in the delivery report.
4. **Do not widen `EARLY_FINALIZE_MATTERS` or remove `unknown` from it.** The
   exception is correct after the lead has been asked. Only the turn-one case is
   wrong. See F2.
5. **Do not push or deploy.** Adriano does both.

---

## 4. Execution flow

```
git fetch origin
git checkout -b fix/meta-channel-intake origin/main
# F1, F2, F3 with tests, committed separately
npm run lint && npm run typecheck && npx vitest run
bash scripts/check-engine-sync.sh     # must stay green; proves no engine edits
# open PR, hand back to Adriano
```

Commit each fix separately so any one can be reverted alone.

---

## 5. F1 (HIGH): Phase B must set `contactCaptureStarted`

**The bug.** A circular dependency between the processor and the engine.

1. Contact gate fails, Phase B sends the contact-capture follow-up.
2. Phase B persists the engine state verbatim
   (`channel-intake-processor.ts:776-791`), setting neither
   `contactCaptureStarted` nor `pendingAskedSlotId`. Compare Phase C at lines
   932-937, which sets both.
3. Next inbound arrives. The processor decides whether to parse the reply as a
   name by calling `getNextStep` and checking for `capture_contact(client_name)`
   (lines 428-437).
4. `control.ts:960` gates that entire branch on `if (state.contactCaptureStarted)`,
   which is still false. The branch never runs, so `nameCaptureContext` stays
   false.
5. Without that flag, `applyContactExtractionToState` uses the default path,
   whose `BARE_NAME_RE` requires a leading capital. The name is not captured.
6. Gate fails again, Phase B re-asks. Loop until `MAX_FOLLOW_UPS` (3).

**The fix.** In the Phase B success path at `channel-intake-processor.ts:774-791`,
persist `{ ...state, contactCaptureStarted: true }` rather than `state`, on both
the `updateChannelSession` and `createChannelSession` branches.

**Explicitly out of scope for F1: do not also set `pendingAskedSlotId`.**
`applyPendingSlotReply` skips contact-tier slots by design, so the pointer would
be inert here, and setting it adds an interaction with the sticky-reask logic at
lines 866-882 for no benefit. `contactCaptureStarted` alone closes the chain.

**Secondary benefit to verify, not to build:** with the flag set, the engine's
weak-name doctrine at `control.ts:982-991` starts working on these channels for
the first time. A weak profile name like "A D" should now trigger a name-capture
step instead of being accepted as identity. Confirm this in the F1 test rather
than assuming it.

**Tests.** New cases in
`src/lib/__tests__/channel-intake-processor-name-capture-resume.test.ts`:

- Phase B send persists `contactCaptureStarted: true`.
- Full two-turn Messenger sequence: no profile name, turn 1 "i want to speak to a
  lawyer" asks for contact, turn 2 "adriano" captures `client_name` = "Adriano"
  and does NOT re-ask.
- WhatsApp-shaped state with weak profile name "A D" plus phone triggers a
  name-capture step rather than accepting "A D".

**Note on existing coverage.** That test file already seeds
`contactCaptureStarted: true` in its fixture (line 179), which is precisely the
state Phase B never produces in production. That is why the suite is green while
the channel is broken. Leave the existing cases alone but add the cases above
that start from the real Phase B state.

---

## 6. F2 (HIGH): turn-one guard for `unknown` matter type

**The bug.** `discovery-floor.ts` puts `unknown` in `EARLY_FINALIZE_MATTERS`, and
`meetsDiscoveryFloor()` returns `true` immediately for it. The documented
rationale is that an unclassifiable matter has nothing matter-specific to ask.
That holds after the lead has described a situation. It is wrong on turn one of a
messaging channel, where the opening line is a greeting.

Path: `channel-intake-processor.ts:842` sets `floorMet = true`; `getNextStep`
returns a non-asking type because there is no matter; the `else if (!floorMet)`
fallback at line 896 is therefore skipped; `slotToAsk` stays undefined; control
falls to line 980 and finalizes.

The web widget never hits this because its hero prompt asks the person to
describe their situation before they type. WhatsApp has no such prompt.

**The fix.** Inside the `inDiscoveryPhase` block, before the floor is consulted:
if `state.matter_type === 'unknown'` and `discoveryCount === 0`, ask an opening
description question and return as an ask (mirroring the existing Phase C send +
session-persist + return shape at lines 918-961, including setting
`pendingAskedSlotId`). Turn two onward, the existing exception stands unchanged.

Do this in the processor. Do not change the semantics of `meetsDiscoveryFloor`,
which is shared.

**Question copy (use verbatim):**

```
Thanks for reaching out. Before a lawyer reviews this, could you describe in a
sentence or two what your situation is about?
```

Checked against the writing rules: no em dashes, no banned vocabulary, no
rule-of-three, no italics, no outcome promise, no time-relative reply promise,
LSO Rule 4.2-1 safe ("a lawyer reviews" is the honest next step). Do not
paraphrase it.

Wire it through the i18n layer following the exact pattern used for the
clarifier at lines 913-915 (`i18n.widget_strings?.<key> || '<English fallback>'`).
If the PT locale has no entry, see stop-line 3.

**Tests.** New file
`src/lib/__tests__/channel-intake-processor-unknown-turn-one.test.ts`:

- `matter_type: 'unknown'`, `discoveryFollowUpCount: 0`, contact gate satisfied
  → asks the description question, does not finalize, persists a session.
- `matter_type: 'unknown'`, `discoveryFollowUpCount: 1` → finalizes as before
  (the exception still works on turn two).
- `matter_type: 'out_of_scope'`, turn zero → finalizes as before (untouched).
- Turn two of the WhatsApp repro: after the guard asks and the lead replies with
  a real description, the matter reclassifies away from `unknown` and discovery
  continues.

---

## 7. F3 (MEDIUM): lowercase bare-name replies

**The bug.** `contact-extraction.ts:57`:

```js
const BARE_NAME_RE = /^[A-Z][a-zA-Z'’\-]{1,29}(?:\s+[A-Z][a-zA-Z'’\-]{1,29}){0,2}$/;
```

The leading-capital requirement means a lowercase reply fails the default
extraction path. People type their name lowercase in chat constantly. This is
independent of F1: even with F1 shipped, the default path still runs whenever
`nameCaptureContext` is false.

Note `tryExtractCaptureContactName` (the `nameCaptureContext` path) already
handles case correctly via `titleCase`, so F3 only concerns the default path.

**The fix.** Make `BARE_NAME_RE` case-insensitive on the first letter of each
token and title-case the captured value before it is written to the slot, so
stored names stay normalised. Keep every existing guard: the anchoring, the
1-3 token limit, the 2-30 char per-token bound, `NAME_BLOCKLIST`, and
`isWeakName`. The point is to accept "adriano", not to loosen what counts as a
name.

Do not touch the `email/phone must also be present` guard on the default path.
That guard is what stops "Sarah Patel as executor" from being read as a name in a
matter description, and F1 already covers the name-only reply case.

**Tests.** Extend `src/lib/__tests__/contact-extraction.test.ts`:

- "adriano 6475492106" → name "Adriano", phone "+16475492106".
- "ADRIANO DOMINGUES" plus a phone → name "Adriano Domingues".
- Regression guard: a matter description containing a capitalised name and no
  contact info still does NOT set `client_name`.
- Regression guard: blocklist and `isWeakName` rejections still hold in lowercase
  ("yes", "ok", "a d").

---

## 8. F4 (INVESTIGATE, do not fix blind): Messenger sent no profile name

The Messenger session has no `client_name` at all, where the code plainly expects
a profile-derived one (`control.ts:973-981` names "Messenger first+last" as a
profile_metadata source). Two candidate explanations:

1. Profile name requires a permission we do not hold until App Review grants
   advanced access, in which case it resolves itself on approval.
2. A token or field-request problem in `messenger-send.ts` / the intake route.

Determine which, with evidence, and write it up. Do not change behavior under
this item. If it is (1), F1 covers us anyway, because the loop is fixed whether
or not a profile name arrives.

---

## 9. Operator steps (Sonnet cannot do these)

Surface these in the delivery report:

1. Push the branch and merge the PR.
2. Confirm the Vercel production deploy is READY.
3. Send the live test messages for verification (section 10).

---

## 10. Live verification after deploy

All three channels, one fresh conversation each, from a sender with no existing
open session. Cold-open with a greeting, not a description, since that is the
case that broke.

| Channel | Expected |
|---|---|
| WhatsApp | "i want to speak to a lawyer" gets the description question back, not a finalization |
| Messenger | Same, and a lowercase one-word name reply is accepted on the first try |
| Instagram | Same as Messenger (first ever test of this path) |

Then for one channel, carry the conversation through to a finished brief and
confirm `screened_leads` shows a real `matter_type`, non-zero axes, `multi_turn:
true`, and a non-empty `questionHistory`.

**Data cleanup after verification passes.** Purge the two junk rows from the
2026-08-06 testing via supabase MCP:

- `screened_leads.6464abe5-4f15-4c09-8465-015769a5ae0d`
- the `channel_intake_sessions` row for sender `26924934080492300`

Also purge any rows the verification run itself creates, plus the older Sarah
Patel test leads still outstanding from the May App Review prep.

---

## 11. Delivery report + bookkeeping

Report in the five-section engine-investigation format per CLAUDE.md: root cause,
exact code path affected, recommended fix, tests added, impact analysis on
existing rows. Note that band-shifting deploys never recompute historical rows,
so no backfill is implied by any of this.

Append rows to `00_System/FOLLOWUPS.md` for anything left open, and mirror a
Followups block into this file's last section.

Update the App Review checklist at
`docs/app-review/Operator_Execution_Checklist.md` once verification is green, so
the screencast step is unblocked with a dated note.

---

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-08-06 | This plan | Three Meta-channel intake defects authored for Sonnet execution; blocks Meta App Review screencasts | H | src/lib/channel-intake-processor.ts; src/lib/discovery-floor.ts; src/lib/contact-extraction.ts | Execute F1-F3, investigate F4; Adriano pushes and deploys | Sonnet | Open |
| 2026-08-06 | F2 copy | New opening description question needs authored PT, not composed; English ships with fallback | M | i18n locale files; channel-intake-processor.ts | Author PT from the live PT corpus before any PT-language lead hits the guard | Adriano | Open |
| 2026-08-06 | F4 | Messenger supplied no profile name where the code expects one; cause unconfirmed | M | src/lib/messenger-send.ts; src/app/api/messenger-intake | Determine whether this is a pending-permission artefact or a token defect | Sonnet | Open |
| 2026-08-06 | Test coverage gap | channel-intake-processor-name-capture-resume.test.ts seeds contactCaptureStarted=true, the exact state Phase B never produces, so the suite stayed green through a fully broken channel | M | src/lib/__tests__/ | When adding F1 cases, start fixtures from real Phase B output rather than hand-seeded engine state | Sonnet | Open |
