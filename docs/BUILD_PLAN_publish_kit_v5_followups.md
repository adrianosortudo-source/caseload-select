# BUILD PLAN — Publish Kit, fifth follow-up round

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** the v1 plan and the v1/v2/v3/v4 follow-up plans are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

Round 4 fixed two false **premises**. Its individual fixes were correct. This
round fixes what round 4 did *around* them: every one of those fixes changed a
fact, and in four cases the other consumers of that same fact were never
updated — including one that now hands out a working download link to
unapproved content. Two round-4 steps also interact to open a path that
neither opened alone.

Read section B before touching anything.

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

## A. What round 4 got right — do not undo these

You will be editing code that round 4 deliberately changed. Preserve all of it:

- `partitionArtifacts` anchoring on the current version rather than treating a
  blocked piece's artifacts as another version's (FU4-1). **FU5-6 refines the
  anchor; it does not revert it.**
- Active artifacts beating superseded ones in `dedupeArtifacts` (FU4-2).
- `artifactControlState` living in a pure, tested module (FU4-3).
- Deterministic artifact ordering and the `comparePieces` id tiebreak (FU4-4).
- The Markdown signed-URL withholding in `renderArtifact` (FU4-5). **FU5-3
  extends it to two sibling lines it never covered.**
- Header chips and the blocked banner respecting active filters (FU4-6b).
- `toAgentRecord`'s withholding property — the seven omitted keys. **This must
  survive this round untouched.**

The one round-4 decision this plan reverses is FU4-6a (`keepPublicUrl`); see
FU5-5 for why, and note that the reversal is a *decision*, flagged for the
owner, not a bug fix.

---

## B. The pattern in this round's findings (read before starting)

Round 4's lesson was "check the premise". This round's lesson is narrower and
more mechanical:

> When a round establishes a new fact, every consumer of that fact must be
> updated in the same step — and two fixes landing in one round can compose
> into a defect neither one causes alone.

Four concrete instances, all reproduced by running the real code:

**B1. `superseded_at` was exported and then only half-used.** FU4-2 wired it
into the dedupe *ranking* and into a piece warning. It was never wired into
the access decision or the label. `supersededAt` appears nowhere in
`PublishKit.tsx` and is not an input to `artifactControlState`. Observed, for
an approved and current deliverable whose only `social_image` row is
retracted:

```
ARTIFACT signedUrl : https://signed.example/a1.png
ARTIFACT supersededAt : 2026-07-03T00:00:00Z
CONTROL STATE THE UI COMPUTES : download
PIECE WARNINGS : ["One artifact slot has been retracted ... cannot be published."]
AGENT RECORD withheld : false
AGENT gets signed_url : https://signed.example/a1.png
```

The operator sees a navy **Download** anchor and, in the same card's footer, a
sentence saying it cannot be published. The download works.
`supabase/migrations/20260717001444_...:162-163` then raises
`publication receipt artifact_id references a superseded artifact` when the
receipt is recorded. The Markdown is the sharpest illustration: it prints
`- Superseded: … (retracted, not publishable)` and then the working signed URL
**four lines later**.

**B2. FU4-5 gated one of three link-emitting sites.** `renderArtifact` is
gated. `renderVersionSection` (`content-period-export.ts:676`) takes no
`may_publish` parameter at all and prints the signed URL whenever one exists;
`renderDeliverable` calls it unconditionally at `:760`. For a
`lead_magnet_pdf`, the version asset **is** the deliverable's content, not an
accessory. So the export withholds the crop and publishes the payload.

**B3. FU4-1 and FU4-6a compose into a leak neither causes alone.** Before
FU4-1, a blocked piece's bound artifact list was **always empty**, so FU3-3's
strip applied to nothing and `keepPublicUrl` was moot. FU4-1 populated that
list with the current, *unapproved* artifacts. FU4-6a then chose to keep
`publicUrl` on it, justified in the v4 plan (line 477) as *"that content is
approved and its public URL is public."* That sentence was falsified by FU4-1
earlier in the same round. Observed, on a `changes_requested` piece:

```
bound artifact : a-rejected
  signedUrl : null
  publicUrl : https://drglaw.ca/just-rejected.png
Provenance renders `Public URL`? true
```

