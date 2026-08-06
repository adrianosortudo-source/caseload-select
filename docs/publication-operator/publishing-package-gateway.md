# Publishing Package Gateway

Status: built, uncommitted work committed on `feat/publishing-package-gateway`; not deployed; no production credential set.

## Purpose and scope boundary

The gateway exists because browser `<input type="file">` workflows, chat attachments, temporary scratchpads, native file dialogs, Chrome cookies, and manual operator intervention are not an acceptable dependency for a publishing agent's asset delivery. It solves exactly one problem: get an approved hero image from local disk onto the correct deliverable's `hero_image_url`, safely and repeatably.

**It is intentionally narrow.** One endpoint, one operation: upload one approved hero image and bind it to one exact deliverable. It is not a generic publishing back door — see `src/lib/__tests__/publishing-package-gateway-auth-boundary.test.ts`, which statically proves the gateway's credential cannot reach approval, status-change, placement, notification, Files-hub, or arbitrary-storage code paths anywhere else in the repository.

It does not implement body posting, approvals, placement, notification, or external publishing. Those are separate, future, separately-reviewed surfaces.

## Env contract

Two environment variables, names only — no values are ever written to this document, logged, or returned by any part of the gateway:

- `PUBLISHING_PACKAGE_GATEWAY_TOKEN` — the dedicated bearer credential the endpoint requires (see `src/lib/publishing-package-gateway-auth.ts`). Distinct from `CRON_SECRET`/`PG_CRON_TOKEN` and from any operator/lawyer portal session — reusing a broader credential here would let anything that can call this endpoint reach everything that credential already unlocks.
- `PUBLISHING_PACKAGE_GATEWAY_URL` — the CLI-side base URL of the deployed endpoint. Only consumed by the CLI's non-dry-run path (`scripts/publishing-bind-heroes.mjs`); the server itself does not read this variable.

This repository has no `.env.example` to extend today. Whoever sets the real production value of `PUBLISHING_PACKAGE_GATEWAY_TOKEN` should record where it lives (e.g. Vercel project env) in the team's normal credential-tracking location — that step is explicit remaining work, not part of this build.

## Endpoint

`POST /api/publishing-agent/hero-package`

Auth: `Authorization: Bearer <PUBLISHING_PACKAGE_GATEWAY_TOKEN>`, checked before the request body is even parsed. An unauthenticated or wrongly-authenticated caller gets `401 { ok: false, error: "unauthorized" }` — never a receipt (a receipt would leak operation-id/shape information to a caller who never proved they may use this endpoint).

Body: `multipart/form-data` with:

| Field | Required | Notes |
|---|---|---|
| `firm_id` | yes | must match `HERO_PACKAGE_UUID_RE` |
| `deliverable_id` | yes | must match `HERO_PACKAGE_UUID_RE` |
| `expected_locale` | yes | must be one of `SUPPORTED_HERO_PACKAGE_LOCALES` |
| `expected_content_kind` | yes | must be one of `SUPPORTED_HERO_PACKAGE_CONTENT_KINDS` |
| `expected_sha256` | yes | exactly 64 lowercase hex characters, compared byte-for-byte (no case normalization) |
| `alt_text` | yes | non-empty; transported and receipted, **not yet persisted** — see "alt_text deferral" below |
| `file` | yes | the actual image bytes; PNG/JPG/JPEG/WebP only, sniffed from real bytes, never trusted from filename or Content-Type; max 10 MB |

No JSON body, no `url` field — the endpoint never fetches a remote URL and never accepts a caller-supplied storage path. Every rejection leaves the deliverable's existing `hero_image_url` unchanged; the only successful write is exactly `content_deliverables.hero_image_url` + `updated_at`, scoped by both `id` and `firm_id`.

### Rejection outcomes (`finalValidationOutcome`)

`rejected_malformed_request`, `rejected_unsupported_mime`, `rejected_too_large`, `rejected_hash_mismatch`, `rejected_deliverable_not_found`, `rejected_cross_firm`, `rejected_archived`, `rejected_locale_mismatch`, `rejected_content_kind_mismatch`, `rejected_storage_write_failed`, `rejected_binding_write_failed`, and `confirmed` on success.

## CLI

`npm run publishing:bind-heroes -- --manifest <absolute-manifest-path> [--dry-run] [--continue-on-error]`

Reads a manifest from local disk (schema in `src/lib/publishing-package-manifest.ts`), validates the whole manifest and every asset's local SHA-256 before any network request, then uploads exactly the listed assets — never a directory scan, never a filename-based guess.

- `--dry-run`: validates and computes hashes; makes zero network requests; still writes a receipt (marked `dryRun: true`) beside the manifest.
- `--continue-on-error`: without it, the CLI stops at the first failed operation; with it, it processes every operation and reports all results.
- Requires `PUBLISHING_PACKAGE_GATEWAY_URL` and `PUBLISHING_PACKAGE_GATEWAY_TOKEN` for a real (non-dry-run) run; dry runs need neither.

## Receipt semantics

The endpoint's receipt is returned in the HTTP response body only — it is not currently written to a durable server-side table (no `publishing_package_receipts`-style table exists; creating one is blocked by the migration-lineage freeze in effect since 2026-07-18). The CLI separately writes its own on-disk JSON receipt (`<manifest>.receipt.json`) recording what it attempted and the server's response for each operation. Together these are today's "immutable operation receipt" — durable, queryable server-side persistence is explicit future work once the freeze lifts.

## alt_text deferral

The manifest schema and both the CLI and endpoint require `alt_text` and transport it end-to-end (CLI validates → CLI sends it → endpoint validates it's present → endpoint includes it in the receipt). **It is not persisted anywhere.** `content_deliverables` has no alt-text column, and adding one is a migration — out of scope while the freeze holds. This is a deliberate, disclosed gap: alt text is carried faithfully through the pipeline and visible in every receipt, so no data is silently dropped without a trace, but nothing currently reads it back for rendering. Persisting it (and wiring it into the actual `<img>` tag it describes) is remaining work for the weekly-manifest phase.

## The seven publishing-agent operating principles

1. The Publishing Agent publishes from a manifest, never from browser inference.
2. Every release object requires exact bindings: firm, deliverable, locale, content kind, asset role, asset filename, asset hash, destination.
3. A matching-looking asset is not valid evidence of correctness — bytes are sniffed and hashed server-side, never trusted from a claim.
4. An EN text-overlay asset must never bind to PT content and vice versa — enforced by exact `expected_locale` equality against the deliverable's own recorded locale.
5. A website hero, Native LinkedIn Article cover, LinkedIn post card, GBP card, Lead Magnet hero, and Landing Page hero are distinct destination roles; this gateway writes exactly one of them (`hero_image_url`) and has no code path for any other.
6. The gateway is intentionally hero-image-upload/bind only — it must not become a generic publishing back door.
7. The broader publishing system will need a complete weekly package manifest (source deliverable/version, locale, destination, content relationship, asset id/hash/dimensions, CTA label and exact target, PDF asset, approval state, planned placement, QA state) — this gateway and the Canonical Publication Packet (`src/lib/publication-packet.ts`) are the narrow foundations for that, not a preview of its full shape.
