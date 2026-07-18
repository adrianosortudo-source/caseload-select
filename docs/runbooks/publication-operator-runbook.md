<!-- DOC-META v1
doc-type: operating-playbook
status: active
version: v1
last-edited: 2026-07-18
-->

# Publication Operator: operator runbook

## What the operator can do today

Everything in this release is **read-only**. There is no "publish" button anywhere. The Publication Queue (`/admin/content-studio/publication-queue`) exists to answer one question per placement: "if I were to publish this right now, what exactly would happen, and what is stopping me if anything is?"

1. Open `/admin/content-studio/publication-queue`, pick a firm, pick a content period.
2. The list shows every placement in that period with a rough status. `13 deliverable(s) with no placement yet` means the deliverable exists and is being worked on, but no destination has been configured for it (see "Known gap" below).
3. Click a placement row ("Run dry preflight") to see the full picture: the exact approved content, the destination and its configuration state, the release authorization path, the asset/hash summary, a redacted dry-run of exactly what would be sent, and the placement's claim/receipt history.
4. Nothing on the detail page writes anything. Reloading it re-runs the same read-only computation against current data.

## Credential / configuration checklist

| Destination | What's needed | Current status (2026-07-18) |
|---|---|---|
| Website (`firm_website`) | A prior verified `publication_artifacts`/`publication_receipts` row recording the firm's real public site origin. No deploy API — the operator deploys the firm's own site repository by hand (e.g. `vercel --prod` from a separate repo) and records evidence afterward. | No integration; deploy is always manual. Works once at least one page has been manually verified and registered. |
| LinkedIn (`linkedin_article` / `linkedin_post` / `linkedin_company_page`) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN` (names only — none exist yet) | Not configured. No OAuth client anywhere in this codebase. |
| Google Business Profile | `GOOGLE_BUSINESS_PROFILE_CLIENT_ID`, `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET`, `GOOGLE_BUSINESS_PROFILE_LOCATION_ID` (names only — none exist yet) | Not configured. No API client anywhere in this codebase. |
| Email delivery | No destination configuration model exists yet for placements | Not configured. |

Adding any of these is out of scope for this release. `validateConfiguration()` on the corresponding adapter will keep reporting `configured: false` with the exact missing-integration reason until real credentials and a real API client exist — this is by design, not a bug to silence.

## Known gap: no real placements exist yet

As of this release, `content_placements` has zero rows in production, for every firm. The 13 real DRG Founder Vesting deliverables all carry complete legacy metadata (`deliverable_role`, `publication_destination`, `publication_path`) but have never had a `content_placements` row created for them. Two ways to close this, neither performed automatically by this system:

1. **Manual, one at a time.** `POST /api/portal/[firmId]/deliverables/[deliverableId]/placements` with `{destination, locale, intended_path, required_artifact_type, scheduled_publish_date?}`. For a LinkedIn deliverable, the operator must pick the specific destination (`linkedin_post`, `linkedin_article`, or `linkedin_company_page`) — the legacy `publication_destination = "linkedin"` value does not disambiguate this, and the Publication Operator will never guess.
2. **A future, separately-reviewed backfill** that mechanically derives placements from complete legacy metadata. Explicitly not part of this release (a production write; its own review).

## Reading a blocked status

| Status | What it means | What to do |
|---|---|---|
| `blocked_content` | The deliverable itself isn't ready — not approved, version drift, missing locale/role, missing required asset | Go to the deliverable's own review page; this is the existing approval workflow, unaffected by this release |
| `blocked_authorization` | Content might be fine, but no release path exists — not individually approved and no active standing authorization (or the version is flagged `requires_individual_review`) | The firm's lawyer needs to approve the version, or enable standing authorization from their own portal (an operator can never do this) |
| `blocked_missing_configuration` | Content and authorization are fine, but the destination itself has no account/location/site on record | See the credential checklist above; for website, register real evidence first |
| `blocked_destination_validation` | Everything above passes, but the content doesn't fit the destination's own format rules (character limit, missing image, missing CTA target) | Revise the content in Content Studio, or reconsider the destination |
| `already_published` | A verified receipt already exists for this exact placement and approved version | Nothing to do; check the receipt history on the detail page |
| `ambiguous_external_state` | Either a receipt exists but hasn't been verified/failed/is mid-correction, OR another claim is already active on this placement | See "Ambiguous-state reconciliation" below |
| `ready` | Every gate passed | This release stops here — there is no publish action to take yet (release ladder step 4+) |

## Ambiguous-state reconciliation

An `ambiguous_external_state` result means the system genuinely does not know whether the last attempt succeeded, and will not guess.

- **Unverified receipt:** run the existing `POST .../receipts/[receiptId]/verify`. For website/PDF this runs a real check automatically. For LinkedIn/GBP it will return `unverifiable` — an operator who has personally confirmed the live post resubmits with `{manualOutcome: "verified"|"failed"}`.
- **Failed receipt:** investigate before retrying — a failed verification usually means the claimed URL/post doesn't actually exist or doesn't match the approved content. Do not create a new claim until you understand why the prior one failed.
- **Reconciling:** a correction is already in progress on this receipt's chain; wait for it to resolve rather than starting a second one.
- **Active competing claim:** either a concurrent attempt is genuinely in progress (wait), or a prior claim was never released because its intended publish never completed (a stale claim). Resolving a stale claim is a decision for a human, not this dry-run engine — it requires understanding what actually happened externally, which is exactly what this release cannot check for LinkedIn/GBP.

## Incident posture

Nothing in this release can cause an incident by itself — it performs no writes and no external calls. The realistic failure modes are all upstream, in systems this release reuses but does not own:

- If the manifest route 500s, check the Supabase connection and the existing `publication-preflight-loader.ts`/`publication-readiness-loader.ts` (unchanged) — the same failure would affect the pre-existing preflight report too.
- If a destination format check looks wrong, verify the platform limit constants in `publication-destination-validators.ts` against LinkedIn's/Google's current developer documentation (they were sourced from public documentation as of 2026-07 and are not fetched live).
- If the queue page shows unexpected data, remember it reads real production tables directly — an unexpected empty state (like the one this pilot found) is very likely the true state of the data, not a rendering bug. Verify with a direct read-only query before assuming otherwise.