`PublishKit.tsx:775` guards on `{!locked && publicUrl && …}` and the bound
call site never passes `locked`, so a live link to just-rejected material is
rendered in the disclosure and sits in the RSC payload. Pre-round-4 it was
null in both places.

**B4. FU4-2 changed the dedupe rule and left the sentence describing it.**
Observed, one active row created 2026-07-01 versus one superseded row created
2026-07-09 in the same slot:

```
KEPT : [ 'a-active-OLD' ]
WARNING SAYS : "1 superseded artifact ... only the most recently created artifact per slot is shown."
```

The kept artifact is the *older* one. The sentence also calls a discarded
*active* row "superseded", which now collides with the real `superseded_at`
meaning FU4-2 introduced.

---

## FU5-1 — Give the link decision one home, shared by both consumers

**Files:** new `src/lib/artifact-links.ts`, `src/lib/publish-kit-pure.ts`,
`src/lib/__tests__/publish-kit-pure.test.ts`, new
`src/lib/__tests__/artifact-links.test.ts`
**Severity: structural — this step exists so B1/B2/B4 cannot recur**

Three of this round's findings are the same defect: two files deciding
independently whether an artifact's links may be shown, and drifting. There is
no shared module today because `publish-kit-pure.ts` already imports types
from `content-period-export.ts`, so a runtime import back would be a cycle.
A third module both can import breaks the tie.

**This step is a pure move. No behaviour changes. Tests must pass unchanged
apart from the import path.**

### 1a. Create `src/lib/artifact-links.ts`

Move `ArtifactControlState` and `artifactControlState` out of
`publish-kit-pure.ts` into this new file **verbatim**, including their doc
comments. The new file imports nothing from either existing module. Header:

```ts
/**
 * The single decision about whether an artifact's links may be shown, and
 * what a disabled control should say instead.
 *
 * This module exists because two independent consumers make that decision --
 * the Publish Kit UI (via publish-kit-pure.ts) and the Markdown/JSON export
 * (content-period-export.ts) -- and in round 4 they drifted apart: the UI
 * withheld a signed URL that the export printed, and the export named an
 * artifact "retracted, not publishable" four lines above a working link to
 * it. publish-kit-pure.ts already imports types from content-period-export.ts,
 * so neither can import the other at runtime. Both import this instead.
 *
 * No I/O, no React, no Supabase. Unit-tested in
 * __tests__/artifact-links.test.ts.
 */
```

### 1b. Re-export for compatibility

In `publish-kit-pure.ts`, replace the moved definitions with:

```ts
export { artifactControlState, type ArtifactControlState } from "@/lib/artifact-links";
```

so `PublishKit.tsx`'s existing import keeps working untouched.

### 1c. Move the tests

Move the whole `describe("artifactControlState", …)` block from
`publish-kit-pure.test.ts` into a new
`src/lib/__tests__/artifact-links.test.ts`, importing from
`@/lib/artifact-links`. Do not change a single assertion.

**Acceptance:** `npx tsc --noEmit` clean, `npm test` green, and the
`artifactControlState` test count is identical before and after.

---

## FU5-2 — A retracted artifact must never be downloadable, anywhere

**Files:** `src/lib/artifact-links.ts`, `src/lib/publish-kit-pure.ts`,
`src/components/portal/PublishKit.tsx`, both test files
**Severity: HIGH** — see B1

### 2a. Make supersession an input to the decision

In `artifact-links.ts`, add `retracted` to the union and to the input, ordered
**after** `other_version` (version binding stays the primary discriminator)
and **before** `unapproved` (retraction is the more specific and more final
fact: approval will never make a retracted artifact publishable):

```ts
export type ArtifactControlState =
  | "no_file"
  | "other_version"
  | "retracted"
  | "unapproved"
  | "locked"
  | "unsigned"
  | "download";

export function artifactControlState(input: {
  storagePath: string | null;
  locked: boolean;
  supersededAt: string | null;
  unapproved: boolean;
  mayPublish: boolean;
  signedUrl: string | null;
}): ArtifactControlState {
  if (!input.storagePath) return "no_file";
  if (input.locked) return "other_version";
  if (input.supersededAt) return "retracted";
  if (input.unapproved) return "unapproved";
  if (!input.mayPublish) return "locked";
  if (!input.signedUrl) return "unsigned";
  return "download";
}
```

