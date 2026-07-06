<!-- DOC-META v1
title: P12 Tracking and Attribution Build Plan
owner: Adriano Domingues
created: 2026-07-06
status: Ready for execution
executor: Claude Code (Sonnet 5), autonomous
-->

# P12: Tracking and Attribution Build Plan

End-to-end plan to close the lead-to-source attribution loop for CaseLoad Select, starting from the verified current state of 2026-07-06. Written for autonomous execution by a Claude Code session. Every claim below was code-verified or FOLLOWUPS-verified on 2026-07-06; trust these anchors over older memory notes (the "DRG launched with zero analytics" claim from June is stale).

---

## 1. Mission

A lead that arrives through the CaseLoad Screen widget must carry its traffic source (utm_*, gclid, referrer) onto its `screened_leads` row, so that when the lawyer signs the case, the signed case can be traced back to the campaign, ad, or surface that produced it. This is the prerequisite for Google Ads value-based bidding (the "T" pillar) and for the GA4 offline-conversion import that Google keeps recommending.

Four phases, strictly ordered. Phase 1 is the build. Phases 2-4 are gated and partially operator-dependent; build what code can build, then stop and report the operator steps.

---

## 2. Executor contract

Read before writing any code:

1. `D:\00_Work\01_CaseLoad_Select\CLAUDE.md` (master rules: writing rules apply to code comments too, no em dashes anywhere, no banned vocabulary)
2. `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\CLAUDE.md` (app architecture, Database Access Invariant, deploy safety pattern)
3. This document, fully, before Phase 0.

Binding standing instructions:

- **Close the full loop.** After every commit: push, confirm the Vercel deployment reaches READY, apply Supabase migrations at write time. Never end a phase with "operator must push."
- **Migrations apply to prod first, then code deploys.** Additive column on an existing table; the reading code ships after the column exists.
- **Two different deploy models.** See the repo matrix in section 4. Getting this wrong silently loses work.
- **Engine sync discipline does not bind here.** No file under `src/lib/screen-engine/` is touched by this plan. `ScreenEnginePublicWidget.tsx` is an app component, not an engine file; no sandbox mirror, no `check-engine-sync.sh`.
- **Test data hygiene.** DRG's `screened_leads` table was purged of test rows on 2026-07-02. Any test intake created during verification must use an obviously fake name (prefix `TRACKTEST`), and the row must be deleted (or status flipped to a clearly-archived state) after verification. Do not leave test rows that could read as market signal.
- **TypeScript and tests are gates.** `npx tsc --noEmit` clean and the vitest suite green before every push, in both repos.
- **No em dashes, no banned vocabulary, no italics** in any file content written, including code comments and this plan's follow-on docs. The banned-vocab hook blocks the write; do not fight it, rephrase.

Stop-lines (do not cross without operator confirmation):

- Do not enable Google Ads, create campaigns, or spend money.
- Do not upload any lead data to Google (Phase 4 is design-only in this plan).
- Do not add a consent banner to drglaw.ca without the operator approving copy and posture (Phase 3 has an explicit decision gate).
- Do not touch GHL configuration (Phase 2 numbers/forwarding are operator steps).
- Do not modify `.env.local` measurement IDs or Vercel env vars except as specified.

---

## 3. Verified current state (2026-07-06)

### Already live, do not rebuild

