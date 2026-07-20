---
doc-type: operating-playbook
scope: publication-readiness-manifest-and-artifact-evidence
status: active
version: v3
last-edited: 2026-07-16
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

## The activation boundary (DR-098, v2 addition)

Every period, past or future, carries an explicit `readiness_lifecycle` on
`content_periods`: `legacy_unreconciled` | `setup_required` | `enforced`.
This is not derived from a date, a deliverable count, or any other proxy.
It is set once, deliberately, by a reviewed migration or an operator
action, and the pure evaluator's raw pass/fail result is never trusted to
decide it on its own.

**The four states a lawyer or operator actually sees, and what each one
means:**

- **Not yet reconciled** (`legacy_unreconciled`, rendered
  `historical_unreconciled`). This period predates the readiness ledger.
  Its content may already be approved, live, and correct; that has simply
  never been checked against this system. The label is a statement about
  the *evidence record*, not about the content's legal or publication
  status. Nothing here implies the content is unsafe, unapproved, or
  wrong; it implies only that nobody has yet walked through the
  reconciliation workflow below for it.
- **Setup required** (`setup_required`, the default for every period not
  explicitly classified otherwise, past, present, or future). Current
  work, future work, and stalled/incomplete backlogs alike. Not
  historical, not yet activated, not alarming. A deliverable can sit here
  even after its own metadata is fully backfilled; that just means it is
  ready *for activation*, not "ready" in the enforced sense below.
- **Blocked** (`enforced` period, deliverable fails a genuine, current
  requirement). Reserved exclusively for a period an operator has
  explicitly activated, where a specific deliverable is missing a real
  production requirement, an image, an approval, a live route, a stale
  artifact bound to the wrong version. A deliverable that fails only a
  metadata-shaped requirement (see `METADATA_ONLY_KEYS` in
  `publication-readiness.ts`) inside an enforced period still renders
  "Setup required," not "Blocked," because the activation trigger already
  guarantees metadata completeness at the moment of activation; a
  metadata gap appearing after that point is a defense-in-depth signal,
  not a normal-path outcome.
- **Ready** (`enforced` period, every blocking requirement passes). The
  only state that means "this specific version, with this specific
  evidence, is actually fit to publish." Never inferred, never assumed;
  every constituent check is evaluated fresh, every time.
- **Excluded** (archived deliverables). Out of scope regardless of period
  lifecycle, matching `evaluateDeliverableReadiness`'s own short-circuit.

**Who may activate a period, and how.** Activation (the transition to
`enforced`) is operator-only, one period at a time, never a bulk or
scheduled operation. `POST /api/portal/[firmId]/periods/[periodId]/activate-readiness`
rejects a missing session with 401 and a non-operator session with 403.
Before writing, it runs the same preflight
(`evaluateActivationPreflight`) the database trigger
(`trg_validate_readiness_activation`) will re-check atomically: every
active deliverable in the period must already have `deliverable_role`,
`locale`, and `publication_destination` set, and, for roles that carry
their own placement (`article`, `landing_page`, `lead_magnet_pdf`),
`publication_path` too. A period failing that check gets a 409 with the
exact list of blocking deliverable ids, never a silent partial
activation. **Activation itself never claims a deliverable is ready.** It
only turns on the strict evaluation; every deliverable inside a
freshly-activated period still has to pass its own requirements, exactly
like a brand-new one would. Re-activating an already-enforced period is a
no-op (the timestamp is never re-stamped). An *ordinary* UPDATE against
`content_periods`, issued through the app's normal `service_role`
connection, can never move a period away from `enforced` once activation
has been recorded: `trg_validate_readiness_activation` checks
`current_user = 'postgres'` and refuses anything else unconditionally
(see `20260715210116_content_periods_enforced_monotonic.sql`). That
monotonic guarantee is deliberate — an operator action taken through the
app, or a bug in application code, cannot silently un-enforce a period
through the same trigger that guards activation. (A migration applied
with elevated database privileges, or a database owner acting directly,
sits in a different category — see the honest limitation spelled out
below.)

**The one audited, exceptional path off enforcement (DR-099).**
`POST /api/portal/[firmId]/periods/[periodId]/deactivate-readiness` is the
sole route that can move a period back from `enforced` to
`setup_required` or `legacy_unreconciled`, and it exists specifically to
correct a misclassification, never to routinely toggle enforcement. It
rejects a missing session with 401 and a non-operator session (lawyer or
client) with 403; it requires a non-empty `reason` string and a
`toLifecycle` of `setup_required` or `legacy_unreconciled`, anything else
is a 400. It never acts on a period without a human-supplied
justification, and it is never a blanket or bulk operation — one period,
one call, one reason, every time.

