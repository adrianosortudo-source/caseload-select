# CORRECTION PATCH — Publish Kit

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** v1–v6 follow-ups and the v7 closing patch are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

The v7 closing patch broke the three-round streak on behaviour: independent
verification found no reachable false statement, no contradicting fixture, and
no behavioural regression from any of its five edits. All five are correctly
implemented.

It introduced one thing, and it is a structural regression with a false
comment on top of it — **caused by the plan text, not by the execution**:

> **PATCH-1 severed the shared withholding gate that FU5-3 created that module
> to provide.** `shouldWithholdArtifactLinks` now has exactly one caller
> (`renderArtifact`), while `renderVersionSection` composes its own decision
> at the call site. Its doc comment still reads *"Used by every link-emitting
> line in the Markdown export so one gate cannot be updated while a sibling is
> missed — the exact failure that let `renderVersionSection` publish an
> unapproved lead-magnet PDF while `renderArtifact` correctly withheld the
> crop beside it."* That sentence is now false, and the sibling it names is
> the one PATCH-1 disconnected.

Behaviour is provably identical and both call sites are test-pinned, so this
is not a live defect. It is the reopening of a drift class that cost two
rounds to close, plus a comment asserting it is still closed.

This patch fixes that, closes the two exit criteria the v7 patch left open,
and corrects one exit criterion that was written too strongly to be
satisfiable.

---

## 0. Commands and constraints (unchanged, restated)

```bash
npx tsc --noEmit
```

```bash
npm test
```

- **`npm run lint` is broken repo-wide and is not yours to fix.**
- `vitest` runs in **node** and only collects `src/**/__tests__/**/*.test.ts`.
  **`.test.tsx` never runs.** This is the constraint that makes STEP 3
  necessary rather than optional.
- Read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Tailwind tokens only; square corners; no coloured left-edge accent bar; no
  orphan words in UI copy.
- **Do not run any script that writes to source files while another process
  may be reading this tree.**

---

## STEP 1 — Restore the single withholding gate; keep the composed wording

**File:** `src/lib/content-period-export.ts`, `src/lib/artifact-links.ts`,
`src/lib/__tests__/content-period-export.test.ts` · **Severity: medium (structural)**

PATCH-1 conflated two separable things: **the decision** (withhold or not) and
**the wording** (which reasons to name). `renderArtifact` already gets this
right — it calls `shouldWithholdArtifactLinks` for the decision *and*
`artifactWithholdReason` for the wording. PATCH-1 should have given
`renderVersionSection` the same shape; instead it replaced the decision too.

### 1a. Make the version section use the shared predicate for the decision

In `renderDeliverable`, compute the decision with the shared function and the
wording with the local composer:

```ts
  const currentVersionWithheld = shouldWithholdArtifactLinks({
    matchesCurrentVersion: true, // the current version is trivially itself
    deliverableMayPublish: d.may_publish,
    supersededAt: null, // versions are not publication_artifacts rows
  });
  lines.push(
    renderVersionSection(
      "Current version",
      d.current_version,
      currentVersionWithheld ? versionWithholdReason(true, d.may_publish) : null,
    ),
  );
  if (d.approved_version) {
    const approvedVersionWithheld = shouldWithholdArtifactLinks({
      matchesCurrentVersion: false, // by definition not the current version
      deliverableMayPublish: d.may_publish,
      supersededAt: null,
    });
    lines.push(
      renderVersionSection(
        "Approved version, differs from current",
        d.approved_version,
        approvedVersionWithheld ? versionWithholdReason(false, d.may_publish) : null,
      ),
    );
  }
```

`approvedVersionWithheld` is always `true` (the first disjunct fires), so this
preserves the current always-withhold behaviour while routing the decision
through the one gate. Keep `renderVersionSection`'s `withholdReason: string | null`
signature — it is the right shape.

Note this also eliminates the degenerate-string risk structurally:
`versionWithholdReason` is now called only when the shared predicate already
returned true, which guarantees at least one reason.

### 1b. Correct the doc comment

`artifact-links.ts`'s `shouldWithholdArtifactLinks` comment must describe what
is true after 1a:

```
 * Whether a temporary signed URL (and the public path beside it) must be
 * withheld from an export consumer. Three independent reasons, any of which
 * is sufficient: the object is not bound to the deliverable's current
 * version; the deliverable is not cleared to publish; or the artifact has
 * been retracted.
 *
 * This function owns the DECISION. The wording of the withheld line is
 * composed separately at each call site (artifactWithholdReason,
 * versionWithholdReason) because the reasons that can apply differ by
 * section -- a version is never a publication_artifacts row, so it can never
 * be retracted. Both link-emitting sections of the Markdown export route
 * their decision through here, so one gate cannot be updated while a sibling
 * is missed: that is the failure that let renderVersionSection publish an
 * unapproved lead-magnet PDF while renderArtifact correctly withheld the
 * crop beside it.
```

### 1c. Test

Add one test asserting the shared gate is load-bearing for the version
section: a `lead_magnet_pdf` in `in_review` with a stored version asset must
withhold. This already exists — instead, add the **regression guard** that
would have caught PATCH-1's severing: assert that
`shouldWithholdArtifactLinks` is consulted for the version section by
verifying an approved, current deliverable with `may_publish: true` prints
the working URL while the same deliverable with `may_publish: false`
withholds. Both already exist; the new value is in **1d**.

### 1d. Pin the invariant that made this regression invisible

Add to `artifact-links.test.ts` a comment-documented test asserting the
module's stated contract — that it is the single decision point — cannot be
verified by a unit test, so instead assert the *behavioural* equivalence the
severing preserved: for every combination of
`(matchesCurrentVersion, deliverableMayPublish)` with `supersededAt: null`,
`shouldWithholdArtifactLinks` agrees with `!deliverableMayPublish` when
`matchesCurrentVersion` is true, and is always `true` when it is false. Four
rows. This is what a future reader needs to see to know the version-section
call sites are equivalent to what they replaced.

**Acceptance:** revert 1a (drop the shared-predicate calls, restore the
inline ternary), confirm the suite still passes — proving this step is a
*structural* fix with no behavioural change — then restore. Say so explicitly
in your report rather than claiming a test caught it.

---

## STEP 2 — Make the two label ladders exhaustive

**File:** `src/components/portal/PublishKit.tsx` · **Severity: low**

`copyColumnMessage`'s dictionary is compile-time exhaustive: adding a fourth
`CopyColumnMessage` member without a string fails `tsc`. The two remaining
label mappings are not, and both silently mislabel on a new union member:

- The artifact-block label ladder — a ternary chain ending `: "Download locked"`.
  An 8th `ArtifactControlState` compiles clean and renders "Download locked".
- `laneLabel` — falls through to `"Publisher unknown"` for any new
  `PublisherLane`.

Convert both to the same dictionary form `copyColumnMessage` uses, so the
compiler enforces coverage:

```tsx
const ARTIFACT_CONTROL_LABEL: Record<Exclude<ArtifactControlState, "download">, string> = {
  no_file: "No stored file for this artifact.",
  other_version: "Different version",
  retracted: "Retracted",
  unapproved: "Not approved",
  locked: "Download locked",
  unsigned: "Link unavailable, refresh",
};
```

(`download` is excluded because it renders an anchor, not a labelled button.)
Index it with `controlState` in the non-anchor branch. Do the same for
`laneLabel` with `Record<PublisherLane, string>`. Import
`ArtifactControlState` as a type from `@/lib/publish-kit-pure`.

**Acceptance:** temporarily add a member to `ArtifactControlState` in
`artifact-links.ts`, confirm `npx tsc --noEmit` now fails on the dictionary,
remove the member, confirm clean. Paste both outputs.

---

## STEP 3 — Move the last two truth-bearing decisions out of the component

**Files:** `src/lib/publish-kit-pure.ts`,
`src/components/portal/PublishKit.tsx`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: medium**

Exit criterion 2 says every claim the UI makes is decided in a `.ts` module
and tested there. Three decisions remain in the component. Verified directly:
reverting the copy column's consumption to the round-5 proxies leaves the
entire 5,766-test suite green — the component is still invisible to the
suite, so anything decided there is unprotected.