| Layer | State | Anchor |
|---|---|---|
| GA4 tag on drglaw.ca | Live in production. Measurement ID `G-N89NGTSSS9`, set in `.env.local` AND Vercel Production env (verified 2026-06-24, FOLLOWUPS row 142). Loader is production-gated. | `drg-law-website/src/components/analytics/GoogleAnalytics.tsx` |
| Pageviews | Manual page_view per App Router navigation, UTMs preserved in page_location, EN/PT locale dimension, StrictMode dedupe guard. | same file, `PageviewTracker` |
| Click events | phone_click, whatsapp_click, email_click, booking_click. | `drg-law-website/src/lib/analytics.ts` |
| Widget conversion events | widget_start fires on first `caseload-widget-resize` postMessage; widget_submit fires on `caseload-widget-complete` (posted by the widget only on a real persist). | `GoogleAnalytics.tsx` ClickTracker + `caseload-select-app/src/components/intake-v2/ScreenEnginePublicWidget.tsx:392` |
| Site-side UTM forwarding | The DRG site already appends the parent page's utm_source/medium/campaign/term/content onto the iframe src. Closed 2026-06-24. | `drg-law-website/src/components/layout/CaseLoadWidget.tsx:32` (UTM_KEYS) and `:54-75` |
| API acceptance | `/api/intake-v2` already validates and inserts utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer. | `caseload-select-app/src/app/api/intake-v2/route.ts:106-113, 256-259, 447-452` |
| DB columns | `screened_leads` already has utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer. | `caseload-select-app/src/app/portal/[firmId]/triage/[leadId]/page.tsx:56-60` (LeadRow) |
| Brief rendering | `buildInboundContext` renders "Day, Time - Source - Term" on the triage brief for web leads. | `caseload-select-app/src/lib/inbound-context.ts` |
| Operator console GA pull | DRG `intake_firms.ga4_property_id = 543032031`, `vercel_project_id = drg-law-website`; the firm Website analytics page pulls GA4 Data API server-side. | `caseload-select-app/src/app/admin/firms/[firmId]/metrics/page.tsx`, `src/lib/google-analytics.ts` |

### The gap (the only broken link in the chain)

The widget receives UTMs on its own URL (the site forwards them) but never reads them and never sends them to the API. The persist payload built in `ScreenEnginePublicWidget.tsx` `persist()` (lines 348-376) contains `referrer` and nothing else attribution-related. Net effect today: `screened_leads.utm_*` is null on every web lead, and the brief's inbound-context line falls back to referrer-host only.

Second gap: `gclid` (Google Ads click ID) does not exist anywhere in the chain: not in the site's UTM_KEYS, not in the widget payload, not in the API schema, not as a `screened_leads` column. Without gclid, Phase 4 (offline conversion import) is impossible regardless of volume.

Unverified (Phase 0 checks): whether `widget_submit` is marked as a Key Event in GA4 property 543032031, and whether events are actually flowing in production GA (they should be, but prove it).

---

## 4. Repo and deploy matrix

| Repo | Path | Deploy model | Gates |
|---|---|---|---|
| caseload-select-app | `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app` | Commit + push to main. GitHub git integration deploys. NEVER CLI-deploy uncommitted changes (they get silently reverted on next push). | `npx tsc --noEmit`, vitest suite, then push, then confirm Vercel READY |
| drg-law-website | `D:\00_Work\01_CaseLoad_Select\06_Clients\DRGLaw\03_Authority\Website\drg-law-website` | `npx vercel --prod --yes` from the repo root. No git integration; CLI is canonical. 308 redirects in output are normal. | `npx tsc --noEmit`, `npm run build`, then CLI deploy |
| Supabase prod | project `ssxryjxifwiivghglqer` (ca-central-1) | Supabase MCP `apply_migration`, or `supabase db push` (project is linked) | Migration file committed to `supabase/migrations/` in the same change |

Local dev on either repo: `next dev --webpack` (Turbopack broken on D: drive).

---

## 5. Phase 0: baseline verification

Goal: prove the built layer is live, so Phase 1 starts from known-good. No code changes expected; this phase produces a short findings list.

### Tasks

**0.1 Confirm the GA4 tag ships in production HTML.**
`curl -s https://drglaw.ca | grep -o "googletagmanager.com/gtag/js?id=G-[A-Z0-9]*"` should return the measurement ID. If absent, the env var fell out of Vercel Production: check `npx vercel env ls` in the drg-law-website repo and restore before anything else.