Document `retracted` in the state list comment: *the database enforces at most
one active artifact per slot and rejects a publication receipt that references
a superseded one, so this artifact can be shown as evidence but never
published.*

### 2b. Make the guarantee structural, not presentational

`PublishKit.tsx` is a `"use client"` component: a label alone is not a
guarantee, because `signedUrl` still ships in the RSC payload. In `toPiece`,
strip a retracted artifact's links **regardless of `may_publish`**. Replace
the current bound-list strip with a single expression:

```ts
  // Two independent reasons to withhold a working link, applied together:
  // the piece is not cleared to publish, OR this specific artifact has been
  // retracted (a superseded row is historical evidence; the database rejects
  // a publication receipt that references it). The strip is structural rather
  // than a UI choice because PublishKit is a "use client" component and every
  // field on the view model is serialised into the page regardless of what
  // JSX renders.
  const boundArtifacts = dedupedBoundArtifacts.map((a) =>
    !deliverable.may_publish || a.supersededAt ? stripAccess(a) : a,
  );
```

(After FU5-5 `stripAccess` takes no options, so this reads exactly as written.
If you are executing steps in order, write it with `stripAccess(a)` now and
FU5-5 will already agree.)

### 2c. Pass it through the UI

Both `ArtifactBlock` call sites that render real artifacts must pass
`supersededAt={artifact.supersededAt}`. Add `supersededAt?: string | null` to
the props. The version-asset call site passes `supersededAt={null}` — a
version asset is not a `publication_artifacts` row and has no supersession
concept.

Add the label branch: `retracted` → **"Retracted"**. Keep every existing class
string, `aria-disabled` on every non-anchor state, and no `onClick`.

### 2d. Tell the agent

`toAgentRecord` ships `artifacts: piece.artifacts` wholesale, so `supersededAt`
already reaches a publishing agent — but nothing tells it to look. After 2b the
`signedUrl` is null, which makes a retracted artifact unusable rather than
merely inadvisable. Record that in the `AgentRecordPublishable.artifacts` doc
comment:

```ts
  /**
   * Artifacts bound to the version being published. An entry whose
   * `supersededAt` is non-null has been retracted: it carries no `signedUrl`
   * and must never be published. The database rejects a publication receipt
   * that references a superseded artifact.
   */
  artifacts: PublishKitArtifact[];
```

Do **not** add a `warnings` field to the agent record. That is a contract
change and is out of scope; the null `signedUrl` plus `supersededAt` is
sufficient and is enforced structurally.

### 2e. Tests

In `artifact-links.test.ts`, extend the exhaustive suite: `retracted` is
returned when `supersededAt` is set and `storagePath` exists and `locked` is
false; `other_version` still wins over `retracted`; `retracted` wins over
`unapproved`, over `locked`, and over `unsigned`.

In `publish-kit-pure.test.ts`, a new
`describe("a retracted artifact is never downloadable", …)`:

1. On a **publishable** piece (`may_publish: true`), a bound artifact with
   `superseded_at` set has `signedUrl` and `signedUrlExpiresAt` null, and
   keeps `storagePath` and `sha256`.
2. On that same piece, a **non**-retracted bound artifact in a different slot
   still keeps its `signedUrl` — the strip is per artifact, not per piece.
3. `toAgentRecord` on that publishable piece returns the retracted artifact
   with `signedUrl` null and `supersededAt` set.

**Acceptance:** revert 2b (drop the `|| a.supersededAt`), watch tests 1 and 3
fail, restore. Then revert 2a's ordering (move the `supersededAt` check below
`mayPublish`), watch the `artifact-links` retracted-beats-locked case fail,
restore.

---

## FU5-3 — Close the two link-emitting sites FU4-5 never covered

**Files:** `src/lib/artifact-links.ts`, `src/lib/content-period-export.ts`,
`src/lib/__tests__/content-period-export.test.ts`
**Severity: HIGH** — see B2

### 3a. One predicate, used by every Markdown link line

In `artifact-links.ts`:

