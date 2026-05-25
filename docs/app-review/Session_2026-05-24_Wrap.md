# Session wrap — 2026-05-24 (Sunday night, ~8.5 hours)

Operator: Adriano · Goal: get Meta App Review submitted with working test assets and screencasts.

## What shipped tonight (in production)

| # | Item | Detail |
|---|---|---|
| 1 | **Meta Business Verification submitted** | CRA Profile PDF with operating name "CaseLoad Select" + phone 647-549-2106 on Page 1. Meta status: **In review** (expect verdict Tue 2026-05-26 or Wed 2026-05-27). |
| 2 | **Permanent FB Page Access Token live** | Long-lived user token → `/me/accounts` exchange → permanent Page token for DRG Law Test (Page ID 1179834051874177). Stored in `intake_firms.facebook_page_access_token`. `expires_at: 0` (never expires). Messenger + Instagram Send APIs now operational. |
| 3 | **Contact extraction** | New `src/lib/contact-extraction.ts`. Regex extracts `client_name` / `client_email` / `client_phone` from bare-reply turns. Closes the multi-turn loop hole where the bot asked for contact and the lead replied with bare info but engine had no extraction path. Commit `e6c2f01`. 20 tests. |
| 4 | **Numeric option mapping** | New `src/lib/numeric-option-mapping.ts`. When the bot asks "1. X / 2. Y / 3. Z" and lead replies "2", maps digit → option value and routes through engine's canonical `applyAnswer` (NOT direct slot write). That gets reroute side effects (corporate_general → shareholder_dispute), questionHistory updates, completeness/band recompute — same effect as web-widget chip click. Commit `33f16c2`. 13 tests. |
| 5 | **Matter type reroute on LLM fill** | Explicit `rerouteFromCorporateGeneral` / `rerouteFromRealEstateGeneral` call in `channel-intake-processor` after LLM merge. Covers the case where Gemini (not the numeric mapper) fills the routing slot. Will become redundant when Task #99 lands (teach `mergeLlmResults` to side-effect). Commit `33f16c2`. |
| 6 | **Discovery cap 3 → 12** | `DISCOVERY_FOLLOW_UP_CAP = 12` in `channel-intake-processor.ts`. Lets Phase C walk slot depth closer to the web widget. Commit `33f16c2`. |

**Result demonstrated in DB:** lead `L-2026-05-25-77P` landed as Band A, matter_type=shareholder_dispute, 15 slots filled, real fee estimate ("$3,000–$10,000+ depending on urgency and dispute complexity"), proper matter pack content. Same engine as the sandbox web widget — proved by the brief content matching the `shareholder_dispute` matter pack in `report.ts`.

## What's NOT shipped (queued for tomorrow)

Quality gaps that surfaced under real end-to-end testing tonight. None block App Review approval, but each is a real product gap.

### Priority 1 — blocks recording (do these first tomorrow)

| Task | What | Scope | Sandbox sync? |
|---|---|---|---|
| #99 | Teach `mergeLlmResults` to apply reroute side effects when LLM fills routing slots | Engine fix (`src/lib/screen-engine/extractor.ts`) — small | YES |
| #100 | Inject `__matter_type` classifier for routing catch-alls (`corporate_general`, `real_estate_general`), not just `unknown` | Engine fix (`src/lib/screen-engine/llm/schema.ts`) — small | YES |
| #101 | Free-text fuzzy match for "dont know"/"yes"/"no" replies (adapter — same family as numeric mapping) | Adapter helper, server-only | No |
| #102 | Slot priority audit — drop invasive questions on Meta channels (ownership_percentage at minimum) | Slot registry edit + possible new applies_to filter | YES if slotRegistry changes |

After Priority 1: smoke test Messenger end-to-end. Expected outcome — bot infers `corporate_problem_type` from turn 1 ("business partner dispute about buyout") via the classifier injection, skips the redundant routing question, asks 4-6 relevant discovery slots (not ownership %), accepts "dont know" gracefully, lead lands with rich Band A brief matching web widget depth.

### Priority 2 — good-to-have before clicking Submit

| Task | What |
|---|---|
| #89 | Mint System User Access Token for WhatsApp Cloud API (permanent — current is dev 24h token) |
| #91 | Purge May 15-24 unconfirmed_inquiries pileup for DRG (cosmetic — keep production queue clean) |
| #93 | Update screencasts/README test message to be DRG-appropriate (was study-permit, doesn't match DRG's 4 LSO areas) |

### Priority 3 — post-launch refinements

| Task | What |
|---|---|
| #90 | Add token-expiry monitoring to intake_firms (cron warn 14 days before expiry — prevents what happened tonight) |
| #92 | OOS infinite-loop bug (when matter classifies out_of_scope, LLM skipped, contact extraction can fail) |
| #94 | Contact slots applies_to gap (slot definitions only list Corporate matter types — fix is to make universal) |
| #96 | LLM should infer corporate_problem_type from turn 1 (partially addressed by #100, may need further prompt tuning) |

## Then record + submit

1. Record 4 screencast MP4s (Tasks #81-#84) per `docs/app-review/screencasts/README.md` — Messenger, Instagram, WhatsApp, Business Manager config
2. Upload MP4s to App Review permission slots (Task #85)
3. Verify Meta Business Verification has flipped green (Task #80 — should be by Tue/Wed)
4. Click **Submit for review** on tab `1089981770`
5. Purge 3 Sarah Patel test leads (Task #86)

## Critical context for tomorrow's session

- **Operator inbox is `adriano@caseloadselect.ca` only** — never substitute personal gmail (DR-047)
- **DRG firm ID:** `eec1d25e-a047-4827-8e4a-6eb96becca2b` (the production row — there is no separate test firm row; one was created and deleted as redundant 2026-05-23)
- **DRG's 4 LSO practice areas:** Real Estate, Corporate & Commercial, Wills & Estates, Employment Law (NOT immigration — the screencasts README uses a study permit scenario which is OOS for DRG)
- **DRG Page Access Token:** PERMANENT (`expires_at: 0`), no rotation needed until manually invalidated
- **WhatsApp token:** still 24h dev token, needs System User token before WhatsApp Send actually works (#89)
- **Engine ≡ same code on web and Meta** — `src/lib/screen-engine/*` is byte-for-byte mirrored to sandbox (DR-033). Depth differences are 100% about how slots get filled (web = chip UI, Meta = text-extraction + Phase C questions)

## Working Chrome tabs (still alive in operator's browser)

- `1089981770` — Meta App Review submission (https://developers.facebook.com/apps/1007304805285554/app-review/submissions/?submission_id=1016624077686960)
- `1089981777` — Meta Business Suite Security Centre (verification panel, status="In review")
- Messenger conversation with DRG Law Test in operator's personal FB account (history of tonight's smoke tests visible)
- Triage portal at `https://app.caseloadselect.ca/portal/eec1d25e-a047-4827-8e4a-6eb96becca2b/triage` (operator session active)

## Commits landed tonight

```
e6c2f01  fix(channel-intake): extract contact from multi-turn reply text
a69fa7c  fix(channel-intake): map bare-digit replies to numbered single_select options
33f16c2  fix(channel-intake): route Meta digit replies through engine's applyAnswer + reroute corporate_general on LLM-fill
```

All three deployed to Vercel production. Lib test suite at 1837/1837 pass.

## Cleanup not done

- Channel intake sessions from tonight's testing remain in DB (finalized but not deleted). They're benign — won't reprocess or notify.
- Sarah Patel test leads (multiple) remain in DRG triage queue with Band A. Task #86 covers purging them post-recording.
