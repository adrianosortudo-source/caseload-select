# BUILD PLAN — Publish Kit v1, follow-up adjustments

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** `docs/BUILD_PLAN_publish_kit_v1.md` is built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

This plan fixes defects found in two independent audits of the v1 build. The v1
build was faithful to its own plan; most of these gaps are ones the v1 plan did
not anticipate. Nothing here re-opens a settled architectural decision.

---

## 0. Commands and constraints

```bash
npx tsc --noEmit
```

```bash
npm test
```

- **`npm run lint` is broken repo-wide and is not yours to fix.** Next.js 16.2.9
  removed the built-in `next lint`, and no `eslint` package or config is
  installed. Do not install ESLint. Do not add a config. Verify with
  `npx tsc --noEmit` and `npm test` only.
- `vitest` runs in a **node** environment and only collects
  `src/**/__tests__/**/*.test.ts`. **`.test.tsx` never runs.** Anything needing a
  test goes in a pure `.ts` module.
- Still read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Do not import `@/lib/publication-manifest` or `@/lib/publication-readiness*`
  into the Publish Kit. (You may *read* them for reference; do not import.)
- Tailwind tokens only; square corners; **never a coloured left-edge accent bar
  on a callout** — full hairline border plus tinted background.
- No orphan words in UI copy.

---

## The core defect (FU-1 to FU-4) — read before starting

Each `publication_artifacts` row carries a `version_id` binding it to one
deliverable version. The table is an append-only, version-bound ledger: a new
version gets a **new row**, and old rows are never mutated. Its own migration
header states that staleness "is a DERIVED property computed by comparing an
artifact's `version_id` against the deliverable's current approved version."

`publication-readiness.ts:78-86` does exactly that, splitting `{ current, stale }`.

`content-period-export.ts` does **not**. It groups artifacts by `deliverable_id`
alone (`:413-417`) and `ContentExportArtifact` never exposes `version_id`. The
bundle therefore carries every artifact from every version, indistinguishably.

In v1 that was an inert JSON field. The Publish Kit turned it into a row of live
**Download buttons**.

**Failure A.** An article approved at v3 has `social_image` rows at v1, v2 and v3
— three rows, by design. The kit renders three identical "Social Image" blocks,
three live downloads, no version marker. The operator downloads the v1 crop,
which may carry a claim the lawyer removed, and posts it with approved v3 text.

**Failure B.** A deliverable approved at v2 gets an unapproved v3 draft. The kit
correctly shows v2 copy — then lists the **v3** artifacts beneath it as if they
belonged to this piece, and prints their `public_url` verbatim in the provenance
panel regardless of `mayPublish`. The signed download is locked; the plain URL is
not, and is copy-pasteable.

**Failure C.** "Copy week manifest" hands the publishing agent a
`publishable: true` record whose `artifacts` array contains all three versions
with nothing to discriminate on. The agent has no basis to pick correctly.

FU-1 to FU-4 fix this end to end.

---

## FU-1 — Export `version_id` and `mime_type` on artifacts

**File:** `src/lib/content-period-export.ts` · **Severity: high**

### 1a. Interface

In `export interface ContentExportArtifact` (~line 85), after `id: string;`:

```ts
  /**
   * The deliverable version this artifact was registered against. An artifact
   * is evidence for ONE version: a crop cut for v2 is not evidence for v5.
   * Consumers must compare this against the version they are publishing and
   * never present a non-matching artifact as current.
   */
  version_id: string;
```

And after `size_bytes: number | null;`:

```ts
  /** MIME type recorded on the artifact row, when known. */
  mime_type: string | null;
```

### 1b. Populate both

In the `exportArtifacts` mapping (inside the `await Promise.all`), add
`version_id: a.version_id,` after `id: a.id,` and `mime_type: a.mime_type,`
after `size_bytes: a.size_bytes,`.

Both fields already exist on `PublicationArtifact` (`src/lib/types.ts:434,445`).

### 1c. Markdown renderer

In `renderArtifact`, after the artifact-type heading line, add:

```ts
  lines.push(`  - Bound to version: \`${a.version_id}\``);