```ts
/**
 * Whether a temporary signed URL (and the public path beside it) must be
 * withheld from an export consumer. Three independent reasons, any of which
 * is sufficient: the object is not bound to the deliverable's current
 * version; the deliverable is not cleared to publish; or the artifact has
 * been retracted. Used by every link-emitting line in the Markdown export so
 * one gate cannot be updated while a sibling is missed -- the exact failure
 * that let renderVersionSection publish an unapproved lead-magnet PDF while
 * renderArtifact correctly withheld the crop beside it.
 */
export function shouldWithholdArtifactLinks(input: {
  matchesCurrentVersion: boolean;
  deliverableMayPublish: boolean;
  supersededAt: string | null;
}): boolean {
  return (
    !input.matchesCurrentVersion ||
    !input.deliverableMayPublish ||
    Boolean(input.supersededAt)
  );
}
```

### 3b. Gate the version section

Give `renderVersionSection` a third parameter `withholdLinks: boolean`. When
true, replace the two signed-URL lines with the single line already used by
`renderArtifact`:

```
- Signed URL withheld: this version is not the deliverable's current version, or the deliverable is not cleared to publish.
```

Keep `Storage path`, `Asset name`, `Asset MIME`, `Asset size`, and
`Asset SHA-256` printing unconditionally — those are durable identity, not
access, and the whole export exists to report them.

In `renderDeliverable`, compute the argument at each call site:

```ts
  lines.push(
    renderVersionSection(
      "Current version",
      d.current_version,
      shouldWithholdArtifactLinks({
        matchesCurrentVersion: true, // the current version is trivially itself
        deliverableMayPublish: d.may_publish,
        supersededAt: null, // versions are not publication_artifacts rows
      }),
    ),
  );
  if (d.approved_version) {
    lines.push(
      renderVersionSection(
        "Approved version, differs from current",
        d.approved_version,
        // Always withheld: by definition this is not the current version.
        true,
      ),
    );
  }
```

### 3c. Route `renderArtifact` through the same predicate

Replace its inline `withholdSignedUrl` with a
`shouldWithholdArtifactLinks({ matchesCurrentVersion: a.matches_current_version, deliverableMayPublish, supersededAt: a.superseded_at })`
call. This is behaviour-changing in exactly one way, and it is the point:
a **retracted** artifact on a publishable, current-version deliverable now has
its URL withheld instead of printed four lines under
`Superseded: … (retracted, not publishable)`.

### 3d. Gate `public_url` too

`content-period-export.ts:730` prints `public_url` unconditionally, after the
withholding branch. The pure layer nulls exactly that field for an
other-version artifact, with the stated reason that the path "could point at
content that was never approved". Apply the same gate — move the
`public_url` line inside the non-withheld branch. This makes the two consumers
agree on one field instead of disagreeing.

### 3e. Tests

In `content-period-export.test.ts`:

1. A `lead_magnet_pdf` in `in_review` whose `current_version.storage_path` is
   set: the Markdown contains `Signed URL withheld` and does **not** contain
   the version's signed URL. **This is the leak; write this test first and
   watch it fail before writing 3b.**
2. The same deliverable when `approved` and current: the Markdown **does**
   contain the version's signed URL.
3. A retracted artifact on an approved, current deliverable: the Markdown
   contains both `Superseded:` and `Signed URL withheld`, and does not contain
   that artifact's signed URL.
4. An other-version artifact with a `public_url`: the Markdown does not
   contain the public URL.

**Acceptance:** for each of 1 and 3, revert the corresponding gate and confirm
the test genuinely fails, then restore.

---

## FU5-4 — A blocked file deliverable's content must be findable

