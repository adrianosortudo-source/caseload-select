# Publish Kit — open decisions and deferred findings

**Status:** the Publish Kit UI is built, tested, and shipped. This document records
what was deliberately *not* settled, so none of it is rediscovered from scratch by
the next person or the next audit.

Nine review rounds ran over this feature. The access-control layer is closed: ten
core guarantees were each reverted individually and all ten were caught by failing
tests. What remains below is not that layer.

---

## 1. OWNER DECISION — the JSON export applies no withholding (open since round 4)

**Route:** `GET /api/admin/content-periods/[periodId]/content-export`
**Auth:** `requireOperator()`, no cron-bearer bypass. Operator-only.

`format` defaults to **`json`**. Only `?format=markdown` goes through
`renderContentExportMarkdown`, which is where every withholding rule lives.
The JSON branch returns `result.bundle` verbatim (`route.ts:50`), and signing
happens in `buildContentExportBundle` at lines ~516–543 — *before* `may_publish`
is computed at line ~625. Signing is therefore unconditional.

**Consequence, verified by probe against the real exporter:**

- A blocked `lead_magnet_pdf`: Markdown prints
  `Signed URL withheld: the deliverable is not cleared to publish.`
  while the JSON bundle carries a working `current_version.signed_url`.
- A retracted artifact on an approved, current deliverable: Markdown withholds
  and omits both URLs; the JSON bundle carries both `signed_url` and `public_url`.

**Why this is a decision and not a defect:** the route is operator-only, and the
stated purpose of the export is "retrieve exactly what already exists." An operator
can already see unapproved drafts in the review UI. Nothing here reaches a client.

**Why it still needs deciding before agent use:** the default path — the URL with
no query parameter — is the ungated one. Any publishing agent pointed at this
endpoint receives working links to precisely the retracted and unapproved material
that four rounds of work taught the Markdown path to withhold. The safety guarantee
does not cover the route an agent will hit by default.

**The choice:** either gate the JSON branch the way Markdown is gated, or state
explicitly in the route's header that JSON is deliberately ungated operator-only
raw data and that agents must request `?format=markdown`. Either is defensible.
Silence is not, because it currently reads as an oversight.

---

## 2. OWNER DECISION — the Markdown export prints unapproved bodies

`renderVersionSection` (`content-period-export.ts:716-721`) pushes
`version.body_html` ungated. `withholdReason` suppresses only the signed-URL
lines below it. So a blocked deliverable — `status: "in_review"`,
`approved_version_id: null`, the reachable blocked shape — renders its entire
rejected draft in a fenced block, four lines above
`- Signed URL withheld: the deliverable is not cleared to publish.`

Both sibling consumers of the same data withhold it: `selectVersion` ("unapproved
copy is never rendered here") and `toAgentRecord` (omits `body` and `plain_text`
as keys entirely).

**The tension:** withholding the *asset* of an unapproved version while printing
that same version's *body* is either a principled distinction or an inconsistency.
There is a real argument for the distinction — a signed URL mints a time-limited
credential against storage, whereas body text is data already inside a response the
caller is authorised to receive. But **no comment in the file states that rule**,
so a reader cannot tell which it is.

**The choice:** write the rule down, or gate the body. Do not leave it implicit.

---

## 3. OWNER DECISION — reconstructing approved content from `approval_records`

Carried unchanged since round 4. Whether a blocked piece's last genuinely approved
content should be reconstructed from `approval_records` and shown, instead of the
piece simply reading as unavailable. Product call, never a defect.

---

## 4. Deferred findings — real, none live, fold into the next touch

None of these can leak data. All are latent traps or test-quality gaps. They are
recorded so the next audit does not spend a round rediscovering them.

