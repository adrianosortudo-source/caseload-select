# BUILD PLAN — Publish Kit, second follow-up round

**Audience:** the implementing agent (Sonnet). Execute steps in order.
**Prerequisite:** `docs/BUILD_PLAN_publish_kit_v1.md` and
`docs/BUILD_PLAN_publish_kit_v1_followups.md` are both built and merged.
**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

The first follow-up round landed correctly: the version-partition safety
property is real and genuinely tested, the withholding property still holds, and
`tsc`/`npm test` are clean. This round fixes one significant functional gap the
audits had not reached, plus three places where a previous fix is weaker than it
claims to be.

---

## 0. Commands and constraints

```bash
npx tsc --noEmit
```

```bash
npm test
```

- **`npm run lint` is broken repo-wide and is not yours to fix.** No `eslint`
  package or config is installed and Next 16.2.9 removed `next lint`. Do not
  install ESLint. Verify with `npx tsc --noEmit` and `npm test` only.
- `vitest` runs in **node** and only collects `src/**/__tests__/**/*.test.ts`.
  **`.test.tsx` never runs.** Testable logic goes in a pure `.ts` module.
- Still read-only: **no inserts, updates, upserts, deletes, or migrations.**
- Do not modify `DeliverableReview.tsx`, `DRGArticleFrame.tsx`, or
  `drg-article-frame.css`.
- Do not import `@/lib/publication-manifest` or `@/lib/publication-readiness*`.
- Tailwind tokens only; square corners; **no coloured left-edge accent bar on a
  callout**; no orphan words in UI copy.

---

## FU2-1 — The link a hand-posted piece needs is missing entirely

**Severity: high.** This defeats the feature's primary use case.

`content_deliverables` carries two different destination columns, and the
doc comment on `src/lib/types.ts:286-292` is explicit about which applies when:

> For `deliverable_role` in (`gbp_post`, `social_post`) ONLY: the on-site path
> this post promotes. `publication_path` **stays null for these two roles**;
> for every other role, `cta_target_path` stays null and `publication_path`
> keeps meaning "this deliverable's own placement".

`cta_target_path` is exported nowhere, mapped nowhere, and rendered nowhere. A
repo-wide search finds it only in `types.ts` and one comment in
`publication-readiness.ts:424` explaining that readiness deliberately ignores it
("descriptive only, never a requirement"). Readiness is about gates; the Publish
Kit is about what the operator actually types into the post, so the field
readiness ignores is exactly the one this feature needs.

**Failure scenario.** The operator opens the kit to post this week's Google
Business post by hand. They get the copy and the image. `publication_path` is
null for that role by design, so the destination line added in the last round
renders nothing. `cta_target_path` — the on-site page the post is supposed to
drive traffic to — never left the database. The operator has no link on the
page and must go hunting for it, which is the exact problem the Publish Kit was
built to remove. The same applies to every LinkedIn promoter post.

The approved prototype rendered this as a distinct **"Call to action"** field
with its own copy button, separate from the post body. Restore that.

### 1a. Export it

**File:** `src/lib/content-period-export.ts`

Add to `ContentExportDeliverable`, directly after `publication_path`:

```ts
  /**
   * For deliverable_role gbp_post and social_post ONLY: the on-site path this
   * post promotes. publication_path is null for those two roles, so this is
   * the only destination a hand-posted piece has. Null for every other role.
   * See types.ts ContentDeliverable.cta_target_path (DR-097).
   */
  cta_target_path: string | null;
```

Populate it in the `exportDeliverables.push({ ... })` call from
`d.cta_target_path`, immediately after `publication_path: d.publication_path,`.

In `renderDeliverable`, add a line after the existing publication-path line:

```ts
  lines.push(`- CTA target path: ${d.cta_target_path ?? "not recorded"}`);
```

### 1b. Carry it into the view model

**File:** `src/lib/publish-kit-pure.ts`

Add `ctaTargetPath: string | null;` to `PublishKitPiece`, directly after
`publicationPath`, and populate it in `toPiece` from
`deliverable.cta_target_path`.

Add a derived field on the same interface so the UI does not re-implement the
role rule:

```ts
  /**
   * The single destination link this piece publishes to, resolved per role:
   * cta_target_path for gbp_post and social_post (publication_path is null for
   * those), publication_path for every other role. Null when neither is
   * recorded.
   */
  destinationPath: string | null;
```

