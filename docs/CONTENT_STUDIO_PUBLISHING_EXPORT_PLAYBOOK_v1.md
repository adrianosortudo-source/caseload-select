# Content Studio publishing export: session-independent publishing protocol

## What this is

A read-only, period-scoped export of exactly what already exists in Content
Studio: every active deliverable's current content, its approval state, its
registered artifacts, and whether it may be published, all pulled directly
from `content_deliverables` / `deliverable_versions` / `approval_records` /
`deliverable_comments` / `publication_artifacts`. Nothing in this feature
generates, rewrites, or translates content. It is a lookup, not an author.

Endpoint: `GET /api/admin/content-periods/[periodId]/content-export`
(`?format=json` default, or `?format=markdown`). Operator session required.
Builder: `src/lib/content-period-export.ts` (`buildContentExportBundle`,
`renderContentExportMarkdown`).

This is a separate feature from Publication Readiness (the activation
gate/lifecycle system in `publication-readiness.ts`). The export never
checks or requires a period's readiness lifecycle; it reports the raw
deliverable state regardless of whether Publication Readiness has been set
up for that period at all.

## The permanent rule

**A publishing agent (human or AI) must load the bundle first, every time,
and never rely on conversation history or filesystem search instead.**

Reasons this is load-bearing, not a style preference:

- Conversation history is not a data source. A prior turn's summary of a
  deliverable's status can be stale the moment a lawyer approves, requests
  changes, or the operator posts a new version. The bundle is the only
  place a fresh, correct `may_publish` boolean is computed at request time.
- The filesystem in this repository does not contain content for a specific
  firm's deliverables. Nothing under `06_Clients/DRGLaw/` or anywhere else
  is a substitute for what a lawyer actually approved in the portal. A
  publishing agent that greps the operations folder for "the article about
  X" and finds a strategy doc or an old draft is not looking at the
  approved artifact; it is looking at planning material.
- A publishing agent must never generate, rewrite, or translate material to
  fill a gap. The bundle's `generation_policy` block states this in machine
  readable form (`may_generate: false`, `may_rewrite: false`,
  `may_translate: false`, `use_portal_source_only: true`) precisely so an
  agent has no ambiguity to reason its way around. If a deliverable's
  `current_version` is null, or a locale is missing, or an artifact was
  never registered, the correct action is to report the gap and stop. It is
  never to invent replacement copy, translate the English version on the
  spot, or write a plausible LinkedIn caption from the article title. That
  is exactly the "No Invention" failure mode this bundle exists to close
  off.

## Reusable command

Use this exact phrasing to start any publishing task on this branch of
work:

```
Publish period <period_id> from its Content Studio publishing bundle.
```

An agent receiving this instruction should treat "from its Content Studio
publishing bundle" as the whole method statement: fetch the bundle first,
act only on what it contains, and do nothing else in its place.

## Standing publishing instruction (locked, operator-authored)

Every publishing task, regardless of how it is phrased, begins with this
instruction:

> Download the period's Content Studio publishing bundle first. Use only
> deliverables with `may_publish: true`. Never generate, rewrite,
> translate, or infer missing content. For every `may_publish: false`
> item, report the exact reason and stop. Publish each approved
> deliverable independently and record its destination URL.

Five clauses, each mapped to a rule already stated above so there is one
authoritative phrasing an agent can be handed verbatim:

1. **Download the bundle first.** Never conversation history, never
   filesystem search (see "The permanent rule" above).
2. **Only `may_publish: true`.** As of the version-ownership hardening
   fix, this is true only when the current version both IS the approved
   version and actually resolves to a real, owned `deliverable_versions`
   row, never on ID equality alone.
3. **Never generate, rewrite, translate, or infer.** The bundle's
   `generation_policy` states this machine-readably; this clause states it
   in plain language for the agent executing the instruction.
4. **On `may_publish: false`, report the reason and stop.** The exact
   string is already on the deliverable as `may_publish_reason`; quote it,
   do not paraphrase or guess at why.
5. **Publish each approved deliverable independently and record its
   destination URL.** Deliverables are never batch-published as one unit
   (an approved article does not carry its unapproved companion LinkedIn
   post along with it); each publish action, and the resulting live URL,
   is tracked per deliverable id.

## How the agent obtains the bundle

1. Call `GET /api/admin/content-periods/<period_id>/content-export` with an
   operator session cookie. Use `?format=markdown` for a version meant to
   be read directly in a response (headings per deliverable, code-fenced
   HTML bodies, plain warnings list); use the default JSON for programmatic
   parsing or for handing to a second tool.
