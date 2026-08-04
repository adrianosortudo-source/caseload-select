# Publish Kit — decisions and deferred findings

**Status:** built, tested, shipped. Decisions 1 and 2, open since round 4, are now
**RESOLVED** — see below. This document records how, and what remains deferred, so
none of it is rediscovered from scratch by the next person or the next audit.

Nine review rounds ran over this feature. The access-control layer is closed: ten
core guarantees were each reverted individually and all ten were caught by failing
tests.

---

## 1. RESOLVED — the JSON export now applies the same withholding as the Markdown

**Was:** `format` defaults to `json`, and the JSON branch returned the bundle
verbatim. Signing runs in `buildContentExportBundle` *before* `may_publish` is
computed, so the default URL returned working signed URLs to retracted and
unapproved artifacts — exactly what the Markdown path withholds.

**Now:** `withholdBundleLinks(bundle)` (`content-period-export.ts`) applies the
withholding to the bundle itself, routed through the same
`shouldWithholdArtifactLinks` predicate both Markdown sections use, and the route
serialises its output. Withholding lives in the data, not the renderer — the same
lesson the Publish Kit learned when `stripAccess` moved into `publish-kit-pure.ts`.

Four tests pin it, including an **over-strip guard** (an active artifact on a
publishable, current deliverable keeps its links, so "null everything" does not
pass) and an agreement test asserting the withheld JSON contains no URL the
Markdown refuses to print. Reverting the withholding fails three of them; that
was run and observed, not assumed.

`renderContentExportMarkdown` deliberately still receives the **raw** bundle: its
withheld-reason lines are gated on `signed_url` being present, so a pre-withheld
bundle would silently delete the "Signed URL withheld: …" explanations instead of
printing them. A route test pins that asymmetry in both directions.

**Rationale for the original decision being reopened:** it was correctly classified
as operator-only and therefore not a client-facing leak. But the ungated path was
the *default* one, so any agent pointed at the endpoint hit it first. That made it
a coherence failure worth closing rather than documenting.

### Historical detail, for anyone re-auditing

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

---

## 2. RESOLVED — unapproved bodies are exported, and the rule is now written down

`renderVersionSection` (`content-period-export.ts:716-721`) pushes
`version.body_html` ungated. `withholdReason` suppresses only the signed-URL
lines below it. So a blocked deliverable — `status: "in_review"`,
`approved_version_id: null`, the reachable blocked shape — renders its entire
rejected draft in a fenced block, four lines above
`- Signed URL withheld: the deliverable is not cleared to publish.`

Both sibling consumers of the same data withhold it: `selectVersion` ("unapproved
copy is never rendered here") and `toAgentRecord` (omits `body` and `plain_text`
as keys entirely).

**Resolved as: keep the behaviour, state the rule.** The distinction is principled,
and it is now written as policy in the route header —

> ACCESS is withheld; IDENTITY and CONTENT are not. A signed URL mints a
> time-limited capability against storage, whereas a body is data already inside a
> response this operator-only route is authorised to return. An operator can read
> the same draft in the review UI.

`storage_path`, `storage_bucket`, `sha256`, `mime` and `size` survive withholding
for the same reason: an operator who cannot be handed a URL still needs to find the
file by hand, which is the whole point of withholding the link rather than the
record.

The defect was never the behaviour — it was that no rule distinguished it from an
oversight. If the rule is revisited, revisit it in the route header, where it now
lives.

---

## 3. OWNER DECISION — reconstructing approved content from `approval_records`

Carried unchanged since round 4. Whether a blocked piece's last genuinely approved
content should be reconstructed from `approval_records` and shown, instead of the
piece simply reading as unavailable. Product call, never a defect.

---

## 4. Round-9 findings — all fixed except one, which is a design tension

None of these could leak data; all were latent traps or test-quality gaps. Recorded
with their resolutions so a future audit does not spend a round rediscovering them.

| # | Location | Finding | Status |
|---|---|---|---|
| 4.1 | `blockedPiecesAreFullyWithheld` | Checked `signedUrl` on `artifacts` and `versionAsset` only — not `publicUrl` (which `stripAccess` withholds deliberately; see FU5-5, where keeping it was shipped and reverted), not `otherVersionArtifacts`. Its doc also claimed it verified copy, which it never did. A tripwire blind in three of four directions. | **FIXED.** All four channels checked; doc corrected. Copy is explicitly *not* checked, with the reason stated: the controls are `disabled={!piece.mayPublish}` and every piece examined has `mayPublish` false. Five leak-channel tests; narrowing the predicate fails three, observed. |
| 4.2 | `blockedPiecesAreFullyWithheld` "true" test | Vacuous — fixture had `artifacts: []` and `versionAsset: null`, so `.every()` was trivially true. A mutant deleting the whole artifacts clause left it green. | **FIXED.** Fixture now carries a bound artifact, an other-version artifact and a stored version asset, and the test asserts the fixture is non-empty before asserting the predicate. |
| 4.3 | `anchorVersionId` tests | All three fixtures had `anchorVersionId === currentVersionId`, so a plain alias of `currentVersionId` passed every one. | **FIXED.** Added the approved-differs-from-current shape, where `displayedVersionId` is `v2` and `currentVersionId` is `v3`; the anchor must follow the displayed version. |
| 4.4 | Blocked banner scope | Count came from the filtered set, guard read the whole view. | **FIXED.** `blockedPiecesAreFullyWithheld` now takes the pieces to check, and the component passes exactly what it renders. |
| 4.6 | `filteredTotals` | Two branches, two runtime shapes — unfiltered spread 6 keys, filtered returned 4, and the declared type named 4. Excess-property checks do not apply to spreads, so TS could not see it. | **FIXED.** Filtered branch recomputes every field; return type is now `PublishKitView["totals"] & { isFiltered: boolean }`, so the two can no longer diverge. |
| 4.7 | `ARTIFACT_CONTROL_LABEL` cast | `controlState as Exclude<…, "download">` was the one hole in the Record's exhaustiveness guarantee. | **FIXED.** Record covers the full union; cast removed. The `download` entry is documented as defensive-only. |
| 4.8 | `htmlToPlainText` doc | Claimed inline tags "never merge the words on either side"; `<em>Smith</em><em>Jones</em>` yields `SmithJones`. | **FIXED.** Doc now states the actual guarantee and its precondition. |
| 4.5 | Header chips + banner | `(filtered)` marks only the "total" chip; the banner headline "N pieces cannot go out yet." carries a filtered count unhedged. | **OPEN — design tension, not a coding error.** The alternative (period totals above a filtered list) is worse. Revisit if operators misread it. |

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
