# CLOSING PATCH — Publish Kit

**This is not a round-7 audit plan. It is the last set of changes.**

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** v1 plan and the v1–v6 follow-up plans are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

Six audit rounds have run. The access-control layer is closed: ten core
guarantees were each reverted individually and **all ten** were caught by
failing tests, and three consecutive adversarial passes have found no
high-severity access defect. That work is done.

What is not done is narrower and has a single cause. Every remaining finding
is a **sentence whose clauses were never checked against the state that
produces them**, and every one of them lives in code `vitest` cannot reach —
`PublishKit.tsx`, or a Markdown call site with no test asserting the wording.
Measured, not assumed: reverting round 6's main behavioural change
(`hasCurrentArtifactToShow` / `currentVersionHasBody` back to the round-5
proxies) leaves the entire 5,747-test suite green.

That is why this is the last patch. Re-reading these files by eye has now
produced a new finding *and* introduced a new defect in each of the last three
rounds. The fix is not another read-through — it is to move the remaining
truth-bearing decisions into the tested layer so the next person to touch them
cannot break them silently. Step 3 is the point of this patch; the rest is
cleanup on the way past.

---

## 0. Commands and constraints (unchanged, restated)

```bash
npx tsc --noEmit
```

```bash
npm test
```

- **`npm run lint` is broken repo-wide and is not yours to fix.** Verify with
  the two commands above only.
- `vitest` runs in **node** and only collects `src/**/__tests__/**/*.test.ts`.
  **`.test.tsx` never runs.** This constraint is the *reason for step 3* — a
  decision that must be tested has to live in a `.ts` module.
- Read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Tailwind tokens only; square corners; no coloured left-edge accent bar; no
  orphan words in UI copy.
- **Do not start any background process that writes to this working tree while
  tests are running.** A concurrent mutation script corrupted one audit run.

---

## PATCH-1 — The "Current version" section prints a clause that is false every time it appears

**File:** `src/lib/content-period-export.ts`,
`src/lib/__tests__/content-period-export.test.ts` · **Severity: high (false statement, no access consequence)**

`renderVersionSection`'s withheld line is a fixed two-reason disjunction:

```
- Signed URL withheld: this version is not the deliverable's current version, or the deliverable is not cleared to publish.
```

The current-version call site hardcodes `matchesCurrentVersion: true` and
`supersededAt: null`, so `shouldWithholdArtifactLinks` can only return true
there via `!d.may_publish`. The first clause is therefore **false on every
occurrence**, printed directly under a heading reading `**Current version**`.
Reachable on the commonest blocked shape in the product: any `in_review`
image/PDF/lead-magnet deliverable whose version carries a file.

The v6 plan examined this exact function and cleared it, reasoning that its
disjunction was "always accurate for the states it can reach." That check
asked whether a reason was *missing*; it never asked whether the reasons kept
were *true*.

### 1a. Give the version section the same treatment `renderArtifact` got

Add beside `artifactWithholdReason`:

```ts
/**
 * Composes the version-section withheld reason from whichever reasons
 * actually apply at THIS call site. The current-version call can only
 * withhold because the deliverable is not cleared to publish -- it is
 * trivially its own current version -- so a fixed disjunction mentioning
 * version-binding prints a false clause under a "Current version" heading.
 */
function versionWithholdReason(isCurrentVersion: boolean, deliverableMayPublish: boolean): string {
  const reasons: string[] = [];
  if (!isCurrentVersion) reasons.push("this is not the deliverable's current version");
  if (!deliverableMayPublish) reasons.push("the deliverable is not cleared to publish");
  return `Signed URL withheld: ${reasons.join(", and ")}.`;
}
```

Change `renderVersionSection`'s third parameter from `withholdLinks: boolean`
to `withholdReason: string | null` (null meaning "do not withhold"), and have
it print `- ${withholdReason}` when non-null. At the two call sites:

- **Current version:** pass
  `d.may_publish ? null : versionWithholdReason(true, d.may_publish)`.
- **Approved version:** pass `versionWithholdReason(false, d.may_publish)` —
  always withheld, and both clauses are genuinely true there when
  `may_publish` is false, one clause when it is true.

Note `", and "` not `", or "` — when several reasons hold, all of them hold.
Leave `artifactWithholdReason`'s existing `", or "` alone; changing it is
cosmetic and out of scope for a closing patch.

### 1b. Tests

1. A blocked (`in_review`) deliverable whose current version has a
   `storage_path`: the Markdown contains
   `"the deliverable is not cleared to publish"` and does **not** contain
   `"not the deliverable's current version"`.
