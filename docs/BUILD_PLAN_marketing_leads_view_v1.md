# Build Plan · Marketing Leads View v1

**Drafted:** 2026-08-01 (facts verified live 2026-07-31/08-01 against prod Supabase, prod GHL, and this repo)
**Executor:** Sonnet session, this repo (`05_Product/caseload-select-app`), which is the real git checkout
**Approved by:** Adriano (sizing conversation, 2026-08-01)
**Estimated:** Half a day including verification. ~150-250 lines new code, 2 lines changed in nav.

---

## What and why

Checklist lead-magnet downloads are captured end to end (consent row in Supabase, tagged contact in GHL) but are invisible in the operator console. Nothing in the app reads `marketing_lead_consent_log`; the only writer is `src/app/api/marketing-lead-intake/route.ts`. The nav item "All leads (every firm)" actually links to the screened-leads triage queue, which is a different population, so the label over-promises.

Build three things, nothing else:

1. A read-only operator page at `/admin/marketing-leads` listing marketing leads across firms.
2. A per-row deep link into the GHL contact timeline, where nurture journey progression actually lives.
3. A nav fix: rename the mislabeled entry and add one for the new page.

Explicitly rejected scope (do not add): export, band-style filters, row actions, open-rate columns, any GHL API integration, any schema change, any write path. The one legal mutation on this table belongs to the intake route (ghl_contact_id backfill) and stays there.

---

## Verified facts (do not re-derive; trust these)

**Table `marketing_lead_consent_log`** (Supabase project `ssxryjxifwiivghglqer`, caseload-select-ca). Columns, verified via information_schema 2026-08-01:

| column | type |
|---|---|
| id | uuid |
| firm_id | uuid |
| email | text |
| ghl_contact_id | text, null until backfilled; stays null when GHL capture fails |
| source | text, e.g. `checklist_lead_magnet_form` |
| asset | text, checklist slug, e.g. `business-sale-commercial-lease-checklist` |
| locale | text, `en` or `pt` |
| consent_text_version | text, e.g. `checklist-consent-2026-07-27-v4` |
| basis_evidence | jsonb |
| ip_address | text |
| user_agent | text |
| captured_at | timestamptz |
| created_at | timestamptz |

**Live rows:** exactly 2 as of 2026-08-01, both operator tests. `adrianosdomingues@live.com` (asset business-sale-commercial-lease-checklist, ghl_contact_id `c5W3Wt2zk07CGaBhWpS5`) and `adrianosortudo+drgtest5@gmail.com` (founder-vesting-checklist). Use these as the verification fixtures; do not create new rows.

**Firm join:** `intake_firms.ghl_location_id` (text) exists and is read by the intake route. DRG's value is `KwpSaMUehIN25dMG4WZB`.

**Deep link format,** verified against the live GHL UI 2026-08-01:
`https://app.gohighlevel.com/v2/location/{ghl_location_id}/contacts/detail/{ghl_contact_id}`

**Auth:** pages under `/admin` render behind `getOperatorSession()` enforced in the parent layout. A new page under `src/app/admin/` inherits it. Confirm the layout gate exists on your branch before assuming (see STOP gate 1).

**Data access pattern:** `import { supabaseAdmin as supabase } from "@/lib/supabase-admin";` then direct PostgREST queries in a server component. Reference implementation: `src/app/admin/triage/page.tsx` (523 lines; copy its conventions, not its complexity). Note `export const dynamic = "force-dynamic"` and `export const revalidate = 0` there.

**Nav:** `src/components/admin/FirmSwitcher.tsx`, `SYSTEM_LINKS` array (around line 87). Current first entry: `{ label: "All leads (every firm)", href: "/admin/triage" }`.

**FK caveat:** triage uses an embedded select `intake_firms!inner(...)`, which proves an FK from `screened_leads` to `intake_firms`. Whether `marketing_lead_consent_log.firm_id` carries an FK is UNVERIFIED. See STOP gate 2.

---

## Steps

### 1. Absorb the pattern
Read `src/app/admin/triage/page.tsx` top to bottom once. You are copying: the supabase-admin import, the server-component shape, force-dynamic, the error-state rendering, the table styling classes, and the timestamp formatting convention used in the console. You are NOT copying: band filters, tabs, counts, refresh, row actions, bulk controls.

**STOP gate 1:** confirm `src/app/admin/layout.tsx` (or the effective parent layout) calls `getOperatorSession()` and gates rendering. If it does not, replicate triage's exact auth mechanism on the new page before anything else. Do not ship an unauthenticated page under any circumstances.

