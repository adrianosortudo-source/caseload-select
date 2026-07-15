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