**Files:** `src/lib/publish-kit-pure.ts`,
`src/components/portal/PublishKit.tsx`, `src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: HIGH**

FU4-1 anchored *artifacts* on the current version but left `versionAsset`
alone. `selectVersion`'s third branch still returns `versionAsset: null` and
`versionNumber: null` for **every** blocked piece. For `lead_magnet_pdf` and
image roles the version asset *is* the deliverable. Observed, on an ordinary
`changes_requested` checklist PDF:

```
versionAsset : null
versionNumber : null
artifacts.length : 0
warnings : []
>>> COPY COLUMN SAYS   : "This piece is delivered as a file. See the artifacts panel."
>>> ARTIFACTS PANEL SAYS : "No artifacts registered for this piece yet."
>>> BUT THE FILE EXISTS AT : deliverables/f1/d1/checklist.pdf
```

Two sentences pointing at each other, no warning, and the deliverable's actual
content unreachable.

### 4a. Show the current version's asset, still locked

`selectVersion`'s third branch returns the current version's **asset and
number** while keeping `bodyHtml` and `versionId` null. The body stays hidden
by design (FU4-1c's copy message sends the operator to the review page for the
draft); the *file* is what is currently unfindable.

```ts
  // No version is cleared to display. The body stays hidden -- unapproved copy
  // is never rendered here -- but the current version's ASSET is still this
  // piece's real content for an image or pdf deliverable, so it is surfaced
  // (download-locked, labelled "Not approved" by artifactControlState) rather
  // than silently omitted. versionId stays null: nothing is cleared to show,
  // which is what displayedVersionId means.
  return {
    bodyHtml: null,
    versionNumber: deliverable.current_version?.version_number ?? null,
    versionId: null,
    versionAsset: toVersionAsset(deliverable.current_version),
    warnings: [],
  };
```

The existing `strippedVersionAsset` logic already nulls `signedUrl` and
`signedUrlExpiresAt` when `!may_publish`, so this surfaces no working link.
**Verify that by test, do not assume it.**

### 4b. Make "is the panel empty" a tested fact, not a JSX expression

Add to `PublishKitPiece`:

```ts
  /**
   * Whether the artifacts panel will render anything at all. The copy column
   * points the operator at that panel for image and pdf pieces, so that
   * sentence is only true when this is true.
   */
  hasAnyArtifactToShow: boolean;
```

Set it to
`Boolean(strippedVersionAsset) || boundArtifacts.length > 0 || otherVersionArtifacts.length > 0`.
Replace the equivalent inline condition in `PublishKit.tsx`'s empty-state with
`!piece.hasAnyArtifactToShow`.

### 4c. Stop the copy column pointing at an empty panel

`PublishKit.tsx` currently tests `contentKind` first, so a file piece always
gets "See the artifacts panel" even when the panel is empty. Branch on the
panel's real state:

```tsx
{(piece.contentKind === "image" || piece.contentKind === "pdf") && piece.hasAnyArtifactToShow
  ? "This piece is delivered as a file. See the artifacts panel."
  : !piece.mayPublish && piece.currentVersionId
    ? "This piece has copy, but no version is currently approved. Open the review page to read the current draft."
    : "No approved copy for this piece yet."}
```

### 4d. Label the version asset correctly

The version-asset `ArtifactBlock` passes no `unapproved` prop, so once 4a makes
it reachable for a blocked piece it would read **"Download locked"** — a
permission claim about content whose real problem is that it is not approved.
Pass `unapproved={piece.boundArtifactsAreUnapproved}` and
`versionId={piece.displayedVersionId ?? piece.currentVersionId}` so the
provenance panel names the version the asset actually belongs to.

### 4e. Tests

New `describe("a blocked file deliverable's asset stays findable", …)`, built
from a bundle the exporter can emit (`may_publish: false`,
`approved_version: null`, `current_version` with a `storage_path`):

1. `versionAsset` is non-null and its `storagePath` matches.
2. `versionAsset.signedUrl` and `signedUrlExpiresAt` are null.
3. `versionNumber` is the current version's number, not null.
4. `hasAnyArtifactToShow` is true.
5. For a blocked piece whose current version has **no** `storage_path` and no
   artifacts, `hasAnyArtifactToShow` is false.
6. `toAgentRecord` on that blocked piece still omits `version_asset` entirely
   — the withholding property must not regress.

**Acceptance:** revert 4a, watch 1, 3 and 4 fail, restore.

---

## FU5-5 — Withhold an unapproved artifact's public URL again

**Files:** `src/lib/publish-kit-pure.ts`, `src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: HIGH** — see B3

FU4-6a's `keepPublicUrl: true` was justified by a sentence FU4-1 had already
made false. Because the strip is applied only when `!may_publish`, and because
FU4-1 filled that list with the *current, unapproved* artifacts, the option's
`true` branch now applies to unapproved artifacts and **only** to unapproved
artifacts. There is no case it serves.

