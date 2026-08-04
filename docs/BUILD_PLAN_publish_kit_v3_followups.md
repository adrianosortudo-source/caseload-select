# BUILD PLAN — Publish Kit, third follow-up round

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** `docs/BUILD_PLAN_publish_kit_v1.md`,
`docs/BUILD_PLAN_publish_kit_v1_followups.md`, and
`docs/BUILD_PLAN_publish_kit_v2_followups.md` are all built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

Round 2 landed its stated fixes, and two independent audits confirm the CTA
work, the hooks, the download-filename tests, and the withholding property are
all genuinely correct. This round fixes defects created by **interactions
between round-2 fixes**, plus one dedupe-correctness hole. It is a small,
tight round: five steps.

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
  Testable logic lives in `publish-kit-pure.ts`, never in `.tsx`.
- Read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Do not import `@/lib/publication-manifest` or `@/lib/publication-readiness*`.
- Tailwind tokens only; square corners; no coloured left-edge accent bar; no
  orphan words in UI copy.

---

## FU3-1 — The dedupe key discards legitimately distinct artifacts

**File:** `src/lib/publish-kit-pure.ts` (~line 630, `dedupeByTypeAndLocale`)
**Severity: high**

The within-version dedupe keys on `` `${a.artifactType}::${a.locale ?? ""}` ``.
`PublicationArtifact` carries `destination` as a first-class distinguishing
column (`src/lib/types.ts:437`), and both the export and the UI treat it as
identity-relevant (it renders as a chip on every artifact block).

**Failure scenario.** One approved version legitimately carries
`social_image / en-CA / linkedin` (the 1200×628 feed scrim) **and**
`social_image / en-CA / google_business_profile` (the 1200×900 photo-scrim).
They share the current dedupe key, so whichever has the later `created_at`
wins and:

- the other crop disappears from the operator UI **and from
  `toAgentRecord(...).artifacts`** — a publishing agent posts the LinkedIn
  crop to Google Business, or has no asset at all;
- the warning claims the discarded artifact was "superseded", which is false —
  nothing superseded it.

**A second defect in the same function:** the tie-break on equal `created_at`
keeps the incumbent, and the artifacts query has no `ORDER BY`, so two rows
inserted in the same transaction (identical timestamps) are kept or discarded
per Postgres's arbitrary row order — a **different artifact can win on each
page load**.

**Also fix the doc comment.** It cites `findArtifact` in
`publication-readiness.ts` as precedent. That function selects one artifact
*for one specific requirement check*; it was never a precedent for collapsing
the destination dimension in an exhaustive display. Rewrite the comment to
state the real rule.

### 1a. The fix

```ts
    const key = `${a.artifactType}::${a.locale ?? ""}::${a.destination ?? ""}`;
```

And a deterministic tie-break: replace the comparison with

```ts
    if (
      !existing ||
      a.createdAt > existing.createdAt ||
      (a.createdAt === existing.createdAt && a.id > existing.id)
    ) {
```

A genuine replacement targets the same slot — same type, same locale, same
destination — so true duplicates still collapse. Update the function's doc
comment: the key is the artifact's full slot identity
(type, locale, destination); newest `createdAt` wins; `id` breaks ties so the
result is stable across page loads. Remove the `findArtifact` citation.

### 1b. Tests

**File:** `src/lib/__tests__/publish-kit-pure.test.ts`, in
`describe("artifact version binding", ...)`:

1. Two artifacts, same version, same `artifact_type` and `locale`, different
   `destination` (`"linkedin"` vs `"google_business_profile"`): **both** are
   kept in `piece.artifacts`, and no "superseded" warning is emitted (assert
   `piece.warnings.some(w => w.includes("superseded"))` is false).
2. Two true duplicates (same type, locale, **and** destination) with equal
   `created_at` and ids `"a-alpha"` / `"a-beta"`: the kept one is `"a-beta"`
   (higher id), and the result is the same when the input array order is
   reversed. Assert both orderings in the one test.

**Acceptance:** break the key deliberately (drop `destination` again), watch
test 1 fail, restore. Do not commit the broken state.

---

## FU3-2 — Every locked artifact renders the false label "No stored file for this artifact."

