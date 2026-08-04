# BUILD PLAN — Publish Kit, fourth follow-up round

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** v1 plan and the v1/v2/v3 follow-up plans are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

This round is different from the previous three. Rounds 1-3 fixed defects in
code. This round fixes defects in **premises** — two load-bearing assumptions
that three prior rounds (and two of my own audit passes) reasoned from without
checking against the database. Both are wrong, and one of them means the
feature's entire blocked-piece rendering path has never once behaved as
designed.

Read section A before touching anything.

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
  **`.test.tsx` never runs.** Logic that needs a test must live in
  `publish-kit-pure.ts`.
- Read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Do not import `@/lib/publication-manifest` or `@/lib/publication-readiness*`.
- Tailwind tokens only; square corners; no coloured left-edge accent bar; no
  orphan words in UI copy.

---

## A. The two false premises (read before starting)

### A1. `approved_version` is always null in production

`content-period-export.ts:501` populates `approved_version` only when
`approved_version_id !== current_version_id`. **No writer in the system can
produce that state.** There are exactly two:

- `supabase/migrations/20260623000001_approval_rpc_atomic.sql:66-79` — an
  `approved` decision sets `approved_version_id = p_version_id` (the version
  being approved, which *is* the current version); any other decision sets
  `approved_version_id = NULL`.
- `src/lib/deliverables.ts:620-628` — posting a new version sets
  `current_version_id` to the new version and `approved_version_id` to `null`,
  with the comment "clear any stale approval pointer (the prior approval stays
  in approval_records)".

So `approved_version_id` is always either `NULL` or exactly equal to
`current_version_id`. It can never differ. Therefore:

- `ContentExportDeliverable.approved_version` is **always null**;
- `selectVersion`'s middle branch (`publish-kit-pure.ts:536-544`) is dead code;
- `evaluateMayPublish`'s "approved version is not the current version" branch
  (`content-period-export.ts:257-263`) is unreachable;
- **every** blocked piece falls to `selectVersion`'s third branch, yielding
  `versionId = null`;
- `partitionArtifacts` (`:611`) therefore routes **every** artifact into
  `otherVersionArtifacts`.

**What an operator actually sees today on the ordinary "lawyer requested
changes" piece** — the single most common blocked state in the product:

- copy column: *"No approved copy for this piece yet."* (or, for a pdf/image
  piece, *"This piece is delivered as a file. See the artifacts panel."*
  pointing at a panel that shows nothing);
- artifacts: only a collapsed disclosure reading *"Artifacts from other
  versions (N)"*, whose body text says *"These were cut for a different version
  of this piece"* — **false**: those artifacts are bound to the current version;
- every control reads **"Different version"** — also false.

