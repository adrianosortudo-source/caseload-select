# BUILD PLAN — Publish Kit, sixth follow-up round

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** the v1 plan and the v1–v5 follow-up plans are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

Round 5's access-control work is sound end to end: every strip, gate, and anchor
survived an independent adversarial pass with no HIGH findings. What survived
is narrative and one fixture — a Markdown sentence that states two false
reasons instead of the true one, a copy-column message reused past the shape
it was written for, and a test fixture that quietly reverted to the premise
FU5-6 spent a whole step correcting.

Read section A before touching anything — it names the failure pattern behind
every one of this round's findings, because it is the same pattern behind
every prior round's findings, and it will recur in round 7 if the next
plan-writer doesn't check its own later steps against its own earlier ones.

---

## 0. Commands and constraints (unchanged, restated)

```bash
npx tsc --noEmit
```

```bash
npm test
```

- **`npm run lint` is broken repo-wide and is not yours to fix.** Do not
  install ESLint. Verify with the two commands above only.
- `vitest` runs in **node** and only collects `src/**/__tests__/**/*.test.ts`.
  **`.test.tsx` never runs.** Logic that needs a test must live in a plain
  `.ts` module.
- Read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Do not import `@/lib/publication-manifest` or `@/lib/publication-readiness*`.
- Tailwind tokens only; square corners; no coloured left-edge accent bar; no
  orphan words in UI copy.

---

## A. Why these findings keep having the same shape

Four rounds of audits have found real defects. Every one of them reduces to
one of these:

1. **A false premise, validated by everything downstream.** Round 4: an
   entire design (show the approved version when blocked) rested on a state
   two SQL migrations prove can never occur. Plan, code, and tests all agreed
   with each other because they all inherited the same wrong belief.
2. **A later step invalidates an earlier one's reasoning, in the same
   document.** Round 4: FU4-1 filled a list that FU4-6a's justification
   assumed was empty — both in the same plan. This round: FU5-9's fixture
   recompute was written against the premise FU5-6, six steps earlier in the
   *same* plan, had just corrected.
3. **A new fact fans out to more consumers than the plan named.**
   `superseded_at` had six consumers; round 4's plan named two, and round 5
   became the other four.
4. **A proxy stops matching the fact it stands for once a new state becomes
   reachable.** `currentVersionId` was a safe proxy for "has copy" until
   FU5-4 made the fallthrough reachable for pieces whose current version has
   no body at all.

Every step below is written to leave nothing for the next round to find in
these same four shapes. Before you mark this plan done, re-read FU6-2 against
FU6-3 and FU6-5 against FU6-1 — confirm none of them assumes a premise a
later step in this same document changes. That check is itself part of
FU6-6's final verification, not optional.

---

## FU6-1 — The Markdown withheld line must state the true reason, not a fixed pair of usually-false ones

**File:** `src/lib/content-period-export.ts`, `src/lib/__tests__/content-period-export.test.ts`
**Severity: medium**

`renderArtifact`'s withheld line is one fixed sentence regardless of *why*
`shouldWithholdArtifactLinks` returned true:

```
"Signed URL withheld: this artifact is not bound to the deliverable's current version, or the deliverable is not cleared to publish."
```

FU5-3 added `supersededAt` as a third, independent reason to withhold — and
never updated this sentence. Reachable scenario, FU5-3's own headline case: a
retracted artifact on an **approved, current** deliverable. `matches_current_version`
is true, `may_publish` is true, `superseded_at` is set. Both stated reasons
are false. The `Superseded: … (retracted, not publishable)` line four lines
above lets a careful reader infer the real cause, but the withheld line
itself asserts two falsehoods.

`renderVersionSection`'s withheld line does **not** need this fix — it never
carries a `supersededAt` (versions are not `publication_artifacts` rows), so
its two-reason disjunction is always accurate for the states it can reach.
Scope this to `renderArtifact` only.

### 1a. Compose the sentence from the reasons that are actually true

```ts
function artifactWithholdReason(a: ContentExportArtifact, deliverableMayPublish: boolean): string {
  const reasons: string[] = [];
  if (a.superseded_at) reasons.push("it has been retracted");
  if (!a.matches_current_version) reasons.push("it is not bound to the deliverable's current version");
  if (!deliverableMayPublish) reasons.push("the deliverable is not cleared to publish");
  return `Signed URL withheld: ${reasons.join(", or ")}.`;
}
```