```

and a MIME line alongside the existing size line when `a.mime_type` is set.

### 1d. Tests

**File:** `src/lib/__tests__/content-period-export.test.ts`

Add to the existing artifact `describe` block: an artifact row registered against
`"v1"` with `mime_type: "image/png"` exports `version_id === "v1"` and
`mime_type === "image/png"`. Existing fixtures already set `version_id`.

**Acceptance:** `npx tsc --noEmit` clean, `npm test` green, no existing assertion
weakened.

---

## FU-2 — Complete the version asset in the view model and the agent record

**File:** `src/lib/publish-kit-pure.ts` · **Severity: medium**

Two related gaps:

- `toVersionAsset` (~line 424) reads `version.storage_path` for its null guard
  but never copies it out, and `PublishKitPiece["versionAsset"]` has no
  `storagePath`. So `PublishKit.tsx` hardcodes `storagePath={null}` and the
  version asset's provenance panel is empty or merely repeats the SHA-256 shown
  two rows above. The storage path is the **canonical, non-expiring** identity
  (see `content-period-export.ts:57,61-69`) and is currently invisible.
- `AgentRecordPublishable` has no `version_asset`. For an `image` or `pdf`
  deliverable the version asset **is** the deliverable, and the bundle explicitly
  warns when no `publication_artifacts` exist. So a publishable PDF can yield an
  agent record with empty `body`, empty `artifacts`, and no pointer to the
  approved file at all.

### 2a. Add `storagePath` to the version asset

Add `storagePath: string | null;` to `PublishKitPiece["versionAsset"]` and
populate it in `toVersionAsset` from `version.storage_path`.

### 2b. Add `version_asset` to the publishable agent record

Add to `AgentRecordPublishable`:

```ts
  version_asset: {
    name: string | null;
    mime: string | null;
    size_bytes: number | null;
    sha256: string | null;
    storage_path: string | null;
    signed_url: string | null;
  } | null;
```

Populate it in `toAgentRecord`'s publishable branch from `piece.versionAsset`.
**Do not** add it to the withheld branch — the early return must stay exactly as
it is.

### 2c. Tests

- A piece whose version has a `storage_path` exposes it on `versionAsset`.
- A publishable piece with a version asset yields an agent record whose
  `version_asset.storage_path` and `.sha256` match.
- A **blocked** piece still has no `version_asset` key at all — assert with
  `expect(record).not.toHaveProperty("version_asset")`.

---

## FU-3 — Partition artifacts by the displayed version

**File:** `src/lib/publish-kit-pure.ts` · **Severity: high**

The kit shows the **current** version when `may_publish` is true and the
**approved** version when false (`selectVersion`, ~line 444). Artifacts must be
judged against whichever version is actually on screen.

### 3a. Return the displayed version id

`selectVersion` returns `{ bodyHtml, versionNumber, versionAsset, warnings }` and
does not return the version id, so it is unavailable downstream. Add
`versionId: string | null` and populate in all three branches:

- `may_publish` true → `deliverable.current_version?.id ?? null`
- `may_publish` false with an approved version → `deliverable.approved_version.id`
- neither → `null`

### 3b. Carry the fields onto `PublishKitArtifact`

Add `versionId: string;` and `mime: string | null;`, populated in `toArtifact`
from `artifact.version_id` and `artifact.mime_type`.

### 3c. Add two fields to `PublishKitPiece`

```ts
  /** The version whose body and assets this card is showing. */
  displayedVersionId: string | null;
  /**
   * Artifacts registered against a DIFFERENT version than the one displayed.
   * Never downloadable, never in the agent record: a crop cut for another
   * version is not evidence for this one.
   */
  otherVersionArtifacts: PublishKitArtifact[];
```

Redefine `artifacts` in a comment: bound to `displayedVersionId` only.

### 3d. Partition in `toPiece`

```ts
  const allArtifacts = deliverable.artifacts.map(toArtifact);
  const boundArtifacts = versionId
    ? allArtifacts.filter((a) => a.versionId === versionId)
    : [];
  const otherVersionArtifacts = versionId
    ? allArtifacts.filter((a) => a.versionId !== versionId)
    : allArtifacts;
