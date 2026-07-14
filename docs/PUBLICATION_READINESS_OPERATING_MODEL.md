---
doc-type: operating-playbook
scope: publication-readiness-manifest-and-artifact-evidence
status: active
version: v1
last-edited: 2026-07-14
---

# Publication readiness operating model

This is the operating reference for the publication readiness system: the
manifest that reports whether a deliverable is actually ready to go live, the
artifact ledger that backs that report with real evidence, and the
reconciliation endpoint that checks the evidence is still true. It exists to
enforce DR-093 (content-complete and publishable are separate states) and
DR-094 (approval binds to immutable artifact bytes) as running code, not just
as doctrine.

This is a different, adjacent system from the comment, suggestion, and
approval workflow. That workflow is documented in
`docs/CONTENT_STUDIO_APPROVAL_PLAYBOOK.md` (how a lawyer's review moves a
deliverable to an approved version) and `docs/CONTENT_STUDIO_RELEASE_RUNBOOK.md`
(how a code or database change to that workflow gets deployed). Neither of
those docs is restated here. Publication readiness starts only after a
version is approved; it asks a separate question, whether everything that
version needs to actually appear in front of a client, in the right
language, at the right address, with the right evidence on file, exists and
still checks out.

## The core distinction

Seven states, each one necessary but not sufficient for the next:

Copy present is not the same as content approved.
Content approved is not the same as artifact built.
Artifact built is not the same as artifact bound to the approved version.
Artifact bound is not the same as destination ready.
Destination ready is not the same as publication authorized.
Publication authorized is not the same as published.
Published is not the same as live and verified.

The manifest endpoint answers the middle of that chain (approved through
destination ready). It does not authorize, publish, or verify live status.
Nothing in this system does those things yet; see Known limitations below.

## The manifest endpoint (read only)

`GET /api/admin/content-periods/[periodId]/publication-manifest`

- Query param: `format=json` (default) or `format=markdown`.
- Auth: an operator session, or a `Bearer` token matching `CRON_SECRET` /
  `PG_CRON_TOKEN`, the same pattern used by the webhook-outbox admin routes.
  There is no lawyer-facing or public path to this endpoint.
- For every deliverable in the period it reports: locale, deliverable role,
  publication destination and path, the current and approved version ids,
  whether the current version is actually the approved one, whether the
  current version has a body, which artifacts the deliverable's role
  requires, which of those artifacts actually exist and are bound to the
  current version, which existing artifacts are bound to a stale (non-current)
  version instead, and a final `ready` boolean.
- Every response also carries a fixed `policy` block:
  `generation_policy: "existing_assets_only"`, `may_generate_missing_assets:
  false`, `may_modify_copy: false`, `may_translate: false`,
  `may_publish_ready_items: false`, `requires_explicit_publication_authorization:
  true`. Every deliverable row also carries `permitted_actions`
  (`view_readiness`, `reconcile_evidence`, `download_manifest`) and
  `prohibited_actions` (`generate_missing_asset`, `rewrite_content`,
  `translate_content`, `publish`, `schedule`,
  `approve_on_behalf_of_lawyer`).
- The `format=markdown` rendering opens with an explicit "AI operator
  instructions" block (do not generate, do not modify copy, do not
  translate, do not publish, report missing requirements, wait for explicit
  authorization) so an agent reading the manifest as text sees the same
  constraint an agent reading the JSON would have to infer from the policy
  object.

This endpoint is read only. It runs one evaluation function over data
already in Supabase and returns it. No code path reachable from this route
generates an asset, rewrites or translates copy, publishes anything, or
schedules anything. If a future change adds any of those, it does not belong
on this route.

## The reconciliation endpoint (validates, never authors)

`POST /api/admin/content-deliverables/[deliverableId]/reconcile-artifacts`

- Auth: operator session only.
- For every `publication_artifacts` row already registered against the
  deliverable, it runs the checks that apply to that artifact's type: a
  storage-object existence and size check for images and PDFs, a SHA-256
  match for PDFs, an HTTP reachability check for webpages, landing pages,
  and thank-you pages, and a completeness check on the recorded repository
  and commit for a deployed webpage. Emails and external posts (LinkedIn,
  GBP) have no automated check today; they read back as registered evidence
  only.
- Every check writes exactly one append-only row to
  `publication_artifact_validations`, recording pass, fail, or error. A
  check that cannot confirm evidence reports fail or error, never a silent
  skip that would read as success.
- What it does not do: it never registers a new `publication_artifacts` row,
  never guesses a file's location from a naming convention, never generates
  or edits anything, and never publishes or approves anything. It only
  re-checks evidence an operator already put on record.

## Mandatory agent rule