Implement it in `toPiece` as a small exported pure helper so it is testable:

```ts
export function resolveDestinationPath(
  role: DeliverableRole | null,
  publicationPath: string | null,
  ctaTargetPath: string | null,
): string | null {
  if (role === "gbp_post" || role === "social_post") return ctaTargetPath;
  return publicationPath;
}
```

### 1c. Put it in the agent record

**File:** `src/lib/publish-kit-pure.ts`

`AgentRecordPublishable.destination` currently maps to `piece.publicationPath`,
which is null for exactly the two roles a publishing agent would post by hand.
Change it to `piece.destinationPath`, and add a sibling field so a consumer can
still see the raw columns without re-deriving the rule:

```ts
  destination: string | null;        // resolved per role, see resolveDestinationPath
  publication_path: string | null;   // raw column
  cta_target_path: string | null;    // raw column
```

**Do not** add any of these to the withheld branch. That early return stays
exactly as it is.

### 1d. Render it

**File:** `src/components/portal/PublishKit.tsx`

Two changes:

1. The muted path line under the piece title (added last round) currently reads
   `piece.publicationPath`. Change it to `piece.destinationPath` so it is
   populated for hand-posted roles.
2. In the copy column, below the body panel and above the constraint meters,
   when `piece.destinationPath` is set, render a labelled **Call to action**
   field: the eyebrow label, the path in `font-mono` inside the same bordered
   panel treatment the body uses, and a copy button beside the label reading
   `Copy link`. Gate the copy button on `piece.mayPublish` exactly as the body's
   Copy button is gated, with the same `Copy locked` label when blocked.

### 1e. Tests

**File:** `src/lib/__tests__/publish-kit-pure.test.ts`

Add a `describe("destination path resolution", ...)`:

1. `resolveDestinationPath("gbp_post", null, "/resources/checklist")` returns
   `"/resources/checklist"`.
2. `resolveDestinationPath("social_post", null, "/journal/x")` returns
   `"/journal/x"`.
3. `resolveDestinationPath("article", "/journal/x", null)` returns
   `"/journal/x"`.
4. `resolveDestinationPath("article", "/journal/x", "/ignored")` returns
   `"/journal/x"` — `cta_target_path` is never consulted for a non-post role.
5. `resolveDestinationPath(null, null, null)` returns `null`.
6. End to end through `toPublishKitView`: a `gbp_post` deliverable with
   `publication_path: null` and `cta_target_path: "/resources/checklist"`
   produces a piece whose `destinationPath` is `"/resources/checklist"`.
7. `toAgentRecord` on that same publishable piece has
   `destination === "/resources/checklist"`, and carries both raw columns.

**File:** `src/lib/__tests__/content-period-export.test.ts`

Add one case: a deliverable with `cta_target_path` set exports it verbatim.
Add `cta_target_path: null` to the `makeDeliverable` fixture default.

**Acceptance:** `npx tsc --noEmit` clean, `npm test` green, no existing
assertion weakened.

---

## FU2-2 — A locked artifact's signed URL still reaches the browser

**Severity: medium.**

`partitionArtifacts` (`src/lib/publish-kit-pure.ts:559-568`) passes artifact
objects through to `otherVersionArtifacts` unchanged, `signedUrl` intact.
`PublishKit` is a client component, so Next.js serialises the entire `view` prop
into the RSC payload delivered to the browser.

`ArtifactBlock` correctly refuses to render the URL when `locked` is true, so
nothing is visible. But a live, working, one-hour download link for an artifact
bound to an unapproved or superseded version is present in the page source and
recoverable from devtools, a saved page, or a proxy log.

The guarantee is currently **presentational**. The stated design principle is
that a caller is never *handed* material it is not cleared to publish. Make it
structural: if the URL never reaches the browser, the `locked` branch cannot be
wrong.

**Fix:** in `partitionArtifacts`, strip the temporary access fields from the
`other` list only:

```ts
  const stripAccess = (a: PublishKitArtifact): PublishKitArtifact => ({
    ...a,
    signedUrl: null,
    signedUrlExpiresAt: null,
  });
```

Return `other: artifacts.filter(...).map(stripAccess)` in both branches
(including the `!versionId` branch, where every artifact is "other"). Leave
`storagePath` and `sha256` in place — those are durable identity, not access,
and the operator needs them to identify the file.

Add a comment stating why: the download is refused in two independent places,
and this one does not depend on the UI getting it right.

