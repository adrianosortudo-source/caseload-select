# GTA prospect research worker

The worker is a read-only public-web evidence collector for the private GTA
research queue. It is neither a CRM worker nor an outreach worker. It never
submits a form, uses chat, books an appointment, sends a message, creates a
contact, or changes a target website.

## Required inputs

Run from a protected worker environment only:

```text
GTA_PROSPECT_RESEARCH_QUEUE_TOKEN=<scoped queue worker secret>
GTA_PROSPECT_RESEARCH_QUEUE_BASE_URL=https://admin.caseloadselect.ca
GTA_PROSPECT_RESEARCH_WORKER_ID=gta-research-worker-01
```

`GTA_PROSPECT_RESEARCH_QUEUE_TOKEN` is a production-only, server-side secret.
Keep any worker copy DPAPI-protected on the approved operator machine; never
place it in a repository file, a research capsule, or a draft package. When it
is rotated, replace the Vercel value and the protected worker copy together,
then activate the change only through the normal GitHub PR merge and
production deployment path. Do not use a direct production deployment solely
to refresh this credential.

The policy file passed through `--policies` is an operator-reviewed JSON array.
Each host must supply exactly one current policy state, review/expiry timestamps,
and exact allowed path prefixes:

- `published_terms`: a reviewed terms URL and SHA-256 hash.
- `no_published_terms`: a separate, documented review recording a 404 or 410
  and body hash for each conventional same-host endpoint: `/terms`,
  `/terms-of-use`, `/terms-and-conditions`, and `/terms-of-service`.

The no-published-terms state is deliberately narrow. A timeout, 429/5xx,
redirect to an unapproved host, a page that merely appears not to contain terms,
or an unreviewed endpoint is not proof. It remains blocked. The worker never
performs this discovery itself and never requests a candidate page until the
policy validates.

```json
[
  {"host":"example.com","reviewedAt":"2026-09-14T00:00:00.000Z","expiresAt":"2026-10-14T00:00:00.000Z","termsUrl":"https://example.com/terms","termsSha256":"64-lowercase-hex-characters","allowedPathPrefixes":["/"]},
  {"host":"example.org","reviewedAt":"2026-09-14T00:00:00.000Z","expiresAt":"2026-10-14T00:00:00.000Z","noPublishedTermsReview":{"kind":"no_published_terms","attemptedUrls":[{"url":"https://example.org/terms","status":404,"bodySha256":"64-lowercase-hex-characters"},{"url":"https://example.org/terms-of-use","status":404,"bodySha256":"64-lowercase-hex-characters"},{"url":"https://example.org/terms-and-conditions","status":404,"bodySha256":"64-lowercase-hex-characters"},{"url":"https://example.org/terms-of-service","status":404,"bodySha256":"64-lowercase-hex-characters"}]},"allowedPathPrefixes":["/"]}
]
```

## Invocation

```text
pnpm tsx scripts/run-gta-prospect-research-worker.ts --policies /protected/policies.json --output /durable/evidence/gta-2026-09-14 --limit 10
```

`--output` must be a durable, access-controlled evidence volume. The runner
writes each complete capsule idempotently using its hash as the file name. It
does not put raw page content in logs.

## Safety boundary

- Public HTTP `GET` only; cookies omitted and redirects handled manually.
- Per request: DNS lookup rejects private/reserved addresses; unapproved hosts,
  credentials, custom ports, and cross-host redirects are rejected.
- The worker validates the reviewed terms hash before `robots.txt` and site
  pages. It then honours applicable robots rules on every crawled path.
- Default caps: 8 pages, 1 MB body per page, 15-second request timeout. Pages
  are same-host, approved-path team/lawyer/about/contact candidates only.
- The emitted evidence capsule contains raw response text, content hash, URL,
  time, status, visible email/team/leadership/intake signals, and an explicit
  `actionsNotPerformed` record.

## Queue lifecycle

1. Claim at most 25 items under a bounded lease.
2. Capture and write the full evidence capsule before changing queue state.
3. On a fetch/policy/robots failure, persist the failure capsule and defer with
   a bounded retry date.
4. On successful capture, defer with `research_capture_pending_governed_import`
   for seven days. This is intentional: the worker cannot resolve, import,
   merge identities, allocate `firm_id`, or assert qualification.
5. The governed evidence/identity pipeline reads the capsule, validates roster,
   owner, public professional email, advertising, GBP and geography, then
   resolves the queue item with the existing service-only queue RPC.

If capsule persistence or queue handoff fails, the worker leaves the lease
unresolved. Lease expiry creates a safe retry; idempotent capsule filenames
prevent loss or silent overwrite.

## Geography handoff

The worker only records an observed source address. It deliberately emits
`coordinate: null` and `boundary: null`; Toronto labels and postal codes are
not Downtown proof. A separately sourced geocoder must append coordinates,
coordinate provenance, the Downtown Plan 41 boundary version, and the boundary
decision before a firm can be classified as in scope.

## Required integration after this worker ships

The runtime requires an append-only, access-controlled capsule sink and a
governed importer/reviewer that persists source evidence, allocates stable
identity only after adjudication, and finally calls `resolve`. The existing
queue schema has no `research_captured` state, so this worker uses deferred
review holds instead of pretending a raw crawl is a qualified lead.
