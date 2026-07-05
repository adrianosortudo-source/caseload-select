# Content Studio: Next 20% Build Plan (autonomous execution spec)

**Status:** Approved for autonomous execution. **Written:** 2026-07-05, operator-directed, based on the same-day audit.
**Executor:** Claude (Sonnet 5), full autonomy, zero operator input during the run.
**Scope baseline:** Content Studio sits at ~63% of its product goal (audit of 2026-07-05, recorded on the Ses.15 roadmap row in this repo's CLAUDE.md). This plan takes it to ~83%. The product goal, from `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` Section 1: publish-ready pages that rank for real queries and get quoted by AI answer surfaces, behind an LSO-compliant approval record.

The audit found the pipeline strong in the middle (generation, validation, preview) and unbuilt at both ends: no enforcement on the legal gate, no publish path, and zero real content ever run through the tool. This plan builds the ends. It deliberately stops at the sign-off line: everything up to "awaiting lawyer approval" is autonomous; nothing beyond it is.

---

## 0. Executor contract

You have full autonomy inside the constraints below. Do not ask the operator anything; every decision this work requires is pre-made in this document. If you hit a situation this document genuinely does not cover, write the blocker into the final report, skip that item, and continue with the rest. Do not improvise around a stop-line.

**Stop-lines (never cross, no exceptions):**

1. Never contact, notify, or email the client lawyer (Damaris) or any firm contact. Suppress every notification a build step would otherwise fire toward a firm (details in WP-2).
2. Never publish, deploy, or transmit content to any public surface. No drglaw.ca deploys, no GHL posts, no social APIs. The DRG website repo (`06_Clients/DRGLaw/03_Authority/Website/drg-law-website`) is read-only for this run.
3. No schema changes of any kind: no files under `supabase/migrations/`, no `supabase db push`, no `apply_migration`, no DDL through any channel. Task #12 (migration reconciliation) owns that lane. Do not apply the staged `20260630_content_publish_delegation.sql`. Everything in this plan is application code plus row data in existing tables and JSONB columns.
4. Do not touch `src/lib/screen-engine/` (byte-sync discipline with the sandbox, DR-033).
5. Do not commit or modify anything under `supabase/` at all, including the `_reconciliation_*` folders.

## 1. Read first (in this order)

1. This repo's `CLAUDE.md`: Database Access Invariant, Developer Gotchas, Ses.15 roadmap row (it records the audit and the four smoke-test fixes).
2. `docs/CONTENT_STUDIO_SEO_AEO_SPEC.md` Sections 1, 4, 7, 10, 11.
3. `src/lib/content-studio.ts`, `src/lib/content-studio-structured.ts`, `src/lib/content-studio-prompt.ts`, `src/lib/content-validators.ts`.
4. `src/lib/deliverables.ts`, `src/lib/deliverables-pure.ts`, `src/lib/deliverables-auth.ts`, and migration `20260623_content_approval.sql` (shape reference only; already applied).
5. `src/app/api/admin/content-studio/pieces/route.ts` and `pieces/[id]/` (route.ts, draft, validate), `src/app/admin/content-studio/[id]/page.tsx`.
6. `06_Clients/DRGLaw/03_Authority/Strategy/drg_strategy_v2.upload.json` and whatever content-strategy document sits alongside it (ContentStrategy v3 is the ladder reference for query selection in WP-4).

## 2. Live constants (verified 2026-07-05)

| Constant | Value |
|---|---|
| Supabase prod project | `ssxryjxifwiivghglqer` |
| DRG firm_id | `eec1d25e-a047-4827-8e4a-6eb96becca2b` |
| Active strategy id (DRG Counsel Case-File v4.1) | `19646d3b-286e-4310-bd5d-1d01ba2116a0` |
| Smoke-test piece (canonical_service_page, reusable as the E2E fixture) | `16eba76a-5690-41a2-9e5e-09b7310f6460` |
| `content_pieces.status` CHECK values | draft, in_review, changes_requested, approved, production, published, archived |
| `workflow_gate` CHECK values | discovery, position, draft, legal_gate, authoring, production |
| Draft model | `CONTENT_STUDIO_MODEL` env override, default `claude-sonnet-5`, strict structured outputs |
| Calendar slots waiting | 4 counsel_note + 1 counsel_letter, status `planned`, DRG |

## 3. Work packages, in execution order

Percentages are the contribution to the overall project number (63 to ~83).

### WP-1: Strategy data completion (+1%)

The live strategy row is missing the entity data the schema assembly needs. Populate, from documented facts only (Article IV, no invention):

- `strategy_json.canonical_nap`: firm name (DRG Law Professional Corporation), website `https://drglaw.ca`, public phone `647-598-2537` (the LSO NAP line, NOT the Voice AI line), address as it appears on the drglaw.ca contact page and in `intake_firms` for the DRG row. Cross-check both sources; if they disagree, use the website value and note the discrepancy in the report.
- `strategy_json.authority_assets`: the named lawyer (Damaris Regina Guimaraes, exact spelling per the memory rule; verify against the drglaw.ca site source), her title, and the site's about/journal URLs.
- `voice_rules.approved_ctas`: pull the CTA labels actually in use on drglaw.ca surfaces (for example "Submit for review" on intake). Read the website repo source to collect them; do not invent labels.
- `format_specs.canonical_service_page`: `{ "structure": [section keys in the order of SERVICE_PAGE_SECTION_KEYS], "word_range": [1200, 2000], "tone": <reuse the strategy voice tone> }`.

Apply by UPDATE to the live row via the Supabase MCP (row data, not schema), and mirror the same change into `drg_strategy_v2.upload.json` so the source file and the row stay in sync. Bump nothing: same strategy id, same version (this is data completion, not a strategy revision).

**Acceptance:** re-run the draft route on the smoke piece; the `breadcrumb_urls_incomplete` warning is gone and the JSON-LD blocks carry the NAP entity.

### WP-2: The legal gate becomes real (+7%)

Today `PATCH /api/admin/content-studio/pieces/[id]` accepts any forward gate move with no conditions, and `content_pieces.deliverable_id` is populated by nothing. Wire the gate to the existing deliverables approval system (the portal review surface Damaris already uses).

1. **Entry condition for `draft -> legal_gate`:** a current EN version exists AND the most recent `validate_deterministic` run for that version has zero `fail` results. Reject with a 422 explaining exactly what is missing.
2. **On advancing to `legal_gate`:** render the piece to HTML (reuse `renderServicePagePreview` for canonical_service_page; for Markdown formats use the same rendering approach the admin page uses, extracted so both share one renderer), create a `content_deliverable` (content_kind `text`) with that HTML as version 1 via `createDeliverable` + `addVersion`, and set `content_pieces.deliverable_id`. **Notification suppression is mandatory:** `deliverables.ts` fires `deliverable_review_requested` events on the review path (see the call sites near lines 445 and 492). Add an explicit `notify: false` option threaded through, defaulting to the current behavior everywhere else, and pass `notify: false` from this flow. Confirm by checking `notification_outbox` after the E2E run: zero new firm-bound rows.
3. **Exit condition for `legal_gate -> authoring` and `legal_gate -> production`:** the linked deliverable has `status = 'approved'`, OR an active `content_publish_delegations` row covers the piece's format. That table does not exist in prod yet (its migration is staged, not applied), so the delegation check must be a guarded read: on any query error, treat as "no delegation" and rely on the approved-deliverable path alone. Never create the table.
4. **Admin surface:** on `admin/content-studio/[id]`, show the linked deliverable's status and a link to its portal review page; on the gate tracker, show why an advance is blocked.
5. **Tests:** pure gate-condition logic gets unit tests (entry condition, exit condition, delegation-guard fallback). Route-level behavior gets a test if the existing route-test pattern in this repo supports it without `server-only` breakage (see Developer Gotchas in CLAUDE.md).

**Acceptance:** on the smoke piece, `draft -> legal_gate` succeeds only after a passing validation run, creates the deliverable, links it, fires nothing at the firm; `legal_gate -> production` is refused while the deliverable is unapproved.

### WP-3: Publish and export pipeline (+7%)

The mechanism, not the publication. Nothing in this WP touches a public surface.

1. **Export renderer** in `src/lib/content-studio-structured.ts` (or a sibling `content-studio-export.ts`): `renderServicePageExport(blocks, seoMetadata)` returning `{ pageHtml, schemaJsonLd, meta }` where `pageHtml` is a complete standalone HTML document: DRG-brand-correct (read the brand facts from the strategy row, not hardcoded), the LSO "Legal information, not legal advice" disclaimer banner before content (DR-082 pattern; copy the exact wording from the `LsoDisclaimer` component on the DRG website repo, read-only), JSON-LD in `<script type="application/ld+json">`, title and meta description in `<head>`. Markdown formats get the same wrapper around their rendered body.
2. **Export route** `POST /api/admin/content-studio/pieces/[id]/export` (operator-gated with `requireOperator`, same as siblings): requires the WP-2 exit condition (approved deliverable or delegation). Writes the bundle (page.html, schema.json, meta.json) to the `firm-files` bucket under an `exports/content-studio/<pieceId>/v<version>/` prefix (no `firm_files` table rows, matching the message-attachments precedent), returns signed URLs (1h TTL).
3. **Publish record:** a separate explicit action (`POST .../publish-record`) that takes `{ published_url }`, sets piece `status = 'published'` (already a legal CHECK value), and appends `{ publish_record: { url, at, exported_version } }` to the current version's `seo_metadata`. Do NOT store it in `source_brief` (the brief form PATCH could clobber it). This action only records what the operator did manually; it publishes nothing itself.
4. **Admin surface:** Export button (with blocked-state explanation) and publish-record form on the piece page.

**Acceptance:** end-to-end on the smoke piece with the deliverable force-approved ONLY via direct SQL on the smoke deliverable row (this is test fixture manipulation on a row you created, clearly titled SMOKE TEST; never do this to a real piece; say so in the report): export produces a bundle whose page.html passes a manual read for the disclaimer banner, JSON-LD presence, and zero banned vocabulary (run the existing validators against the exported text as a check).

### WP-4: Run the factory to the sign-off line (+4%)

The five stale calendar slots become five real pieces parked at `legal_gate`.

1. Source the queries and topics from the DRG content strategy documents in `06_Clients/DRGLaw/03_Authority/Strategy/` (ContentStrategy v3 ladder) and the gaps in the live drglaw.ca journal (read the website repo's journal pages to avoid duplicating an existing article). Every brief field traces to a document or the live site; invent nothing (Article IV).
2. For each of the 4 counsel_note slots + 1 counsel_letter slot: build a `source_brief` in the exact shape of spec Section 11 (primary_query, secondary_queries, client_question_variants, jurisdiction Ontario, practice_area from the slot's territory, audience, search_intent, answer_summary, internal_link_targets pointing at real drglaw.ca URLs you verified exist).
3. Create each piece via the API (create, gate to draft, generate, validate). Iterate: if validators fail, regenerate at most 3 times per piece (vary nothing but the retry; if still failing, record the failure and move on). When green, advance to `legal_gate` through the WP-2 flow (deliverable created, notifications suppressed).
4. Mark the calendar slots `briefed` (the create route already does this when `calendar_slot_id` is passed).

**Acceptance:** 5 pieces at `legal_gate`, each with a linked unapproved deliverable, zero notifications sent, calendar slots consumed. These wait for Damaris; that wait is the designed end state of this run, not a failure.

### WP-5: Coverage report (+1%)

Read-only measurement scaffold at `/admin/content-studio/coverage?firm_id=`: one table over `content_pieces` joined to versions: title, format, primary_query (from seo_metadata, fallback source_brief), gate, deliverable status, published URL (from the WP-3 publish record), last validation verdict. A second block lists calendar slots with no piece. Reuse the admin page patterns (server component, `supabaseAdmin`, `FirmFilter`). No external APIs, no rank tracking.

**Acceptance:** page renders with the 6 live pieces and shows exactly one published-URL cell empty per unpublished piece.

## 4. Explicitly out of scope (do not build, even if tempting)

- The three gated compliance-format generator branches (paid_traffic_landing, review_request, review_response).
- Any write to the DRG website repo, any Vercel deploy of it.
- Applying the delegation migration, or any migration.
- GSC, rank tracking, sitemap pinging, indexing APIs.
- Realtime anything, PT authoring, rich-text editing of drafts.
- Refactors outside the files this plan names, however untidy they look.

## 5. Verification technique (proven 2026-07-05)

- **Local:** `npx vitest run` on every touched suite plus the three content-studio suites; `npx tsc --noEmit` clean. `next dev` is NOT a prod-data surface: `.env.local` points at the OLD Supabase project; never run local dev against prod expectations.
- **Prod smoke:** mint an operator cookie. `npx vercel env pull` from this repo gives `PORTAL_SECRET` (sensitive vars like `ANTHROPIC_API_KEY` and the Supabase keys pull as empty strings; `PORTAL_SECRET` and `CRON_SECRET` pull fine). Cookie value is `base64url(JSON.stringify({firm_id, role: "operator", exp: Date.now()+2*3600*1000})) + "." + HMAC-SHA256-base64url(payload, PORTAL_SECRET)`, sent as `Cookie: portal_session=<token>` to `https://app.caseloadselect.ca`. Delete the pulled env file and the cookie when done.
- **Data reads and WP-1 row updates:** Supabase MCP `execute_sql` against project `ssxryjxifwiivghglqer`. UPDATE statements on existing rows are allowed; DDL is not.
- **Deploys:** commit + push to main only (Vercel git integration; CLI-only deploys get reverted). A parallel session may be committing to this repo: `git pull --rebase` before every push, stage explicit file paths only, never `git add -A`, and check `git status` for unrelated staged files before every commit. Confirm the deployment reaches READY (`npx vercel ls`) after each push that carries code.

## 6. Writing rules (apply to every generated string and every doc line)

No em dashes anywhere. No italics. No banned vocabulary (the strategy row's `banned_vocabulary` list is enforced by validators; the master list in the operator CLAUDE.md applies to plan docs and comments too). No outcome promises, no timing promises, no specialist/expert language (LSO Rule 4.2-1). Evidence-led: every factual claim in a brief traces to a source document.

## 7. Delivery and report

1. Append a `Ses.16 Content Studio ends-of-pipeline` row to the Build Roadmap table in this repo's CLAUDE.md: what shipped per WP, commit hashes, what was skipped and why.
2. Append one row to `D:\00_Work\01_CaseLoad_Select\00_System\FOLLOWUPS.md` (same schema as existing rows): the five pieces waiting at legal_gate for Damaris's review is the open item; owner Adriano.
3. Final report to the operator, in this order: what shipped (per WP, one line each), the new completion estimate against the 83% target, defects found in existing code while building (fixed or flagged), the exact list of things now waiting on a human (Damaris approvals, publish decisions), and anything skipped with the reason.
4. Leave the smoke-test piece and its force-approved deliverable clearly labeled; do not delete them.