**Revert it, and delete the option** so the asymmetry cannot be reintroduced:

```ts
function stripAccess(artifact: PublishKitArtifact): PublishKitArtifact {
  return { ...artifact, signedUrl: null, signedUrlExpiresAt: null, publicUrl: null };
}
```

Rewrite the doc comment to say plainly that a *public* path is still withheld
for material that is not cleared, because for an unapproved or other-version
artifact the path may point at content that was never approved — or at nothing
at all, since an unapproved artifact has typically not been deployed. Simplify
the two `map((a) => stripAccess(a))` call sites back to `map(stripAccess)`.

Update the FU4-6a test to assert the opposite: a blocked piece's bound
artifact has `publicUrl` **null**. Keep the other-version assertion as is.

**Note for the owner, to include in your summary:** this reverses a decision
made one round ago. It is reversible; if the owner wants an operator to see
where a blocked piece's asset currently sits, the right place is the review
page, not a provenance disclosure on a card whose every control is disabled.

---

## FU5-6 — Anchor on a version the exporter proved this deliverable owns

**Files:** `src/lib/publish-kit-pure.ts`, `src/lib/content-period-export.ts`,
`src/lib/__tests__/publish-kit-pure.test.ts`
**Severity: medium**

`content-period-export.ts`'s `resolveOwnedVersion` exists so that a dangling or
cross-wired `current_version_id` is "treated exactly like a missing version
everywhere in this module" — but the module still exports the **raw pointer**,
and FU4-1 anchored on it. Observed, with `current_version_id: "v-foreign"` and
`current_version: null` (the exact corruption `resolveOwnedVersion` defends
against):

```
BOUND (main panel, labelled "Not approved") : a-foreign pub=https://drglaw.ca/foreign.png signed=null
OTHER (disclosure, stripped)                : (empty)
```

Another deliverable's artifacts are promoted into this piece's main panel and
presented as its own current artifacts. Pre-round-4 they sat in the disclosure
with everything stripped.

### 6a. Derive from the resolved version

In `toPiece`, use the version the exporter actually resolved and proved owned:

```ts
  // deliverable.current_version is non-null only when content-period-export's
  // resolveOwnedVersion proved the row exists AND belongs to this deliverable.
  // Anchoring on the raw current_version_id pointer instead would let a
  // dangling or cross-wired pointer promote another deliverable's artifacts
  // into this piece's main panel as its own.
  const ownedCurrentVersionId = deliverable.current_version?.id ?? null;
```

Use `ownedCurrentVersionId` for all three of: `currentVersionId` on the piece,
the `anchorVersionId` fallback, and `boundArtifactsAreUnapproved`.

### 6b. Same for `matches_current_version`

In `content-period-export.ts`, compute it from the resolved version rather than
the raw column, so the export and the UI cannot disagree:

```ts
matches_current_version: currentResolved.version !== null && a.version_id === currentResolved.version.id,
```

### 6c. Tests

1. A deliverable with `current_version_id` set and `current_version: null`
   (foreign/dangling): `piece.currentVersionId` is null,
   `boundArtifactsAreUnapproved` is false, `artifacts` is empty, and every
   artifact is in `otherVersionArtifacts` with `signedUrl` and `publicUrl`
   null.
2. The normal case is unchanged: `current_version` present ⇒ artifacts bound to
   it land in `artifacts`.

**Acceptance:** revert 6a, watch test 1 fail, restore.

---

## FU5-7 — Two warnings that state the opposite of what the code does

**File:** `src/lib/publish-kit-pure.ts`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: medium**

### 7a. The dedupe warning contradicts FU4-2 — see B4

Replace the sentence so it describes the rule actually implemented, and stop
it calling a discarded *active* row "superseded" now that the word has a
precise database meaning:

```ts
`${discardedCount} duplicate artifact${discardedCount === 1 ? "" : "s"} for this version ${
  discardedCount === 1 ? "was" : "were"
} filtered; one artifact is shown per slot, preferring an active row over a retracted one and, among equals, the most recently created.`
```

### 7b. The retraction warning hardcodes "One"