The design intent written in round 1 ("when blocked, show the approved version,
never the newer one") has never executed. The prior approval lives in
`approval_records`, not on the deliverable row.

**Scope decision for this round:** FU4-1 fixes the false statements without
deciding the larger product question. Whether the kit should reach into
`approval_records` to resurrect and display the last-approved content for a
blocked piece is a genuine product decision, not a bug fix. **Do not implement
it.** Note it in your summary as an open question for the owner.

### A2. `publication_artifacts` is NOT append-only within a slot

`publish-kit-pure.ts:630-636` and `content-period-export.ts:113-121` both
assert that replacing an artifact for the same version and slot "inserts a
second row". `supabase/migrations/20260715232702_..._publication_artifacts_dedupe_partial_index.sql`
proves otherwise: a **unique partial index** on
`(deliverable_id, version_id, artifact_type, coalesce(locale,''), coalesce(destination,''))
WHERE superseded_at IS NULL` enforces **at most one active artifact per slot**.
A replacement requires stamping `superseded_at` on the prior row first.

FU3-1's slot key happens to match the index columns exactly — the right key,
reached by wrong reasoning. But the real discriminator, `superseded_at`, is
never exported and never reaches the pure layer. The reachable failure is a
slot **retracted with no replacement** (a crop pulled after legal review): the
superseded row wins the dedupe, renders as the piece's current artifact with a
working signed URL and no warning — while
`supabase/migrations/20260715225139_...:160-161` **raises an exception** if a
publication receipt references a superseded artifact. The kit hands the
operator an asset the receipt path will refuse to record.

---

## FU4-1 — Stop telling the operator that a blocked piece's own artifacts belong to another version

**Files:** `src/lib/publish-kit-pure.ts`, `src/components/portal/PublishKit.tsx`
**Severity: high**

The root cause is that `partitionArtifacts` receives only `displayedVersionId`
and treats `null` as "everything belongs to some other version". The truth for
a blocked piece is "these belong to the *current* version, which is not
approved". Those are different facts and must render differently.

### 1a. Carry the current version id into the mapping

`ContentExportDeliverable.current_version_id` is already exported. In `toPiece`,
capture it and add to `PublishKitPiece`:

```ts
  /**
   * The deliverable's current version, whether or not it is approved. Distinct
   * from displayedVersionId, which is null when nothing is cleared to show.
   * An artifact bound to this id belongs to THIS piece as it stands now -- it
   * is simply not approved -- and must never be described as another
   * version's.
   */
  currentVersionId: string | null;
```

### 1b. Anchor the partition on the current version when nothing is displayed

Change `partitionArtifacts` to take an explicit anchor and never fall through
to "everything is other":

```ts
function partitionArtifacts(
  artifacts: PublishKitArtifact[],
  anchorVersionId: string | null,
): { bound: PublishKitArtifact[]; other: PublishKitArtifact[] } {
  if (!anchorVersionId) return { bound: [], other: artifacts.map(stripAccess) };
  return {
    bound: artifacts.filter((a) => a.versionId === anchorVersionId),
    other: artifacts.filter((a) => a.versionId !== anchorVersionId).map(stripAccess),
  };
}
```

and call it with `versionId ?? deliverable.current_version_id`. The blocked-piece
strip from FU3-3 already applies to the bound list, so nothing becomes
downloadable that was not before — the artifacts simply stop being mislabelled.

Add a third field so the UI can tell the two states apart without re-deriving
the rule:

```ts
  /**
   * True when the bound artifacts belong to the current version but no version
   * is cleared to publish. They are this piece's real, current artifacts --
   * download-locked, but NOT another version's.
   */
  boundArtifactsAreUnapproved: boolean;
```

Set it to `versionId === null && deliverable.current_version_id !== null`.

### 1c. Fix the copy column's false empty state

`PublishKit.tsx:429-435` says *"No approved copy for this piece yet."* whenever
`plainText` is empty, which after A1 is every blocked piece — including ones
that have perfectly good copy awaiting re-approval. When
`piece.plainText` is empty **and** `piece.mayPublish` is false **and**
`piece.currentVersionId` is non-null, render instead:

*"This piece has copy, but no version is currently approved. Open the review
page to read the current draft."*

Keep the existing pdf/image message and the original "no copy yet" message for
their genuine cases (no current version at all).

### 1d. Fix the artifacts panel framing

In `PieceCard`, when `piece.boundArtifactsAreUnapproved` is true, the bound
artifacts render in the **main** artifacts area (not the disclosure) under a
short muted line: *"These belong to the current version, which is not approved.
They cannot be downloaded here."* The "Artifacts from other versions"
disclosure keeps its existing wording and continues to hold only genuinely
other-version artifacts.

### 1e. Tests

In `publish-kit-pure.test.ts`, a new
`describe("blocked piece with no approved version", ...)` built from a bundle
shape the exporter **can actually emit** (`may_publish: false`,
`approved_version: null`, `current_version` set, artifacts bound to
`current_version.id`):

1. `piece.displayedVersionId` is null and `piece.currentVersionId` equals the
   current version's id.
2. Artifacts bound to the current version are in `piece.artifacts`, **not** in
   `otherVersionArtifacts`.
3. `piece.boundArtifactsAreUnapproved` is true.
4. Those bound artifacts still have `signedUrl` null (FU3-3's strip still
   applies — this must not regress).
5. An artifact bound to a genuinely different version is still in
   `otherVersionArtifacts`.
6. For a publishable piece, `boundArtifactsAreUnapproved` is false.

**Also fix the existing FU3-3 tests.** All three at
`publish-kit-pure.test.ts:797-874` construct `may_publish: false` **with
`approved_version` populated** — a shape `content-period-export.ts:501` cannot
produce. Keep them (they guard `selectVersion`'s middle branch should a future
writer ever create that state) but add a comment saying so explicitly, so the
next reader does not mistake them for coverage of the reachable case.

**Acceptance:** break 1b (revert the anchor to `versionId` only), watch tests 2
and 3 fail, restore.

---

## FU4-2 — A retracted artifact is presented as current, downloadable evidence

**Files:** `src/lib/content-period-export.ts`, `src/lib/publish-kit-pure.ts`
**Severity: medium-high**

Per A2, `superseded_at` is the real discriminator and never leaves the
database.

### 2a. Export it

Add to `ContentExportArtifact`, after `created_at`:

```ts
  /**
   * When this artifact was retracted, or null when it is active. The DB
   * enforces at most one ACTIVE artifact per (deliverable, version, type,
   * locale, destination) slot; a superseded row is historical evidence and is
   * never publishable. A publication receipt referencing a superseded
   * artifact is rejected at the database level.
   */
  superseded_at: string | null;
```

Populate from `a.superseded_at` and print it in `renderArtifact` when set.

### 2b. Prefer active rows in the pure layer

Add `supersededAt: string | null` to `PublishKitArtifact`, populated in
`toArtifact`. In `dedupeArtifacts`, an **active** artifact always beats a
superseded one regardless of `createdAt`; among two active or two superseded,
keep the existing `createdAt` then `id` rule.

When the winner for a slot is superseded (i.e. the slot has been retracted with
no replacement), append a piece warning:

*"One artifact slot has been retracted and has no active replacement. It is
shown for reference and cannot be published."*

### 2c. Correct the two false comments

Rewrite the "append-only even WITHIN one version" comments in both files to
state what the schema actually enforces: at most one active artifact per slot,
supersession stamps `superseded_at` on the prior row, and the slot key here
deliberately matches the DB's own unique-index columns.

### 2d. Tests

1. Given one superseded and one active artifact in the same slot, the active
   one is kept even when the superseded row has a later `createdAt`.
2. Given only a superseded artifact in a slot, it is kept (nothing else to
   show) **and** the retraction warning is present.
3. Two active artifacts in the same slot still resolve by `createdAt` then
   `id` (existing behaviour must not regress).

---

## FU4-3 — Move the artifact control decision into the pure layer and give the unsigned state its own label

**Files:** `src/lib/publish-kit-pure.ts`, `src/components/portal/PublishKit.tsx`,
`src/lib/content-period-export.ts` · **Severity: medium**

Two problems, one fix.

**The logic is untested.** The strings `"Different version"`,
`"Download locked"`, and `"No stored file for this artifact."` appear only in
`PublishKit.tsx` — nowhere in any test. This is the one part of the feature
verified by inspection alone, and it is precisely the logic that silently
regressed between rounds 2 and 3 (stripping made a branch unreachable and
nothing caught it). All four inputs are plain props with no React state
(`PublishKit.tsx:596-617`), so extraction is clean.

**One reachable shape lies.** A publishable piece whose signing failed
(`storagePath` set, `mayPublish` true, `signedUrl` null) renders
**"Download locked"** — telling the operator a permission decision was made
about approved, publishable content. Nothing is locked; the URL failed to
generate. And the cause is invisible: `signArtifact`
(`content-period-export.ts:335-345`) and `signVersionAsset` (`:320-327`) both
destructure `const { data } = await ...` and **discard `error`**.

### 3a. Extract the decision

In `publish-kit-pure.ts`:

```ts
export type ArtifactControlState =
  | "no_file"        // no stored object exists
  | "other_version"  // bound to a version other than the one displayed
  | "unapproved"     // this piece's current artifact, but nothing is approved
  | "download"       // cleared, signed, ready
  | "locked"         // exists and is approved, but this piece may not publish
  | "unsigned";      // exists and is permitted, but the URL failed to sign

export function artifactControlState(input: {
  storagePath: string | null;
  locked: boolean;
  unapproved: boolean;
  mayPublish: boolean;
  signedUrl: string | null;
}): ArtifactControlState;
```

Order: `no_file` → `other_version` → `unapproved` → (`mayPublish` false →
`locked`) → (`signedUrl` null → `unsigned`) → `download`.

`ArtifactBlock` switches on the returned state for both the label and the
element. Labels: `no_file` → "No stored file for this artifact.";
`other_version` → "Different version"; `unapproved` → "Not approved";
`locked` → "Download locked"; `unsigned` → "Link unavailable, refresh";
`download` → the anchor. Keep every existing class string, `aria-disabled` on
every non-anchor state, and no `onClick`.

### 3b. Stop swallowing the signing error

In both signers, capture `error` and return it alongside. In
`buildContentExportBundle`, when signing fails for an artifact or version that
has a `storage_path`, push a deliverable warning:

*"An artifact has a stored file but its download link could not be generated.
Refresh to retry."*

Do not fail the bundle — a signing failure is not a data-integrity failure.

### 3c. Tests

Exhaustively test `artifactControlState` over every combination of the five
inputs that the call sites can produce — at minimum the six states above, each
asserted by name. This is the step that makes the round-2/round-3 regression
class impossible to reintroduce.

**Acceptance:** break the state order (put `signedUrl` first, as it was before
FU3-2), watch the `other_version` and `unapproved` cases fail, restore.

---

## FU4-4 — Make artifact order deterministic, and stop the tests from hiding it

**File:** `src/lib/publish-kit-pure.ts`, `src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: medium**

FU3-1 fixed *which* artifact wins a tie. It did not fix the **order** of the
returned array. `dedupeArtifacts` returns `[...latestByKey.values()]`
(`publish-kit-pure.ts:660`); `Map` preserves first-insertion position, which
follows the input array, which comes from a query with **no `ORDER BY`**
(`content-period-export.ts:408`). Any heap reordering — a row update, a VACUUM,
a parallel scan — reshuffles the artifact blocks between page loads. The
operator who learned "the second image is the GBP crop" downloads the LinkedIn
crop, and `toAgentRecord(...).artifacts` carries the same instability, so an
agent indexing `artifacts[0]` gets a different asset run to run.

Pieces and date groups are already sorted (`:341`, `:351`); this is artifacts
only.

### 4a. Sort inside `dedupeArtifacts`

Sort `kept` by `artifactType`, then `locale ?? ""`, then `destination ?? ""`,
then `id`. Every component is stable and present on every artifact.

### 4b. Add a final tie-break to `comparePieces`

`:323-332` compares `publishDate` then `title` and stops. Two pieces sharing
both order arbitrarily. Add `a.id.localeCompare(b.id)` as the last comparator.

### 4c. Stop the tests masking order

`publish-kit-pure.test.ts:613`, `:629`, `:657`, `:791` call `.sort()` on the
actual output before asserting, which makes a reorder regression invisible.
Remove those `.sort()` calls and assert the exact expected order. Add one test
that builds the same three artifacts in two different input orders and asserts
both produce an identical array.

---

## FU4-5 — The export route bypasses every structural guarantee, and this project widened the gap

**Files:** `src/lib/content-period-export.ts`, and a decision for the owner
**Severity: medium**

`buildContentExportBundle` has two consumers: the Publish Kit page, and
`src/app/api/admin/content-periods/[periodId]/content-export/route.ts` — whose
own header says it exists so *"an operator or a publishing agent"* can retrieve
content. Every structural guarantee this project built (`partitionArtifacts`,
`stripAccess`, the blocked-piece strip, `toAgentRecord`'s withheld branch)
lives in `publish-kit-pure.ts`, which that route does not import.

**This round's predecessor made it worse.** Before FU-1, artifacts in the
bundle carried no signed URL at all. They now carry working, one-hour,
`Content-Disposition: attachment` URLs — emitted for every artifact regardless
of version binding or `may_publish`, and printed verbatim by the Markdown
renderer. An agent reading the export now receives working download links for
artifacts bound to unapproved or superseded versions, with only a doc comment
telling it to check `version_id` itself.

**Do not unilaterally change the export's contract** — it is a separate,
documented feature whose stated purpose is to export exactly what exists, and
other consumers may depend on it.

Do this much, which is additive and safe:

### 5a. Make the bundle state the binding facts it already knows

For each artifact the bundle already knows whether it matches
`current_version_id` and whether the deliverable `may_publish`. Add to
`ContentExportArtifact`:

```ts
  /** True when version_id equals the deliverable's current_version_id. */
  matches_current_version: boolean;
```

and in `renderContentExportMarkdown`, for any artifact where
`matches_current_version` is false **or** the deliverable's `may_publish` is
false, replace the printed signed URL line with:

*"Signed URL withheld: this artifact is not bound to the deliverable's current
version, or the deliverable is not cleared to publish."*

Leave the JSON `signed_url` field as-is for now.

### 5b. Report the JSON decision to the owner

In your summary, state plainly that the JSON `signed_url` is still emitted
unconditionally, and that removing it for non-current or non-publishable
artifacts would be a **breaking change to a documented endpoint** and needs the
owner's decision. Do not make that call yourself.

---

## FU4-6 — Two truthfulness fixes

**File:** `src/components/portal/PublishKit.tsx`,
`src/lib/publish-kit-pure.ts` · **Severity: low**

### 6a. `stripAccess` over-strips `publicUrl`

`publish-kit-pure.ts:593-595` nulls `publicUrl` alongside the signed URL. The
schema is explicit that these are different kinds of thing: the migration's own
constraint comment says `public_url` "must be a stable public path" while
signed URLs "are generated on demand at read time, never persisted here". A
stable public path is not a credential — withholding it grants no
confidentiality and removes the one field that tells the operator *where the
live version currently sits*.

Note the existing asymmetry: the `versionAsset` strip (`:713-715`) already
nulls only `signedUrl`/`signedUrlExpiresAt`, which is the right shape.

**Fix:** give `stripAccess` a second parameter
`{ keepPublicUrl: boolean }`. Keep `publicUrl` for the blocked-piece bound-list
strip (FU3-3's call site) — that content is approved and its public URL is
public. Continue nulling it for other-version artifacts, where the URL could
point at content that was never approved.

### 6b. Header chips and blocked banner ignore the active filters

`PublishKit.tsx:160-177` computes from `view.totals` (all pieces) while the
list below renders only `visibleGroups`. With "Google Business" selected the
header can read "14 total / 2 blocked" and the banner assert *"The reason is
shown on each piece below"* when neither blocked piece is below.

**Fix:** compute the chip counts and the blocked-banner condition from the
filtered set. When a filter is active, append *"(filtered)"* to the chip row so
the numbers are not mistaken for the period totals.

---

## FU4-7 — Final verification

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. A blocked piece with `approved_version: null` and artifacts bound to its
   current version shows those artifacts in the main panel, labelled
   "Not approved", **not** under "Artifacts from other versions", and they
   still carry no `signedUrl`.
2. That same piece's copy column no longer claims it has no copy when it has a
   current version.
3. A retracted (superseded) artifact never beats an active one, and a
   slot retracted with no replacement carries the retraction warning.
4. `artifactControlState` returns all six states, each covered by a test
   asserting the state by name.
5. The same three artifacts in two different input orders produce an identical
   array, and no test calls `.sort()` on actual output before asserting.
6. The Markdown export withholds the signed-URL line for non-current or
   non-publishable artifacts.
7. `toAgentRecord` on a blocked piece still omits `body`, `plain_text`,
   `destination`, `publication_path`, `cta_target_path`, `artifacts`, and
   `version_asset` — the withholding property must survive this round
   untouched.
8. `git status` shows no migration files and no change to
   `DeliverableReview.tsx`; no file you touched performs a Supabase write.

---

## Definition of done

- [ ] Blocked pieces no longer describe their own current artifacts as another
      version's; the copy column no longer falsely claims no copy exists.
- [ ] `superseded_at` is exported; active artifacts beat retracted ones; a
      retracted-with-no-replacement slot warns.
- [ ] Both "append-only within a version" comments corrected to match the
      unique partial index.
- [ ] `artifactControlState` lives in the pure layer, covers six states
      including `unsigned`, and is exhaustively tested.
- [ ] Signing errors are captured and surfaced as a warning instead of
      silently rendering as "Download locked".
- [ ] Artifact order is deterministic; `comparePieces` has an `id` tie-break;
      no test masks order with `.sort()` on actual output.
- [ ] The Markdown export withholds signed URLs for non-current or
      non-publishable artifacts; the JSON decision is escalated, not made.
- [ ] `publicUrl` survives the blocked-piece strip; header chips respect
      filters.
- [ ] `npx tsc --noEmit` and `npm test` both pass, with real output pasted.

---

## Open question for the owner (do not implement)

Because `approved_version_id` is cleared whenever a new version is posted or
changes are requested, the deliverable row cannot tell the kit *what the lawyer
last approved* — that history lives in `approval_records`. The round-1 design
intent ("when blocked, show the approved version, never the newer one") is
therefore unimplementable from the current bundle.

Restoring it would mean the exporter resolving the most recent `approved`
decision from `approval_records` and loading that version. That is a feature
addition with real design questions attached (does an approval survive a later
rejection? how is a months-old approved version framed?), not a bug fix. Raise
it; do not build it.