**File:** `src/components/portal/PublishKit.tsx` (ArtifactBlock, ~line 669)
**Severity: medium**

Two round-2 fixes collided. `stripAccess` nulls `signedUrl` on **every**
other-version artifact — correct. But ArtifactBlock's control branching keys
on `signedUrl` presence first:

```
signedUrl ? (canDownload ? <Download> : <"Different version" | "Download locked">)
          : <"No stored file for this artifact.">
```

With `signedUrl` always null for locked artifacts, the
`locked ? "Different version" : ...` branch is **dead code** — it requires
`signedUrl && locked`, which is now impossible. Every artifact in the
"Artifacts from other versions" panel renders **"No stored file for this
artifact."** directly above a provenance section showing its storage path,
SHA-256, and size. An operator reasonably concludes the data is corrupt, and a
locked artifact is indistinguishable from a URL-only webpage artifact that
genuinely has no file.

### 2a. The fix — branch on the right facts, in the right order

`storagePath` answers "does a stored file exist" (it survives stripping, by
design — it is durable identity, not access). `locked` answers "is this
another version's". Only then does `signedUrl` answer "can you have it now".
Replace the control block with:

```tsx
        {!storagePath ? (
          <button type="button" aria-disabled="true" className={LOCKED_BUTTON_CLASSES}>
            No stored file for this artifact.
          </button>
        ) : locked ? (
          <button type="button" aria-disabled="true" className={LOCKED_BUTTON_CLASSES}>
            Different version
          </button>
        ) : canDownload && signedUrl ? (
          <a href={signedUrl} download rel="noreferrer" className={DOWNLOAD_ANCHOR_CLASSES}>
            Download
          </a>
        ) : (
          <button type="button" aria-disabled="true" className={LOCKED_BUTTON_CLASSES}>
            Download locked
          </button>
        )}
```

Use the exact class strings already present on these elements; you may hoist
them to two module-level constants (`LOCKED_BUTTON_CLASSES`,
`DOWNLOAD_ANCHOR_CLASSES`) to avoid triplication, or inline them — either is
fine. Keep the existing aria-disabled comment on the first locked control.
Keep the expiry line's condition (`canDownload && signedUrlExpiresAt &&
mounted`) unchanged.

Note the fourth branch also correctly covers the FU3-3 case below: a blocked
piece's bound artifact will have a `storagePath`, no `locked` flag, and (after
FU3-3) no `signedUrl` — it must read "Download locked", not "No stored file".
This ordering makes that automatic.

### Acceptance for FU3-2

State the rendered label for each of these shapes, by inspection:

| storagePath | locked | mayPublish | signedUrl | expected |
|---|---|---|---|---|
| null | — | — | null | No stored file for this artifact. |
| set | true | — | null (stripped) | Different version |
| set | false | true | set | Download (working anchor) |
| set | false | false | null (stripped, FU3-3) | Download locked |

---

## FU3-3 — Blocked pieces still ship live download links under a banner that says "withheld"

**Files:** `src/lib/publish-kit-pure.ts` (`toPiece`),
`src/components/portal/PublishKit.tsx` (blocked banner) · **Severity: medium**

Round 2 made the no-links guarantee structural for **other-version**
artifacts. It is still presentational for a blocked piece's **bound**
artifacts and its **version asset**: when `may_publish` is false and the
approved version is displayed, `toVersionAsset` and the bound list carry live
`signedUrl` values into the RSC payload, while the UI renders "Download
locked" and the banner states "Their copy and downloads are withheld until
each clears." View source on that page and copy a working one-hour download
URL for material the page claims is withheld.

The material is approved-version content, so no *unapproved* bytes leak — that
is why this is medium, not high. But the stated invariant is two independent
refusals, and here there is one.

### 3a. Strip in the pure layer

In `toPiece`, after partitioning and dedupe, when `deliverable.may_publish` is
false:

- map the bound list through the existing `stripAccess`;
- null `versionAsset.signedUrl` and `versionAsset.signedUrlExpiresAt` (keep
  `storagePath`, `sha256`, `name`, `mime`, `sizeBytes` — durable identity
  stays).

Add a comment stating the invariant plainly: **a piece that is not cleared to
publish carries no working links at all** — not in the UI, not in the RSC
payload. Note that `plainText` and `destinationPath` remain visible by
design (the operator reads blocked copy to prepare); the guarantee is about
transferable access, not readability.

`toAgentRecord` needs no change — the withheld branch already omits
everything. Do not touch it.

### 3b. Correct the banner wording

The blocked-pieces banner currently reads: *"Their copy and downloads are
withheld until each clears."* Copy (the text) is deliberately visible and
selectable; only the buttons are locked. After 3a the downloads part becomes
true. Make the sentence accurate:

*"Their downloads are withheld and their copy controls are locked until each
clears. The reason is shown on each piece below."*

### 3c. Tests

**File:** `src/lib/__tests__/publish-kit-pure.test.ts`, new
`describe("blocked pieces carry no working links", ...)`:

1. A blocked piece (approved version displayed) whose bound artifact was
   exported with a live `signed_url`: in the view model, that artifact's
   `signedUrl` and `signedUrlExpiresAt` are null, and its `storagePath` and
   `sha256` are intact.
2. The same piece's `versionAsset.signedUrl` is null while
   `versionAsset.storagePath` is intact.
3. A publishable piece keeps both its bound artifact's and its version asset's
   `signedUrl`.

**Acceptance:** break 3a deliberately (skip the blocked-piece strip), watch
tests 1 and 2 fail, restore. Do not commit the broken state.

---

## FU3-4 — Dedupe the other-versions panel too, per version

**File:** `src/lib/publish-kit-pure.ts` · **Severity: low**

Dedupe runs only on the bound list. Ten superseded rows across old versions
all render individually in the "Artifacts from other versions" disclosure —
harmless to safety, but noisy and inconsistent with the bound-list rule.

**The key difference:** the other list spans **multiple versions**, and the
panel's purpose is to show what each other version has. The dedupe key there
must therefore include the version:

```ts
    const key = `${a.versionId}::${a.artifactType}::${a.locale ?? ""}::${a.destination ?? ""}`;
