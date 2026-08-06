---
doc-type: build-plan
title: Firm Voice Builder Interactive Tool, v1
version: v1
date: 2026-07-17
author: Claude (Fable 5) for Adriano Domingues
consumer: Sonnet 5 (executing agent)
companions: >
  Version3_CaseLoadSelect/LeadMagnet_FirmVoiceBuilder_v1.md (the fixture-tested spec this build
  supersedes as delivery surface; becomes v2 in Phase 0);
  09_Internal/ANTI_AI_WRITING_STYLE.md (Wikipedia field guide, source for the blocklist expansion);
  C:\Users\adria\OneDrive\Desktop\VOICE_PROFILE_Adriano.md (the operator's own 100-question taste
  interview; source for the interview-conduct and output-structure upgrades; copy into 09_Internal/
  as part of Phase 0);
  04_Playbooks/01_Authority/PB_Authority_LeadMagnetProduction_v1.html (gate doctrine, deferred);
  DR-089 (consent principle, deferred)
status: Ready for execution
---

# Build Plan: Firm Voice Builder Interactive Tool v1

## 0. What this is

The Firm Voice Builder pivots from a copy-paste prompt (parked; code sits uncommitted in the
website repo) to an interactive tool: a lawyer answers an AI-driven interview in the browser,
Gemini conducts it, and the tool renders a finished Firm Voice Profile. Same product as the
CaseLoad Screen demo in spirit: the tool IS the proof of craft.

Operator decisions already made in conversation (2026-07-17): no email gate yet, no GHL wiring
yet, Gemini as the model (same as every other tool), and the taste-interviewer upgrades below
are approved for incorporation. Do not re-litigate any of these.

The interview logic itself was already fixture-tested once (dry run, Claude-on-Claude): pacing,
adaptive skipping, and calibration rounds passed; one real bug (fee question missing before the
fee calibration round) was found and fixed in the v1 source. This build ports that logic to
Gemini and must re-verify on Gemini, because Gemini follows multi-turn pacing instructions
differently than Claude.

## 1. Locked decisions