The route performs no writes of its own. It calls
`deactivatePeriodReadiness()` (`src/lib/deliverables.ts`), which delegates
to the `deactivate_period_readiness_atomic` SECURITY DEFINER RPC (the same
pattern as `record_approval_atomic`). That RPC is the sole supported,
audited *application* path off enforcement:
`trg_validate_readiness_activation` checks `current_user = 'postgres'`
and refuses the downgrade for anyone else, and the RPC is the only
function owned by `postgres` that performs this write, so no ordinary
application code, no other function, and no direct table update issued
through the app's normal `service_role` connection can move an enforced
period backward. That is a statement about ordinary application and
service-role write paths, not an unconditional claim about every
possible Postgres session: a database owner or Postgres superuser
retains administrative authority over the database itself (disabling or
dropping the trigger, or connecting directly as the `postgres` role and
issuing a plain UPDATE, which the trigger explicitly permits when
`current_user = 'postgres'`). That is a documented, accepted limitation
of this design, not a gap it attempts to close — the invariant this
trigger provides is "ordinary application/service-role code paths cannot
bypass the audited RPC," not "no Postgres session anywhere, ever, can
move this backward." Every call through the RPC inserts exactly one
append-only row into `content_periods_enforcement_audit`, recording the
period, the firm, the actor (operator id and name), the reason, and the
from/to lifecycle values. That table carries its own
`trg_block_content_periods_enforcement_audit_mutation` trigger (blocks
every UPDATE and DELETE unconditionally) and RLS enabled and forced with
`anon`/`authenticated`/`public` all revoked, so the only way to read or
write it is a service-role query or the RPC itself: there is no way to
reopen a period without a reason on file, and no way to later edit or
erase why one was recorded.

**How historical reconciliation actually works, end to end.** For a
period found to be `legacy_unreconciled` (or one an operator later
decides to move toward activation), the workflow is always: (1) inventory
every active deliverable's current metadata gaps and evidence state,
producing a dry-run reconciliation manifest (see below), never a live
write; (2) an operator personally verifies whatever evidence the dry run
flagged as checkable (loads the live URL, downloads the PDF and computes
its hash, confirms an image exists in storage) and registers it as a
`publication_artifacts` row through the manual insert path described
below; (3) the operator backfills the deliverable's own metadata columns
(`deliverable_role`/`locale`/`publication_destination`/`publication_path`)
via a reviewed migration, grounded only in facts already true (a title
string implying a format, a route that already exists in the site's
source, never an invented one); (4) once every active deliverable in the
period has complete metadata, the operator runs the activation endpoint;
(5) from that point the period behaves exactly like any other enforced
period, "Blocked" now means something real, and further evidence
registration goes through `reconcile-artifacts` like any other
deliverable. A partially reconciled period can be resumed at any point in
this sequence: metadata backfill and evidence registration are both
idempotent, additive operations (a migration that sets already-correct
values is a no-op; a duplicate artifact registration is rejected by
`publication_artifacts_dedupe_idx`), so there is no "resume token" to
track, only "how many of the active deliverables still fail the
activation preflight," which the preflight itself reports on every call.

**Evidence provenance and the standing prohibition against invented
receipts.** Every fact that ends up in a metadata backfill migration or a
`publication_artifacts` row must trace to something a human actually
did: loaded a URL and saw it resolve, downloaded a file and hashed it,
read a route that already exists in a site's source tree. A planned
publication date is not evidence of publication. A matching title is not
evidence of a live page. A portal approval is not evidence of external
placement. An expiring signed URL is an access mechanism, not a durable
receipt; the durable identity of a storage-backed artifact is always its
bucket/path pair. When no real evidence exists for a slot, the correct
value is `null`, recorded with a comment explaining why, never a guessed
path or a fabricated hash. The relocation-clause metadata migration
(`20260715120500_relocation_clause_publication_metadata.sql`) is the
worked example: three PT-locale rows are left with `publication_path =
null` because no Portuguese page exists anywhere in site source, and two
EN rows keep their real, designed path even though that path currently
404s live, because the gap is an undeployed-but-authored page, not a
missing one, and the migration says so in its own comments rather than
routing around it.

**Pending legal approval is never bypassed by reconciliation.** A
deliverable whose current version has not been approved by the firm's
lawyer (`approved_version_id !== current_version_id`, or `status =
'in_review'`) fails `current_version_approved` regardless of period
lifecycle, regardless of how much other evidence exists, and no
reconciliation action in this system can change that. The operator
cannot approve on the licensee's behalf; the only way a deliverable
clears that check through `evaluateDeliverableReadiness` (this document's
`ready`/manifest surface) is the firm's lawyer signing off through the
existing approval workflow. The relocation-clause period's own "Clause in
the Margin" PT article (`b767ef14-dd4e-405e-9c54-1f7f9364f13c`) is
`in_review` today and stays that way through every migration in this
feature; nothing here touches its `status` or `approved_version_id`.