```

When `versionId` is null there is no version on screen, so **every** artifact is
"other" and none is presented as current. That is the safe direction.

### 3e. Withhold from the agent record

`toAgentRecord`'s publishable branch keeps using `piece.artifacts` (now
bound-only). **Never** include `otherVersionArtifacts` in either branch.

### 3f. Tests

Artifact mapping has **zero coverage today** — every existing fixture passes
`artifacts: []`. Add a `describe("artifact version binding", ...)`:

1. An artifact matching the displayed (current) version is in `piece.artifacts`,
   not in `otherVersionArtifacts`.
2. A non-matching artifact is in `otherVersionArtifacts`, not in `artifacts`.
3. `may_publish` false with the **approved** version displayed: the artifact
   bound to the approved version is in `artifacts`; one bound to the newer
   current version is in `otherVersionArtifacts`.
4. No version displayed → `artifacts` is empty, all in `otherVersionArtifacts`.
5. `toAgentRecord` on a publishable piece with one bound and one unbound artifact
   returns **only** the bound one (assert length **and** artifact `id`).
6. `toArtifact` maps `filename` to the basename of `storagePath`
   (`"a/b/hero.png"` → `"hero.png"`) and passes `signedUrl`, `sha256`, `mime`
   through unchanged.

**Acceptance:** break case 5 deliberately (return all artifacts), watch it fail,
restore. Do not commit the broken state.

---

## FU-4 — Render the partition safely

**File:** `src/components/portal/PublishKit.tsx` · **Severity: high**

1. Keep rendering `piece.versionAsset` and `piece.artifacts` as now, but pass the
   real `storagePath` (FU-2a) and `mime` (FU-3b) instead of the hardcoded
   `null`s.
2. When `piece.otherVersionArtifacts.length > 0`, render a collapsed `<details>`
   below them:
   - Summary: `Artifacts from other versions ({n})`
   - Muted explanation: *"These were cut for a different version of this piece
     and are not evidence for the version shown above. They cannot be downloaded
     here."*
   - Each rendered via `ArtifactBlock` with a new `locked` prop.
3. Add `locked?: boolean` to `ArtifactBlock`. When true:
   - the download control renders disabled regardless of `mayPublish` /
     `signedUrl`, labelled `Different version`;
   - **`publicUrl` is not rendered at all** in the provenance panel. Show only
     `versionId`, `storagePath` and `sha256` so the operator can identify the
     file. This closes Failure B: an unapproved version's live URL is never
     printed as this piece's.

Full hairline border on the panel; no left accent bar.

**Acceptance:** state explicitly that a piece with a mismatched artifact shows it
only inside the collapsed panel, with no working download and no `public_url`
anywhere on the card.

---

## FU-5 — Stop telling the operator an approved PDF has no approved copy

**File:** `src/components/portal/PublishKit.tsx` (~line 348, 383)
**Severity: medium**

The copy column branches solely on `piece.plainText`, falling through to
`"No approved copy for this piece yet."`. `ContentKind` is
`"text" | "image" | "pdf"` (`types.ts:211`); for `image` and `pdf` the content
**is** the version asset and `body_html` is legitimately null.

**Scenario:** a fully approved, current `lead_magnet_pdf` displays "No approved
copy for this piece yet." — a false statement about approved content, on the page
whose whole job is to say what is cleared to publish. `piece.contentKind` is in
the view model and never consulted.

**Fix:** when `plainText` is empty, branch on `piece.contentKind`:

- `"image"` / `"pdf"` → *"This piece is delivered as a file. See the artifacts
  panel."*
- `"text"` (or anything else) → keep the existing
  *"No approved copy for this piece yet."*

---

## FU-6 — Make downloads actually download

**File:** `src/lib/content-period-export.ts` · **Severity: medium**

`PublishKit.tsx` renders `<a href={signedUrl} download rel="noreferrer">`. The
HTML `download` attribute is **ignored for cross-origin URLs**, and Supabase
storage is a different origin serving objects inline. Clicking Download navigates
the current tab to the raw file: the operator loses filter state and scroll
position and must press Back for every asset.

The installed `@supabase/storage-js` supports a third argument on
`createSignedUrl` — its own docs describe `{ download: true }` as *"Create a
signed URL which triggers the download of the asset."* This sets
`Content-Disposition: attachment` server-side, which cross-origin cannot defeat.

**Fix:** pass a filename to both signers.

In `signArtifact`, derive the basename of `artifact.storage_path` and pass it:

```ts
  const filename = artifact.storage_path.split("/").pop() || undefined;
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(artifact.storage_path, SIGNED_URL_TTL, { download: filename });
```

In `signVersionAsset`, do the same using `v.asset_name` when present, falling
back to the basename of `v.storage_path`.

Leave the `download` attribute on the anchor in `PublishKit.tsx` (harmless, and
correct if an asset ever becomes same-origin). Do **not** add `target="_blank"` —
with `Content-Disposition: attachment` it would leave a stray blank tab.

**Acceptance:** state that both signers pass a `download` filename, and that the
kit page is no longer navigated away on download.

---

## FU-7 — Hide the kit link during a lawyer preview

**File:** `src/app/portal/[firmId]/deliverables/[deliverableId]/page.tsx`
**Severity: medium**

v1 added `{session.role === "operator" && detail.deliverable.period_id && (...)}`.

`isLawyerPreview` is already computed in this file (~line 53). During a DR-084
faithful lawyer preview the session role is still `"operator"`, so this
operator-only link renders inside a view whose entire purpose is to show the
operator exactly what the lawyer sees. That is operator chrome leaking into the
preview, which this file's own header comment designs against.

**Fix:**

```tsx
{session.role === "operator" && !isLawyerPreview && detail.deliverable.period_id && (
```

Change nothing else in this file.

**Acceptance:** state that the link is absent in a lawyer preview and present
outside one.

---

## FU-8 — Make instant-derived timestamps hydration-safe and locally correct

**File:** `src/components/portal/PublishKit.tsx` · **Severity: medium**

Two sites derive a display value from a UTC **instant**:

- `~line 539` — `new Date(signedUrlExpiresAt).toLocaleString("en-CA")`. This is a
  client component, so Next.js server-renders it too: the server formats in the
  host timezone (UTC in production), the browser in the operator's. The strings
  differ and React reports a hydration mismatch on every artifact with a signed
  URL.
- `~line 436` — `formatDate(piece.changeRequestedAt.slice(0, 10))` slices the
  **UTC** date component. A change requested at 20:00 Toronto on 25 July is
  00:00Z on 26 July and displays as 26 July: a wrong date, though stable.

Do **not** change `formatDate` (line 31-35) or `formatByteCount` (37-39). Those
format a date-only string as local midnight and a plain number respectively, both
timezone-invariant, matching `ContentPlan.tsx:41-49`.

**Fix:** add a mount gate and render both instant-derived values only after
hydration, formatted in local time:

```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
```

Place it in whichever component owns each render site (`ArtifactBlock` for the
expiry, `PieceCard` for the change-request date). Both lines are conveniences, so
omitting them from the server HTML costs nothing.

**Acceptance:** no hydration warning in the browser console on a kit page with
signed URLs; the change-request date matches the operator's local date.

---

## FU-9 — Empty state for a period with no deliverables

**File:** `src/components/portal/PublishKit.tsx` (~line 115) · **Severity: low**

```ts
const nothingMatches = visibleGroups.length === 0 && view.groups.length > 0;
```

With zero deliverables, `view.groups.length === 0`, so `nothingMatches` is false
and `visibleGroups` is empty: the page renders a header, "0 total" chips, a filter
bar, then blank space to the bottom, with no indication whether the week is empty
or the page failed. The period index page already has the equivalent empty state.

**Fix:** add a separate branch. When `view.groups.length === 0`, render a bordered
box: `No deliverables in this content week yet.` Keep the existing
`nothingMatches` message for the filtered-to-nothing case — the two states are
different and must read differently.

---

## FU-10 — Render the data that is computed and dropped

**File:** `src/components/portal/PublishKit.tsx` · **Severity: low**

- `view.bundleWarnings` is populated (`publish-kit-pure.ts:557`) and never read.
  `buildContentExportBundle` writes real operator signal into it, e.g. *"3 of 16
  active deliverables have at least one data-completeness warning."*
- `piece.publicationPath` is populated and appears only inside the JSON of "Copy
  publish record" — so an operator cannot see where an article is destined.

**Fix:**

1. Below the blocked-pieces notice, when `view.bundleWarnings.length > 0`, render
   a bordered tinted box (same treatment as the blocked notice, **no left accent
   bar**) headed `Data completeness`, warnings as a plain `<ul>`. Render nothing
   when the array is empty.
2. In the piece card header, when `piece.publicationPath` is set, render it as
   muted monospace text under the title.

---

## FU-11 — Disabled download controls must be real controls

**File:** `src/components/portal/PublishKit.tsx` (~line 528, 533)
**Severity: low**

The locked and "no stored file" states render as `<span>`. The v1 spec §6d
required every control to be a real `<button>` or `<a>`. A `<span>` is not
focusable and is not announced as a disabled control, so a keyboard or
screen-reader operator tabbing the artifact panel skips straight past it and
never learns that a download exists but is locked.

**Fix:** render both as `<button type="button" disabled>` with the same visual
classes. Keep the same labels.

---

## FU-12 — Clear the toast timer

**File:** `src/components/portal/PublishKit.tsx` (~line 89-92) · **Severity: low**

```ts
function showToast(message: string) {
  setToast(message);
  window.setTimeout(() => setToast(null), 2200);
}
```

The handle is never stored or cleared. Copy at t=0 (clears at 2200), copy again at
t=2000: the first timer fires at 2200 and clears the second toast after 200ms. The
operator gets no confirmation the second copy worked — including no chance to read
*"Clipboard blocked. Select the text and copy manually."* if it failed. The timer
also fires after unmount.

**Fix:** hold the handle in a `useRef<number | null>(null)`, clear any pending
timer at the top of `showToast`, and clear it in a `useEffect` cleanup.

---

## FU-13 — Guard the hand-written role list against the union

**File:** `src/lib/publish-kit-pure.ts` (~line 40-46) · **Severity: low (latent)**

`KNOWN_DELIVERABLE_ROLES` hand-duplicates the `DeliverableRole` union.
TypeScript will not catch divergence, because a subset is still assignable to
`DeliverableRole[]`. An unapplied migration in the tree
(`20260719140000_content_deliverables_email_role_widen.sql`) would add
`email_newsletter`; if applied, those deliverables would silently resolve to
`role: null` and `lane: "unknown"`, losing their copy constraints with no error.

**Fix:** make the list exhaustive at compile time, e.g.

```ts
const ROLE_PRESENCE: Record<DeliverableRole, true> = {
  article: true,
  social_post: true,
  gbp_post: true,
  lead_magnet_pdf: true,
  landing_page: true,
};
const KNOWN_DELIVERABLE_ROLES = Object.keys(ROLE_PRESENCE) as DeliverableRole[];
```

Adding a member to the union now fails the build until it is listed here. Add a
one-line comment saying that is the point.

---

## FU-14 — Final verification

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. An artifact bound to a version other than the one displayed never appears in
   `piece.artifacts`, never appears in `toAgentRecord`, has no working download,
   and has **no `public_url` printed anywhere** on the card.
2. `toAgentRecord` on a blocked piece still omits `body`, `plain_text`,
   `destination`, `artifacts`, **and `version_asset`** entirely — the v1 safety
   property is intact and now covers the new field.
3. `toAgentManifest` still returns one record per deliverable, blocked included.
4. A publishable `pdf` deliverable no longer reads "No approved copy for this
   piece yet."
5. Both signers pass a `download` filename to `createSignedUrl`.
6. The "Open in Publish Kit" link is absent during a lawyer preview.
7. `git status` shows no migration files and no change to `DeliverableReview.tsx`.
8. No file you touched performs a Supabase write.

---

## Definition of done

- [ ] `ContentExportArtifact` carries `version_id` and `mime_type`, both tested.
- [ ] `versionAsset` carries `storagePath`; the agent record carries
      `version_asset`, withheld on blocked pieces.
- [ ] `PublishKitPiece` carries `displayedVersionId`, bound-only `artifacts`, and
      `otherVersionArtifacts`.
- [ ] `toAgentRecord` emits only artifacts bound to the displayed version.
- [ ] Mismatched artifacts render collapsed, download-locked, with no
      `public_url`.
- [ ] Artifact mapping has real test coverage, including the version partition
      and basename / signedUrl / mime passthrough.
- [ ] Image and PDF deliverables no longer report missing copy.
- [ ] Downloads download instead of navigating.
- [ ] The kit link is hidden during a lawyer preview.
- [ ] Instant-derived timestamps are hydration-safe and locally correct.
- [ ] Empty period, bundle warnings, and publication path all render.
- [ ] Disabled download controls are focusable buttons.
- [ ] Toast timer is cleared and cleaned up.
- [ ] The role list is exhaustive at compile time.
- [ ] `npx tsc --noEmit` and `npm test` both pass.