In `renderArtifact`, replace the fixed string with
`artifactWithholdReason(a, deliverableMayPublish)`. Keep the `else if
(a.signed_url)` branch (the working-link case) unchanged.

### 1b. Tests

In `content-period-export.test.ts`:

1. A retracted artifact on an approved, current deliverable: the Markdown
   contains "it has been retracted" and does **not** contain "is not bound to
   the deliverable's current version" or "is not cleared to publish".
2. An other-version artifact on a publishable deliverable (not retracted): the
   Markdown contains "it is not bound to the deliverable's current version"
   and not "it has been retracted".
3. A current, matching artifact on a non-publishable deliverable (not
   retracted): the Markdown contains "the deliverable is not cleared to
   publish" and not "it has been retracted".
4. All three existing withholding tests (`renderContentExportMarkdown:
   withholds the signed URL…`) still pass unchanged — they assert `toContain("Signed URL withheld")`, which remains true regardless of which reasons compose the sentence.

**Acceptance:** revert 1a to the fixed string, watch tests 1–3 fail (test 1
because the retraction reason is absent), restore.

---

## FU6-2 — Two truthfulness fixes for the copy column, from one root cause

**File:** `src/lib/publish-kit-pure.ts`, `src/components/portal/PublishKit.tsx`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: medium**

Both are the same defect: `PublishKit.tsx`'s copy column branches on
`currentVersionId` (a proxy for "a current version row exists") and
`hasAnyArtifactToShow` (a proxy that includes `otherVersionArtifacts`, i.e.
content that is explicitly **not** evidence for this piece). Neither proxy
answers the question the sentence built on it asks.

Reachable scenarios (both probe-confirmed):

- A blocked `pdf` deliverable whose current version has no `storage_path` and
  no bound artifacts, but one artifact registered against an **older**
  version: `hasAnyArtifactToShow` is true (because `otherVersionArtifacts.length
  > 0`), so the copy column says *"This piece is delivered as a file. See the
  artifacts panel."* — and the panel contains only the collapsed "Artifacts
  from other versions" disclosure, whose own caption says its contents
  "cannot be downloaded here" and are "not evidence for the version shown
  above."
- A blocked piece (any `contentKind`) whose `current_version.body_html` is
  null: `currentVersionId` is still non-null, so the copy column says *"This
  piece has copy, but no version is currently approved."* There is no copy —
  the draft the sentence sends the operator to read does not exist.

### 2a. Add two narrow, honest fields

In `PublishKitPiece`:

```ts
  /**
   * Whether this piece's CURRENT version (bound or approved, whichever is
   * displayed or would be if approved) has copy at all. Independent of
   * approval status -- this answers "does a draft exist to send the
   * operator to", not "is a version cleared to publish". Distinct from
   * plainText being non-empty, which additionally requires may_publish.
   */
  currentVersionHasBody: boolean;
  /**
   * Whether THIS piece's own current-version content -- its version asset or
   * an artifact bound to it -- is present. Deliberately excludes
   * otherVersionArtifacts: those are explicitly not evidence for this piece
   * (see PublishKitArtifact.versionId's doc comment), so they must never
   * satisfy a claim about what THIS piece delivers. Compare
   * hasAnyArtifactToShow, which is broader by design (gates "is the panel
   * empty", where an other-version disclosure counts as "not empty").
   */
  hasCurrentArtifactToShow: boolean;
```

In `toPiece`, compute both:

```ts
  const currentVersionHasBody = Boolean(deliverable.current_version?.body_html);
  const hasCurrentArtifactToShow = Boolean(strippedVersionAsset) || boundArtifacts.length > 0;
```

Add both to the returned object, alongside the existing `hasAnyArtifactToShow`
(do not remove or rename it — it correctly gates the panel's own empty-state
message, per the round-5 audit's category-B verdict, and continues to do so).

### 2b. Fix the two messages

In `PublishKit.tsx`'s copy column:

```tsx
{(piece.contentKind === "image" || piece.contentKind === "pdf") && piece.hasCurrentArtifactToShow
  ? "This piece is delivered as a file. See the artifacts panel."
  : !piece.mayPublish && piece.currentVersionHasBody
    ? "This piece has copy, but no version is currently approved. Open the review page to read the current draft."
    : "No approved copy for this piece yet."}
```

### 2c. Tests

In `publish-kit-pure.test.ts`:

1. A blocked pdf piece with no current-version storage_path, no bound
   artifacts, and one other-version artifact: `hasCurrentArtifactToShow` is
   false while `hasAnyArtifactToShow` is true — the two flags must disagree
   in this fixture, proving they answer different questions.
2. A blocked piece whose `current_version.body_html` is null:
   `currentVersionHasBody` is false.
3. A blocked piece whose `current_version.body_html` is set:
   `currentVersionHasBody` is true, regardless of `may_publish`.
4. A publishable piece: both new fields still compute (not gated on
   `may_publish`), matching their doc comments' "independent of approval"
   claim.

**Acceptance:** revert 2b's `hasCurrentArtifactToShow` check back to
`piece.hasAnyArtifactToShow`, watch test 1's implied UI condition fail (assert
directly: `piece.hasAnyArtifactToShow && !piece.hasCurrentArtifactToShow`
must be true for that fixture, proving the old code path would have shown the
file-delivery message there); restore.