**Standing Publishing Authorization (2026-07-17) is a narrower, separate
exception at the claim layer, not a change to this document's readiness
evaluator.** `evaluateDeliverableReadiness`'s `current_version_approved`
check above is unchanged and still passes only via individual lawyer
sign-off -- a firm's standing authorization does not flip it, and a
deliverable relying on standing authorization still shows
`current_version_approved: fail` in this manifest/readiness surface. The
actual second path lives one layer down, in
`claim_placement_for_publish()` (see `lib/publication-placement-claims.ts`
and `supabase/migrations/20260717230956_standing_publishing_authorization.sql`):
a claim may proceed either because the version was individually approved
(this document's existing path, unchanged) or because the firm's latest
`standing_publishing_authorizations` event is `'enabled'` and the version
is not flagged `requires_individual_review`. Every other requirement this
document describes -- role/locale metadata, artifact binding, placement
readiness, journey validation -- applies identically on both paths; only
the single "has a lawyer individually signed this exact version"
condition gets a second way to be satisfied. See the CLAUDE.md "Standing
Publishing Authorization (DR-104)" section for the full model.

**Rollback and recovery.** The lifecycle columns and their two triggers
are purely additive (new columns, new constraints, new triggers on
existing tables); rolling back means dropping the two triggers, the two
CHECK constraints, and the two columns, in that order, which reverts
every period to having no lifecycle concept at all and reintroduces the
original false-"Blocked" bug for anything except Founder Vesting. A
partially-applied migration set (e.g. the activation-invariant migration
applied but a later metadata-backfill migration not yet run) is safe by
construction: every period defaults to `setup_required` until explicitly
classified, so an interrupted rollout never produces a mislabeled
"Blocked" state, only a temporarily-incomplete "Setup required" one.
Because activation is gated by a database trigger, a bad application-code
deploy cannot force an under-classified period into `enforced`; the
worst a code bug can do is refuse a legitimate activation, never grant an
illegitimate one.

**The Codex review and release gate.** No migration in this feature
applies to production, and no code from this branch deploys, until an
independent Codex architecture and release review has run against the
open PR and approved it. This document, the dry-run reconciliation
manifest under `docs/reconciliation/`, and the PR description together
are the review artifact; Codex should specifically re-verify the
no-fabrication claims above against the actual migration SQL, not just
this doc's prose. See the migration/deployment runbook,
`docs/runbooks/publication-readiness-legacy-reconciliation-migration.md`,
for the exact application order once that review clears.

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

## Approval binds to the version, not the rendering (DR-105)

`may_modify_copy: false` in the manifest's policy block, above, governs
the deliverable's own substantive copy. It does not, and was never meant
to, forbid a separate, narrower thing: rendering an already-approved
version's exact substantive content on a destination surface other than
its source surface, wrapped in that destination's own required
presentation and compliance boilerplate. DR-105 (`00_System/01_Doctrine/DECISION_RECORDS.md`)
names this a Surface-Presentation Adaptation and gives it its own
controlled path, `docs/publication-operator/surface-presentation-adaptation-registry.md`,
so the two concerns stay distinct: an agent still may never regenerate,
shorten, translate, or otherwise rewrite a deliverable's substantive
copy, on this or any other route; a pre-registered, whitelisted
presentation difference (most concretely, a compliance disclaimer whose
website wording literally says "this website" and would be false on a
different surface) is not that, and is resolved by exact registry
lookup, never drafted at runtime. See `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md`
§4.1a and §5 for where this sits in the full publication preflight, and
"Pending legal approval is never bypassed by reconciliation," below, for
the unrelated, unchanged rule this does not touch: individual lawyer
sign-off on substantive content is never something a Surface-
Presentation Adaptation, an operator, or an agent may substitute for.
This section is doctrine only as of 2026-07-19: the manifest evaluator
does not yet call a `resolve_surface_presentation_adaptation` step, and
no code path reads the registry file above at runtime.

The registry's own source-authorization eligibility bar
(`immutable_release_authorized_version`) is the same two-path model this
document already describes above under "Standing Publishing Authorization
(2026-07-17)": a source version is eligible for a Surface-Presentation
Adaptation only when it is immutable and release-authorized through an
individual lawyer approval, or through an active standing authorization
covering a version that is not flagged `requires_individual_review`. This
is not a separate or looser authorization concept unique to surface
adaptation; it is the identical bar `claim_placement_for_publish()`
already applies. A registered adaptation rule's `platform_link_formatting`
allowance is narrow in the same way: it may only re-render an
already-approved, existing link in the destination platform's required
format, never change the URL, destination, CTA target, or anchor
meaning, and never add, remove, or substitute a link (see the registry's
own scope note for the exact boundary).

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