**0.2 Confirm events are flowing.**
Use the existing server-side GA4 client (`src/lib/google-analytics.ts` in the app repo, service account already configured for property 543032031) to run a Data API query for the last 14 days of event counts, dimensioned by eventName. Expect page_view, phone_click, widget_start at minimum. Write a throwaway script under the scratchpad (not the repo) or extend a one-off query through the existing lib. If widget_submit shows zero over 14 days, that is expected (no real leads yet), not a defect.

**0.3 Key Event marking.**
Attempt to list key events via the GA4 Admin API with the same service account (`GET /v2/properties/543032031/keyEvents`). If the service account has edit rights, create `widget_submit` as a Key Event if missing. If it only has Viewer, record this as an operator step: GA4 UI > Admin > Key events > mark `widget_submit` (and optionally `phone_click`).

**0.4 Report.**
Emit a five-line findings block (tag live yes/no, events flowing yes/no, widget_submit key event yes/no/operator-step, anomalies) before starting Phase 1.

### Acceptance

- Measurement ID confirmed in prod HTML.
- Event flow confirmed via Data API (or a concrete blocker named).
- Key Event state known, with operator step recorded if the API path is read-only.

---

## 6. Phase 1: close the lead-to-source loop (the build)

Goal: every web lead persists utm_*, gclid, and referrer onto its `screened_leads` row. This is four small changes in a strict order: DB column, API schema, widget payload, site key list. Migration first, then app, then site.

### 6.1 Migration: add gclid to screened_leads

New file `supabase/migrations/20260706_screened_leads_gclid.sql` in the app repo:

```sql
-- P12 Phase 1: Google Ads click ID for offline conversion attribution.
-- Additive, nullable; existing rows unaffected. RLS already forced on
-- screened_leads (service-role only), no grant changes needed.
alter table public.screened_leads
  add column if not exists gclid text;

comment on column public.screened_leads.gclid is
  'Google Ads click ID captured from the widget URL at intake. Key for offline conversion import (P12 Phase 4).';
```

Apply to prod via Supabase MCP `apply_migration` BEFORE pushing any code that references the column. Verify with a `select gclid from screened_leads limit 1`.

Decision, locked here so the executor does not re-open it: a single `gclid` text column, not a `click_ids` jsonb. If msclkid/fbclid are ever needed, they get their own additive columns then. Scope discipline: gclid only in this phase.

### 6.2 API: accept and persist gclid

File: `src/app/api/intake-v2/route.ts`.

- Add `gclid?: string | null` to the request validation alongside the existing utm fields (lines 106-113 region). Trim and length-cap it the same way the utm fields are handled (if they are capped; match the existing pattern exactly, and if there is no cap, add a sane one such as 512 chars to all of them only if that does not change existing behavior tests).
- Thread it through both insert paths where utm fields already flow (the two blocks around lines 256-259 and 447-452).
- Check `src/lib/web-intake-session-store.ts` and `/api/intake-v2/checkpoint/route.ts`: the drop-off checkpoint should also carry utm_* + gclid so that thin briefs created by the expiry sweeper (`/api/cron/expire-web-intake-sessions`) keep attribution. Read the store first; if the checkpoint payload and the finalize path can carry the fields with a small additive change (a jsonb `attribution` field on the checkpoint row or reuse of existing columns), do it in this phase. If it turns out to require a second migration on `web_intake_sessions`, do that migration too (same additive pattern). If it balloons beyond that, record it as a followup instead and keep Phase 1 shippable.

### 6.3 Widget: read own URL params, include in payload

File: `src/components/intake-v2/ScreenEnginePublicWidget.tsx`.

- On mount (or lazily inside `persist()`), read `window.location.search` for utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid. The widget page already reads `?lang=` so URL params reach the iframe; follow whatever pattern the lang read uses if it goes through the page component, otherwise read `window.location` directly inside the client component.
- Add the six fields to the `persist()` payload (lines 348-376 region), null when absent.
- Add them to the checkpoint POST body as well if 6.2 wired the checkpoint path.
- Values must survive the whole intake session: capture them once at mount into a ref, not at persist time, in case any in-widget navigation mutates the URL (it should not, but the ref costs nothing).
- The sandbox SPA at caseload-screen-v2 is an operator demo surface and is out of scope; production web leads flow through `/widget-public/[firmId]` in this repo. Do not touch the sandbox.