`.some()` yields a fixed sentence regardless of count; two retracted slots
still report one. Count them and pluralise, matching the file's existing
convention:

```ts
  const retractedCount = boundArtifacts.filter((a) => a.supersededAt).length;
  const retractedSlotWarnings =
    retractedCount > 0
      ? [
          `${retractedCount} artifact slot${retractedCount === 1 ? " has" : "s have"} been retracted with no active replacement. ${
            retractedCount === 1 ? "It is" : "They are"
          } shown for reference and cannot be published.`,
        ]
      : [];
```

Note this now reads `boundArtifacts` (post-strip) rather than
`dedupedBoundArtifacts`; both contain the same rows, and reading the final
list keeps the warning aligned with what is rendered.

### 7c. Tests

1. Active-older versus superseded-newer in one slot: the kept artifact is the
   active one **and** the warning does not contain the phrase
   "most recently created artifact per slot".
2. Two retracted slots on one piece: the warning says "2 artifact slots have
   been retracted".
3. One retracted slot: the warning says "1 artifact slot has been retracted".

---

## FU5-8 — The signing-error warning duplicates, misattributes, and breaks React keys

**Files:** `src/lib/content-period-export.ts`,
`src/components/portal/PublishKit.tsx`,
`src/lib/__tests__/content-period-export.test.ts` · **Severity: medium**

The identical string is pushed from three sites — the current-version signer,
the approved-version signer, and once **per artifact** inside
`Promise.all(map(…))`. It is not a race (JS is single-threaded and the array
is read after the `await`), but it duplicates, it misattributes, and the
duplicates collide downstream.

### 8a. One warning per kind, with a count

Replace the three pushes with two counters accumulated during the loop and at
most two warnings pushed **after** it — which also removes the
`Promise.all`-ordering nondeterminism in the warnings array:

```ts
  if (versionSigningFailures > 0) {
    warnings.push(
      "This deliverable's version asset has a stored file but its download link could not be generated. Refresh to retry.",
    );
  }
  if (artifactSigningFailures > 0) {
    warnings.push(
      `${artifactSigningFailures} artifact${artifactSigningFailures === 1 ? "" : "s"} ${
        artifactSigningFailures === 1 ? "has" : "have"
      } a stored file but ${artifactSigningFailures === 1 ? "its" : "their"} download link${
        artifactSigningFailures === 1 ? "" : "s"
      } could not be generated. Refresh to retry.`,
    );
  }
```

The version-asset wording is the fix for the misattribution: the current code
says "An artifact" when a *version asset* failed, and the round-4 test at
`content-period-export.test.ts:571-587` asserts that exact wrong string —
**update that test, do not preserve it.**

### 8b. Stable React keys

`PublishKit.tsx` renders `piece.warnings.map((w) => <p key={w}>{w}</p>)`.
Warning text is not a key. Use the index, which is stable for a
server-rendered static list:

```tsx
{piece.warnings.map((w, i) => (
  <p key={`${piece.id}-warning-${i}`}>{w}</p>
))}
```

### 8c. Tests

1. Two artifacts failing to sign on one deliverable produce **exactly one**
   warning, and it contains "2 artifacts".
2. A version-asset signing failure produces a warning containing
   "version asset" and **not** the word "artifact has".
3. Both failing together produce exactly two warnings.

---

## FU5-9 — Two comments and one fixture that now lie

**Files:** `src/lib/publish-kit-pure.ts`,
`src/lib/__tests__/publish-kit-pure.test.ts` · **Severity: low**

### 9a. `PublishKitArtifact.versionId`'s instruction is now wrong

It reads *"Compare against `PublishKitPiece.displayedVersionId` before ever
treating this as evidence for the piece currently on screen."* After FU4-1 a
blocked piece's bound artifacts have `versionId === currentVersionId` while
`displayedVersionId` is null, so a consumer following that instruction
concludes none of them are evidence — the opposite of what FU4-1 established.
Correct it to name `displayedVersionId ?? currentVersionId` and say why.

### 9b. Make the artifact fixture self-consistent

