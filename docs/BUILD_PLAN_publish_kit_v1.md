# BUILD PLAN — Publish Kit v1

**Audience:** the implementing agent (Sonnet). Execute steps in order. Do not
re-plan, do not substitute your own architecture, do not skip verification.

**Repo root:** `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-content-studio-v43`

**Approved prototype (visual + behavioural reference):**
`docs/prototypes/publish-kit-v1/index.html` — open it in a browser before you
start. It is the agreed design. Where this plan and the prototype disagree,
**this plan wins** (the prototype used sample data and a few invented fields).

---

## 0. What already exists — read this before writing any code

The backend for this feature **is already built and tested**. You are building a
**user interface over it**, plus one small backend gap-fill. Do not build a new
data layer. Do not write migrations. Do not create new tables.

| Thing that already exists | Location | What it gives you |
|---|---|---|
| `buildContentExportBundle(periodId)` | `src/lib/content-period-export.ts` | The entire period-scoped publishing bundle: every deliverable, its copy (`body_html`), its signed asset URL, sha256, mime, size, its `publication_artifacts`, `may_publish` + `may_publish_reason`, unresolved comments and change requests |
| `renderContentExportMarkdown(bundle)` | same file | Markdown rendering of the same bundle |
| `GET /api/admin/content-periods/[periodId]/content-export?format=json\|markdown` | `src/app/api/admin/content-periods/[periodId]/content-export/route.ts` | Operator-gated HTTP access to the bundle |
| `DownloadBundleButton` | `src/components/portal/ContentPlan.tsx` (~line 656) | Existing per-week operator control that links to the two formats above |
| `buildPublicationManifest(periodId, operatorId)` | `src/lib/publication-manifest.ts` | Readiness manifest. **Separate feature. Do not import it. Do not merge it into the kit.** |

`content-period-export.ts`'s own module header states its purpose: *"so an
operator or a publishing agent can retrieve exactly what already exists in the
client portal without searching the filesystem, guessing asset locations, or
regenerating anything."* That is exactly this feature's purpose. The bundle is
the source of truth; the Publish Kit renders it for humans.

### The one backend gap