### 6.4 Site: add gclid to the forward list

File: `drg-law-website/src/components/layout/CaseLoadWidget.tsx` line 32.

```ts
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
```

The constant name stays as-is (rename adds diff noise for nothing). One-line change; the forwarding loop already handles any listed key.

### 6.5 Brief surface

`buildInboundContext` already renders source/medium/campaign/term. gclid is a machine key, not for display; storing it is enough. Verify only that `inbound-context.ts` does not need changes, and that the triage `LeadRow` interface plus the page select list gain `gclid` ONLY if something reads it (nothing should; skip the select change if unused, per the existing pattern of selecting only what renders).

### 6.6 Tests

- App repo: extend the intake-v2 route tests (find the existing suite covering utm passthrough; mirror its shape) with: gclid accepted and persisted, gclid absent yields null, oversized gclid handled per the chosen cap.
- Widget: if a payload-shape unit test exists for `persist()`, extend it; if not, do not invent a jsdom harness for this, the route test plus e2e verification below covers it.
- Full suite green in the app repo before push. Site repo: tsc + build.

### 6.7 Deploy and end-to-end verification

Order: migration already applied (6.1) > app commit + push > confirm Vercel READY > site `npx vercel --prod --yes`.

Then the live proof:

1. Open (or curl-simulate via a headless check if browser tools are unavailable) `https://drglaw.ca/?utm_source=tracktest&utm_medium=plan&utm_campaign=p12&gclid=TRACKTEST123`.
2. Complete a minimal intake through the embedded widget using name `TRACKTEST Verification`, a fake but well-formed email, and a corporate-law style matter description.
3. Query prod: `select lead_id, utm_source, utm_medium, utm_campaign, gclid, referrer from screened_leads where contact_name ilike 'TRACKTEST%' order by submitted_at desc limit 1;` and confirm all values landed.
4. Confirm the triage brief for that lead renders the inbound-context source line.
5. Delete the test row (and any `web_intake_sessions` checkpoint row it created), and note the deletion in the completion report. Also expect a new-lead notification email fired to the firm's lawyers during the test: warn the operator in the report that Damaris may receive one TRACKTEST notification, or, better, run the test against a non-DRG test firm if one exists with the widget embedded (it does not today, so the DRG warning path is the realistic one; keep the test to exactly one submission).

### Acceptance (Phase 1 done means all of these)

- `screened_leads.gclid` column exists in prod.
- A tagged test intake produced a row with utm_source, utm_medium, utm_campaign, gclid, referrer all populated.
- Brief inbound-context line showed the source.
- Test row cleaned up.
- Both repos deployed, tsc + tests green, FOLLOWUPS.md updated.

---

## 7. Phase 2: call attribution (operator-gated)

Goal: phone calls become attributable. Today only `tel:` clicks are tracked (a click event, not a call), and the two DRG lines (LSO NAP 647-598-2537, Voice AI intake 647-584-0998) carry no source signal.

What code can do now:

- **2.1 Voice leads already carry channel.** Voice intakes land with `channel='voice'` and caller ID. No code change; the attribution unit for voice is the phone number dialed, which is what 2.2 provides.
- **2.2 Dynamic number insertion (site-side, build after operator provides the number).** When the operator provisions a GHL tracking number that forwards to the Voice AI line, add a small client component to drg-law-website: if the landing session carries `gclid` or `utm_medium=cpc`, swap the displayed phone number (and `tel:` href) to the tracking number; otherwise show the standard line. Persist the decision in sessionStorage so in-site navigation keeps the swapped number. NAP discipline: the LSO/citation surfaces keep the canonical number; the swap applies only to on-page display for paid sessions, never to schema.org JSON-LD, footer NAP, or citations.