---

## FU6-3 — Fix the fixture FU5-9 introduced to contradict FU5-6

**File:** `src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: low**

FU5-9 specified recomputing `matches_current_version` from
`built.current_version_id` — the **raw pointer**. FU5-6, six steps earlier in
the same document, had just changed the real exporter to derive
`matches_current_version` from the **resolved** `current_version`, precisely
because the raw pointer can be foreign or dangling. The fixture now
contradicts the rule it exists to enforce: in the FU5-6 foreign-pointer test
itself (`current_version_id: "v-foreign"`, `current_version: null`), the
fixture stamps `matches_current_version: true` on the artifact — a shape
`content-period-export.test.ts`'s own FU5-6 test proves the real exporter
cannot produce (it asserts `false` for that exact scenario).

Inert today (`toArtifact` never reads `matches_current_version`), but the
fixture's own comment claims to implement the resolved-version rule and
doesn't.

### 3a. One-line fix

```ts
  return {
    ...built,
    artifacts: built.artifacts.map((a) => ({
      ...a,
      matches_current_version: built.current_version?.id !== undefined
        && built.current_version?.id === a.version_id,
    })),
  };
```

Simplify to `built.current_version?.id === a.version_id` — when
`built.current_version` is null, `undefined === a.version_id` is always
false for a real `version_id` string, so the shorter form is equivalent and
clearer:

```ts
  matches_current_version: built.current_version?.id === a.version_id,
```

### 3b. Test

Add one case: a fixture with `current_version_id: "v-foreign"`,
`current_version: null`, and an artifact with `version_id: "v-foreign"`
(matching the raw pointer but not any resolved version) — assert the
built artifact's `matches_current_version` is `false`, matching what the real
exporter would produce for the same shape.

**Acceptance:** revert to `built.current_version_id`, watch the new test fail
(it will report `true`), restore.

---

## FU6-4 — Two stale comments

**Files:** `src/lib/artifact-links.ts`, `src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: low**

### 4a. `artifact-links.ts`'s `locked` state doc

Currently: *"Currently unreachable given how may_publish/displayedVersionId
interact (a bound artifact only exists without 'unapproved' when mayPublish
is true)."* False on the defense-in-depth branch (a hypothetical future
writer sets `approved_version_id` to something other than
`current_version_id` or null): there, a bound artifact has `unapproved: false`
and `mayPublish: false` simultaneously, reaching `locked`. It is unreachable
in production only because of the two-writer invariant (the approval RPC and
`deliverables.ts` both only ever set `approved_version_id` equal to
`current_version_id` or clear it to null), not because of how the fields
interact structurally.

Rewrite:

```
 * - locked: exists and is bound to an approved/displayed version, but this
 *   piece may not publish for some other reason. Unreachable in production
 *   only because the two writers of approved_version_id (the approval RPC
 *   and deliverables.ts) never set it to anything other than
 *   current_version_id or null; if a future writer ever does, this is the
 *   correct fallback state rather than a crash or a mislabel.
```

### 4b. The stale line-number citation

`publish-kit-pure.test.ts`'s comment block above `describe("blocked piece
with no approved version...")` cites `content-period-export.ts:501`. Line
numbers rot with every edit; this round alone has shifted them repeatedly.
Replace the citation with the function name, not a line number:

```
// Per evaluateMayPublish in content-period-export.ts, approved_version_id
// can never differ from current_version_id in production...
```

Search the test file for any other `content-period-export.ts:<number>` or
`publish-kit-pure.ts:<number>` style citations and apply the same fix.

---

## FU6-5 — Stop an unapproved version number from riding into the withheld agent record