2. That same deliverable when approved and current: no withheld line at all,
   and the working signed URL prints (guards against the null-means-allow
   refactor inverting).

**Acceptance:** revert 1a to the fixed sentence, watch test 1 fail, restore.

---

## PATCH-2 — `currentVersionHasBody` is true for markup containing no text

**File:** `src/lib/publish-kit-pure.ts`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: medium**

```ts
const currentVersionHasBody = Boolean(deliverable.current_version?.body_html);
```

`Boolean(body_html)` means "the column is a non-empty string", not "there is
copy". The version-post route rejects a body only when its sanitiser returns
empty, so `<p></p>`, `<p><br></p>`, and `<p>&nbsp;</p>` are all stored and all
make this flag true while `htmlToPlainText` yields `""`. A blocked piece in
that state tells the operator *"This piece has copy… Open the review page to
read the current draft"* and sends them to an empty draft.

This is the same proxy-vs-fact gap FU6-2 was written to close; it replaced
`currentVersionId` with a better proxy and stopped one step short of the fact.

### 2a. Derive from the rendered text, not the column

```ts
  const currentVersionHasBody =
    htmlToPlainText(deliverable.current_version?.body_html ?? null).length > 0;
```

Update the field's doc comment to say it reflects whether the body *renders to
any text*, not whether the column is populated.

### 2b. Tests

1. A blocked piece whose `current_version.body_html` is `"<p></p>"`:
   `currentVersionHasBody` is **false**.
2. Same for `"<p><br></p>"` and `"<p>&nbsp;</p>"`.
3. A blocked piece with `"<p>Real draft</p>"`: still **true** (no regression).

**Acceptance:** revert 2a to `Boolean(...)`, watch tests 1–2 fail, restore.

---

## PATCH-3 — Move the copy-column sentence into the tested layer

**Files:** `src/lib/publish-kit-pure.ts`,
`src/components/portal/PublishKit.tsx`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: medium (structural — this is the point of the patch)**

Verified: reverting FU6-2's two operands in `PublishKit.tsx` back to
`hasAnyArtifactToShow` / `currentVersionId` leaves **all 5,747 tests green**.
The most substantive behavioural change of round 6 has zero regression
protection, because the branch consuming it lives in a `.tsx` file vitest
never collects. Its three new tests assert the pure-layer *inputs* and never
the decision.

Every finding in rounds 4, 5, and 6 has concentrated in exactly the code the
tests cannot see. This step closes that for the copy column — the same remedy
`artifact-links.ts` already applied to the download control after the
identical silent regression between rounds 2 and 3.

### 3a. Add the decision to the pure layer

```ts
/**
 * Which sentence the copy column shows when a piece has no displayable copy.
 * Lives here, not in PublishKit.tsx, because it is a claim about the piece --
 * and every claim this feature makes is decided and tested in the pure layer.
 * The component selects presentation; it does not decide truth.
 */
export type CopyColumnMessage = "file_delivery" | "has_unapproved_copy" | "no_copy";

export function copyColumnMessage(piece: PublishKitPiece): CopyColumnMessage {
  if ((piece.contentKind === "image" || piece.contentKind === "pdf") && piece.hasCurrentArtifactToShow) {
    return "file_delivery";
  }
  if (!piece.mayPublish && piece.currentVersionHasBody) return "has_unapproved_copy";
  return "no_copy";
}
```

Do **not** return the English string from the pure layer — return the case,
and keep the wording in the component. The decision is what needs testing;
the copy is presentation and belongs beside the markup.

### 3b. Consume it

In `PublishKit.tsx`, replace the ternary with a lookup keyed on
`copyColumnMessage(piece)`, preserving the three existing strings verbatim.

### 3c. Tests

Port the enumeration directly — one assertion per reachable combination:

| contentKind | mayPublish | hasCurrentArtifactToShow | currentVersionHasBody | expected |
|---|---|---|---|---|
| pdf | true | true | false | `file_delivery` |
| pdf | true | false | false | `no_copy` |
| pdf | false | false | true | `has_unapproved_copy` |
| pdf | false | false | false | `no_copy` |
| text | false | false | true | `has_unapproved_copy` |
| text | false | false | false | `no_copy` |
| text | true | false | true | `no_copy` |
| image | false | true | false | `file_delivery` |

**Acceptance:** revert 3b so the component uses the round-5 proxies again,
and confirm a `copyColumnMessage` test now fails — proving the decision is
finally covered. Restore.

---

## PATCH-4 — Two tests that do not discriminate

**Files:** `src/lib/__tests__/content-period-export.test.ts`,
`src/lib/__tests__/artifact-links.test.ts` · **Severity: low**