### 3a. `filteredTotals`

`PublishKit.tsx` recomputes `total` / `publishable` / `blocked` over a
component-local `matchesFilters` predicate, duplicating `toPublishKitView`'s
totals logic, and renders the result as "N total (filtered)" and as the
blocked banner's count. Move both the predicate and the recomputation:

```ts
export interface PublishKitFilter {
  channel: string | null; // null = all
  lane: PublisherLane | null; // null = any
}

export function pieceMatchesFilter(piece: PublishKitPiece, filter: PublishKitFilter): boolean {
  const channelOk = filter.channel === null || piece.destination === filter.channel;
  const laneOk = filter.lane === null || piece.lane === filter.lane;
  return channelOk && laneOk;
}

/**
 * Totals over the pieces a filter actually shows. Separate from
 * PublishKitView.totals, which always describes the whole period: presenting
 * period totals above a filtered list claims the operator is seeing counts
 * they are not.
 */
export function filteredTotals(
  view: PublishKitView,
  filter: PublishKitFilter,
): { total: number; publishable: number; blocked: number; isFiltered: boolean } {
  const isFiltered = filter.channel !== null || filter.lane !== null;
  if (!isFiltered) {
    return { ...view.totals, isFiltered: false };
  }
  const visible = view.groups.flatMap((g) => g.pieces).filter((p) => pieceMatchesFilter(p, filter));
  return {
    total: visible.length,
    publishable: visible.filter((p) => p.mayPublish).length,
    blocked: visible.filter((p) => !p.mayPublish).length,
    isFiltered: true,
  };
}
```

Consume both in the component; keep the `"all"` / `"any"` sentinel values in
component state and map them to `null` at the boundary.

### 3b. The blocked banner's claim

`PublishKit.tsx` asserts of every blocked piece: *"Their downloads are
withheld and their copy controls are locked until each clears."* Both clauses
are true today (`stripAccess` nulls the links; the copy/download buttons are
`disabled={!piece.mayPublish}`), but nothing pins the sentence to those
facts. Add a predicate the sentence is derived from:

```ts
/**
 * True when every blocked piece in the view genuinely has both its links
 * stripped and no publishable copy -- the two claims the blocked banner
 * makes. Rendering that sentence when this is false would tell the operator
 * something untrue about material they can see.
 */
export function blockedPiecesAreFullyWithheld(view: PublishKitView): boolean {
  return view.groups
    .flatMap((g) => g.pieces)
    .filter((p) => !p.mayPublish)
    .every(
      (p) =>
        p.artifacts.every((a) => a.signedUrl === null) &&
        (p.versionAsset === null || p.versionAsset.signedUrl === null),
    );
}
```

Render the two-clause sentence only when this returns true; otherwise render
the shorter *"The reason is shown on each piece below."* alone. In practice
the guard is always true — that is the point: it is now pinned, and if a
future change leaks a link into a blocked piece the sentence stops making the
claim instead of lying.

### 3c. `versionId={piece.displayedVersionId ?? piece.currentVersionId}`

The component re-derives the pure layer's anchor to print as the "Bound to
version" provenance value. Add `anchorVersionId: string | null` to
`PublishKitPiece`, set it from the existing `anchorVersionId` local in
`toPiece`, and have the component read the field. One line each side; removes
a duplicated decision of exactly the shape this series keeps finding.

### 3d. Tests

For `pieceMatchesFilter` and `filteredTotals`: unfiltered returns
`view.totals` verbatim with `isFiltered: false`; a channel filter counts only
matching pieces; `publishable + blocked === total` under every filter; a
filter matching nothing returns zeros. For `blockedPiecesAreFullyWithheld`:
true for a view whose blocked pieces are stripped; false when a blocked
piece's artifact retains a `signedUrl`. For `anchorVersionId`: equals
`displayedVersionId` when set, `currentVersionId` when not, null when neither.

**Acceptance:** for `filteredTotals`, revert to returning `view.totals`
unconditionally and watch the channel-filter test fail; restore. For
`blockedPiecesAreFullyWithheld`, revert to `return true` and watch the
leaked-link test fail; restore.

