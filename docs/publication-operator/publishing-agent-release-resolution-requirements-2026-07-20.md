<!-- DOC-META v1
doc-type: architecture
status: draft
version: v2
last-edited: 2026-07-21
supersedes: none (additive to docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md, docs/publication-operator/surface-presentation-adaptation-registry.md, DR-105, and docs/PUBLICATION_READINESS_OPERATING_MODEL.md; nothing below removes or loosens any rule in those documents)
v2 changelog: added §13, the resolve_and_audit_release_graph preflight stage and its implementation (src/lib/release-graph/), a calibration pass that refines and renames some of §7's states (see §13.2's reconciliation table) and extends the DRG Renewal Clause case study (§13.6) with visual-rendition-role findings. §1-§12 are unchanged from v1 and are kept for the failure-mode narrative and destination-manifest model they still describe correctly; where §13 uses a different name for the same underlying gap, §13.2 says so explicitly rather than leaving two competing vocabularies unreconciled.
v2 same-day addendum (2026-07-21, pre-review policy fix): §13.2b corrects two classifications (`unsubscribe_endpoint_pending`, `compliance_wrapper_missing` for `linkedin_article`) that originally fired from an invalid evidence source (this repository's own code, or the absence of a runtime reader) rather than from the actual system/firm record each fact is really about. See §13.2b for the full correction and reasoning.
-->

# Publishing agent release-resolution requirements addendum

This is a documentation-only addendum. It does not create, apply, or modify a migration; does not write, update, or delete a production row; does not touch application code; does not run a build or test suite; and does not publish, schedule, or send anything. Every fact below that concerns already-existing system behavior traces to the files, tables, and doctrine cited inline, all confirmed present on `origin/main` at commit `f50b452` (merge of PR #63, `docs/publication-operator-dr105-2026-07-19`) unless a citation explicitly says otherwise. Where this document draws on the unmerged `feat/publication-operator` branch, DRG-specific work-session facts, or open decisions, it says so plainly rather than presenting them as shipped.

This addendum revises the future Publishing Agent specification in response to failures discovered while preparing DRG Law's "The renewal clause" content period for publication (period id `7ca11880-42a9-4bab-940a-baf2966b9f7e`, firm `eec1d25e-a047-4827-8e4a-6eb96becca2b`, work session 2026-07-19). It does not change anything in that period's data, and it does not implement anything against it.

## 1. Problem this addendum solves

An approved deliverable is not a publishable one. `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s seven-line chain already states this in the abstract ("Copy present is not the same as content approved... Published is not the same as live and verified"); this addendum exists because a real work session showed the specific, concrete ways a publishing agent can violate that chain even while believing it is being careful.

Before this addendum, the agent's working model risked six distinct failures, each observed or nearly committed during the renewal-clause session:

1. **Treating blank Content Studio fields as missing content.** A null `publication_path`, a null hero-image reference, or an empty metadata column can mean the content genuinely does not exist, or it can mean the value is supplied at render time by the destination's own template and was never meant to live in the portal row. Without resolving which is true, an agent either wrongly reports real content as absent, or wrongly assumes absent content is merely unrendered.
2. **Treating portal rows as the canonical source when website, PDF, or email files are actually authoritative.** `content_deliverables`/`deliverable_versions` are canonical for a piece's substantive copy, but the moment that copy has been rendered into a static PDF, deployed onto a website, or wrapped into an email template, the rendered artifact — not the portal row — is what a reader actually receives. An agent that only reads the portal can certify readiness for an artifact it never actually inspected.
3. **Assuming a URL could be substituted when a channel-specific destination was missing.** The clearest instance: a LinkedIn teaser whose strategy calls for a native LinkedIn Article, silently pointed at the website URL instead because the Article did not exist yet. This reads as "done" and is actually a different, unauthorized destination.
4. **Discovering required assets at the last minute.** Finding that a PDF, image, or route does not exist only at the moment of attempted publication, rather than as an early, explicit preflight fact, turns a routine gap into a fire drill and increases the temptation to route around it.
5. **Treating a planned placement as a publication.** A `content_placements` row in state `planned` records intent, not delivery. Reporting a period as "ready" or "live" because placements exist collapses a distinction the schema itself preserves.
6. **Confusing an approved website article, a native LinkedIn Article, and a LinkedIn teaser post.** These are three different content objects with three different authorship rules (§5, §4.1 of the preflight design document). Treating them as interchangeable "the same content, different channel" risks either republishing independently drafted text as if it were the approved version, or approving a teaser as if it required the same version-identity guarantee as a republish.

Everything below exists to close these six failure modes with named, checkable states — never a single generic "blocked."

## 2. Canonical-source resolution: mandatory first stage

This is a new stage, prior to and feeding into fact A ("Exact content") of the existing Publication Resolution preflight (`docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md` §4). That document's six facts assume a `deliverableId` and `releaseVersionId` are already known; this stage is what establishes, for every *intended output* (not every deliverable — one deliverable can have several intended outputs, §4), which artifact is actually canonical before any readiness question is asked about it.

**Rule:** before evaluating readiness for any output, the agent must resolve and record the canonical source for that output. No readiness evaluation may proceed from an unresolved source.

### Permitted source classes

- `content_studio_release_authorized_version` — an immutable `deliverable_versions` row where `deliverable.status = 'approved'` and there is no drift (`current_version_id = approved_version_id`), or an active standing publishing authorization covers it and it is not flagged `requires_individual_review` (the same two-path bar `resolveReleaseVersion()` and the DR-105 registry both already apply — see preflight design §4 fact A and the registry's "Source-authorization eligibility" section). This is the class for a deliverable's own substantive copy.
- `website_repository_source_or_template` — a route, component, or template that exists in a site's source tree (e.g. `drg-law-website`), confirmed by reading that repository, not by inference from a route name.
- `generated_static_website_artifact` — a deployed webpage, confirmed live (`publication_artifacts` type `webpage`, most recent `publication_artifact_validations` row `pass` — preflight design §4 fact C).
- `generated_downloadable_pdf_artifact` — a physical file, confirmed by SHA-256 computed from the downloaded bytes (`publication_artifacts` type `pdf`; see the Founder Vesting evidence table in `docs/PUBLICATION_READINESS_OPERATING_MODEL.md` for the exact worked precedent of this class in practice).
- `approved_email_html_or_template` — an approved email deliverable/version, or (for transactional/branded shells) the rendering path in `src/lib/email-shell.ts`/`src/lib/email-branding.ts`, confirmed by reading the actual template.
- `native_channel_artifact_already_published` — a live, already-existing native post (e.g. a LinkedIn Article already live), used only when the task is a teaser/repost pointing at that existing artifact, never when the task is to create the artifact itself.

Every source record, regardless of class, must carry:

| Field | Meaning |
|---|---|
| `source_class` | One of the six values above. |
| `source_location_or_reference` | Deliverable/version ID, file path in a named repository, storage bucket/path pair, or live URL — never a description in prose. |
| `release_authorized_version_id` | Where applicable (source classes rooted in Content Studio) — the exact immutable version, resolved via the two-path bar above, never merely "approved" without checking drift. |
| `sha256` | Where a static asset exists (PDF, image) — computed from the actual downloaded bytes, matching `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s existing evidence-provenance standard, never copied from a prior record. |
| `locale` | Explicit locale tag (`en-CA`, `pt-BR`, etc.), never inferred from firm default. |
| `firm` | Explicit firm ID. |
| `source_verification_timestamp` | When the resolver actually checked this, not when the row was created. |
| `resolver_identity_or_process` | The operator, agent process, or automated job that performed the resolution — the same actor-attribution discipline `publication_receipts`/`publication_artifacts` already require. |

**Explicit rule:** a blank portal field is never by itself proof that content is absent. It is exactly and only evidence that the portal field is blank. Resolving what that blankness means is the entire purpose of §3's gap classification.

This stage is additive to, not a replacement for, the existing evidence model. `publication_artifacts`, `deliverable_versions`, and the Tier-2 `publication-execution-manifest.ts` fields already carry most of these facts for the cases they cover (§4, fact A and fact C of the preflight design document already resolve `release_authorized_version_id` and asset validation respectively). What is new here is the requirement that *every* intended output — including ones the existing manifest does not yet model, like a standalone downloadable PDF or an email template — go through this same resolution discipline before anything downstream runs, and that the resolution be recorded explicitly rather than assumed from the presence of a portal row.

## 3. Required gap classification

Every apparent gap — a blank field, a missing route, an unconfirmed asset — must be classified into exactly one of the following before any remediation or blocking decision is made. An agent must never auto-fill a field, or silently treat a gap as resolved, merely to make a dashboard look complete; this is the same standing prohibition against invented receipts already stated in `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s "Evidence provenance" section, extended here to metadata gaps, not only artifact evidence.

1. **`content_absent`** — The canonical content or artifact genuinely does not exist anywhere in any permitted source class. Confirmed by checking every plausible source class in §2, not merely the portal.
2. **`renderer_derived_metadata`** — The portal field is blank, but the actual publishing renderer or template supplies the value at render time (for example, the DR-082 compliance disclaimer, which `LsoDisclaimer.tsx` injects server-side rather than storing per-deliverable). A blank field in this category is correct, expected, and not a gap at all once classified — it must never be reported as `content_absent`.
3. **`destination_required_metadata_missing`** — The content exists, but a specific destination requires an asset or value that has not been supplied for that destination (for example, a GBP-required image, or a locale-specific route). This is the category for a genuine, destination-scoped gap that is not about the content's own existence.
4. **`source_path_unverified`** — The agent has not yet determined whether the real rendering/publishing path actually supplies the value, i.e. it has not yet distinguished case 2 from case 1 or 3. This is a legitimate, honestly-reported intermediate state — it must resolve to one of the other four categories before the preflight can proceed past it, and it must never be silently treated as either "present" or "absent" while unresolved.
5. **`destination_target_unresolved`** — The content exists, but the destination's own required CTA or target (a native LinkedIn Article, a landing page, a specific GBP action target) does not yet exist, or exists but is not bound to this placement. This is distinct from `destination_required_metadata_missing`: the destination *record* may be fully configured, but the *thing it should point at* is the actual gap.

## 4. Destination manifest model

`content_placements` (Tier 1, live on `origin/main`) is already version-bound and destination-scoped, but it is one row per *placement*, and today's `destination` CHECK enum (`firm_website`, `linkedin_article`, `linkedin_post`, `linkedin_company_page`, `google_business_profile`, `email_delivery`) does not cleanly separate every surface this addendum's problem statement requires distinguishing — most notably, a downloadable PDF has no destination value of its own; it rides today as a `publication_artifacts` row required by a `firm_website` (landing-page) placement, not as an independent manifest row. This section defines the *conceptual* manifest — one row per actual destination — that this addendum requires; §11 flags where the current schema already supports it and where a schema decision is still open.

Each destination-manifest row must include at least:

- `firm`
- `locale`
- `source_id_and_reference` — the deliverable and its resolved `release_authorized_version_id` from §2
- `output_surface` — one of the DRG-relevant surfaces below
- `destination_account_or_profile` — which website origin, which LinkedIn company page, which GBP location, which sender identity (today: modeled only in the drafted-not-applied `publication_destination_configs`, Tier 3 — see preflight design §1 and §8)
- `intended_destination_type` — e.g. `linkedin_native_article` vs `linkedin_post` (§5 below; note this is the same distinction the DR-105 registry's `destination_surface` field already draws, kept consistent with it)
- `public_target_or_cta_target` — the resolved URL/target this placement points at, if the surface is CTA-led
- `required_assets` — the specific artifact types this row needs (hero image, PDF, form, etc.)
- `required_compliance_wrapper` — whether a surface-presentation adaptation applies (§4.1a of the preflight design document) and which rule resolves it
- `delivery_prerequisites` — destination-specific gating facts that are not artifacts (email consent basis, unsubscribe endpoint, channel credential)
- `readiness_state` — the resolved state from §7's machine
- `planned_vs_published_state` — `content_placements.state`'s own lifecycle (`planned` / `ready` / `published` / `retired`), kept distinct from `readiness_state` because one is about preflight facts and the other is about the placement's own recorded lifecycle
- `evidence_or_receipt_fields` — the bound `publication_artifacts`/`publication_receipts` rows, once they exist

### DRG-relevant surfaces

- website journal article
- website landing page
- downloadable PDF
- native LinkedIn Article
- LinkedIn teaser post
- Google Business Profile post
- email newsletter

**One approved content source can yield several destination-manifest rows, each independently ready or blocked.** A single approved Counsel Note version can back a website journal article (one row), a native LinkedIn Article republishing it (a second row, content-identity-linked per §5), and a LinkedIn teaser pointing at that Article (a third row, independently authored copy, CTA-linked not content-linked). Blocking one row must never be reported as blocking the others, and readiness on one must never be read as readiness on the others.

## 5. Explicit content graph rules

These relationships are non-negotiable. An agent that violates any of them has produced an unauthorized publication, not a shortcut.

- **Website article → native LinkedIn Article.** A native LinkedIn Article is a republication surface of the same release-authorized article version, with only DR-105-permitted surface-presentation adaptations applied (`docs/publication-operator/surface-presentation-adaptation-registry.md`; preflight design §4.1a). This is already stated as the routing rule in preflight design §4.1: "before a `linkedin_article` placement is ever created, resolution of fact A... for that placement must trace back to the identical `releaseVersionId` already resolved for the same deliverable's `firm_website` placement, not to a sibling `content_deliverables` row with its own version history." This addendum adds nothing to that rule; it restates it because the renewal-clause session showed how easy it is to violate in practice.
- **Native LinkedIn Article → LinkedIn teaser post.** The LinkedIn post is a separately authored teaser (its own short copy, its own approval) and must point to the native LinkedIn Article when that is the defined strategy — not to the website article, not to nothing.
- **A teaser must not silently substitute the website URL when the strategy requires a native LinkedIn Article.** This is the single most concrete failure this addendum was written to prevent. When the native Article does not yet exist, the correct output is `destination_target_unresolved` / `native_article_missing` (§7), stated explicitly, never a quiet fallback to a URL that happens to resolve.
- **Lead magnet.** Downloadable PDF, landing page, form/delivery route, and promotional post are linked release components of one release, not independent items. The Founder Vesting evidence table (`docs/PUBLICATION_READINESS_OPERATING_MODEL.md`) is the existing, real precedent for exactly this shape: one lead-magnet deliverable backed by a hero-image artifact, a PDF artifact with recorded SHA-256, a landing-page webpage artifact, and a form-presence artifact, each independently evidenced. A promotion may not promise a download before the PDF and the delivery path are both verified — matching that same document's explicit refusal to register `delivery_email_present`/`thank_you_page_present` without personally submitting the live form.
- **GBP.** The post may be self-contained (no click-through required) or CTA-led (requires a working target). The manifest must record which, explicitly, per row — never left implicit. If CTA-led, its exact target must exist and be bound (§7, `destination_target_unresolved`). **Required image status is a DRG publishing-standard requirement, not a universal Google platform requirement** — the existing Tier-2 `publication-destination-validators.ts` bakes "GBP post... + required image" into its format check, and this addendum makes explicit that this is DRG's own editorial standard for its posts, not a claim about what Google Business Profile itself requires of every post on the platform. A future firm's GBP standard may differ; this must not be hard-coded as a platform truth.
- **Email.** Email is first-class — modeled with its own full preflight (§6) and its own delivery prerequisites (§7), never treated as an improvised social post or a generic text deliverable dropped into a send tool. Today `email_delivery` exists only as a `content_placements.destination` enum value with no resolved account/sender model behind it (preflight design §1, Tier 4) — this addendum's email checklist (§6) is what that destination needs before it can ever leave `channel_auth_missing`/`delivery_platform_unconfigured`.

## 6. Destination-specific preflight requirements

Every checklist below is fail-closed: an unresolved item blocks that destination's row, never the whole deliverable, and never falls back to a softer state by default.

### Website article / landing page

- canonical source verified (§2)
- real route exists in the site's own source tree, or is produced by the controlled build (`generated_static_website_artifact` / `website_repository_source_or_template`)
- HTTP success verified after deployment (`channel-validation.ts`'s SSRF-safe fetch wrapper; `publication_artifact_validations`' `route_check`)
- locale route verified where the strategy promises one (never assumed present because the English route exists — this is exactly the PT-route gap `docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s "Known limitations" section already documents for a different period)
- links resolve (no dead URLs, no misdirected same-language links)
- intended CTA works (target exists and is reachable)
- required visual assets exist (`publication_artifacts` type `hero_image`/`social_image`, validated not merely registered)
- actual rendered metadata may be derived by the website template (`renderer_derived_metadata`, §3) — never re-litigated as a gap once classified

### Downloadable PDF

- physical file exists
- extraction/render validation passes
- SHA-256 recorded from the actual downloaded bytes
- PDF link resolves from its landing page
- language/locale is correct
- no "download" promotion is allowed before this passes — this is the same rule the Founder Vesting lead-magnet precedent already enforces by refusing to register unverified evidence

### Native LinkedIn Article

- same authorized source version is identified (§5's content-identity rule; never a sibling deliverable)
- approved DR-105 surface adaptation rule exists if a wrapper or link-formatting change is necessary (`surface_adaptation_rule_missing` otherwise — preflight design §4.1a/§5)
- channel account/credential is configured (today: never satisfied — no LinkedIn integration exists anywhere in this codebase, preflight design §1 Tier 4)
- article URL/URN captured after publication, as the receipt (`publication_receipts.external_post_id`/`public_url`)
- no website disclaimer is copied blindly if wording is surface-specific — this is the exact DR-082/LSO disclaimer case the registry's one existing rule (`drg_en_website_article_to_linkedin_article_lso_notice_v1`) was authored to resolve; a rule not existing for a given tuple blocks, it is never grounds to freehand the wording

### LinkedIn teaser post

- approved teaser source exists (its own short-form deliverable, independently authored and approved — not the article's content)
- intended CTA target exists
- native Article URL is required if the strategy says it is (§5) — checked explicitly, not assumed
- no fallback website URL substitution (§5's central rule)
- image/card requirement satisfied where the approved plan calls for it
- post receipt/URN captured

### GBP post

- approved post copy
- destination account configured (today: no `publication_destination_configs` row exists for any firm — Tier 3, not applied)
- required image asset exists when DRG's release standard requires one (§5 — a DRG standard, stated as such)
- CTA target exists if CTA-led (§5)
- receipt/public URL or other platform evidence captured (today: `channel-validation.ts` cannot check GBP; it is `unverifiable`, requiring operator attestation — preflight design §1)

### Email newsletter

- approved email HTML/source
- exact sender identity
- recorded consent/basis gate (`consent_basis_missing` if absent — see `src/lib/consent-log.ts`/`consent-log-pure.ts` for the existing consent-record model this destination must reuse, not duplicate)
- legal-information wrapper appropriate to the email surface (never the website's own wrapper copied verbatim — same DR-105 discipline as LinkedIn)
- physical mailing address
- functional unsubscribe endpoint supplied by the actual sending platform (`unsubscribe_pending` if the platform has not yet supplied a working one — this is the real, current gap the DRG Law Minute newsletter surfaced: GHL had not yet supplied a functioning unsubscribe endpoint as of the 2026-07-19 work session)
- delivery platform configured (`delivery_platform_unconfigured` otherwise)
- no send while `unsubscribe_endpoint_pending = true` — hard block, no override
- send receipt/campaign ID recorded
- email-version creation and client notification are separate actions — this repo already enforces this distinction structurally elsewhere (`addVersion({silent: true})` throughout Content Studio, and the explicit silent/notify-now choice shipped for deliverable versions and comments); this checklist item is a restatement for the email surface specifically, not a new rule.

## 7. New, precise preflight states

These states specialize and extend, but do not replace, the twelve-state (plus `ambiguous_external_state`) machine already defined in `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md` §5. Where a new state below is a narrower instance of an existing one, that relationship is noted explicitly — a future implementation should read these as leaves added under the existing tree, not a competing taxonomy. No implementation exists for any of these states today; this section is the specification a future preflight-status module should satisfy.

| State | Meaning | Operator next action |
|---|---|---|
| `canonical_source_missing` | §2 resolution found no artifact in any permitted source class. Equivalent in severity to the existing `content_absent` classification (§3) once resolved. | Confirm whether content was ever authored; if not, this is a new-content task, not a publishing task. |
| `source_path_unverified` | §2/§3: the agent has not yet determined whether a blank field is renderer-derived, a genuine gap, or destination-scoped. Never silently resolved either way. | Resolver checks the actual rendering/template path before this can advance. |
| `pdf_missing` | Narrower instance of the existing `live_asset_missing` (preflight design §5), specific to the downloadable-PDF artifact type. | Operator confirms whether the PDF was ever generated; if not, generation + verification is a prerequisite, never assumed complete. |
| `route_missing` | Narrower instance of `live_asset_missing`, specific to a webpage route that does not exist in the site's own source. | Route must be built and deployed before this destination can proceed. |
| `locale_route_missing` | Narrower instance of `live_asset_missing`, specific to a non-default-locale route (e.g. `pt-BR`) that has no route at all, distinct from a route that exists but 404s live. | Locale-specific build work; never resolved by pointing the locale at the default-language route. |
| `required_image_missing` | Narrower instance of `destination_required_metadata_missing`, for a destination-specific required image asset (e.g. DRG's GBP image standard, §5). | Operator supplies and registers the image artifact through the existing registration path. |
| `native_article_missing` | Narrower instance of `destination_target_unresolved`, specific to §5's teaser-must-not-substitute rule: the native LinkedIn Article a teaser's strategy requires does not yet exist. | The Article placement must be created and published first, per §5's content-identity rule — never worked around by repointing the teaser. |
| `destination_target_unresolved` | §3's general case: content exists, but the destination's own required CTA/target does not exist or is not bound to this placement. | Operator resolves or creates the actual target, explicitly, never inferred. |
| `channel_auth_missing` | Same state already defined in preflight design §5 — retained unchanged here for completeness, since every destination checklist in §6 references it. | Real OAuth/API integration work, not a configuration flip. |
| `surface_adaptation_rule_missing` | Same state already defined in preflight design §4.1a/§5 — retained unchanged. | A human authors and registers a new rule in the DR-105 registry, at the same review bar as the one existing rule. |
| `substantive_adaptation_requires_approval` | Same state already defined in preflight design §4.1a/§5 — retained unchanged. | Routes to the deliverable's normal comment/suggestion/version/approval workflow; only the firm's lawyer approves it. |
| `unsubscribe_pending` | New: the email destination's sending platform has not yet supplied a functioning unsubscribe endpoint. Hard-blocks any send, no override, per §6. | Operator resolves with the sending platform (today: GHL) before any send is attempted. |
| `consent_basis_missing` | New: no recorded consent/basis gate exists for this recipient list, reusing the existing `consent_log`/`consent-log-pure.ts` model rather than a new one. | Operator confirms and records the consent basis before any send. |
| `delivery_platform_unconfigured` | New: no delivery platform/sender identity is configured for this destination at all (broader than `channel_auth_missing`, which presumes a specific credential attempt failed — this state covers "nothing has been set up yet"). | Platform configuration work, a prerequisite to even attempting `channel_auth_missing` resolution. |
| `ready_for_operator_action` | Equivalent to the existing `eligible_to_publish` (preflight design §5) — renamed here to make explicit that reaching this state is never itself authorization; a human batch-confirmation step (§8, §9) still follows. | Operator reviews the dry-run preflight summary and confirms, or declines. |
| `publication_receipt_missing` | New, and distinct from the existing `receipt_contract_missing` (which is about an unimplemented adapter for a destination value that has never been used): this state means every other fact resolved, an actual publish attempt should have produced a receipt, and none exists yet. | Operator investigates whether the attempt actually happened outside this system's visibility, or genuinely has not yet occurred. |
| `ambiguous_external_state` | Same state already defined in preflight design §5 — retained unchanged. | Same remedies as the existing runbook table: resubmit with `manualOutcome`, investigate a failed receipt, wait out a genuine concurrent claim, or make an explicit human judgment call. |

Do not use one generic "blocked" label as the actionable output at any point in this list. Every state above carries its own next action; collapsing any two of them into a shared "blocked" bucket in a future implementation defeats the purpose of naming them separately.

## 8. Publishing sequence

1. **Resolve canonical source** (§2) for every intended output.
2. **Construct the destination manifest** (§4) — one row per actual destination, not per deliverable.
3. **Classify every apparent gap** (§3) before any remediation or blocking decision.
4. **Verify assets and destinations** against the relevant checklist (§6).
5. **Produce a dry-run Publish / Hold / Needs verification report** — the same operator-readable preflight-summary discipline `docs/publication-operator/publication-resolution-preflight-design-2026-07-19.md` §9 already specifies (`renderDryRun()`, proven secret-free by its own test suite), extended to cover every state in §7, not only the original twelve.
6. **Request only a real human policy or publishing decision** — never a request to rediscover facts the resolver itself can establish (§9).
7. **Claim the specific placement atomically only when ready** — via the existing `claim_placement_for_publish()` RPC and its idempotency guarantee (preflight design §6); never a placement created or claimed speculatively ahead of readiness.
8. **Publish through the approved adapter** — the Tier-2 `PublicationAdapter` contract, structurally disabled for live calls until a channel graduates per preflight design §7A's promotion criteria; this addendum changes none of those criteria.
9. **Capture immutable receipt/evidence** — `publication_receipts`, append-only, scope-validated at insert.
10. **Reconcile public result against the manifest** — the existing `reconcile-artifacts` pattern (`docs/PUBLICATION_READINESS_OPERATING_MODEL.md`'s "Mandatory agent rule": any instruction to publish begins with read-only reconciliation; missing assets are blockers, never implied authorization to create them), applied here against the full destination manifest rather than only registered artifacts.

Stated explicitly, because the renewal-clause session showed how easily these blur in practice:

- **A planned placement is not a publication.** `content_placements.state = 'planned'` records intent only.
- **A published receipt is not proof of correct content unless it is bound to the authorized version and the intended destination.** A receipt scoped to the wrong version, or to a destination that was never the intended one (e.g. a teaser accidentally bound to a website URL when the strategy required a native Article), is a bookkeeping success and a publication failure simultaneously — reconciliation (step 10) must catch this, not merely confirm a receipt row exists.
- **Never retry automatically if external state is ambiguous.** `ambiguous_external_state` (§7) exists precisely so an agent facing an unverified prior attempt reports the ambiguity rather than guessing whether it may safely proceed.

## 9. Human-decision boundary

The agent may request a human decision only for:

- a real strategic choice (for example, self-contained GBP vs. CTA-led GBP, §5)
- a missing approved source, or a substantive adaptation request (§7, `substantive_adaptation_requires_approval`)
- a channel/account authorization decision (new credentials, new destination configuration)
- a send/publish action the agent has not been explicitly authorized to take

It must not ask humans to rediscover field mappings, source locations, or routine asset checks that the resolver (§2) can establish itself. If a human is asked "does this PDF exist?" after the resolver could have checked storage directly, that is a resolver failure being pushed onto a human, not a legitimate escalation.

## 10. DRG Renewal Clause case study

The following is a narrative account of lessons from the 2026-07-19 work session on DRG Law's "The renewal clause" period (13 deliverables, EN/PT Counsel Note, EN/PT Clause in the Margin, EN/PT checklist PDF, EN/PT landing page, LinkedIn posts, GBP posts; period status `setup_required` as of the 2026-07-15 historical reconciliation ledger, `docs/reconciliation/HISTORICAL_RECONCILIATION_LEDGER_2026-07-15.md`). It illustrates how §3–§7 above apply to real facts; it does not re-verify those facts live as part of producing this document, and it changes no production data.

- **Portal metadata blanks are not automatically missing content.** Several fields flagged as blank during the session turned out to be `renderer_derived_metadata` (§3) once the actual rendering path was checked, not `content_absent`. Treating every blank field as a content gap would have produced false blockers across the period.
- **EN/PT PDF absence is a true `pdf_missing` condition only if the static files genuinely do not exist.** The correct check is a direct look at the storage location or the deployed file, per §2's `generated_downloadable_pdf_artifact` source class — never an inference from the portal alone.
- **A missing PT route is `locale_route_missing` only after source-path verification.** Before concluding a Portuguese route does not exist, the resolver must check the site's own source tree (§2, `website_repository_source_or_template`); a route that exists in source but 404s live is a different state (`route_missing` after deployment, not `locale_route_missing`) from one that was never built at all.
- **A GBP good-standing item is `destination_target_unresolved` if it is CTA-led and no standalone destination exists — not automatically absent content.** The underlying content may be complete; what is missing is the bound target the CTA points at, which is a destination-manifest gap (§4), not a content gap (§3).
- **A LinkedIn teaser requires the native Article URL when the strategy requires that surface.** Per §5's non-negotiable rule, this must resolve to `native_article_missing`, never a quiet substitution of the website URL, even when the website URL is itself confirmed live and correct.
- **The DRG Law Minute email newsletter remains `unsubscribe_pending` until the sending platform supplies a functioning endpoint.** As of the 2026-07-19 session, GHL had not yet supplied one; per §6's email checklist, this is a hard block on any send, independent of how complete the newsletter's own copy is.
- **Active deliverables plus archived rows are not duplicate content merely because the raw period row count is higher than the active count.** A period's total `content_deliverables` row count can exceed its active-deliverable count once superseded/archived rows are included; reading the raw total as "duplicate" or "bloated" content without checking each row's `status`/archived state is a classification error, not a real finding.

## 11. Implementation impact and sequencing

No implementation is authorized by this document. This is a sequenced plan for future work, labeled per lane exactly as this addendum's brief requires. The current Publication Operator implementation branch (`feat/publication-operator`, HEAD `7a6ae79`, per preflight design §1 Tier 2) remains unmerged and not production-deployed; nothing in this addendum changes that, and nothing in this addendum should be read as claiming any of that branch's code is live.

| Phase | Scope | Blocked by migration-lineage freeze? | Needs a schema migration? | Needs an external credential/platform decision? | Buildable now? |
|---|---|---|---|---|---|
| **A — Documentation and resolver contract** | Formalize §2's canonical-source resolution as a typed resolver contract/module signature (no schema change: it reads existing `content_deliverables`/`deliverable_versions`/`publication_artifacts` fields and returns a typed record with explicit nulls, matching the Tier-2 manifest's existing "stored value or explicit typed null with a reason" pattern). | No | No | No | **Yes** |
| **B — Manifest and dry-run report** | Extend the Tier-2 `publication-execution-manifest.ts`/`publication-preflight-status.ts` shape to the §7 state list (specializing, not replacing, the existing 12+1 states) and produce the §8 step-5 dry-run report format. | No | No | No | **Yes**, once Phase A lands and once the Tier-2 branch promotion decision (preflight design §10, item 1) is made — rebase/re-derive is real work, not a formality, but it requires no migration and no freeze exception. |
| **C — Destination configurations and validated asset binding** | Apply (or amend per the open question in preflight design §8) `publication_destination_configs`; resolve the open schema question in this addendum's §4 about whether a downloadable PDF needs its own `content_placements.destination` enum value or stays modeled as a `firm_website`/landing-page required asset. | **Yes** — any new migration is blocked until the migration-lineage remediation design is human/data-engineer-approved and executed (`docs/audits/MIGRATION_LINEAGE_INCIDENT_2026-07-18.md`, freeze in effect since 2026-07-18) | **Yes** | No | No — genuinely blocked |
| **D — Adapters/credentials in controlled pilots** | Real OAuth/API integration for LinkedIn and/or GBP, exercised under preflight design §7A's promotion criteria and §7C's operator-endorsed rollout sequence. | No (credential work touches no migration) | No | **Yes** — real platform decisions, account ownership, OAuth app registration | Partially — engineering scaffolding can proceed; live credential issuance is an external, human-owned step |
| **E — Receipts and reconciliation** | Wire `publication_receipts` capture and the `reconcile-artifacts` pattern (§8, step 10) through to the new destination-manifest model once Phases B–D exist. | No | No | Depends on which destinations are live by this point | Partially — the reconciliation *pattern* can be designed now; live reconciliation needs Phase D's credentials for non-website destinations |
| **F — DRG pilot** | One real, human-watched, end-to-end cycle per destination value, per preflight design §7A's promotion criteria, using the renewal-clause and/or relocation-clause periods as real test cases. | Indirectly — depends on Phase C for full destination-configuration coverage | No (pilot itself, assuming Phase C already landed) | **Yes** — the same per-destination credential bar as Phase D | No — depends on every phase above |

## 12. Verification

- **No code, migration, schema, environment, production-data, or deployment change was made** while originally producing this document. Every data-facing fact was gathered with read-only `SELECT`/`list_tables` calls; every code-facing fact was gathered with read-only `git` inspection (`ls-tree`, `cat-file -e`, `diff --stat`, `log`) against `origin/main` and existing worktrees, never a checkout, branch switch, or file edit outside this one new document. That remains true; the paragraph below states what changed since.
- **Current state, not just the original authoring pass:** this document was originally authored and committed as a single new file. It has since been consolidated, same-day, into a four-file documentation-only change set alongside `docs/publication-operator/surface-presentation-adaptation-registry.md` (also new), and two existing files it makes additive references to, `CLAUDE.md` and `docs/PUBLICATION_READINESS_OPERATING_MODEL.md` (both modified, not replaced, not recreated). The current consolidated change set therefore modifies two existing documentation files and adds two new documentation files — nothing else in the repository is touched. It does not change application code, migrations, schema, production data, configuration, credentials, deployments, or publishing state.
- **Point-in-time facts, not a live re-check:** every production-data fact in this document (row counts, table states, the §3 case-study deliverable's status, and similar) reflects a read-only query run on the date recorded next to it. Citing one of those facts here is not a claim that production was re-queried as of this consolidation pass — treat each as dated evidence, not current live status.
- **No local-only or unmerged material is cited as though it were on `origin/main`.** Every reference in this document to Tier-2/Tier-3 code, the `feat/publication-operator` branch, or any reconciliation report is labeled with its actual location (unmerged branch, drafted-not-applied migration, or "historical reconciliation evidence is not yet committed to `origin/main` and is not relied on as an implementation dependency for this design," per §3). No filesystem path local to any one worktree or machine is treated as available on `origin/main` anywhere in this document.
- **Exact source files/tests examined** (read, not modified): `docs/PUBLICATION_READINESS_OPERATING_MODEL.md` (confirmed on `origin/main`, both its stale locally-checked-out v1 and the current v3 were diffed); a same-day historical reconciliation report for this deliverable's period (historical reconciliation evidence is not yet committed to `origin/main` and is not relied on as an implementation dependency for this design); `docs/PUBLICATION_OPERATOR_ARCHITECTURE.md`, `docs/runbooks/publication-operator-runbook.md`, `docs/reconciliation/publication-operator-dry-run-founder-vesting-2026-07-18.md` (branch `feat/publication-operator`, pending publication); `src/lib/publication-execution-manifest.ts`, `publication-preflight-status.ts`, `publication-placement-claims.ts` (same branch, partial reads, exported-symbol greps for `publication-adapter.ts`, `content-placements.ts`, `publication-receipts.ts`, `standing-publishing-authorization.ts`); `supabase/migrations/20260715191218_20260715130100_content_placements.sql`, `20260715191243_20260715130200_publication_receipts.sql`, `20260718121500_publication_destination_configs.sql` (same branch); `CLAUDE.md` (both the stale local-checkout copy and the `feat/publication-operator` branch's copy, for the Ses.16–Ses.21 build-roadmap history); test-file and route-file listings via `find`/`grep` under the `feat/publication-operator` branch. Production database facts: `list_tables` against `ssxryjxifwiivghglqer`; two `SELECT` queries against `content_placements` and `content_deliverables` for the exact case-study deliverable.
- **Every assumption requiring a later database-engineer, operator, or channel-owner decision**, collected from throughout this document:
  1. Whether `publication_destination_configs` should carry a permitted-content-roles field (§8).
  2. The exact review process by which the Tier-2 branch gets promoted — merge-as-is vs. rebase vs. re-derive on current `origin/main` (§10).
  3. Whether the GHL social-media-posting surface is a real integration path for LinkedIn/GBP, worth a dedicated evaluation (§4E, §10) — not investigated beyond noting its existence.
  4. The exact scope (destinations, firms, volume ceiling) of any future autonomous-release authorization — this document defines the bar for proposing it, not the proposal itself (§7A).
  5. Whether/when the `publication_destination_configs` migration can be applied at all, which depends entirely on the separate, already-in-flight migration-lineage freeze-remediation process this document does not own or advance.

## 13. `resolve_and_audit_release_graph` (added 2026-07-21)

A mandatory preflight stage, added on top of everything above: before a Publishing Agent proposes any release, it must resolve and record ten specific facts about that release and classify every gap found into one of fifteen precise categories. This section is implemented (audit-only, read-only, dry-run) at `src/lib/release-graph/` — `release-graph-types.ts` (types), `release-graph-audit.ts` (the pure resolver), `release-graph-audit-loader.ts` (read-only I/O), `release-graph-report.ts` (the operator-facing report). Nothing under this stage creates a placement, claim, receipt, or artifact row, calls an external API, or modifies production data; it composes with and reuses `evaluateDeliverableReadiness` (`publication-readiness.ts`), `buildPreflightReport` (`publication-preflight.ts`), and `isManuallyVerifiableDestination` (`channel-validation.ts`) rather than re-deriving what those already correctly decide.

### 13.1 The ten facts

For every proposed release (one deliverable version × one intended destination placement), the agent must resolve and record:

1. The immutable release-authorized source version.
2. The intended destination surface.
3. The canonical public destination/route where one is required.
4. The required visual rendition for that exact surface.
5. The required downloadable artifact, if promised.
6. The CTA target and whether it is live and correct.
7. Required compliance wrapper and sender requirements.
8. Channel authorization/integration availability.
9. Whether the preview artifact is current and faithfully represents the release.
10. What evidence/receipt will prove publication.

Facts 3-10 are moot, and are never evaluated, when fact 1 resolves to `content_absent` — there is nothing to audit a destination, rendition, or receipt for when no content exists yet.

### 13.2 The fifteen gap classifications, and how they reconcile with §7's states

| Classification | Fires when | Relation to §7's states |
|---|---|---|
| `content_absent` | No body/asset exists for the current version at all. | Same meaning as §7's `canonical_source_missing`; renamed here for consistency with fact 1's wording. |
| `source_path_unverified` | The release-authorized version's identity itself cannot yet be confirmed (never-approved, or version drift). | Broadened from §7's `source_path_unverified` (which was about blank metadata specifically) to also cover approval/drift ambiguity at fact 1. |
| `renderer_derived_metadata` | A blank portal field (excerpt/byline/topic/read_time) is one the actual destination renderer already handles gracefully. | New as a first-class, reachable classification — §7 described the concept in §3 but never gave it its own resolver code path. Informational only (`can_publish_with_existing_renderer`), never blocking. |
| `destination_required_metadata_missing` | A required configuration value (role, locale, `publication_destination`/`publication_path`, publish schedule) was never set. | Same meaning as §7's `destination_required_metadata_missing`. |
| `destination_target_unresolved` | A required route, CTA target, or native Article does not exist or is not bound. | Consolidates §7's `route_missing`, `locale_route_missing`, and `native_article_missing` into one classification, distinguished instead by the finding's own `fact` field (3 vs. 6) and `factualEvidence` text — three separate state names for "the target doesn't exist yet" were harder to keep straight in practice than one classification with a precise, per-instance explanation. |
| `required_downloadable_artifact_missing` | A `lead_magnet_pdf`-role deliverable has no PDF bound to the current version. | Renamed from §7's `pdf_missing`; same underlying check (version `storage_path` or a `pdf`-type `publication_artifacts` row). |
| `required_visual_rendition_missing` | No image of the destination's required rendition role (§13.2a) is bound at all. | New — §7's `required_image_missing` did not distinguish rendition role; this and the next two classifications replace it with role-aware detection. |
| `visual_rendition_role_mismatch` | An image IS bound, but it is the wrong rendition role for this destination (a baked editorial card reused as a textless website hero, or the reverse). | New. This is the DRG acceptance example 5 (wrong hero-card reuse), formalized as its own detectable, testable classification — never collapsed into "image missing," since an image genuinely exists here. |
| `visual_safe_area_violation` | A bound, correctly-roled image carries a recorded `validation_result.safe_area_ok: false`. | New. Reachable only once a validator ever populates that field (none does today, per §13.7) — defined now so the classification and its resolver code path exist before the capability does. |
| `preview_not_publish_faithful` | `evaluateDeliverableReadiness`'s own `staleArtifacts` list is non-empty. | New name for a fact §7 never separately named — reuses existing stale-artifact detection rather than adding a new one. |
| `compliance_wrapper_missing` | A `linkedin_article` placement resolves this two ways, distinguished by evidence, never collapsed into one message: (a) **wrapper absent** — no DR-105 rule is documented for this exact firm/locale tuple (`blocks_today`, a real doctrine gap needing operator+lawyer authorship); (b) **documented but not runtime-bound** — a rule IS documented for the tuple (named by `rule_id`), but no code path applies or binds it to a release (`system_improvement`, engineering-only). An `email_delivery` placement resolves it from configured branding, or branding present but no canonical registered legal-wrapper text. | Same underlying gap as §7's `surface_adaptation_rule_missing`, extended to also cover email's own compliance wrapper (which §7 did not address) and, as of 2026-07-21, to stop conflating "no reader exists" with "no rule exists" for `linkedin_article` — see §13.2b. |
| `channel_auth_missing` | Any non-`firm_website`, non-`email_delivery` destination — no LinkedIn/GBP credential or integration exists anywhere in this codebase. | Same as §7's `channel_auth_missing`, unchanged. |
| `unsubscribe_endpoint_pending` | An `email_delivery` placement, resolved from the firm's own delivery-configuration record (`intake_firms.ghl_location_id`), never from a search of this repository's source: (a) no delivery-platform account is connected for this firm at all (`system_improvement`); (b) an account is connected, but no record in this system confirms a functioning unsubscribe endpoint for it (`needs_human_confirmation` — the external platform may already provide one, unverified by this audit either way). | Renamed from §7's `unsubscribe_pending`; now reported as its own classification distinct from `channel_auth_missing`/`compliance_wrapper_missing` rather than folded into either. As of 2026-07-21, corrected to resolve from firm data rather than a repository code search — see §13.2b. |
| `publication_receipt_missing` | A placement is `state = 'published'` but no `publication_receipts` row backs that claim. | Narrowed from §7's `publication_receipt_missing`: no longer fires merely because nothing has published yet (the normal pre-publish state), only on this specific published-but-unevidenced inconsistency. |
| `ambiguous_external_state` | An existing receipt's `verification_state` is not exactly `verified` (i.e. `unverified`/`failed`/`reconciling`). | Same as §7's `ambiguous_external_state`, unchanged; the preflight-design document's own active-claim half of this state is not re-implemented here (no claim-table read is part of this audit's ten facts). |

Two states from §7 have no direct successor in this list and remain governed by the systems that already own them, unchanged: `substantive_adaptation_requires_approval` (DR-105's own registry contract, `surface-presentation-adaptation-registry.md`) and `already_published`/`ready_for_operator_action` (already fully covered by the reused `buildPreflightReport` gate, carried on every audit as `existingPreflightGate` rather than re-classified into one of the fifteen).

#### 13.2a Visual rendition roles

Two roles, named exactly as required:

- `textless_html_headline` — website article and homepage media. The headline, byline, and any overlay are rendered live in HTML/CSS over a plain, textless source photo (this is what `DRGArticleFrame.tsx` already does — the hero `<img>` carries no baked text, the chip row and `<h1>` are separate DOM nodes on top of it). Required for the `firm_website` destination.
- `baked_editorial_card` — LinkedIn/GBP/OG media. The headline and any eyebrow/byline are composed into the image's own pixels ahead of time, because the destination platform renders no live HTML over it. Required for `linkedin_article`, `linkedin_post`, `linkedin_company_page`, and `google_business_profile`.

The mapping from a bound artifact to its actual role is read directly from the existing, already-distinct `publication_artifacts.artifact_type` enum (`hero_image` → `textless_html_headline`, `social_image` → `baked_editorial_card`) — no new column, no inference from the image bytes themselves. `email_delivery` carries no rendition-role requirement in this phase. Any destination the rendition-role table does not recognize fails closed (`required_visual_rendition_missing`, `needs_human_confirmation`) rather than guessing a role — this is a hard requirement (§13's brief: "the agent must fail closed if it cannot determine the rendition role").

#### 13.2b Policy correction, 2026-07-21: resolving from system evidence, not from what this repository's code happens to contain

An independent review (2026-07-21, pre-PR, pre-independent-audit) caught two related mistakes in the first version of this module, both the same category of error: treating "this repository's own code doesn't do X" as proof about a fact that is not actually about this repository's code.

**`unsubscribe_endpoint_pending`.** The original resolver fired unconditionally for every `email_delivery` placement, citing a repository-wide `grep` for the word "unsubscribe" as its evidence. That is invalid: the actual sending platform (GHL, or any future replacement) is external to this repository, and a source-code search can never establish what an external platform does or does not provide. The corrected resolver reads `intake_firms.ghl_location_id` (a real, pre-existing per-firm field, already used elsewhere for GHL Voice/SMS) and distinguishes: no account connected at all (`system_improvement` — nothing to check yet), versus an account connected but no durable record in this system confirms its unsubscribe-endpoint status (`needs_human_confirmation` — the fact may already be true externally; this audit simply cannot see it). Both states still block a send, for the same operational reason as before; only the *evidence and reasoning* changed, from "we searched code and found nothing" to "we checked the firm's own configuration record and here is exactly what it does and does not tell us."

**`compliance_wrapper_missing` for `linkedin_article`.** The original resolver fired unconditionally, with an identical message, for every `linkedin_article` placement regardless of firm or locale, citing "no DR-105 registry reader exists" as if that single system-enforcement gap were the whole story. That conflates two different facts that need two different owners: whether a DR-105 rule has ever been authored and reviewed for this exact (firm, locale) tuple at all (a content/doctrine question, answered by a human), and whether the running system can automatically find and apply that rule once it exists (an engineering question). The corrected resolver checks a small, explicitly hand-maintained mirror of the one rule actually present in `surface-presentation-adaptation-registry.md` today (DRG Law, `en-CA`) and reports two distinct outcomes: **wrapper absent** — no rule documented for this tuple at all (`blocks_today`; needs an operator + the firm's lawyer to author and review a new rule, exactly the same bar the one existing rule met); **documented but not runtime-bound** — a rule is documented (the finding names its `rule_id`), but nothing in this codebase reads the registry or attaches the rule to a specific release as evidence, so it can never reach a "bound" state today regardless of how ready the content is (`system_improvement`; engineering-only, no further doctrine work needed for that tuple). A third state, *wrapper exists and IS bound to a specific release*, is named in this document for completeness but is not currently reachable by any code path — nothing in this system's schema records a rule's application to a release yet (no `adaptation_rule_id`-shaped field exists on `publication_receipts` or elsewhere), so "bound" stays a defined-but-dormant outcome, the same posture already used for `visual_safe_area_violation` (§13.2, `required_visual_rendition`).

Neither correction changes any of the ten facts, any of the fifteen classification names, or any release verdict's priority order (§13.4). Both are scoped, local fixes to how two specific classifications gather and present their evidence.

### 13.3 The eight-field structured finding

Every finding this stage reports carries exactly these fields, in this order, alongside its classification and which of the ten facts it was found while resolving:

`releaseImpact` (`blocks_today` | `can_publish_with_existing_renderer` | `needs_human_confirmation` | `system_improvement`), `factualEvidence`, `canonicalSourceConsulted`, `immediateDisposition`, `rootCause`, `proposedDurableSolution`, `authorityRequired`, `reusablePreflightRule`.

No field is ever left as a placeholder; a resolver that cannot honestly fill one does not report the finding. `reusablePreflightRule` exists specifically so every finding also teaches the next audit something general, not only what is wrong with this one release.

### 13.4 The release verdict and operator report

Every audited release (one deliverable × one destination) resolves to exactly one of four verdicts, computed from the release-impact values of its findings, in this priority order:

1. **Hold** — any finding is `blocks_today`.
2. **System improvement** — no `blocks_today` finding, but at least one is `system_improvement` (the release cannot proceed today, but the reason is a missing system capability, not this release's own content).
3. **Needs verification** — no `blocks_today` or `system_improvement` finding, but at least one is `needs_human_confirmation`.
4. **Publish now** — no findings, or only `can_publish_with_existing_renderer` findings (informational; the release is genuinely ready, via an accepted fallback path rather than the ideal one).

`release-graph-report.ts`'s `renderReleaseGraphReport()` groups every audited release under its verdict (Hold first, Publish now last) and prints every finding's full eight-field output beneath it, plus a summary count and the reused `existingPreflightGate` result. `toReleaseGraphReportJson()` provides the same content as structured JSON for a programmatic consumer.

### 13.5 Publishing sequence integration

This stage runs as the mandatory first step of §8's existing ten-step publishing sequence, before step 1 ("resolve canonical source") is considered complete for a specific destination — in practice, `resolve_and_audit_release_graph`'s ten facts are a strict superset of §8 step 1-4 for a single release, so a Publishing Agent following §8 satisfies this stage by calling `resolveAndAuditReleaseGraph()` (or, for a whole period, `loadReleaseGraphAuditForPeriod()`) before proceeding to step 5's dry-run report. Nothing in §13 changes step 5 onward.

### 13.6 DRG Renewal Clause case study, extended

Read-only, narrative, fixture-grounded (not a fresh live query — see §12's existing point-in-time discipline, which applies here unchanged). Demonstrates the required distinctions exactly:

- **Lead-magnet PDF absent resolves `required_downloadable_artifact_missing`** — a `lead_magnet_pdf`-role deliverable with neither a bound version asset nor a `pdf`-type `publication_artifacts` row is a real, `blocks_today` finding, never softened to "setup required."
- **Portal excerpt/byline blanks resolve `renderer_derived_metadata`, not `content_absent`** — `DRGArticleFrame.tsx` already conditionally renders the topic chip, byline, read-time, and lead paragraph only when each is present; a blank value there is a valid editorial state the renderer already handles, surfaced as an informational, non-blocking finding rather than a false content gap.
- **A PT publication route requires canonical-source verification before classification** — before reporting a Portuguese route as missing, this stage checks for a current-version, `pt-BR`-locale `webpage` artifact; only its genuine absence (not merely an unchecked assumption) resolves `destination_target_unresolved`.
- **A GBP promotion with no live target resolves `destination_target_unresolved`, not automatically missing copy** — when a GBP post is CTA-led (`cta_target_path` set) and the promoted page's own webpage artifact is not validated, the finding is about the *target*, and says so explicitly; the post's own copy may be complete.
- **The DRG Law Minute is not send-ready while `unsubscribe_endpoint_pending`** — reported as its own classification, `system_improvement`, independent of how complete the newsletter's copy or branding shell is, and independent of `compliance_wrapper_missing` (a separate fact about the legal-wrapper text, not the unsubscribe mechanism).
- **Wrong hero-card reuse on a homepage/article resolves `visual_rendition_role_mismatch`** — a `social_image` (baked-text card) artifact bound where a `firm_website` placement requires a textless `hero_image` (or the reverse) is a distinct, `blocks_today` finding from `required_visual_rendition_missing`: an asset exists, it is simply the wrong object for this surface, and must never be treated as an acceptable substitute regardless of visual similarity.

### 13.7 Implementation impact, specific to this stage

| Gap | Blocked by migration freeze? | Needs schema? | Needs external credential? | Buildable now? |
|---|---|---|---|---|
| DR-105 runtime registry reader (closes `compliance_wrapper_missing` for `linkedin_article`) | No | No | No | **Yes** |
| Canonical email legal-wrapper text registration (closes `compliance_wrapper_missing` for `email_delivery`) | No | No | No (a doctrine/copy decision, not a credential) | **Yes**, pending the same operator+lawyer review DR-105's one rule already had |
| Safe-area validator that populates `publication_artifacts.validation_result.safe_area_ok` (makes `visual_safe_area_violation` reachable in practice) | No | No | No | **Yes** |
| LinkedIn/GBP OAuth + posting API (closes `channel_auth_missing`) | No | No | **Yes** | No — external platform/credential decision |
| Email delivery platform + real unsubscribe endpoint (closes `unsubscribe_endpoint_pending`) | No | No | **Yes** | No — external platform/credential decision |
| `publication_destination_configs` (firm-level account identity, referenced by fact 8's context) | **Yes** | **Yes** | No | No — genuinely blocked |

Nothing in this section is implemented beyond the audit-only module cited in this section's opening paragraph. No schema, external integration, image redesign, or policy change is authorized or performed by this addendum.