### Tests

Add to the existing `describe("artifact version binding", ...)`:

- An artifact in `otherVersionArtifacts` has `signedUrl === null` and
  `signedUrlExpiresAt === null`, while the artifact in `artifacts` retains its
  signed URL.
- In the no-version-displayed case, the artifact in `otherVersionArtifacts` also
  has `signedUrl === null`.

---

## FU2-3 — The locked download controls are still not keyboard-reachable

**Severity: medium.**

Last round replaced two `<span>` elements with `<button type="button" disabled>`
(`src/components/portal/PublishKit.tsx:626-632` and `:635-641`). That was a real
improvement in semantics, but it does not achieve the stated goal.

**The `disabled` attribute removes an element from the tab order in every
browser.** A keyboard or screen-reader operator tabbing through the artifact
panel still skips straight past it and never learns that a download exists but
is locked, or that an artifact has no stored file — which was the exact failure
the fix was written to close.

**Fix:** for a control that must stay discoverable, use `aria-disabled` instead
of `disabled`:

- Replace `disabled` with `aria-disabled="true"` on both buttons.
- Keep `type="button"` and add no `onClick`, so activating it does nothing.
- Replace the `disabled:cursor-not-allowed` class with plain
  `cursor-not-allowed` (the `disabled:` variant no longer applies without the
  attribute).

The element is now focusable and announced as a disabled button, while still
doing nothing when activated.

Leave the **Copy text** and **Download .txt** buttons in the copy column using
the real `disabled` attribute: those sit next to visible explanatory status text
("Cannot publish" plus the reason), so their state is already discoverable
without focusing them.

---

## FU2-4 — The download-filename fix has no test

**Severity: low.**

`signVersionAsset` and `signArtifact` now pass `{ download: filename }` to
`createSignedUrl` — the fix that makes a cross-origin asset actually download
instead of navigating the tab away. The test mock at
`src/lib/__tests__/content-period-export.test.ts:111` is
`createSignedUrl: (path: string) => { ... }`: it accepts only the path and
discards the options object. Nothing asserts the filename is passed, so deleting
the option tomorrow leaves every test green.

**Fix:** widen the mock to capture the third argument, and assert on it.

Change the mock signature to
`createSignedUrl: (path: string, _expiresIn: number, options?: { download?: string | boolean })`
and push `options?.download` into `state.signedUrlCalls` alongside `bucket` and
`path`. Existing assertions on `bucket`/`path` must keep working unchanged.

Then add two cases:

1. An artifact with `storage_path: "hero/d1.png"` is signed with
   `download: "d1.png"` — the basename.
2. A version with `asset_name: "lease-checklist.pdf"` and a different
   `storage_path` is signed with `download: "lease-checklist.pdf"` — the
   operator-facing name wins over the path basename.

---

## FU2-5 — Final verification

Run both and paste the real output:

```bash
npx tsc --noEmit
```

```bash
npm test
```

Then confirm each explicitly, by inspection:

1. A `gbp_post` with `publication_path: null` and a `cta_target_path` shows that
   path on the card and in a copyable **Call to action** field, and
   `toAgentRecord` returns it as `destination`.
2. An artifact in `otherVersionArtifacts` has `signedUrl === null` in the view
   model, so no signed URL for a non-displayed version is serialised to the
   browser at all.
3. `toAgentRecord` on a blocked piece still omits `body`, `plain_text`,
   `destination`, `publication_path`, `cta_target_path`, `artifacts`, and
   `version_asset` entirely.
4. The locked and no-stored-file controls carry `aria-disabled="true"` and no
   `disabled` attribute, so they are reachable by Tab.
5. Both signers are asserted by a test to pass a `download` filename.
6. `git status` shows no migration files and no change to `DeliverableReview.tsx`.
7. No file you touched performs a Supabase write.

---

## Definition of done

- [ ] `cta_target_path` is exported, carried into the view model, resolved per
      role by a tested pure helper, rendered as a copyable Call to action, and
      returned as the agent record's `destination`.
- [ ] Both raw path columns are on the publishable agent record; neither is on
      the withheld one.
- [ ] Other-version artifacts carry no signed URL into the browser.
- [ ] Locked download controls are keyboard-reachable via `aria-disabled`.
- [ ] The download-filename behaviour is asserted by tests for both signers.
- [ ] `npx tsc --noEmit` and `npm test` both pass.