Any instruction to publish begins with read-only reconciliation. Missing
assets are blockers, never implied authorization to create them.

## Registering a new artifact today (manual, no UI yet)

There is no admin UI and no API route that writes to `publication_artifacts`
in this phase. The table itself enforces that: RLS is enabled and forced
with zero policies, and `anon`/`authenticated`/`public` are revoked, so the
only role that can write to it is the service role. Registering a new
artifact today is a direct, operator-run insert against Supabase using the
service-role connection (the Supabase MCP `execute_sql` tool, or an
equivalent one-off script carrying `SUPABASE_SERVICE_ROLE_KEY`), done only
by an operator who has personally opened the storage object, loaded the live
URL, or otherwise confirmed the evidence exists. This is not a placeholder
for a future UI; it is the real, current path, and it should stay honest
about being manual until a registration surface actually ships.

The insert itself is constrained at the database level, so a bad row fails
loudly rather than silently:

- `deliverable_id` and `version_id` must resolve to the same `firm_id` and
  the same deliverable; a trigger rejects any row that points a version at
  the wrong deliverable or the wrong firm.
- `artifact_type` must be one of the fixed set (`hero_image`, `social_image`,
  `pdf`, `webpage`, `email`, `thank_you_page`, `form`, `external_post`).
- A storage-backed artifact needs both `storage_bucket` and `storage_path`
  set together, never one without the other, and the durable identity is
  that bucket/path pair, never a signed URL with an expiry baked in.
- Once inserted, the row cannot be updated or deleted. A trigger blocks
  every update and delete unconditionally. A correction is always a new row
  bound to the current version, never a mutation of the old one, which is
  the same "never overwrite an approved artifact" posture DR-094 locks for
  the deliverable's own bytes.

After registering a row, run the reconciliation endpoint (or have the
operator run it) so the evidence is actually checked, not just claimed by
the insert.

## Known limitations, not yet built

- No UI action exists to author a `publication_release` yet.
  `publication_releases` and `publication_release_items` exist in the
  database as the data foundation for a future authorize-and-publish step,
  with a status lifecycle and immutable per-item snapshots, but nothing in
  the app writes to them and there is no "authorize" action anywhere in the
  product. Reaching `publication authorized` in the seven-line chain above
  is not possible through the app today.
- No automated posting integration exists for Google Business Profile or
  LinkedIn. An `external_post` artifact is a record the operator registers
  after posting manually; nothing in this system posts on the operator's
  behalf.
- The Portuguese article routes and the Portuguese PDF for the current
  Founder Vesting content period remain genuinely unbuilt as of this
  writing. The `pt-BR` deliverables in that period carry a null
  `publication_path` and will fail `role_and_locale_known` and
  `localized_route` in the manifest until the corresponding website and
  file work ships. The manifest reporting them as blocked is correct
  behavior, not a bug to route around.

## Evidence record: Founder Vesting period (2026-07-13 to 2026-07-17)

Period id `187a18a7-aca5-4d7e-962e-07789b7c7923`, firm `eec1d25e-a047-4827-8e4a-6eb96becca2b`
(DRG Law Professional Corporation). The 8 rows below are every
`publication_artifacts` row registered against this period as of
2026-07-14, each personally verified before insert (live browser check on
the deployed page, or a SHA-256 computed directly from the downloaded
file). None were assumed present from documentation or code alone.

| Artifact id | Deliverable | Type | Evidence |
|---|---|---|---|
| `2dc59780-13cf-47de-a66d-d896d46c64e0` | Founder vesting in Ontario corporations... (Counsel Note, EN) | hero_image | `firm-files:deliverables/hero/eec1d25e.../c98ef96c.../1782273526106-journal-founder-vesting-ontario.png` |
| `5ccc248a-b954-450a-a307-02f20d06b71e` | Founder vesting in Ontario corporations... (Counsel Note, EN) | webpage | `https://drglaw.ca/journal/founder-vesting-ontario`, confirmed live in-browser 2026-07-14 |
| `67b97422-756e-4098-8402-a778941482ae` | What the forfeiture clause... (Clause in the Margin, EN) | hero_image | `firm-files:deliverables/hero/eec1d25e.../0ba293e2.../1783615431132-wk4-citm-overlay-v2.png` |
| `c7753a99-35b1-49e3-877d-3e7d24adf77f` | What the forfeiture clause... (Clause in the Margin, EN) | webpage | `https://drglaw.ca/journal/founder-vesting-forfeiture-clause`, confirmed live in-browser 2026-07-14 |
| `9be3ba41-14ab-4c53-858f-befbb7844ffa` | Founder vesting checklist (Lead Magnet Document, EN) | hero_image | `firm-files:deliverables/hero/eec1d25e.../71939150.../1783616676658-wk4-doc-hero-v2.png` |
| `0dabea0a-8e32-4968-8aeb-a81a3589c6a8` | Founder vesting checklist (Lead Magnet Document, EN) | pdf | `https://drglaw.ca/resources/founder-vesting-checklist.pdf`, 164,381 bytes, SHA-256 `8faf185a9e686ee69fd58d9dd5e9558e284b2cbc3f8e1aca618042b292a66139` (computed directly from the downloaded file, not copied from any prior record) |
| `05f99224-4aca-4b88-887f-6e0a39ae05b1` | Founder vesting checklist (Landing Page, EN) | webpage | `https://drglaw.ca/resources/founder-vesting-checklist`, confirmed live in-browser 2026-07-14 |
| `68358928-6f5e-4553-b5a2-e91794352eba` | Founder vesting checklist (Landing Page, EN) | form | Email-gate form visually confirmed present on the same live page |