**File:** `src/lib/publish-kit-pure.ts`, `src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: low — a scope decision, not an access leak**

FU5-4 made `selectVersion`'s third branch return the current version's
`versionNumber` instead of `null`, so a blocked piece's asset could be found.
That number flows into `AgentRecordBase.version_number`, which is shared by
**both** `AgentRecordWithheld` and `AgentRecordPublishable`. Before FU5-4, a
blocked piece's withheld record always carried `version_number: null`; it now
carries the real number of a version nothing has approved.

A version number is not content and this is not an access-control defect —
but the withheld record's own doc comment says a blocked caller receives
nothing about the blocked content beyond the reason, and this is new
information that reasoning didn't examine. The UI version chip is left
as-is: it is genuinely useful for the FU5-4 findability goal and carries no
content, only a number already visible via the artifact's own provenance
panel. The agent record's *withheld* branch is the higher-stakes surface and
is tightened to match its own stated contract.

### 5a. Null it in the withheld branch only

In `toAgentRecord`:

```ts
  if (!piece.mayPublish) {
    return {
      ...base,
      version_number: null,
      withheld: true,
      blocked_reason: piece.mayPublishReason,
      note: "Copy, asset, and destination are withheld until this clears.",
    };
  }
```

(`base` still supplies `version_number` for the publishable branch
unchanged; the override only applies to the withheld return.)

### 5b. Test

A blocked piece with `versionNumber: 3` (the FU5-4 case: current version
resolved, not approved): `toAgentRecord(piece).version_number` is `null`
despite `piece.versionNumber` being `3`. A publishable piece with
`versionNumber: 2`: `toAgentRecord(piece).version_number` is `2`, unchanged.

**Acceptance:** revert 5a (drop the override), watch the blocked-piece test
fail (expect `null`, receive `3`), restore.

---

## FU6-6 — Final verification, including the cross-step check from section A

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. A retracted artifact on an approved, current deliverable: the Markdown
   withheld line says "it has been retracted" and nothing else.
2. A blocked pdf piece with only an other-version artifact:
   `hasCurrentArtifactToShow` is false and the copy column does **not** claim
   the piece is delivered as a file.
3. A blocked piece with no body on its current version: the copy column does
   **not** claim it has copy.
4. The FU5-6 foreign-pointer fixture's artifact now has
   `matches_current_version: false`, matching what the real exporter proves
   it emits for that shape.
5. A blocked piece's `toAgentRecord().version_number` is null even when
   `piece.versionNumber` is set.
6. **The cross-step check named in section A:** re-read FU6-2's
   `currentVersionHasBody`/`hasCurrentArtifactToShow` against FU6-5's
   `version_number` nulling — confirm neither field derivation silently
   depends on `piece.versionNumber` in a way FU6-5 would invalidate (it does
   not: both derive from `current_version.body_html` and the artifact/asset
   presence, not from `versionNumber`). State this check was performed, not
   just that its conclusion holds.
7. `git status` shows no migration files and no change to
   `DeliverableReview.tsx`; no file you touched performs a Supabase write.

---

## Definition of done

- [ ] The Markdown withheld-artifact line states the reason(s) that are
      actually true for that artifact, including retraction.
- [ ] The copy column never claims file-delivery or copy-existence for a
      piece that has neither, using fields that answer those exact
      questions rather than proxies that answer adjacent ones.
- [ ] The test fixture recomputing `matches_current_version` matches the
      real exporter's resolved-version rule, including on the foreign-pointer
      shape.
- [ ] Both stale comments corrected.
- [ ] A blocked piece's withheld agent record carries no version number.
- [ ] `npx tsc --noEmit` and `npm test` both pass, with real output pasted.
- [ ] The FU6-6 item 6 cross-step check was actually performed before
      declaring this plan done.

---

## Still open, carried forward unchanged

Both from round 4, both still the owner's call, neither touched this round:

1. **JSON `signed_url` in `/api/admin/content-periods/[periodId]/content-export`
   is still emitted unconditionally.** The Markdown view is now fully gated
   (as of FU5-3/FU6-1); the JSON field is untouched because removing it is a
   breaking change to a documented endpoint other consumers may rely on.
2. **Reconstructing a blocked piece's last genuinely approved content from
   `approval_records`** remains a feature with real design questions, not a
   bug fix.

One item newly surfaced this round, deliberately not built further than
FU6-5: whether the **UI** version chip should also be suppressed for a
blocked piece with no current-version content at all (as opposed to just the
agent record). Left as-is because it is informational and matches FU5-4's
findability intent; revisit only if an operator reports it as confusing in
practice.