2. Both formats come from the exact same `buildContentExportBundle` call.
   There is no separate "markdown data" and "JSON data": Markdown is a
   rendering pass over the same bundle object, so there is nothing to
   reconcile between the two if both are pulled in the same request cycle.
3. Read `schema_version` before parsing anything else. This playbook
   documents schema `1.0`. A version bump signals the shape below may have
   changed.

## How the agent interprets `may_publish`

Each deliverable in `bundle.deliverables[]` carries `may_publish` (boolean)
and, when false, `may_publish_reason` (exact string, never inferred).

`may_publish` is true only when all of the following hold, computed fresh
from the row, never from a cached or remembered status:

- `current_version_id` is set (a version exists at all).
- `status === "approved"`.
- `approved_version_id` is set.
- `approved_version_id === current_version_id` (the approved version is the
  one that is actually current; a newer, unapproved version posted after
  approval does not count as approved).

If any of those is false, `may_publish` is false and the reason string says
exactly which condition failed. An agent must treat `may_publish: false` as
an instruction not to publish that deliverable, full stop, regardless of
how the piece reads or how close it looks to done. Publishing a
`may_publish: false` deliverable is the same class of error as skipping the
lawyer's sign-off entirely.

A deliverable can also carry `unresolved_change_request` (the lawyer's most
recent change-request note, still open) and `unresolved_comments` (open
annotation threads). Neither of these alone flips `may_publish`, but both
are useful context for why a piece is not yet approved, and should be
surfaced to whoever is reviewing the publish run rather than silently
dropped.

## How the agent handles a pending piece

A pending piece (in review, changes requested, or simply no current
version yet) is reported in full in the bundle, exactly like every other
active deliverable. It is never omitted for being incomplete. The agent's
job on a pending piece is: report its state (status, reason, any open
change request or comments) and skip publishing it. It is not the agent's
job to nudge it toward completion, draft a replacement, or reinterpret
"pending" as "close enough."

## How the agent resumes after interruption

Because the bundle is read fresh on every call and every deliverable
carries its own independent `may_publish` state, resuming is calling the
same endpoint again. There is no publish-run state file to reconcile: a
piece already published earlier in the run remains whatever the operator
recorded elsewhere (this export never writes anything), and a piece not
yet handled is still sitting in the bundle with the same fields it had
before the interruption, refreshed to the current database state at the
moment of the new call.

## Why it must not recreate missing files