| # | Location | Finding |
|---|---|---|
| 4.1 | `publish-kit-pure.ts` `blockedPiecesAreFullyWithheld` | Checks `signedUrl` on `artifacts` and `versionAsset` only. Does not check `publicUrl` (which `stripAccess` withholds deliberately — see FU5-5, where keeping it was shipped and reverted), nor `otherVersionArtifacts`, nor anything about copy. Its doc comment claims it verifies "links stripped **and no publishable copy**". Three of the four leak channels are unguarded, and the comment overstates all of it. The predicate exists to be a tripwire; it is blind in three directions. |
| 4.2 | `publish-kit-pure.test.ts` — `blockedPiecesAreFullyWithheld` "true" case | Vacuous. The fixture's blocked piece has `artifacts: []` and `versionAsset: null`, so `.every()` is trivially true and the second disjunct short-circuits. Proven by mutant: deleting the entire `artifacts` clause from the predicate leaves both shipped tests green. |
| 4.3 | `publish-kit-pure.test.ts` — `anchorVersionId` cases | All three fixtures have `anchorVersionId === currentVersionId`, so an implementation of `anchorVersionId = currentVersionId` passes every one. Only the `displayedVersionId !== currentVersionId` shape separates them, and the test file itself documents that shape as unreachable in production. The `?? currentVersionId` fallback *is* pinned; the `displayedVersionId` preference is not. |
| 4.4 | `PublishKit.tsx` blocked banner | Scope mismatch: the count comes from `filteredTotals(view, pieceFilter)`; the guard on the next line reads `view.groups` unfiltered. Fails safe today — it can suppress a true sentence, never assert a false one — but the same shape with the guard inverted would lie. |
| 4.5 | `PublishKit.tsx` header chips + banner | `(filtered)` is attached only to the "total" chip. The banner's headline — "N pieces cannot go out yet." — is an unhedged sentence carrying a filtered count. `filteredTotals`' own doc anticipates this; the caller applies the marker to one of three numbers. |
| 4.6 | `publish-kit-pure.ts` `filteredTotals` | Two branches, two runtime shapes: the unfiltered branch spreads `view.totals` and returns 6 keys (including `manual`/`pipeline`); the filtered branch returns 4. The declared return type names 4, and TypeScript's excess-property check does not apply to spreads, so it is silently wrong for one branch. Add a `manual`/`pipeline` chip later and it works unfiltered, breaks filtered. |
| 4.7 | `PublishKit.tsx` `ARTIFACT_CONTROL_LABEL` lookup | `controlState as Exclude<ArtifactControlState, "download">` is the one hole in the compile-time exhaustiveness the Record was introduced to provide. Unreachable today only because `artifactControlState` returns `"unsigned"` whenever `signedUrl` is falsy. If the `&& signedUrl` conjunct is ever dropped, the button renders `undefined` as its label — no build error, in a file vitest never collects. |
| 4.8 | `publish-kit-pure.ts` `htmlToPlainText` doc | Claims "a stripped inline tag never merges the words on either side of it". `<em>Smith</em><em>Jones</em>` yields `SmithJones`. True only under the unstated precondition that source whitespace exists; the shipped test has whitespace on both sides, so it does not exercise the claim. |

---

## 5. Explicitly NOT doing

- **`", or "` → `", and "` in `artifactWithholdReason`.** Every clause it joins is
  true, so "or" understates certainty rather than saying anything false. Declared
  out of scope in the v7 closing patch; that still holds. Its sibling
  `versionWithholdReason` uses `", and "`, so the two read differently — deliberate,
  not drift.
- **Another audit round.** Rounds 7, 8 and 9 each found real items *and* introduced
  new ones; round 8's own correction patch existed because round 7's plan created a
  structural regression, and round 9 found a comment block this file's author had
  pasted twice. The defect rate is below the churn rate of reviewing. Reopen only
  on: an operator reporting a specific false statement; a schema widening reaching
  `deliverable_role` / `publication_destination`; or decision 1 or 2 above being made.

---

## 6. Known forward-compat trap — `email` / `email_newsletter`

Two migrations sit unapplied in `supabase/migrations/2026071914*.sql`, belonging to
the v5.2 workstream, not to the Publish Kit. When the role/destination widening
lands, `publisherLane` returns `"unknown"` for `'email'`, hiding such pieces from
both publisher filters and breaking `manual + pipeline === total`.
`Record<PublisherLane, string>` will **not** catch it, because the TypeScript union
is not widened by the SQL. Widen `PublisherLane` in the same change as the migration.