```

Implement by generalising: give `dedupeByTypeAndLocale` a
`keyOf: (a: PublishKitArtifact) => string` parameter (or split into two thin
wrappers over one core) so the bound list uses the slot key from FU3-1 and the
other list prefixes `versionId`. Newest-`createdAt`-then-`id` wins, same as
FU3-1. No warning is emitted for the other list — it is historical context,
not publishable inventory.

**Test:** two artifacts on version `v1` (same slot, different `created_at`)
plus one on `v2`, all non-displayed: `otherVersionArtifacts` contains exactly
the newer `v1` artifact and the `v2` artifact.

---

## FU3-5 — Final verification

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. Two same-type same-locale artifacts with different destinations both appear
   in `piece.artifacts` and in the publishable agent record.
2. The dedupe winner is identical across input orderings when `created_at`
   ties.
3. The four-row label table in FU3-2 holds, including "Different version" for
   a locked artifact with a storage path and no signed URL.
4. A blocked piece's page payload carries no `signedUrl` anywhere: not on
   bound artifacts, not on `versionAsset`, not on other-version artifacts.
5. The blocked banner no longer claims copy is "withheld".
6. `toAgentRecord` on a blocked piece still omits `body`, `plain_text`,
   `destination`, `publication_path`, `cta_target_path`, `artifacts`, and
   `version_asset` — the withholding property is untouched.
7. `git status` shows no migration files and no change to
   `DeliverableReview.tsx`; no file you touched performs a Supabase write.

---

## Definition of done

- [ ] Dedupe key includes `destination`; tie-break is deterministic by `id`;
      the misleading `findArtifact` citation is gone; both new tests pass and
      the destination test was verified to fail against the old key.
- [ ] ArtifactBlock branches on `storagePath` → `locked` → `signedUrl`; the
      "Different version" label is reachable again; the four-shape table is
      confirmed.
- [ ] Blocked pieces carry no working links in the view model; the banner
      wording is accurate; the strip tests were verified to fail when the
      strip is skipped.
- [ ] The other-versions panel is deduped per version.
- [ ] `npx tsc --noEmit` and `npm test` both pass, with real output pasted.