`ContentExportVersionBody` carries `signed_url` (the version's own asset).
`ContentExportArtifact` **does not** — it carries `storage_bucket`,
`storage_path`, `public_url`, `sha256`, `size_bytes`, `latest_validation`, but no
signed URL. Publication artifacts are the derivative images (article hero,
social image, GBP scrim, Ad card). Without a signed URL the operator cannot
download them from the browser, which is the single pain point this feature
exists to remove. **Step 1 fixes exactly this and nothing else.**

---

## 1. Environment, commands, and hard constraints

### Commands

```bash
npm run lint
```

```bash
npm test
```

```bash
npx tsc --noEmit
```

**There is no `npm run typecheck` script in this repo**, despite what generic
project instructions say. Use `npx tsc --noEmit`. Do not add a typecheck script.

### Test framework constraints — these decide where your code goes

`vitest.config.ts` says:

- `include: ["src/**/__tests__/**/*.test.ts", "src/**/__evals__/**/*.test.ts"]`
  — **`.ts` only. A `.test.tsx` file will never run.**
- `environment: "node"` — **no DOM, no jsdom.** You cannot render React
  components in a test.
- alias `@` → `./src`

**Consequence you must honour:** every piece of logic that needs a test lives in
a plain `.ts` module with no JSX and no React import. React components stay thin
and call into those modules. This mirrors the existing
`deliverables-pure.ts` / `__tests__/deliverables-pure.test.ts` convention.

### Prohibitions

1. **Do not modify** `src/components/portal/DeliverableReview.tsx`,
   `DRGArticleFrame.tsx`, `drg-article-frame.css`, or anything else in the
   approval/annotation path. The approval surface is working and is explicitly
   out of scope.
2. **Do not write to Supabase** anywhere in this feature. Every function you add
   is read-only. No inserts, no updates, no deletes, no RPC that mutates.
3. **Do not create a publication claim, receipt, or "mark as published" action.**
   That is a separate future phase. The prototype draws a disabled
   "Mark as published — phase 2" control; render it disabled or omit it, but
   never wire it.
4. **Do not add a migration.** No schema changes are required.
5. **Do not import** `@/lib/publication-manifest` or
   `@/lib/publication-readiness*` into any file you create. They are a separate
   feature with a deliberate boundary.
6. **Do not show a deliverable as publishable when `may_publish` is false.**
   `may_publish` and `may_publish_reason` from the bundle are authoritative.
   Never re-derive publishability from `status` alone.

### Copy and UI rules (project conventions — follow exactly)

- Tailwind tokens only, from `tailwind.config.ts`: `navy`, `parchment`,
  `parchment-2`, `off-white`, `border-brand`, `green-pass`, `red-fail`, `gold`,
  `gold-on-light`, `body`, `muted`, `field-label`, `deep-black`, `highlight`.
  Do not introduce new hex values in components.
- **Square corners.** Existing portal components use `border` with no
  `rounded-*`. Match them.
- **Never use a coloured left-edge accent bar on a callout.** Use a full
  hairline border plus a tinted background instead. This is a standing rule.
- **No orphan words**: never leave a single word alone on the final line of a
  heading or paragraph of UI copy. Rewrite the sentence if it happens.
- Uppercase micro-labels use `text-[10px] uppercase tracking-wider font-semibold`.
- Separator glyph is the mid-dot `·`, matching `DeliverableCard.tsx`.
- The em-dash build guard (`scripts/check-no-em-dash-marketing.mjs`) is scoped to
  `src/app/(marketing)` only and does **not** apply to the portal. You may use
  em dashes in portal copy, but prefer `·` for separators for consistency.

---

## 2. Architecture — already decided, do not revisit

```
Route (server)   src/app/portal/[firmId]/publish-kit/page.tsx
                   → period index: lists this firm's periods, links to each kit

Route (server)   src/app/portal/[firmId]/publish-kit/[periodId]/page.tsx
                   → operator gate
                   → buildContentExportBundle(periodId)
                   → firm-ownership check
                   → toPublishKitView(bundle)   [pure]
                   → <PublishKitClient view={...} />

Pure logic       src/lib/publish-kit-pure.ts
                   → no I/O, no React, fully unit-tested

Client UI        src/components/portal/PublishKit.tsx   ("use client")
                   → filters, copy buttons, downloads, disclosure panels

Backend gap-fill src/lib/content-period-export.ts
                   → sign publication artifacts (Step 1 only)
```

**Scope decision, already made:** the kit is **period-scoped** (one week, all its
deliverables), not deliverable-scoped. Per-deliverable deep links are anchors
into the period page (`#dlv-<id>`).

---

## STEP 1 — Add signed download URLs to publication artifacts

**File:** `src/lib/content-period-export.ts`

**Why:** artifacts are the derivative images. Without a signed URL the operator
cannot download them, which is the whole point of the feature.

### 1a. Extend the artifact interface

Find `export interface ContentExportArtifact` (~line 85). Add two fields after
`size_bytes`:

```ts
  /**
   * Temporary download URL for this artifact, signed at read time from
   * storage_path. Null when the artifact has no storage_path (e.g. a
   * webpage artifact recorded by URL only) or when signing failed.
   * Never durable evidence: storage_path / sha256 are the canonical
   * identity. Re-request this export to get a fresh URL.
   */
  signed_url: string | null;
  /** When signed_url expires (ISO 8601); null when signed_url is null. */
  signed_url_expires_at: string | null;
```

### 1b. Sign the artifacts

The file already has `signVersionAsset` and a `SIGNED_URL_TTL` /
`signedUrlExpiresAt` pattern. Add an equivalent for artifacts. Place it directly
below `signVersionAsset` (~line 277):

```ts
/**
 * Signs one publication artifact's storage object. Artifacts may legitimately
 * carry no storage_path (a webpage or external_post artifact is recorded by
 * URL), in which case there is nothing to sign and null is correct.
 */
async function signArtifact(
  artifact: PublicationArtifact,
): Promise<string | null> {
  if (!artifact.storage_path) return null;
  const bucket = artifact.storage_bucket ?? ASSET_BUCKET;
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(artifact.storage_path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}
```

### 1c. Use it in the artifact mapping

The artifact mapping at ~line 442 is currently a synchronous `.map()`. Convert
it to an awaited `Promise.all` so each artifact is signed. Replace:

```ts
    const exportArtifacts: ContentExportArtifact[] = deliverableArtifacts.map((a) => {
      const latest = latestValidationByArtifact.get(a.id) ?? null;
      return {
        id: a.id,
        artifact_type: a.artifact_type,
        locale: a.locale,
        destination: a.destination,
        storage_bucket: a.storage_bucket,
        storage_path: a.storage_path,
        public_url: a.public_url,
        sha256: a.sha256,
        size_bytes: a.size_bytes,
        latest_validation: latest
          ? { validator: latest.validator, result: latest.result, created_at: latest.created_at }
          : null,
      };
    });
```

with:

```ts
    const exportArtifacts: ContentExportArtifact[] = await Promise.all(
      deliverableArtifacts.map(async (a) => {
        const latest = latestValidationByArtifact.get(a.id) ?? null;
        const signed = await signArtifact(a);
        return {
          id: a.id,
          artifact_type: a.artifact_type,
          locale: a.locale,
          destination: a.destination,
          storage_bucket: a.storage_bucket,
          storage_path: a.storage_path,
          public_url: a.public_url,
          sha256: a.sha256,
          size_bytes: a.size_bytes,
          signed_url: signed,
          signed_url_expires_at: signed ? signedUrlExpiresAt : null,
          latest_validation: latest
            ? { validator: latest.validator, result: latest.result, created_at: latest.created_at }
            : null,
        };
      }),
    );
```

Confirm `signedUrlExpiresAt` is in scope at that point in the function (it is
used for versions in the same loop). If it is computed after this point, move
its computation above the deliverable loop. Do not change its TTL.

### 1d. Extend the markdown renderer

In `renderContentExportMarkdown`, find where artifacts are printed. For each
artifact that has a `signed_url`, add the same two lines the version body already
emits, with the same "temporary access only, not durable evidence" wording. Keep
the existing artifact lines unchanged.

### 1e. Update the existing test

**File:** `src/lib/__tests__/content-period-export.test.ts`

Read the file first and follow its existing mocking style exactly. Add:

1. A case asserting an artifact **with** a `storage_path` gets a non-null
   `signed_url` and a non-null `signed_url_expires_at`.
2. A case asserting an artifact **without** a `storage_path` gets
   `signed_url: null` and `signed_url_expires_at: null`.
3. A case asserting an artifact whose `storage_bucket` is set uses that bucket
   rather than the default when signing.

Do not weaken or delete any existing assertion in this file.

### Acceptance for Step 1

- `npx tsc --noEmit` passes.
- `npm test` passes, including your three new cases.
- `GET /api/admin/content-periods/<id>/content-export?format=json` returns
  artifacts carrying `signed_url`.
- No other behaviour of the bundle changed.

---

## STEP 2 — Pure view model: `src/lib/publish-kit-pure.ts`

**Create** `src/lib/publish-kit-pure.ts`. No React. No imports from `server-only`.
No Supabase. Pure functions over the bundle types only.

Import types from `@/lib/content-period-export` and `@/lib/types`.

### 2a. Channel constraints (CSB-derived)

```ts
/**
 * Per-role copy constraints, taken from the client's Content Strategy Book.
 * A role absent from this map has no numeric constraint. These are display
 * and warning aids for the operator: they never block a copy or download,
 * and they never override may_publish.
 */
export interface CopyConstraint {
  maxWords?: number;
  minWords?: number;
  maxChars?: number;
}

export const ROLE_COPY_CONSTRAINTS: Partial<Record<DeliverableRole, CopyConstraint>> = {
  gbp_post: { maxWords: 50, maxChars: 300 },
  social_post: { minWords: 40, maxWords: 80 },
};
```

### 2b. Functions to implement

Each must be exported, pure, and total (never throws on malformed input).

```ts
/** Strips HTML tags and decodes the handful of entities body_html carries,
 *  returning plain text suitable for pasting into LinkedIn or Google Business.
 *  Block-level closing tags become newlines so paragraphs survive. */
export function htmlToPlainText(html: string | null): string;

/** Word count on plain text. Whitespace-delimited, no empty tokens. */
export function countWords(text: string): number;

/** Evaluates plain text against a constraint. Returns one entry per applicable
 *  limit so the UI can show a meter per limit. `state` is "ok" | "under" | "over". */
export interface ConstraintReading {
  label: string;          // e.g. "words", "characters"
  value: number;
  limitText: string;      // e.g. "40-80 allowed", "300 max"
  state: "ok" | "under" | "over";
  pct: number;            // 0-100, clamped, for a meter width
}
export function readConstraints(text: string, constraint: CopyConstraint | undefined): ConstraintReading[];

/** Which surface publishes this deliverable, for the publisher filter.
 *  "pipeline"  → firm_website destinations (articles, landing pages, PDFs)
 *  "manual"    → linkedin and google_business_profile
 *  "unknown"   → destination not recorded */
export type PublisherLane = "pipeline" | "manual" | "unknown";
export function publisherLane(destination: string | null): PublisherLane;

/** Sort key for display order: by publish_date ascending (nulls last), then
 *  by title. Deterministic: never depends on the current date. */
export function comparePieces(a: PublishKitPiece, b: PublishKitPiece): number;

/** Groups pieces under their publish_date. Pieces with a null publish_date
 *  land in a single trailing group keyed "" (rendered "No publication date
 *  recorded"). Groups are returned in comparePieces order. */
export function groupByPublishDate(pieces: PublishKitPiece[]): PublishKitDateGroup[];

/** The agent-facing record for ONE piece.
 *  When the piece is not publishable, copy, plain_text, destination, and
 *  artifacts are OMITTED and `withheld: true` is set with the reason.
 *  This is a deliberate safety property: a caller is never handed material
 *  it is not cleared to publish. Assert it in tests. */
export function toAgentRecord(piece: PublishKitPiece): AgentRecord;

/** The whole period as agent records, plus period metadata. */
export function toAgentManifest(view: PublishKitView): AgentManifest;

/** Maps a raw bundle into the view model the UI renders. */
export function toPublishKitView(bundle: ContentExportBundle): PublishKitView;
```

### 2c. Types to define in the same file

```ts
export interface PublishKitArtifact {
  id: string;
  artifactType: string;
  locale: string | null;
  destination: string | null;
  filename: string | null;      // basename of storage_path, or null
  storagePath: string | null;
  publicUrl: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  signedUrl: string | null;
  signedUrlExpiresAt: string | null;
  validation: { validator: string; result: string; created_at: string } | null;
}

export interface PublishKitPiece {
  id: string;
  title: string;
  format: string | null;
  role: DeliverableRole | null;      // from bundle.channel
  locale: string | null;
  contentKind: string;
  status: string;
  publishDate: string | null;
  destination: string | null;
  publicationPath: string | null;
  lane: PublisherLane;
  mayPublish: boolean;
  mayPublishReason: string | null;
  bodyHtml: string | null;           // approved/current version body
  plainText: string;                 // htmlToPlainText(bodyHtml)
  constraints: ConstraintReading[];
  versionNumber: number | null;
  versionAsset: {
    name: string | null;
    mime: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: string | null;
  } | null;
  artifacts: PublishKitArtifact[];
  unresolvedCommentCount: number;
  changeRequestedAt: string | null;
  warnings: string[];
}

export interface PublishKitDateGroup {
  date: string;                 // "" for the undated group
  pieces: PublishKitPiece[];
}

export interface PublishKitView {
  periodId: string;
  periodTitle: string | null;
  startsOn: string;
  endsOn: string;
  firmId: string;
  firmName: string | null;
  generatedAt: string;
  totals: {
    total: number;
    publishable: number;
    blocked: number;
    manual: number;
    pipeline: number;
  };
  groups: PublishKitDateGroup[];
  bundleWarnings: string[];
}
```

### 2d. Which version's body to render — critical rule

For each deliverable in the bundle:

- If `may_publish` is **true**, use `current_version` (which, by
  `evaluateMayPublish`, is the approved version).
- If `may_publish` is **false** and `approved_version` is non-null, use
  `approved_version`, and set `warnings` to include:
  `"Showing the approved version. A newer unapproved version exists."`
- If `may_publish` is **false** and `approved_version` is null, set `bodyHtml`
  to null and `plainText` to `""`.

**Never render `current_version` when it is not the approved version.** This is
the source-integrity rule the whole feature rests on.

### Acceptance for Step 2

- `npx tsc --noEmit` passes.
- File contains no `import ... from "react"`, no JSX, no `server-only`.

---

## STEP 3 — Tests: `src/lib/__tests__/publish-kit-pure.test.ts`

Create the file. Follow the existing style in
`src/lib/__tests__/deliverables-pure.test.ts`. Build small literal fixtures; do
not mock Supabase (there is nothing to mock — the module is pure).

Write **at least** these cases, each as its own `it(...)`:

**htmlToPlainText**
1. `null` returns `""`.
2. `<p>A</p><p>B</p>` returns `"A"` and `"B"` separated by a blank line.
3. `<ul><li>x</li><li>y</li></ul>` puts each item on its own line.
4. `&amp;`, `&quot;`, `&#39;`, `&nbsp;` decode correctly.
5. Tags inside text (`<strong>`) are removed without eating adjacent words.

**countWords**
6. `""` → 0.
7. Multiple spaces and newlines do not create empty tokens.

**readConstraints**
8. `gbp_post` text of 28 words / 201 chars → two readings, both `"ok"`.
9. `gbp_post` text over 300 chars → the characters reading is `"over"`.
10. `social_post` text of 20 words → `"under"` (below the 40 floor).
11. `social_post` text of 90 words → `"over"`.
12. A role with no constraint (`article`) → empty array.
13. `pct` is clamped to 100 when the value exceeds the limit.

**publisherLane**
14. `"firm_website"` → `"pipeline"`.
15. `"linkedin"` and `"google_business_profile"` → `"manual"`.
16. `null` → `"unknown"`.

**Version selection**
17. `may_publish: true` → `bodyHtml` comes from `current_version`.
18. `may_publish: false` with an `approved_version` present → `bodyHtml` comes
    from `approved_version`, and `warnings` contains the newer-version warning.
19. `may_publish: false` with no `approved_version` → `bodyHtml` is null,
    `plainText` is `""`.

**groupByPublishDate**
20. Pieces with dates group under those dates in ascending order.
21. Pieces with a null date land in a single trailing group keyed `""`.
22. An empty input returns an empty array.

**toAgentRecord — the safety property**
23. A publishable piece yields a record containing `body`, `destination`, and
    `artifacts`.
24. A non-publishable piece yields a record where `withheld === true`,
    `publishable === false`, `blocked_reason` equals the bundle's
    `may_publish_reason`, and the keys `body`, `plain_text`, `destination`, and
    `artifacts` are **absent** (assert with
    `expect(record).not.toHaveProperty("body")`, not `toBeUndefined`).
25. `toAgentManifest` includes **every** piece, publishable or not, so a caller
    can report what is blocked. Assert the count equals the input count.

**totals**
26. `totals.publishable + totals.blocked === totals.total`.

### Acceptance for Step 3

- `npm test` passes with all of the above green.
- Case 24 genuinely fails if you delete the withholding branch from
  `toAgentRecord`. Verify by temporarily breaking it, watching the test fail,
  then restoring. Do not commit the broken state.

---

## STEP 4 — Server page: period index

**Create** `src/app/portal/[firmId]/publish-kit/page.tsx`

```tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

Behaviour:

1. `const session = await getPortalSession();`
   from `@/lib/portal-auth`.
2. If `!session` → `redirect("/portal/login")`.
3. If `session.role !== "operator"` → `notFound()`.
   **Operator-only. A lawyer must not see this page at all.** Use `notFound()`
   rather than a redirect so the route's existence is not disclosed.
4. Load periods with `getContentPlan(firmId)` from `@/lib/deliverables` and read
   `plan.periods`.
5. Render a simple list: for each period, the date range
   (reuse the formatting style already used in `ContentPlan.tsx`), the theme,
   and a link to `/portal/${firmId}/publish-kit/${period.id}`.
6. Empty state: "No content weeks yet." — no links, no error.

Keep this page server-only; no `"use client"`, no interactivity.

---

## STEP 5 — Server page: the kit itself

**Create** `src/app/portal/[firmId]/publish-kit/[periodId]/page.tsx`

```tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

Behaviour, in this exact order:

1. `const { firmId, periodId } = await params;`
2. Session + operator gate, identical to Step 4 (redirect when unauthenticated,
   `notFound()` when not an operator).
3. `const result = await buildContentExportBundle(periodId);`
4. If `!result.ok` → `notFound()`.
5. **Firm-ownership check:** if `result.bundle.firm.id !== firmId` →
   `notFound()`. Do not skip this. Without it an operator could load one firm's
   period under another firm's URL and the page would render the wrong firm's
   content under the wrong branding.
6. `const view = toPublishKitView(result.bundle);`
7. Render:
   ```tsx
   <PublishKit view={view} firmId={firmId} />
   ```

Nothing else. All interactivity lives in the client component.

---

## STEP 6 — Client component: `src/components/portal/PublishKit.tsx`

**Create** the file with `"use client";` as the first line.

Props: `{ view: PublishKitView; firmId: string }`.

Import the view types from `@/lib/publish-kit-pure`. Import
`toAgentRecord` / `toAgentManifest` from there too — the component must not
re-implement them.

### 6a. Structure (top to bottom)

1. **Header.** Period theme as `<h1>`, date range, firm name, and chips for
   `total`, `publishable`, `blocked`. Two buttons:
   - "Copy week manifest" → `toAgentManifest(view)`, `JSON.stringify(_, null, 2)`,
     to clipboard.
   - "Refresh download links" → `router.refresh()` from
     `next/navigation`. Label it with the honest reason: download links expire.
2. **Blocked notice.** Only when `totals.blocked > 0`. A bordered, tinted box
   (no left accent bar) listing how many pieces cannot go out and stating that
   their copy and downloads are withheld.
3. **Filter bar.** Two independent groups of buttons:
   - Channel: All / Website / LinkedIn / Google Business, filtering on
     `piece.destination`.
   - Publisher: Any / Posted by hand (`lane === "manual"`) / Pipeline
     (`lane === "pipeline"`).
   Both use `aria-pressed`. Filtering is client state only; never refetches.
   When the combination matches nothing, render "Nothing matches both filters."
4. **Date groups.** For each `view.groups` entry, a heading (formatted date, or
   "No publication date recorded" for the `""` key) followed by its pieces. A
   group whose pieces are all filtered out is not rendered.
5. **Piece cards.** One per piece, `id={"dlv-" + piece.id}` so deep links work.

### 6b. Piece card contents

**Header row:** title, chips for format, locale, `v{versionNumber}`, and the
lane. Right side: a status line —
- `mayPublish === true` → "Approved and current" in `text-green-pass`.
- `mayPublish === false` → "Cannot publish" in `text-amber-700`, with
  `mayPublishReason` rendered verbatim underneath. **Render the reason exactly
  as the bundle supplies it. Do not paraphrase it.**

**Left column — copy.** For each text field, a bordered panel with
`whitespace-pre-wrap` and `select-text`, showing `piece.plainText`. Above it, a
"Copy text" button and a "Download .txt" button. Below it, one meter per entry
in `piece.constraints`.

- When `mayPublish` is false: still show the text (the operator may need to read
  it) but render the Copy and Download controls **disabled**, with the label
  "Copy locked" / "Download locked".
- When `piece.plainText` is empty: render "No approved copy for this piece yet."
  and no controls.

**Right column — artifacts.** For each entry in `piece.artifacts`, and for
`piece.versionAsset` when present:
- The artifact type as a heading, the filename, and a definition list of mime,
  size (format with a helper, e.g. `1,204,338 bytes`), and sha256 in
  `font-mono break-all`.
- A "Download" anchor pointing at `signedUrl`, with `download` and
  `rel="noreferrer"`. When `signedUrl` is null, render a disabled control and
  the reason: "No stored file for this artifact." (a webpage or external-post
  artifact is recorded by URL only).
- The signed-url expiry as small muted text: "Link expires {time}."
- A collapsible `<details>` panel headed "Provenance" containing
  `storagePath`, `publicUrl`, `sha256`, and `validation` when present.
  Collapsed by default.

**Footer row:** unresolved comment count when > 0, change-requested timestamp
when present, any `piece.warnings` rendered as plain sentences, and a
"Copy publish record" button emitting `toAgentRecord(piece)` as pretty JSON.
Also a link to the review page:
`/portal/${firmId}/deliverables/${piece.id}`.

### 6c. Clipboard helper

Use `navigator.clipboard.writeText` with a `document.execCommand("copy")`
fallback via a temporary off-screen textarea. On failure show
"Clipboard blocked. Select the text and copy manually." Never fail silently.

### 6d. Accessibility and motion

- Every control is a real `<button>` or `<a>`; no click handlers on `<div>`.
- Focus states visible.
- Any transition wrapped in `@media (prefers-reduced-motion: no-preference)` if
  you add one. None is required.

---

## STEP 7 — Entry points

### 7a. Per-week link in the content plan

**File:** `src/components/portal/ContentPlan.tsx`

Find the operator-only control row at ~line 582:

```tsx
          {isOperator && (
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={() => setEditing((s) => !s)} ...>
                {editing ? "Close" : "Edit week"}
              </button>
              <DownloadBundleButton periodId={period.id} />
            </div>
          )}
```

Add a `next/link` **before** `DownloadBundleButton`:

```tsx
              <Link
                href={`/portal/${firmId}/publish-kit/${period.id}`}
                className="text-[11px] font-semibold text-navy/70 hover:text-navy"
              >
                Publish Kit
              </Link>
```

`firmId` is already a prop on this component. Confirm `Link` is imported at the
top of the file; add the import if it is missing. Do not restyle or reposition
the existing two controls.

### 7b. Per-deliverable deep link

**File:** `src/app/portal/[firmId]/deliverables/[deliverableId]/page.tsx`

Only when `session.role === "operator"` **and** the deliverable has a non-null
`period_id`, render a link above `<DeliverableReview .../>`:

```tsx
/portal/${firmId}/publish-kit/${detail.deliverable.period_id}#dlv-${deliverableId}
```

labelled "Open in Publish Kit". Do not change any existing prop passed to
`DeliverableReview`. Do not alter the lawyer-preview branch.

---

## STEP 8 — Final verification

Run all three, from the repo root, and paste the real output into your summary:

```bash
npx tsc --noEmit
```

```bash
npm run lint
```

```bash
npm test
```

Then confirm each of these by inspection and state the result explicitly:

1. A lawyer session hitting `/portal/<firm>/publish-kit` gets a 404, not a
   rendered page.
2. An operator hitting a `periodId` belonging to a different firm than the
   `firmId` in the URL gets a 404.
3. A piece with `may_publish: false` renders its reason verbatim and has its
   copy and download controls disabled.
4. `toAgentRecord` on that same piece has no `body`, `plain_text`,
   `destination`, or `artifacts` key.
5. `toAgentManifest` still lists that piece.
6. No file you added or edited writes to Supabase.
7. `git status` shows no migration files and no changes to
   `DeliverableReview.tsx`.

---

## Definition of done

- [ ] Artifacts in the content-export bundle carry `signed_url` and
      `signed_url_expires_at`; three new tests cover it; no existing assertion
      was weakened.
- [ ] `publish-kit-pure.ts` exists, is pure, and has no React or `server-only`
      import.
- [ ] `publish-kit-pure.test.ts` covers all 26 listed cases and passes.
- [ ] `/portal/[firmId]/publish-kit` and `/portal/[firmId]/publish-kit/[periodId]`
      render for operators and 404 for everyone else.
- [ ] The kit shows every deliverable in the period, grouped by publication
      date, filterable by channel and by publisher.
- [ ] Copy is selectable and copyable; artifacts download via signed URLs;
      provenance is disclosed per artifact.
- [ ] Blocked pieces show their reason verbatim, withhold copy and downloads,
      and still appear in the manifest.
- [ ] "Publish Kit" links exist on each week in the content plan and on each
      operator-viewed deliverable that belongs to a period.
- [ ] `npx tsc --noEmit`, `npm run lint`, and `npm test` all pass.

---

## If you get stuck

- **The bundle shape surprises you.** Read
  `src/lib/content-period-export.ts` top to bottom before adapting. Its module
  header documents every deliberate boundary.
- **A field you want does not exist.** Do not add a migration and do not invent
  it. Note it in your summary as a gap and build around it.
- **A test needs a DOM.** It does not. Move the logic into
  `publish-kit-pure.ts` and test it there. `vitest` runs in `node` and will not
  load `.test.tsx`.
- **You are tempted to import `publication-manifest.ts`.** Do not. Read the
  boundary statement in `content-period-export.ts`'s header; it explains why
  these two features stay separate.