Operator steps (report, do not attempt):

- Provision a tracking number in GHL (DRG sub-account `KwpSaMUehIN25dMG4WZB`), forward to 647-584-0998, confirm whisper/recording posture.
- Confirm the number is excluded from every citation surface (Day 1 Ownership Matrix discipline).

Gate: do not build 2.2 until the operator supplies the tracking number. Record as followup and stop.

---

## 8. Phase 3: consent posture (decision gate, then small build)

Goal: a defensible PIPEDA/CASL-adjacent consent posture for analytics on a law firm site, before any Phase 4 data leaves for Google's ad systems.

Decision the operator must make first (present these two options, recommend the second):

- **Option A, implied consent:** keep GA4 firing by default, add a privacy-page disclosure section describing analytics cookies and an opt-out link. Common Canadian posture for analytics-only tracking, lowest friction.
- **Option B, Consent Mode v2 with a light banner (recommended):** gtag consent defaults set to denied for ad_storage/ad_user_data/ad_personalization and granted for analytics_storage, plus a one-line banner with Accept and Decline that upgrades or downgrades. This is the posture Phase 4 requires anyway (ad_user_data consent signals are mandatory for offline import into Google Ads), and for a law firm the stricter default reads right.

Build (only after the operator picks): consent defaults wired into `GoogleAnalytics.tsx` before the config call, a `ConsentBanner` component in the DRG brand system (Brand Book v13: no italics, no em dashes, no terminal square for DRG), copy through the operator before deploy, and the DR-082 disclaimer banner untouched (separate concern, do not merge them).

Gate: copy and posture approval are operator decisions. Prepare the diff, show it, wait.

---

## 9. Phase 4: offline conversion import (design only, explicitly deferred)

Do not build in this plan. Entry criteria, all three required:

1. Google Ads account live and spending for DRG.
2. Phase 1 shipped and gclid populating on real (not test) leads.
3. Signed-case volume trending toward ~15+/month, enough for Smart Bidding to learn.

Design sketch to record for the future session: when a lead's matter reaches a signed state (Take is the current proxy; the true "retainer signed" signal lives with the lawyer), an outbox-style job exports `{gclid, conversion_action, conversion_time, value}` to Google Ads via the Click Conversions API. Reuse the `webhook_outbox` at-least-once pattern. Consent Mode v2 (Phase 3 Option B) must be live first. LSO/PIPEDA review of exactly which fields leave the building: gclid + timestamp + a generic conversion name, never matter type, never contact data.

---

## 10. Completion report format

At the end of the run, produce:

1. Phase 0 findings (five lines).
2. Phase 1: commits (both repos), migration applied, e2e proof (the SQL row, values redacted to prefixes), test-row cleanup confirmation.
3. Phase 2/3: what was recorded as operator-gated, with the exact operator steps listed.
4. FOLLOWUPS.md rows appended (see section 11).
5. Anything discovered that contradicts this plan's verified-state table (per the scope investigation protocol: surface, do not silently pivot).

---

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-07-06 | P12 build plan | Phase 1 lead-to-source loop ready for execution | H | 05_Product/caseload-select-app/, 06_Clients/DRGLaw/03_Authority/Website/drg-law-website/ | Execute Phases 0-1 per this plan | Claude | Open |
| 2026-07-06 | P12 build plan | widget_submit Key Event marking in GA4 property 543032031 unverified | M | GA4 (external) | Phase 0 task 0.3; operator marks in GA4 UI if API is read-only | Adriano | Open |
| 2026-07-06 | P12 build plan | GHL tracking number for paid-call attribution not provisioned | M | GHL DRG sub-account | Operator provisions number forwarding to 647-584-0998, then build Phase 2.2 | Adriano | Open |
| 2026-07-06 | P12 build plan | Consent posture decision (implied vs Consent Mode v2 banner) | M | 06_Clients/DRGLaw/03_Authority/Website/drg-law-website/ | Operator picks Option A or B in section 8, then build | Adriano | Open |