**Deliberately not registered:** `delivery_email_present` and
`thank_you_page_present` for the landing page. Confirming those would have
required submitting the live client-facing form, which was not authorized.
Both remain honestly reported as missing in the manifest, and the readiness
evaluator's fail-closed default makes that the correct, uneventful outcome
rather than a defect: `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`
exists precisely so an unverified requirement is never silently assumed
satisfied.

**Reconciliation exercised live** against the Counsel Note's two artifacts
(2026-07-14, via `POST /api/admin/content-deliverables/c98ef96c-.../reconcile-artifacts`
through the deployed dev server, real operator session): `storage_object_check`
passed on the hero image (2,051,650 bytes confirmed in Supabase Storage),
`route_check` passed on the webpage (HTTP 200 at the live URL),
`deployment_check` correctly failed (no `deployment_commit` was ever
recorded, so it honestly reports incomplete rather than assuming success).
Confirmed in the database immediately after: `publication_artifacts` still
held exactly 8 rows (the reconciliation endpoint cannot register a new
artifact, only validate an existing one), and 3 new append-only rows landed
in `publication_artifact_validations`.

**Idempotency:** `publication_artifacts_dedupe_idx`, a unique index on
`(deliverable_id, version_id, artifact_type, coalesce(locale,''),
coalesce(destination,''))`, blocks a retried registration from creating
duplicate active evidence for the same slot. Verified live in a
rollback-wrapped transaction: re-inserting the exact Counsel Note hero-image
row raised `unique_violation` as expected, then rolled back cleanly with
zero rows left behind.

**Authenticated release-gate walkthrough** (2026-07-14, against commit
`71b4c0e`, the exact commit the Vercel preview built): Vercel Deployment
Protection SSO-gates the preview at the platform level with no automation
bypass available in this environment, so the walkthrough ran against a local
`next dev` server on the same worktree/commit, using a short-lived (2h)
operator session token minted with the real `PORTAL_SECRET` for the actual
`firm_lawyers` operator row (`47941c38-...`, `adriano@caseloadselect.ca`) —
the same signing function (`generatePortalToken`) and the same
`/api/portal/login` verification path a real clicked magic-link email uses.
The token and the script that minted it were deleted immediately after use
(confirmed empty scratch directory, 2026-07-14T20:17:00Z). No deliverable
was approved, edited, archived, or published during the walkthrough.

Confirmed: `GET /api/admin/content-periods/187a18a7-.../publication-manifest`
returned `"summary":{"active_deliverables":13,"ready":0,"blocked":13,
"excluded_archived":1}` and `"generated_by":{"role":"operator","id":
"47941c38-..."}` — exact expected counts, under a real operator session.
The per-period `PeriodCard` for Founder Vesting rendered its own "Download
manifest" link scoped to that period's real id (distinct from 7 other
period cards on the same page, each with its own distinct periodId, and
distinct from the whole-plan `ReviewOverview` aggregate section, which
correctly has no download link). Blocked-reason lists rendered specific,
accurate per-deliverable issues (e.g. the lead-magnet landing page showing
exactly the four unmet requirements: legal approval, delivery email,
thank-you page, journey validation). The deliverable detail page for
"Founder vesting checklist" rendered its existing version history, sign-off
notice ("The operator cannot sign on the licensee's behalf"), archive
control, and comment system unchanged, with no generate, translate,
approve-on-behalf, publish, or schedule action anywhere on the page.

Not independently re-tested live: client/lawyer-role rejection from
`/api/admin/*`. This is proven by the same code path `getOperatorSession()`
uses for the operator check (`session.role !== "operator"` rejects lawyer
and client alike, `src/lib/portal-auth.ts`), already covered by the passing
test suite, and was not re-tested with a second minted token in order to
keep this walkthrough scoped to the single real operator row the release
gate specified.