### 4a. FU6-1's third test passes against the code it was meant to reject

Reverting FU6-1 produces two failures, not three. The third test asserts
`toContain("the deliverable is not cleared to publish")`, a substring the old
fixed sentence also contained verbatim. Add the discriminating line:

```ts
    expect(md).not.toContain("it is not bound to the deliverable's current version");
```

### 4b. `shouldWithholdArtifactLinks` has no direct test

All nine tests in `artifact-links.test.ts` cover `artifactControlState`. The
withholding predicate — the function the module exists for — is covered only
indirectly through Markdown substring assertions in another file. Add an
eight-row table test driving every combination of
`(matchesCurrentVersion, deliverableMayPublish, supersededAt)` and asserting
the boolean, so the predicate is pinned independently of its callers.

---

## PATCH-5 — Final verification

```bash
npx tsc --noEmit
```

```bash
npm test
```

Confirm each explicitly, by inspection:

1. A blocked deliverable's **Current version** section says only
   "the deliverable is not cleared to publish" — no version-binding clause.
2. A blocked piece with `<p></p>` as its body does not claim to have copy.
3. `copyColumnMessage` is exercised by tests covering all eight rows, and
   reverting the component to the round-5 proxies makes one fail.
4. Reverting FU6-1 now fails **three** tests, not two.
5. `shouldWithholdArtifactLinks` has direct coverage of all eight inputs.
6. `git status` shows no migration files, no change to `DeliverableReview.tsx`,
   no stray scripts in the repo root, and no Supabase write in any file touched.

---

## Definition of done

- [ ] Every withheld-reason sentence in the Markdown export is composed from
      conditions true at its own call site.
- [ ] `currentVersionHasBody` reflects rendered text, not column emptiness.
- [ ] The copy column's decision lives in the pure layer and is tested there;
      `PublishKit.tsx` selects wording only.
- [ ] Both non-discriminating tests fixed; the withholding predicate has
      direct coverage.
- [ ] `npx tsc --noEmit` and `npm test` pass, with every break-and-restore
      **observed and pasted**, not asserted.

---

## Deliberately not doing

- **`", or "` → `", and "` in `artifactWithholdReason`.** Every clause it
  joins is true; the connective merely understates certainty. Cosmetic.
- **Further tightening of the withheld agent record.** The surviving fields
  (`title`, `channel`, `scheduled_day`, …) are editorial-calendar metadata
  that exist before anyone drafts a version; an agent that cannot say *"the
  LinkedIn post scheduled Tuesday is blocked"* cannot do its job. The line is
  defensible. Note that FU6-5 left a same-session incoherence — the record
  says `version_number: null` while the UI chip two inches away prints `v3` —
  which is cosmetic and not worth another edit.
- **The `email` / `email_newsletter` widening.** The prepared, unapplied
  migration will make `publisherLane` return `"unknown"` for `'email'`,
  hiding such pieces from every filter and breaking
  `manual + pipeline === total`. `ROLE_PRESENCE`'s compile-time guard will
  not catch it, because the TS union was not widened alongside the SQL.
  **This belongs to the v5.2 workstream that applies that migration, not
  here.** Flagged so it is not discovered in production.

---

## Exit criteria — the Publish Kit is done when these hold

1. Every sentence that **asserts something about a piece's state** is
   composed from the conditions it asserts, decided in a `.ts` module, and
   covered by a test that fails when the composition is reverted. Sentences
   that merely **name an already-decided value** are presentation and need
   only be exhaustively mapped, enforced by the compiler.
2. Every claim the UI makes is decided in a `.ts` module and unit-tested
   there; `PublishKit.tsx` selects presentation, never truth.
3. `npx tsc --noEmit` and `npm test` green with break-and-restore observed.
4. **No further audit round is scheduled.**

Reopen only on: an operator reporting a specific false statement; a schema
widening reaching `deliverable_role` / `publication_destination`; or the JSON
`signed_url` decision being made.

---

## Handoff note

The Publish Kit's access-control layer is closed. Ten core guarantees were
each reverted individually and all ten were caught by failing tests; three
consecutive adversarial passes found no high-severity access defect. The
remaining risk class is narrative truth — sentences whose clauses were not
checked against the state producing them — and after this patch every such
sentence is composed in a tested function.

Two owner decisions remain untouched since round 4, both product calls rather
than defects: whether the JSON `signed_url` in
`/api/admin/content-periods/[periodId]/content-export` should be gated the way
the Markdown now is, and whether a blocked piece's last genuinely approved
content should be reconstructed from `approval_records`.

Do not commission another audit round. If a specific falsehood is reported,
fix that sentence.