| # | Decision | Locked value |
|---|---|---|
| L1 | Home | `caseload-select-app` (only project holding `GEMINI_API_KEY`; the website repo structurally cannot). Page at `(marketing)/tools/firm-voice-builder/page.tsx`, components in `src/components/firm-voice-builder/` (outside the frozen tree, seo-check precedent), API under `src/app/api/tools/firm-voice-builder/`. |
| L2 | Model | `gemini-2.5-flash` via existing `GEMINI_API_KEY`. Env override `FIRM_VOICE_BUILDER_MODEL` (Content Studio precedent after the retired-model 404 incident). Reuse the existing Gemini client pattern (see decision tree D1); no new vendor client. |
| L3 | State | Stateless server. The browser holds the full transcript and sends it every turn. Zero database reads or writes, zero migrations, nothing persisted server-side. Resume via `localStorage`. This is also the privacy story: answers are processed to run the interview and are not stored on our servers. That line appears in the UI. |
| L4 | Budgets | 25 primary questions (spec-enforced); pushback reframes, calibration picks, and proof-feedback turns do not count against it. Server hard caps: 60 interviewer turns per transcript, 30,000 chars per single answer, 200,000 chars total transcript. Friendly 400s past caps. |
| L5 | Protocol markers | Every interviewer message begins `[SECTION:n]` (n = 1..7), stripped by the UI and driving the progress rail. The finished profile is wrapped in `===FIRM_VOICE_PROFILE_START===` / `===FIRM_VOICE_PROFILE_END===` on its own lines. UI parses deterministically; a missing section tag falls back to last known section. |
| L6 | First message | Hardcoded client-side (the Section 1 opener verbatim from the spec). No API call on page load. |
| L7 | Deferred | No email gate, no consent capture, no GHL forward, no analytics events in this build. The gate later lands before the profile reveal (screen-demo pattern). |
| L8 | Confidentiality | The tool invites redaction before pasting samples ("remove client names; the tool does not need them"), the system prompt forbids reproducing client-identifying details in the profile or proof pieces, and the no-storage architecture backs the claim. This is new versus v1 and non-optional: the audience is lawyers pasting client emails. |
| L9 | Interview conduct v2 | Pushback once per vague answer with a make-it-concrete reframe demanding an example; contradiction callouts in the moment (samples versus self-description, quoting the lawyer's own words); thread-following (up to 2 follow-ups off the section spine, then return); one reframe before accepting "I don't know". Direct and insistent, never hostile: the taste-interviewer register at roughly 70% intensity, because a lawyer being interrogated by a free tool bounces. |
| L10 | Output spec v2 | Frequency labels on every profile rule (HARD RULE / STRONG TENDENCY / LIGHT PREFERENCE; Ontario rails are HARD RULES by definition); Quick Reference Card (Always / Never / Signature phrases quoted verbatim from the lawyer's samples / Voice calibration quotes); What Matters Most top 3; the litmus test ("does this sound like something I would actually write, or an AI trying very hard to imitate me; less imitation, more inhabitation"); the workflow instruction (the lawyer gives a topic plus 3 to 5 loose bullets, the AI writes the piece in their voice); format adaptation folded into the register-shifts part. Transcript offered as a secondary markdown download for the quarterly re-run. |
| L11 | Blocklist v2 | Three tiers. Vocabulary: the existing v1 word list carried verbatim (do not retype those lines; see stop-line S6). Constructions: add superficial present-participle analyses, false ranges, elegant variation, vague attributions, significance inflation, and em dash as crutch, sourced from the field guide's Language and Content sections. Formatting: title-case headings, emoji, bold overuse, inline-header vertical lists, from the field guide's Style section. |
| L12 | Language | English-only interview in v1. Multilingual interview logged as a followup, not built. |
| L13 | Question count semantics | "25 questions or fewer" counts primary questions only. The spec states this explicitly (the fixture QA flagged the ambiguity). |
| L14 | Ship mechanics | Branch, PR, CI green, merge and deploy when every gate in Phase 3 passes (standing autonomous precedent). Known non-blocker: the real-Postgres "Publication concurrency integration tests" check has been red on main for 3+ merges (pre-existing migration-ordering break, documented in FOLLOWUPS 2026-07-13); a diff with zero SQL does not need it green. Prod smoke test after deploy. |

## 2. Phase 0: Spec v2

Create `Version3_CaseLoadSelect/LeadMagnet_FirmVoiceBuilder_v2.md` (v1 stays on disk as history).
The v2 file is the canonical spec; the code's system prompt is a port of it. Sync discipline:
edit the spec first, then port. The port lives in `src/lib/firm-voice-builder/system-prompt.ts`
with a header comment naming the source file.

Content deltas from v1, all of them already approved:

1. Delivery reframe: primary surface is the interactive tool at `/tools/firm-voice-builder`;
   the copy-paste prompt remains a regenerable secondary artifact (parked).
2. Interview rules gain five entries (pushback, contradiction callout, thread-following,
   "I don't know" reframe, confidentiality) per L9 and L8. Rule 2's budget language restates
   counting per L13.
3. Section 1 keeps the fee-structure question (already added to v1 after the fixture run).
4. Section 2 adds the redaction invitation before the paste requests.
5. Section 6 adds one question: describe a line from another lawyer's website or ad that makes
   you cringe, and why. (The aesthetic-crimes category earning its one slot.)
6. Section 7 (Build It) restructures per L10 and L11. The Ontario rails text and the vocabulary
   blocklist lines carry over verbatim from v1.
7. Protocol additions for tool mode: the `[SECTION:n]` tag rule and the profile markers (L5),
   stated inside the prompt so the model emits them.
8. The v2 file carries its own Followups block (Doctrine Rule 11).

Also in Phase 0: copy `VOICE_PROFILE_Adriano.md` from the operator's desktop into
`09_Internal/` so the reference material lives in the ops folder, per system doctrine.

Acceptance: v2 reads as a complete, self-contained spec; a diff against v1 shows only the
deltas above; the rails and vocabulary-list lines are byte-identical to v1.

## 3. Phase 1: Backend

New files, all under the app repo:

- `src/lib/firm-voice-builder/system-prompt.ts`: the ported v2 prompt as a exported constant,
  plus the marker constants shared with the UI.
- `src/lib/firm-voice-builder/turn.ts`: pure logic. Transcript validation (shape, size caps,
  turn cap per L4), mapping the client transcript (`{role: 'interviewer' | 'lawyer', text}[]`)
  to Gemini contents, response parsing (section tag extraction, profile-marker detection).
  Pure and unit-testable; no I/O.
- `src/lib/firm-voice-builder/gemini.ts` (only if D1 finds no reusable client): thin wrapper,
  `GEMINI_API_KEY`, model per L2, `maxOutputTokens` 16384 (the build turn emits profile plus
  three proof pieces in one message; Flash is cheap, do not starve it).
- `src/app/api/tools/firm-voice-builder/turn/route.ts`: POST handler. Validate, rate-limit,
  call Gemini, return `{ message, section, profileDetected }`. Rate limiting reuses the
  existing bucket pattern (assist precedent); Upstash vars unset repo-wide means graceful
  no-op, matching the standing posture. Gemini failure returns a friendly retryable error;
  the client transcript is never lost because the server never owned it.

No auth (public tool surface). No persistence. Same-origin usage only by construction of the
page; no CORS headers added.

Acceptance: unit tests green for validation edges (oversized answer, oversized transcript,
turn-cap breach, malformed roles, marker parsing with and without section tags), `tsc` clean,
zero imports from `screen-engine/`.

## 4. Phase 2: Frontend

- `src/components/firm-voice-builder/FirmVoiceBuilder.tsx` plus children: intro panel (what it
  is, 25-minute expectation, the confidentiality invitation, the no-storage privacy line),
  chat surface (interviewer messages left-styled, lawyer answers right-styled, paste-friendly
  auto-growing textarea, Enter-to-send with Shift+Enter newline), seven-segment progress rail
  driven by `[SECTION:n]`, profile reveal (distinct styled block parsed from the markers, copy
  button, transcript download button), and the continuing chat below the reveal for the
  proof-of-work and patch loop.
- Resume: transcript saved to `localStorage` (`fvb-transcript-v1`) after every turn; on load
  with a saved transcript, offer Resume or Start over.
- Transcript download: client-side blob, markdown, one file, no server involvement.
- Page: `(marketing)/tools/firm-voice-builder/page.tsx`, thin, metadata + mount, seo-check
  pattern. If the website-boundary hook blocks the new file, widen its exception list for
  exactly this path in a documented commit (Phase 0 precedent from the Autonomous Execution
  Directive section 3.1); do not weaken anything else.
- AdminShell: verify the route renders without the operator sidebar; add the `/tools/`
  prefix (or this exact path) to the bypass list if not already covered by the seo-check ship.
- Styling: brand tokens, radius 0 on cards and buttons, 2px inputs only, no em dashes and no
  banned vocabulary anywhere in UI copy, no "specialist" / "expert" / "guarantee", terminal
  square on the page h1 per Brand Book 6.18.1.

Acceptance: browser E2E on dev per G3 below.

## 5. Phase 3: Verification gates

- **G1, static**: unit tests, `tsc --noEmit`, lint, all green. Zero engine files touched, so
  no sandbox mirror and no engine-sync run required; state this in the report.
- **G2, live interview**: dev server up, drive the real endpoint end to end playing the
  fixture lawyer (sheet below), composing answers in character. Save the full transcript to
  `Version3_CaseLoadSelect/reports/` with the run date. Checklist, every item required:
  1. One question at a time, never a list, across the whole run.
  2. Fee-structure question asked in Section 1.
  3. Pushback fires on a deliberately vague answer (give one on purpose) and demands an example.
  4. Contradiction callout fires (engineer one: claim "humour never belongs in my writing"
     while the pasted samples are visibly wry).
  5. "I don't know" gets exactly one reframe (answer IDK once, hold it after the reframe).
  6. All three calibration rounds run, two written alternatives each.
  7. Section tags present on every interviewer message; sections covered in order with any
     thread deviations returning to the spine.
  8. Profile arrives between markers and contains: every required part, frequency labels,
     Quick Reference Card with verbatim sample quotes, What Matters Most top 3, the litmus
     test, the workflow instruction, the rails verbatim, the three-tier blocklist, and zero
     client-identifying names from the pasted samples.
  9. Three proof pieces delivered; one feedback round produces a revised profile.
  10. Primary-question count is 25 or fewer.
  Any failure: fix the prompt (spec first, then port), rerun. Recurring same-category failures
  across reruns mean a prompt defect, not model variance; investigate per the standing
  engine-investigation habit before retrying a third time.
- **G3, UI E2E**: in the browser on dev: intro renders, interview flows, mid-interview reload
  resumes from localStorage, profile reveal renders with working copy and download, patch loop
  continues after the reveal, mobile viewport usable.
- **G4, copy sweep**: grep the new UI copy and spec for em dashes, the banned vocabulary, and
  the LSO-restricted terms. Zero hits (quoted blocklist content inside the spec and system
  prompt excepted).

Fixture lawyer sheet (from the 2026-07-17 QA run): Priya Nandakumar, sole practitioner,
employment law, Hamilton, seven years in practice. Warm-direct client emails opening "Hi
[first name]", closing "Talk soon"; a couple of typos left in; dry wry asides in samples while
claiming humour has no place; no LSO Certified Specialist designation; flat-fee severance
reviews plus hourly litigation; English only; refuses to promise outcomes and says "I can
promise you the work, not the result".

## 6. Decision trees

- **D1, Gemini client**: grep for the existing server-side Gemini call sites (`voice-intake`,
  the screen engine's `llmExtractServer`, `/api/transcribe`). If a shared client or a cleanly
  liftable pattern exists, reuse it. If each site rolls its own, create the thin wrapper in
  `src/lib/firm-voice-builder/gemini.ts` and note the duplication as a followup; do not
  refactor the existing call sites in this build.
- **D2, `GEMINI_API_KEY` absent locally**: build everything; unit tests do not need the key
  (mock at the wrapper seam); G2 requires it. If truly absent in the local env, check Vercel
  env for dev availability; if unreachable, park G2 with the exact state written to the report
  and do not merge (G2 is a merge gate).
- **D3, anything else missing**: find it empirically in the repo or ops folder; if not
  findable, build env-gated and log a followup. Never invent facts, never add secrets to the
  repo, never touch another project to work around this one.

## 7. Stop-lines

- S1: never touch `src/lib/screen-engine/` or the sandbox repo.
- S2: no database tables, columns, migrations, or Supabase calls of any kind.
- S3: no edits in `caseloadselect-website` (isolation is bidirectional).
- S4: nothing under `06_Clients/` is in scope.
- S5: no new secrets; the only env vars are the pre-existing `GEMINI_API_KEY` and the optional
  `FIRM_VOICE_BUILDER_MODEL` override.
- S6: the banned-vocabulary hook blocks Writes containing the banned words, and the v1 spec's
  blocklist lines contain them by design. When authoring v2, carry those lines by copying the
  file first (Bash `cp`) and editing around them, or anchor Edits so the banned-word lines are
  never inside `old_string`/`new_string`. If a legitimate edit cannot avoid them, split it.
- S7: writing rules apply to every string in this build, UI copy and code comments included:
  no em dashes, no banned vocabulary, no "not just X but Y" constructions, no italics in
  client-facing surfaces.
- S8: no promotion of the tool anywhere (nav links, homepage, GBP, LinkedIn). Surfacing the
  route publicly is a separate, operator-gated step after the gate ships.

## 8. Reporting

One report in `Version3_CaseLoadSelect/reports/` (dated, workstream-named): what shipped,
gate evidence (G1 output, G2 transcript path and checklist results, G3 observations, G4 grep
results), decisions taken via the trees, anything parked. Followups mirrored to
`00_System/FOLLOWUPS.md` per doctrine. PR description summarizes the same.

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-17 | This plan | Interactive tool plan authored; supersedes the copy-paste delivery as primary surface; landing page code in the website repo stays parked uncommitted | H | 05_Product/caseload-select-app; Version3_CaseLoadSelect | Sonnet executes Phases 0 through 3 in order, ships per L14 | Sonnet 5 | Open |
| 2026-07-17 | This plan | Email gate before profile reveal, GHL consent forward (DR-089), analytics, and website proxy rewrite all deferred by operator decision | M | 05_Product/caseload-select-app; 05_Product/caseloadselect-website | Plan the gate build once the tool is verified working | Adriano | Open |
| 2026-07-17 | This plan | Multilingual interview (lawyer answers in French or Portuguese) not in v1 | L | 05_Product/caseload-select-app | Evaluate after English v1 proves out | Adriano | Open |