### 2. Build the page
Create `src/app/admin/marketing-leads/page.tsx`. Server component, no client components unless the existing table styling demands one (it should not).

Query: select all columns listed above except `basis_evidence`, `ip_address`, `user_agent` (privacy minimalism; they exist for audits, not for a list view), order `captured_at` desc, limit 200.

**STOP gate 2, firm join:** first try the embedded select `intake_firms(id, name, ghl_location_id)` in the same query. If PostgREST returns a relationship error (no FK), fall back to two queries: fetch consent rows, then `intake_firms` rows for the distinct firm_ids, and join in memory. Either path is acceptable; do not add an FK migration to make the embedded select work. No schema changes in this build.

Columns, in order: Captured (formatted like the console's other timestamps), Email, Firm (name), Asset (the slug; render as-is, no prettification), Locale (badge, `en` / `pt`), Consent version, GHL (see below).

GHL column behaviour:
- `ghl_contact_id` present AND firm has `ghl_location_id`: render "Open in GHL" as an external link (`target="_blank" rel="noopener noreferrer"`) to the deep-link URL above.
- `ghl_contact_id` null: render a visible "Not in GHL" badge, styled like the console's warning states. This is deliberate; a linkless row is the surface for capture failures that previously only appeared in an operator email of uncertain deliverability.

Empty state: a plain sentence, e.g. "No marketing leads captured yet." No illustration, no CTA.

Page heading: "Marketing leads". Sub-line: "Checklist and lead-magnet captures across every firm. Rows link to the contact's journey in GHL." Follow console copy rules: no em dashes anywhere, sentence case, no orphan last words in visible copy.

### 3. Fix the nav
In `SYSTEM_LINKS` in `src/components/admin/FirmSwitcher.tsx`:
- Rename `"All leads (every firm)"` to `"Screened leads (every firm)"` (href unchanged).
- Add `{ label: "Marketing leads (every firm)", href: "/admin/marketing-leads" }` directly after it.

Check whether any test snapshots or other components assert the old label string (`grep -r "All leads" src tests`) and update them.

### 4. Verify
- `npm run lint` and `npm run typecheck` clean.
- Run the app locally, sign in as operator, load `/admin/marketing-leads`.
- Expect exactly the 2 fixture rows. Confirm the live.com row's link opens GHL contact `c5W3Wt2zk07CGaBhWpS5` in the DRG location.
- Confirm `/admin/triage` still renders and the nav shows both renamed and new entries.
- Run the existing test suite; nothing should regress since nothing existing was modified except the nav labels.

### 5. Commit, do not push
Single conventional commit, e.g. `feat(admin): marketing leads view with GHL deep links; rename screened-leads nav entry`. Adriano pushes and deploys through the existing Vercel pipeline. Per repo discipline the push is not yours. Do not run `vercel` or any deploy command, and work only in this checkout (other copies of app code exist on disk that are not git repos; building anywhere else risks a stray deploy).

---

## Acceptance criteria

- [ ] `/admin/marketing-leads` renders behind operator auth with the 2 fixture rows
- [ ] Deep link verified against the live GHL contact
- [ ] Null `ghl_contact_id` renders as a visible non-linked state (constructible in a local test render; there is no live null row today)
- [ ] Nav renamed and extended; no other component or test still asserts the old label
- [ ] Zero migrations, zero new dependencies, zero writes to `marketing_lead_consent_log`, intake route untouched
- [ ] Lint, typecheck, tests clean; one commit; no push

## Followups

| Date | Source | Flag | Priority | Touches | Suggested next action | Owner | Status |
|---|---|---|---|---|---|---|---|
| 2026-08-01 | BUILD_PLAN_marketing_leads_view_v1 | Plan authored and facts verified; awaiting execution | H | src/app/admin/marketing-leads/; src/components/admin/FirmSwitcher.tsx | Run this plan in a Sonnet session in this repo | Adriano | Open |
| 2026-08-01 | BUILD_PLAN_marketing_leads_view_v1 | Operator notification deliverability remains unresolved (Resend accepted tonight's send, nothing arrived; same symptom as the 20 May two-inbox probe). The view reduces dependence on that email but does not replace its alerting function | H | drg-law-website checklist-magnet route; Resend dashboard | Check Resend Emails log for the 02:34 UTC send; identify test-key vs suppression vs spam | Adriano | Open |
