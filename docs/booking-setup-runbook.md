# Booking Setup Runbook (Cal.com, WP-6)

Cal.com decision locked 2026-06-25 (CaseLoad_CRM_Migration_Plan_v1.md §10): SaaS, not self-host.

## Operator steps (per firm)

1. Create (or reuse) a Cal.com account for the firm at cal.com.
2. Set up the firm's availability and event type (e.g. "Consultation, 30 min").
3. Copy the public booking URL (e.g. `https://cal.com/drg-law/consult`).
4. Set the firm's `booking_config` via Supabase:

   ```sql
   UPDATE intake_firms
   SET booking_config = jsonb_build_object('provider', 'cal_com', 'url', 'https://cal.com/FIRM/consult')
   WHERE id = '<firm-uuid>';
   ```

5. Verify at `https://app.caseloadselect.ca/book/<firm-uuid>`.

## What this is not

- Not the intake CTA. The Screen widget is the contact path (per the app CLAUDE.md doctrine); this is a secondary, post-intake booking option, same posture as DRG's existing `/book` page.
- Not self-hosted. No Cal.com self-host instance is planned; SaaS only.
- Not wired to any automated flow yet. Nothing links to `/book/[firmId]` automatically; the operator adds the link where it makes sense per firm (portal, matter messages, etc.) once configured.
