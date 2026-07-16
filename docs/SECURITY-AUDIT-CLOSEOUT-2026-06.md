# Security audit close-out (June 2026)

A multi-round adversarial security sweep (Codex audits plus remediation) ran across
the app. This file is the durable record: what shipped, what remains, and who
owns each open item. The sweep has converged; findings dropped from
Critical/High to fix-completeness gaps and false positives.

## Shipped (live on production)

| Area | Fix |
|---|---|
| SEO tool SSRF (`api/tools/seo-check`) | DNS-validating, connection-pinning undici dispatcher; per-hop plus per-URL SSRF checks; full IPv6 reserved ranges (`fe80::/10`, `fec0::/10`, `fc00::/7`, `ff00::/8`, IPv4-mapped, NAT64 `64:ff9b::/96`); manual redirects (max 5); byte-capped streaming body reads (bounds decompression) |
| SEO tool access / cost | Standard/deep scan plus `maxPages > 10` require an operator session; unauthenticated callers forced to quick (10 or fewer) and rate-limited (`seoCheck` bucket); 230s crawl budget with partial results |
| SEO tool data gate | Public responses strip `internalSummary` plus per-issue `internalNote`/`prospectingAngle`; severity calibration (policy items stay low; the coverage bump cannot synthesize critical) |
| Tenant isolation | `api/screen` session lookup bound to `firm_id` (cross-firm session-mix IDOR); Clio OAuth `state` HMAC-signed with firmId+expiry (and rejects when `CLIO_CLIENT_SECRET` is missing) |
| Public auth / abuse | `api/v1/leads` Bearer-only (no `?token=`); `firm-onboarding`, `firm-profile`, and `screen/upload` uploads gated by per-IP rate limit plus Content-Length preflight |
| Voice realtime (draft) | `turn`/`end` bearer auth fails closed in production; `end` binds the loaded session to its stored `firm_id` |
| Dependencies | `next` 16.2.3 to 16.2.9 (middleware-bypass, SSRF-via-WS, XSS, cache-poisoning highs); `postcss` to 8.5.15 |
| Content approval (parallel) | notification CHECK constraint; operator-only guard; version-pointer error capture; magic-byte MIME sniffing on uploads; atomic approval RPC |

## Open backlog (not bugs in shipped code; owner-gated)

1. **Voice realtime `turn` firm-binding.** High, but it is an untracked voice-v2 draft, not deployed.
   `loadActiveVoiceSession(callId)` lacks a firm predicate, so `turn` can cross-bind an active call
   to a request `firmId` (`end` already has the guard). Fix for the voice-v2 owner:
   `loadActiveVoiceSession(callId, firmId)` with `.eq('call_id',callId).eq('firm_id',firmId).eq('finalized',false)`,
   and finalize with `session.firmId` rather than the request param. Ship with the rest of the voice-v2 lib.

2. **`api/tool-intake` per-firm tokens.** Medium/High. A single global `TOOL_INTAKE_SECRET` plus a
   request `firmId` lets any holder post leads to any firm. Needs per-firm tool tokens with the firm
   derived from the token. Token-issuance / infra decision.

3. **`undici` advisories.** Partially unblocked (2026-07-16 corrective release). The project previously
   had no Node pin at all; `package.json` now declares `"engines": { "node": ">=18.17.0" }`, matching the
   currently-installed `undici@6.27.0`'s own floor. Confirmed via the Vercel API: production's actual
   `nodeVersion` project setting is `24.x`, and CI (`.github/workflows/ci.yml`) pins Node 20 -- both
   comfortably clear the `>=18.17.0` floor, and 24.x already clears `undici@8`'s Node 22.19.0 floor too.
   The `undici@8` bump itself remains a separate, not-yet-scheduled upgrade (out of scope for the
   corrective release that added the pin): (a) `npm install undici@^8`, (b) re-verify the SSRF agent
   (Agent, `connect.lookup`, and `dispatcher` cross-version compat, plus the `localtest.me` to 400 block
   and the engine-core tests), (c) full suite. The decompression vector is bounded in the interim by the
   streaming byte cap (an earlier `Accept-Encoding: identity` mitigation was reverted: it broke the
   crawler's compression check for every site and added little over the cap). (Also: `next` vendors its
   own `postcss@8.4.31`; that clears only on a future Next release.)

4. **`VOICE_HMAC_REQUIRED`.** Operator env flip. Set `VOICE_HMAC_REQUIRED=true` in Vercel prod; DRG's
   `voice_webhook_secret` is already populated. A firm with a secret already requires a valid
   signature regardless of the toggle; the toggle governs not-yet-rolled-out firms.

5. **Widget session-id capability model.** `api/memo`, `screen/resume`, and `screen/round3` treat
   `session_id` as the sole capability (the standard capability-URL model; the firm is derived from the
   session). Hardening to a signed capability token is a product decision, not a clear bug.

## Confirmed clean (verified against live prod DB, 2026-06-24)
Operator gate; lawyer/firm isolation in the portal layout; client/matter isolation; signed-URL
firm-prefix binding. RLS posture was checked directly against the prod database (`pg_class` +
`role_table_grants`), not inferred from migrations: all 23 PII tables have RLS enabled and
`anon`/`authenticated` grants are `(none)`. Three tables (`channel_intake_sessions`,
`firm_onboarding_intake`, `unconfirmed_inquiries`) were found RLS-enabled-but-NOT-forced and were
forced in migration `20260624_force_rls_three_pii_tables.sql` (applied to prod + re-verified). All 23
PII tables are now RLS-on-and-forced. Service-role bypasses RLS, so route code is the tenant guard;
that is why the IDOR checks above matter.