`makeArtifact` defaults `matches_current_version: true` and roughly twenty
call sites bind an artifact to a different `version_id` without overriding it,
so those fixtures declare a falsehood. Nothing reads the field today, which is
exactly how the round-4 class of bug starts. Fix it at the source rather than
at twenty call sites: in `makeDeliverable`, after the overrides are spread,
recompute the flag for every artifact from the deliverable actually being
built.

```ts
  // Keep fixtures honest: matches_current_version is derived data, and a
  // fixture that hand-declares it can assert a state the exporter cannot
  // produce -- the failure mode this whole follow-up series exists to catch.
  const built = { ...defaults, ...overrides };
  return {
    ...built,
    artifacts: built.artifacts.map((a) => ({
      ...a,
      matches_current_version:
        built.current_version_id !== null && a.version_id === built.current_version_id,
    })),
  };
```

Then confirm the existing suite still passes unchanged — if any test breaks,
it was asserting on an impossible shape and the test is what is wrong.

---

## FU5-10 — Final verification

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. A retracted artifact on an **approved, current** deliverable renders
   "Retracted", carries no `signedUrl` in the view model, and its signed URL
   is absent from the Markdown export.
2. A `lead_magnet_pdf` in `in_review` with a stored version asset: the
   Markdown contains "Signed URL withheld" and does not contain that version's
   signed URL.
3. A blocked file deliverable shows its version asset, labelled "Not
   approved", with no working link — and the copy column no longer points at
   an empty panel.
4. A blocked piece's bound artifact has `publicUrl` null.
5. A deliverable whose `current_version_id` does not resolve to an owned
   version puts every artifact in `otherVersionArtifacts`, fully stripped.
6. The dedupe warning no longer claims "most recently created"; retraction
   warnings pluralise.
7. Two artifacts failing to sign produce one warning saying "2 artifacts", and
   a version-asset failure says "version asset".
8. `toAgentRecord` on a blocked piece still omits `body`, `plain_text`,
   `destination`, `publication_path`, `cta_target_path`, `artifacts`, and
   `version_asset`.
9. `git status` shows no migration files and no change to
   `DeliverableReview.tsx`; no file you touched performs a Supabase write.

---

## Definition of done

- [ ] `artifactControlState` and `shouldWithholdArtifactLinks` live in one
      module imported by both consumers.
- [ ] A retracted artifact is never downloadable in the UI, the agent record,
      or the Markdown export.
- [ ] `renderVersionSection` and the `public_url` line are gated by the same
      predicate as `renderArtifact`.
- [ ] A blocked file deliverable's version asset is visible and locked;
      `hasAnyArtifactToShow` gates the copy column's pointer.
- [ ] `stripAccess` has no `keepPublicUrl` option; unapproved artifacts
      withhold `publicUrl` again.
- [ ] The artifact anchor and `matches_current_version` both derive from the
      exporter's resolved, ownership-checked version.
- [ ] The dedupe and retraction warnings describe the implemented rule and
      pluralise.
- [ ] Signing failures produce one warning per kind, correctly attributed,
      with stable React keys.
- [ ] `npx tsc --noEmit` and `npm test` both pass, with real output pasted.

---

## Still open, and deliberately not built

Two items carried forward from round 4, both unchanged and both still the
owner's call:

1. **JSON `signed_url` in `/api/admin/content-periods/[periodId]/content-export`
   is still emitted unconditionally** for every artifact regardless of version
   binding, `may_publish`, or retraction. This round gates the **Markdown**
   view completely; the JSON field is untouched because removing it is a
   breaking change to a documented endpoint that other consumers may rely on.
   Note that after FU5-3 the two views of the same bundle disagree — Markdown
   withholds, JSON does not — which is a stronger argument than round 4 had
   for making the change, but it is still not the implementing agent's to make.

2. **Reconstructing a blocked piece's last genuinely approved content from
   `approval_records`.** `approved_version_id` is cleared whenever a new
   version is posted or changes are requested, so the deliverable row cannot
   say what the lawyer last approved. FU5-4 makes the *current* version's asset
   findable, which addresses the operator's immediate problem, but it does not
   restore the round-1 design intent of showing the approved version. That
   remains a feature with real design questions attached, not a bug fix.

One new decision was made rather than escalated, and should be reviewed:
**FU5-5 reverses FU4-6a.** The reasoning is in that step; reversing it again
would be a one-line change.