---

## STEP 4 — Correct exit criterion 1, which was written too strongly to satisfy

**File:** `docs/BUILD_PLAN_publish_kit_v7_closing_patch.md` · **Severity: none (documentation)**

Criterion 1 as written — *"Every operator-facing and agent-facing sentence is
composed from the conditions it asserts, verified by a test that fails when
the composition is reverted"* — cannot be met and should not be. It conflates
two different things:

- **Claims**, which assert something about state ("this piece has copy",
  "downloads are withheld", "N blocked"). These must be composed and tested.
- **Labels**, which name an already-decided value ("Pipeline", "Retracted",
  "Copy text", "Week manifest copied"). These are presentation. Requiring a
  revert-failing test for each would mean a test per string with no defect
  class behind it.

Replace criterion 1 with:

> 1. Every sentence that **asserts something about a piece's state** is
>    composed from the conditions it asserts, decided in a `.ts` module, and
>    covered by a test that fails when the composition is reverted. Sentences
>    that merely **name an already-decided value** are presentation and need
>    only be exhaustively mapped, enforced by the compiler.

Under the corrected criterion, STEPS 2 and 3 close it: every claim moves to
the pure layer with tests, and every label mapping becomes compile-time
exhaustive.

---

## STEP 5 — Final verification

```bash
npx tsc --noEmit
```

```bash
npm test
```

Confirm each explicitly:

1. `shouldWithholdArtifactLinks` has **two** call sites again (`renderArtifact`
   and the version section), and its doc comment describes the decision/wording
   split accurately.
2. Adding a member to `ArtifactControlState` fails `tsc` on the label
   dictionary; both outputs pasted.
3. `filteredTotals`, `pieceMatchesFilter`, `blockedPiecesAreFullyWithheld`,
   and `anchorVersionId` are all in `publish-kit-pure.ts` with tests, and the
   two prescribed break-and-restore cycles were **observed**, not asserted.
4. `PublishKit.tsx` contains no remaining expression that decides whether
   something is true about a piece — only lookups, formatting, and
   event handlers. State this after re-reading the file, and name anything
   you find that does not fit.
5. `git status` shows no new files beyond this plan document, no change to
   `DeliverableReview.tsx`, and no Supabase write in any file touched. Note
   that the two `supabase/migrations/2026071914*.sql` files pre-date this
   work by four days and belong to the v5.2 workstream — report them as
   pre-existing rather than claiming none are present.

---

## Definition of done

- [ ] Both Markdown link-emitting sections route their withhold decision
      through `shouldWithholdArtifactLinks`; its comment matches reality.
- [ ] Both label ladders are compile-time exhaustive.
- [ ] `filteredTotals`, the blocked banner's claim, and the provenance anchor
      are decided in the pure layer and tested.
- [ ] Exit criterion 1 corrected to separate claims from labels.
- [ ] `npx tsc --noEmit` and `npm test` pass, with every break-and-restore
      observed and pasted.

---

## After this patch

Exit criteria 1 (as corrected), 2, and 3 are all met. Criterion 4 —
"no further audit round is scheduled" — stands.

**Do not commission another audit round.** The v7 review's finding holds and
this patch does not change it: the access-control layer is closed, ten core
guarantees are pinned by tests that fail on removal, and the defect rate has
fallen below the churn rate of reviewing. This patch exists because the v7
plan itself introduced a structural regression, which is precisely the
failure mode that argues for stopping rather than continuing.

The two owner decisions carried since round 4 remain open and are product
calls, not defects: whether the JSON `signed_url` in
`/api/admin/content-periods/[periodId]/content-export` should be gated the way
the Markdown now is, and whether a blocked piece's last genuinely approved
content should be reconstructed from `approval_records`.

The `email` / `email_newsletter` widening remains a v5.2 workstream item:
when that migration lands, `publisherLane` returns `"unknown"` for `'email'`,
hiding such pieces from every filter, and STEP 2's `Record<PublisherLane, string>`
will not catch it because the TS union is not widened by the SQL.