If an artifact or a locale is missing, the deliverable's `warnings` array
says so (e.g. "No publication_path recorded for a role that has its own
placement," "No publication_artifacts registered for this deliverable
yet"). The correct response to a warning is to report it upward and, if the
missing piece blocks the intended publish action, stop and ask for it to be
authored in the portal. Recreating it (writing a stand-in file, guessing a
storage path, inventing a translation) would put unapproved, un-reviewed
content into a publish path that exists specifically because every piece
that reaches it went through lawyer sign-off. A regenerated substitute has
not.

## The publication-preflight endpoint (Workstreams 4-7): the authoritative source going forward

Everything above this section describes the export bundle from Workstream
1, whose `may_publish` is DELIVERABLE-scoped: it answers "is this piece's
content approved and current," and nothing about where it goes. Workstreams
4 through 7 added a layer this playbook's first version did not have: a
deliverable can have several independent PLACEMENTS (a Counsel Note article
can go to the firm website AND drive a LinkedIn post AND a GBP post; each
is its own destination, own locale, own evidence trail), and each placement
needs its own publish decision, not a single deliverable-wide one.

**`GET /api/portal/[firmId]/periods/[periodId]/publication-preflight`** is
the placement-scoped successor. Operator-only, read-only, never generates
content. For every active placement in the period it reports:

- `destination`, `locale`, `intendedPath`, `requiredArtifactType`
- `approvedVersionId` / `currentVersionId` (the exact content identity)
- `deliverableReady` (the same DR-093/094/096 evaluator this playbook's
  `may_publish` always came from, still the single source of "is the
  content itself fit to publish")
- `unresolvedCommentCount`
- `currentReceipt` (if this placement has ever been published: the receipt
  id, verification state, published-at timestamp, public URL or external
  post id -- see the receipts section below)
- `mayPublish` and, when false, the exact `reason` string

A publishing agent working from a period built after this playbook's
Workstream 4-7 update should call the preflight endpoint, not (only) the
Workstream 1 export bundle, to decide what to act on: it is placement-aware
where the export bundle is not. The export bundle remains useful for
pulling the actual approved content bytes (`body_html`, storage paths,
hashes) to publish; the preflight endpoint is the release gate that says
whether to act at all, on which destination, right now.

**`mayPublish` fails closed on four independent gates, in this order:**

1. The placement's PERIOD must be `readiness_lifecycle: "enforced"`.
   A period that is `legacy_unreconciled` (predates the readiness ledger)
   or `setup_required` (not yet activated) always reports `mayPublish:
   false` with a reason naming which of the two it is. This is deliberate:
   historical periods stay outside enforcement until an operator
   explicitly activates them, and a brand-new period fails closed by
   default rather than defaulting to "ready."
2. The deliverable itself must be `status: "approved"` with
   `approved_version_id === current_version_id` (no version drift).
3. The deliverable must pass the DR-093/094/096 readiness evaluator
   (`deliverableReady`).
4. Zero unresolved comments on the deliverable (a reply on a change-request
   thread does not count; only genuinely open review comments do).

An agent must treat `mayPublish: false` as a stop instruction for that
specific placement, exactly like the export bundle's `may_publish: false`.
A publishing agent may act ONLY on `mayPublish: true`.

## Destination placements (Workstream 4): `content_placements`

Models WHERE a deliverable is going to be published, independent of its
editorial format. One deliverable, several placements: a Counsel Note
article's own placement is `firm_website`; a companion GBP post promoting
that same article is a SEPARATE placement row with `destination:
"google_business_profile"` and `cta_target_path` pointing at the article's
own path (never a shared/merged row). Do not infer that two placements
share a destination merely because they share a topic or a deliverable;
each one is created and evaluated independently
(`src/lib/content-placements.ts`,
`GET/POST /api/portal/[firmId]/deliverables/[deliverableId]/placements`).

## Publication receipts (Workstream 5): "published" requires a receipt

A publish date alone is not proof of publication. A URL alone is not
sufficient if it cannot be tied to the approved version. `publication_receipts`
is the append-only evidence ledger: a receipt records the exact
`approved_version_id` it claims to publish, the destination, and whatever
evidence exists (`public_url`, `external_post_id`, or a screenshot). The
API (`POST .../placements/[placementId]/receipts`) refuses to create a
receipt whose `approved_version_id` is not this deliverable's own CURRENT
approved version -- a receipt can never claim to publish content the
lawyer did not actually approve as current.

**Corrections are new rows, never edits.** Verifying a receipt
(`POST .../receipts/[receiptId]/verify`) inserts a NEW row via
`reconciles_receipt_id` rather than mutating the one being checked, so even
a later correction to a receipt's verification state never silently alters
history. The "current" receipt for a placement (what the preflight report
shows) is the tip of that reconciliation chain, not necessarily the first
row ever inserted.

**A later content version must not inherit an earlier version's receipt as
proof.** If a deliverable is re-approved after a new version, its OWN
receipts (bound to the new `approved_version_id`) are what count; an older
receipt bound to a superseded version is history, not current evidence.

## Channel-specific validation (Workstream 6)

`src/lib/channel-validation.ts` answers "does this receipt's evidence
actually support the publication claim" and never fabricates a result it
cannot check:

- **Website** (`firm_website`, `requiredArtifactType` unset or `webpage`):
  a real HTTP fetch of `public_url`. Verified only on HTTP 200 and, when an
  expected host is supplied, a matching resolved domain.
- **PDF / lead magnet** (`firm_website`, `requiredArtifactType: "pdf"`): a
  real fetch confirming `content-type: application/pdf`, and, when the
  approved version's own sha256 is known, that the LIVE file's hash
  matches it byte for byte.
- **LinkedIn / GBP** (`linkedin_post`, `linkedin_article`,
  `linkedin_company_page`, `google_business_profile`): NO authorized
  posting or read API exists for these platforms in this system. The
  validator reports `unverifiable`, never a fabricated `verified`, and the
  verify route (`POST .../receipts/[receiptId]/verify`) refuses to persist
  anything for an `unverifiable` result. An operator who has personally
  confirmed the live post resubmits the same endpoint with
  `{ manualOutcome: "verified" | "failed" }`, recording their own
  attestation (`verification_method: "operator_attestation"`) rather than
  the system claiming a check it cannot perform. Do not add direct
  LinkedIn or GBP publishing/read automation unless a functioning
  authorized integration already exists.

## The 10-step publishing operating contract

Every publishing task on a period activated under this system follows
these steps, in order. This supersedes the older, deliverable-only
process further up this document for any period whose `readiness_lifecycle`
is `enforced`; for a `legacy_unreconciled` or `setup_required` period,
stop at step 1 and report that instead (nothing past that point applies
until the operator activates the period).

1. **Identify the firm and period.** Confirm both by id before calling
   anything else; never guess a period from a title string.
2. **Download the bundle first.** Call the Workstream 1 export bundle
   (`GET /api/admin/content-periods/[periodId]/content-export`) for the
   approved content bytes, AND the Workstream 7 preflight report
   (`GET /api/portal/[firmId]/periods/[periodId]/publication-preflight`)
   for the placement-scoped `mayPublish` gate. Never rely on conversation
   history or a filesystem search in place of either call.
3. **Work only from what the bundle and preflight report actually
   contain.** Never invent a destination, a path, a hash, or a piece of
   copy that is not present in either response.
4. **Publish only placements with `mayPublish: true`.** Every other
   placement is skipped this run, not deferred silently.
5. **Never generate, rewrite, translate, or infer missing content.** If
   content is missing for a `mayPublish: true` placement (should not
   happen, since readiness already required a current body), stop and
   report rather than filling the gap.
6. **Report every skipped placement with its exact reason.** Quote the
   `reason` string verbatim; do not paraphrase or guess at why a placement
   was skipped.
7. **Treat each destination independently.** An approved article's own
   publish action never implies its companion LinkedIn or GBP placement is
   also cleared; each is its own `mayPublish` check and its own publish
   action.
8. **Record a receipt immediately after a verifiable publication action.**
   `POST .../placements/[placementId]/receipts` with the destination's
   real `public_url` or `external_post_id`, and the placement's OWN
   `approved_version_id` (never a different placement's, never guessed).
9. **Reconcile the receipt against the approved version and artifact.**
   Run the channel validator (`POST .../receipts/[receiptId]/verify`) so
   the receipt's `verification_state` reflects an actual check, not just an
   unverified claim; for LinkedIn/GBP, follow up with the operator's own
   `manualOutcome` attestation once they have personally confirmed the
   live post.
10. **End with a per-placement completion ledger.** For every placement
    touched this run: its id, destination, whether it was published,
    skipped (with reason), or already had a current receipt from a prior
    run, and the resulting receipt id if one was created.

## Ready-to-use agent prompt

```
Publish period <period_id> for firm <firm_id> from its Content Studio
publication-preflight report.

1. Call GET /api/portal/<firm_id>/periods/<period_id>/publication-preflight.
   If the period's periodLifecycle is not "enforced", stop and report that
   verbatim -- do not proceed past this point.
2. For every placement with mayPublish: true, pull its approved content
   from GET /api/admin/content-periods/<period_id>/content-export
   (matching by deliverableId and approvedVersionId). Never generate,
   rewrite, translate, or infer missing content.
3. For every placement with mayPublish: false, record its exact reason
   and do not act on it.
4. Publish each may-publish placement independently, to its own
   destination. Do not batch an article with its companion LinkedIn/GBP
   placement as one action.
5. Immediately after each verifiable publish, POST a receipt to
   .../placements/<placementId>/receipts with the real public_url or
   external_post_id and this placement's own approved_version_id.
6. Run POST .../receipts/<receiptId>/verify on every receipt just created.
   For a website or PDF destination this runs a real check automatically.
   For LinkedIn/GBP it will return "unverifiable" -- flag those to the
   operator for a manual manualOutcome attestation once they have
   personally confirmed the live post; never fabricate a verified result
   yourself.
7. Finish with a per-placement ledger: id, destination, outcome
   (published / skipped+reason / already-published-prior-run), and the
   resulting receipt id where applicable.
```

## Distinct deliverable identity: articles, LinkedIn posts, GBP posts

A period's active deliverables can include, side by side, a website
article, its companion LinkedIn post, a separate standalone LinkedIn
article, and a Google Business Profile post drawn from the same underlying
topic. These are separate rows in `content_deliverables`, each with its own
`id`, `channel` (`deliverable_role`), `locale`, `current_version`, and
`may_publish` state. The bundle never merges or summarizes them into one
entry. Two consequences follow:

- A publishing agent must act on each deliverable by its own id and its own
  `may_publish` state. An approved article does not authorize publishing
  its unapproved companion LinkedIn post; they are independently gated.
- `publication_destination` and `publication_path` describe where a
  deliverable's own placement lives (an article's journal URL, a landing
  page's route, a lead magnet's file path). A GBP post or a LinkedIn post
  does not own a placement in this sense; where relevant it points at
  something else via `cta_target_path` on the underlying
  `content_deliverables` row rather than at a `publication_path` of its
  own. The bundle exports `publication_path` exactly as stored and never
  fabricates one for a role that does not carry it.
