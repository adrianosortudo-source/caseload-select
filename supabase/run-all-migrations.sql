-- ==============================================================
-- CaseLoad Select — Consolidated Migrations
-- Generated: 2026-04-26T00:46:29Z
-- Run in: Supabase Dashboard → SQL Editor
-- URL: https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql/new
-- All statements are idempotent. Safe to re-run.
-- ==============================================================

-- ==============================================================
-- FILE: 20260414_portal_clio.sql
-- ==============================================================
-- Migration: Add clio_config column to intake_firms (S8)
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql

-- Stores Clio OAuth tokens per firm.
-- Schema: { access_token, refresh_token, expires_at (ms timestamp) }
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS clio_config JSONB DEFAULT NULL;


-- ==============================================================
-- FILE: 20260414_custom_domain.sql
-- ==============================================================
-- Migration: Add custom_domain column to intake_firms (S9)
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;

-- Index for middleware lookup (hostname → firm_id)
CREATE INDEX IF NOT EXISTS idx_intake_firms_custom_domain ON intake_firms (custom_domain);


-- ==============================================================
-- FILE: 20260414_intake_firms_location.sql
-- ==============================================================
-- Migration: Add location column to intake_firms
-- Used by retainer.ts to populate firm_location on the retainer agreement PDF.
-- Fallback in code: "Toronto, ON"

ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS location text;


-- ==============================================================
-- FILE: 20260414_journey_sequences.sql
-- ==============================================================
-- Migration: Seed sequence templates for J5A, J5B, J6 (S6 Part 2)
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql
--
-- No schema changes required. This seeds data into existing tables.
-- Customize subject/body copy before running in production.

-- ── J5A: Spoke, No Book ──────────────────────────────────────────────────────

INSERT INTO sequence_templates (name, trigger_event, description, is_active)
VALUES (
  'J5A — Spoke, No Book',
  'spoke_no_book',
  'Lead was contacted but did not book a consultation. 4 touches over 14 days.',
  true
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE tmpl_id uuid;
BEGIN
  SELECT id INTO tmpl_id FROM sequence_templates WHERE trigger_event = 'spoke_no_book' LIMIT 1;
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active) VALUES
    (tmpl_id, 1, 0,   '{"email":{"subject":"Still thinking it over, {name}?","body":"Hi {name},\n\nJust following up on our recent conversation about your {case_type} matter.\n\nI know these decisions take time. If you have any questions or want to talk through next steps, I am available this week.\n\nWhen would be a good time to connect?","active":true}}'::jsonb, true),
    (tmpl_id, 2, 48,  '{"email":{"subject":"Quick question about your {case_type} situation","body":"Hi {name},\n\nI wanted to reach out one more time. Many people in your situation have similar questions before moving forward, and I find a short conversation usually clears things up.\n\nWould a 15-minute call work for you this week?","active":true}}'::jsonb, true),
    (tmpl_id, 3, 120, '{"email":{"subject":"One thing worth keeping in mind","body":"Hi {name},\n\nI do not want to pressure you, but I would be doing you a disservice if I did not mention that {case_type} matters often have strict time limits.\n\nIf you would like to discuss your options before any deadlines become a factor, I am here.\n\nNo obligation — just a conversation.","active":true}}'::jsonb, true),
    (tmpl_id, 4, 240, '{"email":{"subject":"Leaving the door open","body":"Hi {name},\n\nI realize life gets busy. I wanted you to know the door is open whenever you are ready to revisit your {case_type} matter.\n\nFeel free to reach out at any time. I wish you well.","active":true}}'::jsonb, true)
  ON CONFLICT DO NOTHING;
END $$;

-- ── J5B: Consulted, No Sign ──────────────────────────────────────────────────

INSERT INTO sequence_templates (name, trigger_event, description, is_active)
VALUES (
  'J5B — Consulted, No Sign',
  'consulted_no_sign',
  'Consultation held but lead has not retained. 5 touches over 21 days.',
  true
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE tmpl_id uuid;
BEGIN
  SELECT id INTO tmpl_id FROM sequence_templates WHERE trigger_event = 'consulted_no_sign' LIMIT 1;
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active) VALUES
    (tmpl_id, 1, 0,   '{"email":{"subject":"Following up on your consultation, {name}","body":"Hi {name},\n\nThank you for taking the time to meet. I hope I was able to give you some useful perspective on your {case_type} matter.\n\nIf you have questions after thinking it over, please do not hesitate to reach out. I am happy to clarify anything.","active":true}}'::jsonb, true),
    (tmpl_id, 2, 48,  '{"email":{"subject":"One thing I forgot to mention","body":"Hi {name},\n\nAfter our conversation I thought of something that might be relevant to your situation.\n\nWould you have 10 minutes for a quick follow-up call this week? I want to make sure you have the full picture before making a decision.","active":true}}'::jsonb, true),
    (tmpl_id, 3, 120, '{"email":{"subject":"Your situation and the clock","body":"Hi {name},\n\nI want to be straightforward with you: {case_type} matters have time limits, and waiting can limit your options.\n\nI am not trying to pressure you — but I would rather tell you now than have you miss a window later. If you have decided to move forward elsewhere, I completely understand. If not, let us talk.","active":true}}'::jsonb, true),
    (tmpl_id, 4, 216, '{"email":{"subject":"Decision point","body":"Hi {name},\n\nI want to respect your time, so I will be direct: are you still considering moving forward with your {case_type} matter?\n\nIf yes, I can have an agreement ready for you by end of week. If you have decided to wait or go another direction, just let me know and I will close your file.","active":true}}'::jsonb, true),
    (tmpl_id, 5, 360, '{"email":{"subject":"Whenever you are ready","body":"Hi {name},\n\nThis is my last follow-up. My offer stands — if your {case_type} situation changes and you want legal counsel, reach out at any time.\n\nWishing you the best.","active":true}}'::jsonb, true)
  ON CONFLICT DO NOTHING;
END $$;

-- ── J6: Retainer Awaiting Signature ──────────────────────────────────────────

INSERT INTO sequence_templates (name, trigger_event, description, is_active)
VALUES (
  'J6 — Retainer Awaiting Signature',
  'retainer_awaiting',
  'Proposal sent, retainer not yet signed. 4 touches over 10 days.',
  true
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE tmpl_id uuid;
BEGIN
  SELECT id INTO tmpl_id FROM sequence_templates WHERE trigger_event = 'retainer_awaiting' LIMIT 1;
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active) VALUES
    (tmpl_id, 1, 2,   '{"email":{"subject":"Your retainer agreement, {name}","body":"Hi {name},\n\nI have sent your retainer agreement for your {case_type} matter. Please review it at your convenience.\n\nIf you have any questions about the terms or the fee arrangement, I am happy to walk you through it. Just reply to this email or call the office.","active":true}}'::jsonb, true),
    (tmpl_id, 2, 24,  '{"email":{"subject":"Any questions about the agreement?","body":"Hi {name},\n\nJust checking in — did you have a chance to review the retainer agreement?\n\nIf anything is unclear or you would like to discuss the terms, I can make time for a quick call today or tomorrow.","active":true}}'::jsonb, true),
    (tmpl_id, 3, 72,  '{"email":{"subject":"Following up on your retainer","body":"Hi {name},\n\nI want to make sure the agreement did not get lost in your inbox. I have not received a signed copy yet.\n\nGiven the time-sensitive nature of your {case_type} matter, I want to make sure we get started as soon as possible. Can you sign and return it today?","active":true}}'::jsonb, true),
    (tmpl_id, 4, 168, '{"email":{"subject":"Last reminder — your retainer","body":"Hi {name},\n\nThis is my final follow-up on the retainer agreement. If I do not hear back, I will assume you have decided to go another direction and will close your file.\n\nIf you still want to proceed, please sign and return the agreement or call the office today.","active":true}}'::jsonb, true)
  ON CONFLICT DO NOTHING;
END $$;


-- ==============================================================
-- FILE: 20260414_conflict_check.sql
-- ==============================================================
-- Conflict Check System
-- Blocks consultation_scheduled stage move when a conflict of interest exists.
--
-- conflict_register: historical client/matter data (source of truth for checks)
-- conflict_checks:   per-lead check results with override support
--
-- Run this in the Supabase SQL Editor.

-- ── conflict_register ──────────────────────────────────────────────────────────
-- Stores known clients and opposing parties for each firm.
-- Populated three ways:
--   1. Automatically on client_won (source = 'caseload_select')
--   2. CSV import on onboarding (source = 'csv_import')
--   3. Future Clio sync (source = 'clio_sync')

CREATE TABLE IF NOT EXISTS conflict_register (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_firm_id     uuid REFERENCES law_firm_clients(id) ON DELETE CASCADE,
  client_name     text NOT NULL,
  opposing_party  text,
  matter_type     text,
  email           text,
  phone           text,
  source          text NOT NULL DEFAULT 'caseload_select',
  clio_matter_id  text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflict_register_firm
  ON conflict_register (law_firm_id);

CREATE INDEX IF NOT EXISTS idx_conflict_register_email
  ON conflict_register (law_firm_id, email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conflict_register_phone
  ON conflict_register (law_firm_id, phone)
  WHERE phone IS NOT NULL;

-- ── conflict_checks ────────────────────────────────────────────────────────────
-- One row per check run. A lead may have multiple rows (re-checks after override).
-- The latest row by checked_at is the authoritative result.

CREATE TABLE IF NOT EXISTS conflict_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE CASCADE,
  law_firm_id     uuid REFERENCES law_firm_clients(id) ON DELETE CASCADE,
  result          text NOT NULL CHECK (result IN ('clear', 'potential_conflict', 'confirmed_conflict')),
  matches         jsonb NOT NULL DEFAULT '[]',
  checked_via     text NOT NULL CHECK (checked_via IN ('clio', 'register', 'none')),
  checked_at      timestamptz DEFAULT now(),
  override_reason text,
  reviewed_by     text
);

CREATE INDEX IF NOT EXISTS idx_conflict_checks_lead
  ON conflict_checks (lead_id, checked_at DESC);


-- ==============================================================
-- FILE: 20260414_j2_consultation_reminders.sql
-- ==============================================================
-- J2 — Consultation Reminders
-- Triggered on consultation_scheduled stage change.
-- 3-touch sequence: confirmation → preparation → final reminder.
--
-- Delays are relative to when consultation_scheduled stage was set.
-- Without a consultation_at datetime on the lead, we fire on elapsed time
-- from stage entry. A firm with a predictable booking cycle (e.g. 3-5 day
-- lead time) should see Step 2 arrive ~24h before the consultation.
--
-- Step 1 (0h)  — Immediate confirmation
-- Step 2 (48h) — Preparation tips ("What to bring")
-- Step 3 (96h) — Final reminder ("Your consultation is coming up")
--
-- Exit: if lead moves away from consultation_scheduled (attended, no_show,
-- client_lost), the send-sequences processor skips remaining steps.
--
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  -- Insert template (idempotent)
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J2 — Consultation Reminders', 'consultation_scheduled', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 'consultation_scheduled'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J2 sequence template';
  END IF;

  -- Step 1: Immediate confirmation (0h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 0,
    '{
      "email": {
        "active": true,
        "subject": "Your consultation is confirmed — {firm_name}",
        "body": "Hi {name},\n\nYour consultation with {firm_name} is confirmed. We are looking forward to meeting with you.\n\nPlease keep this email for your records. If you need to reschedule or have any questions before your appointment, reply to this email.\n\nSee you soon,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: Preparation tips (48h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 48,
    '{
      "email": {
        "active": true,
        "subject": "Preparing for your consultation — {firm_name}",
        "body": "Hi {name},\n\nYour consultation is coming up. Here is how to make the most of your time with us:\n\n— Bring any documents related to your {case_type} matter (contracts, correspondence, photos, or records)\n— Write down your key questions in advance\n— Be ready to give a clear timeline of events\n\nThe more context you can provide, the better we can assess your situation and advise you on next steps.\n\nSee you soon,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 3: Final reminder (96h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 3, 96,
    '{
      "email": {
        "active": true,
        "subject": "Reminder: your upcoming consultation — {firm_name}",
        "body": "Hi {name},\n\nThis is a reminder that your consultation with {firm_name} is coming up soon.\n\nIf anything has changed or you need to reschedule, please reply to this email as soon as possible so we can accommodate you.\n\nWe look forward to speaking with you.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;


-- ==============================================================
-- FILE: 20260414_j7_welcome_onboarding.sql
-- ==============================================================
-- Migration: Seed sequence template for J7 — Welcome/Onboarding (S7)
-- Trigger: client_won
-- Touches: 4-touch over 7 days
-- Purpose: Welcome new client, confirm retainer received, set expectations, first check-in
--
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qpzopweonveumvuqkqgw/sql

INSERT INTO sequence_templates (name, trigger_event, description, is_active)
VALUES (
  'J7 — Welcome / Onboarding',
  'client_won',
  'New client confirmed. 4 touches over 7 days: welcome, document checklist, how we work, first check-in.',
  true
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE tmpl_id uuid;
BEGIN
  SELECT id INTO tmpl_id FROM sequence_templates WHERE trigger_event = 'client_won' LIMIT 1;

  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active) VALUES

    -- Step 1 (0h): Welcome — confirm retainer, next steps
    (tmpl_id, 1, 0,
     '{"email":{"subject":"Welcome — you are now a client, {name}","body":"Hi {name},\n\nWelcome. I am glad we are moving forward on your {case_type} matter.\n\nYour signed retainer has been received and your file is now open. Here is what happens next:\n\n1. I will review your file and contact you within 2 business days to confirm the strategy and any immediate deadlines.\n2. If anything urgent comes up before then, call the office directly.\n3. All correspondence will come from this email address — please add it to your contacts.\n\nThank you for trusting me with this. I take that seriously.\n\nThis is general information, not legal advice.","active":true}}'::jsonb,
     true),

    -- Step 2 (24h): Document checklist — what to start gathering
    (tmpl_id, 2, 24,
     '{"email":{"subject":"One thing to do today — your documents","body":"Hi {name},\n\nNow that your file is open, the fastest way to move your {case_type} matter forward is to have your documents organized early.\n\nStart gathering:\n\n- Any written agreements, contracts, or correspondence related to the matter\n- Dates and timelines you can recall (even rough notes help)\n- Names and contact information of anyone involved\n- Any photographs, records, or receipts relevant to your situation\n\nYou do not need everything at once. Bring what you have to our first working meeting and we will fill in the gaps together.\n\nThis is general information, not legal advice.","active":true}}'::jsonb,
     true),

    -- Step 3 (72h): How we work — communication expectations
    (tmpl_id, 3, 72,
     '{"email":{"subject":"How I work — a quick note on communication","body":"Hi {name},\n\nI want to set clear expectations so there are no surprises.\n\nHow I communicate:\n- I respond to emails and calls within 1 business day.\n- I will send you updates when something material changes in your file — not just to check in.\n- If a deadline is approaching, I will flag it early so you have time to respond.\n\nWhat I need from you:\n- Respond promptly when I reach out, especially if documents or decisions are time-sensitive.\n- Let me know if your contact information changes.\n- Tell me immediately if you receive any new correspondence related to this matter.\n\nWe are a team on this. The more information you share, the better I can represent you.\n\nThis is general information, not legal advice.","active":true}}'::jsonb,
     true),

    -- Step 4 (168h / 7 days): First check-in
    (tmpl_id, 4, 168,
     '{"email":{"subject":"One week in — any questions?","body":"Hi {name},\n\nA week has passed since we opened your file. I wanted to check in and make sure you have everything you need at this stage.\n\nIf you have gathered any documents or thought of details you want to share, feel free to reply directly to this email or call the office.\n\nIf you have questions about the process or what to expect next, I am happy to answer them.\n\nThis is general information, not legal advice.","active":true}}'::jsonb,
     true)

  ON CONFLICT DO NOTHING;
END $$;


-- ==============================================================
-- FILE: 20260414_j8_matter_active.sql
-- ==============================================================
-- J8 — Active Matter Update (3-touch, 8 weeks)
-- Triggered on client_won stage change.
-- Sends check-in touchpoints while the matter is active.
-- Reinforces the firm's presence, invites questions, builds referral intent.
--
-- Step 1 (336h  = 14 days) — 2-week check-in
-- Step 2 (672h  = 28 days) — 4-week update
-- Step 3 (1344h = 56 days) — 8-week mid-matter touchpoint
--
-- Exit: none — no "matter closed" stage exists in current pipeline.
-- Steps fire on schedule unless manually cancelled via the sequence editor.
--
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J8 — Active Matter Update', 'matter_active', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 'matter_active'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J8 sequence template';
  END IF;

  -- Step 1: 2-week check-in (336h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 336,
    '{
      "email": {
        "active": true,
        "subject": "Two weeks in — checking in on your {case_type} matter",
        "body": "Hi {name},\n\nIt has been about two weeks since we started working together on your {case_type} matter. I wanted to check in and make sure everything is on track from your end.\n\nIf you have questions, new information, or anything you want to flag, now is a good time to do it. Early communication avoids delays later.\n\nReply to this email or call us directly.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: 4-week update (672h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 672,
    '{
      "email": {
        "active": true,
        "subject": "One month in — your {case_type} matter update",
        "body": "Hi {name},\n\nWe are now about a month into your {case_type} matter. Legal processes often move slower than clients expect, and that is completely normal.\n\nA few things to keep in mind:\n\n— Respond promptly to any requests for documents or information\n— Keep a record of any developments on your end that might be relevant\n— Do not discuss your matter on social media or with opposing parties\n\nIf anything has changed or you have questions, do not hesitate to reach out. We are here.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 3: 8-week mid-matter touchpoint (1344h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 3, 1344,
    '{
      "email": {
        "active": true,
        "subject": "Checking in at the two-month mark",
        "body": "Hi {name},\n\nTwo months in. I want to make sure you feel informed and supported throughout this process.\n\nIf you have not heard from us recently, it does not mean nothing is happening — it often means we are waiting on the other side, a court date, or a filing window.\n\nIf you have concerns about timelines or next steps, please reach out directly. Transparency is important to us.\n\nAnd if you know anyone else who needs legal help with a {case_type} matter, we would be glad to speak with them.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;


-- ==============================================================
-- FILE: 20260414_j9_review_request.sql
-- ==============================================================
-- J9 — Google Review Request (3-touch)
-- Triggered on client_won stage change.
--
-- The firm's Google review link is stored in intake_firms.branding.google_review_url
-- or law_firm_clients.google_review_url. For now, emails include a placeholder
-- that Adriano personalises per firm in the sequence_steps channels JSONB.
--
-- Step 1 (0h)   — Immediate ask: "How was your experience?"
-- Step 2 (72h)  — 3-day follow-up: "Still worth 2 minutes" (if no review yet)
-- Step 3 (168h) — 7-day final: "Last ask" — gentle close
--
-- Google Review status cannot be auto-detected. All 3 touches fire unless
-- Adriano marks the review_requests row as 'completed' (manual). Future
-- enhancement: GBP webhook for auto-exit.
--
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J9 — Google Review Request', 'review_request', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 'review_request'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J9 sequence template';
  END IF;

  -- Step 1: Immediate ask (0h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 0,
    '{
      "email": {
        "active": true,
        "subject": "A quick favour — how was your experience with {firm_name}?",
        "body": "Hi {name},\n\nIt has been great working with you on your {case_type} matter.\n\nIf you are happy with how things went, we would really appreciate a Google review. It takes about 2 minutes and helps other people in similar situations find trusted legal help.\n\n[Leave a Google Review → https://g.page/r/review]\n\nThank you,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: 3-day follow-up (72h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 72,
    '{
      "email": {
        "active": true,
        "subject": "Still worth 2 minutes — {firm_name}",
        "body": "Hi {name},\n\nI wanted to follow up on the review request I sent a few days ago.\n\nIf you had a positive experience with {firm_name}, a short Google review makes a real difference for people searching for legal help online. You do not need to write much — even a sentence or two is helpful.\n\n[Leave a Google Review → https://g.page/r/review]\n\nThanks for your time,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 3: 7-day final ask (168h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 3, 168,
    '{
      "email": {
        "active": true,
        "subject": "Last ask — your review means a lot",
        "body": "Hi {name},\n\nThis is the last time I will ask. If you are willing to share your experience with {firm_name} on Google, here is the link:\n\n[Leave a Google Review → https://g.page/r/review]\n\nIf now is not a good time, no worries at all. We appreciate your business and wish you well with your {case_type} matter.\n\nThank you,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;


-- ==============================================================
-- FILE: 20260414_j10_re_engagement.sql
-- ==============================================================
-- J10 — Referral / Re-Engagement (2-touch)
-- Triggered on client_lost stage change.
-- Reconnects with lost leads at 90 days and 180 days.
--
-- Purpose: circumstances change. A lead that couldn't retain 3 months ago
-- may be ready now. The touch is low-pressure, no hard sell, and doubles
-- as a referral prompt ("know anyone who needs legal help?").
--
-- Step 1 (2160h = 90 days)  — "Checking back in"
-- Step 2 (4320h = 180 days) — "Still here if you need us"
--
-- Exit: none — both touches always fire unless sequence is manually cancelled.
-- Band E leads (filtered) are still included; circumstances may have improved.
--
-- Run in Supabase SQL Editor.

DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J10 — Re-Engagement', 're_engagement', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 're_engagement'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J10 sequence template';
  END IF;

  -- Step 1: 90-day check-in (2160h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 2160,
    '{
      "email": {
        "active": true,
        "subject": "Checking back in — {firm_name}",
        "body": "Hi {name},\n\nIt has been a few months since we last spoke about your {case_type} matter. I wanted to check in and see how things are going.\n\nIf your situation has changed and you are looking for legal help again, we are here. No pressure — just letting you know the door is open.\n\nAnd if you know anyone dealing with a similar situation, we would be happy to have a conversation.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: 180-day final touch (4320h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 4320,
    '{
      "email": {
        "active": true,
        "subject": "Still here if you need us — {firm_name}",
        "body": "Hi {name},\n\nSix months ago we had a conversation about your {case_type} matter. I just wanted to send one last note to let you know we are still here.\n\nLegal situations evolve. If anything has changed or you have new questions, reach out anytime.\n\nWishing you well,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;


-- ==============================================================
-- FILE: 20260414_j11_j12_relationship_nurture.sql
-- ==============================================================
-- J11 — Relationship / Milestone (2-touch: 6mo + 12mo after client_won)
-- J12 — Long-Term Nurture (2-touch: 18mo + 24mo after client_won)
--
-- J11 Purpose: maintain the relationship after the matter closes. Check in,
-- acknowledge the milestone, prime for referrals.
--
-- J12 Purpose: annual compounding for the Authority pillar. A client from 18
-- months ago who hears from the firm is far more likely to refer than one
-- who fell off the radar. Low-frequency, high-value.
--
-- Both sequences are triggered on client_won. They run on a long schedule
-- and are invisible during the active matter phase (J8 covers that window).
--
-- J11:
--   Step 1 (4320h  = 180 days / ~6 months)  — "Six-month check-in"
--   Step 2 (8760h  = 365 days / ~12 months) — "One year on"
--
-- J12:
--   Step 1 (13140h = 547 days / ~18 months) — "Checking in — 18 months later"
--   Step 2 (17520h = 730 days / ~24 months) — "Two years on — still here"
--
-- Run in Supabase SQL Editor.

-- ── J11 ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J11 — Relationship / Milestone', 'relationship_milestone', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 'relationship_milestone'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J11 sequence template';
  END IF;

  -- Step 1: 6-month milestone (4320h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 4320,
    '{
      "email": {
        "active": true,
        "subject": "Six months on — {firm_name}",
        "body": "Hi {name},\n\nIt has been about six months since we worked together on your {case_type} matter. I hope things have settled well for you.\n\nIf you ever need legal advice again — whether for the same matter or something new — we would be glad to help.\n\nAnd if anyone in your network is dealing with a legal situation, please feel free to pass along our name. Referrals are the highest form of trust we receive.\n\nBest,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: 12-month anniversary (8760h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 8760,
    '{
      "email": {
        "active": true,
        "subject": "One year since we worked together — {firm_name}",
        "body": "Hi {name},\n\nA year ago we helped you with your {case_type} matter. I hope the outcome has served you well.\n\nWe continue to help people in the Toronto area with similar situations. If you or someone you know needs legal support, we are here.\n\nWishing you a good year ahead,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;

-- ── J12 ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tmpl_id uuid;
BEGIN
  INSERT INTO sequence_templates (name, trigger_event, is_active)
  VALUES ('J12 — Long-Term Nurture', 'long_term_nurture', true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO tmpl_id
  FROM sequence_templates
  WHERE trigger_event = 'long_term_nurture'
  LIMIT 1;

  IF tmpl_id IS NULL THEN
    RAISE EXCEPTION 'Failed to find or create J12 sequence template';
  END IF;

  -- Step 1: 18-month nurture (13140h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 1, 13140,
    '{
      "email": {
        "active": true,
        "subject": "Checking in — 18 months later",
        "body": "Hi {name},\n\nA year and a half since we last worked together. Time moves fast.\n\nI am reaching out because legal needs evolve with life — a new business, a family change, a property transaction. If anything has come up that you need advice on, or if someone close to you is facing a legal matter, please know we are still here.\n\nNo agenda, just keeping the line open.\n\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

  -- Step 2: 24-month final nurture (17520h)
  INSERT INTO sequence_steps (sequence_id, step_number, delay_hours, channels, is_active)
  VALUES (
    tmpl_id, 2, 17520,
    '{
      "email": {
        "active": true,
        "subject": "Two years on — {firm_name} is still here",
        "body": "Hi {name},\n\nTwo years ago we worked together on a {case_type} matter. I hope things have gone well since then.\n\nThis is a simple note to say that {firm_name} is still here, still helping people with legal matters in Toronto, and still grateful for the trust you placed in us.\n\nIf you ever need us again, or know someone who does, we would be glad to hear from you.\n\nAll the best,\n{firm_name}"
      }
    }'::jsonb,
    true
  )
  ON CONFLICT DO NOTHING;

END $$;


-- ==============================================================
-- FILE: 20260414_retainer_agreements.sql
-- ==============================================================
-- Retainer agreements — auto-generated on Band A/B OTP verification
-- DocuGenerate fills the PDF template; DocuSeal handles e-signature delivery.
-- Status lifecycle: generated → sent → viewed → signed | voided

create table if not exists retainer_agreements (
  id                         uuid primary key default gen_random_uuid(),
  session_id                 uuid,           -- intake_sessions.id
  firm_id                    uuid,           -- intake_firms.id

  -- Contact snapshot at generation time
  contact_name               text,
  contact_email              text,
  contact_phone              text,

  -- DocuGenerate output
  docugenerate_document_id   text,
  docugenerate_document_url  text,

  -- DocuSeal output
  docuseal_submission_id     text unique,
  docuseal_signing_url       text,

  -- Status
  status text not null default 'pending'
    check (status in ('pending', 'generated', 'sent', 'viewed', 'signed', 'voided')),

  -- Timestamps
  generated_at  timestamptz,
  sent_at       timestamptz,
  viewed_at     timestamptz,
  signed_at     timestamptz,
  voided_at     timestamptz,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists retainer_agreements_session_id_idx    on retainer_agreements(session_id);
create index if not exists retainer_agreements_firm_id_idx       on retainer_agreements(firm_id);
create index if not exists retainer_agreements_submission_id_idx on retainer_agreements(docuseal_submission_id);
create index if not exists retainer_agreements_status_idx        on retainer_agreements(status);


-- ==============================================================
-- FILE: 20260415_leads_intake_session_id.sql
-- ==============================================================
-- Add intake_session_id to leads for intake → pipeline bridge.
-- Allows idempotent lead promotion from CaseLoad Screen sessions.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS intake_session_id UUID REFERENCES intake_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_intake_session_id ON leads(intake_session_id);


-- ==============================================================
-- FILE: 20260415_dashboard_columns.sql
-- ==============================================================
-- ────────────────────────────────────────────────────────────────
-- 20260415_dashboard_columns.sql
-- Adds columns required by the 3-tier client dashboard (S8).
-- Idempotent — safe to run multiple times.
-- ────────────────────────────────────────────────────────────────

-- intake_firms: ad spend (manually populated by operator)
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS monthly_ad_spend DECIMAL DEFAULT NULL;

-- leads: response-time tracking
-- first_contact_at — set when stage transitions new_lead → contacted
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ DEFAULT NULL;

-- leads: stage-staleness tracking
-- stage_changed_at — updated on every stage transition
-- Backfill existing rows to updated_at as a reasonable proxy
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ DEFAULT NOW();

UPDATE leads
SET stage_changed_at = updated_at
WHERE stage_changed_at IS NULL OR stage_changed_at = NOW()
  AND updated_at IS NOT NULL;


-- ==============================================================
-- FILE: 20260415_dashboard_v2.sql
-- ==============================================================
-- Dashboard v2: hero metrics config, engagement start, industry benchmarks
-- Idempotent — all additions use IF NOT EXISTS / ON CONFLICT DO NOTHING

-- Hero metrics config on each firm
ALTER TABLE intake_firms
  ADD COLUMN IF NOT EXISTS hero_metrics        JSONB DEFAULT '["signed_cases","cpsc","avgResponseSecs"]',
  ADD COLUMN IF NOT EXISTS metric_definitions  JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS engagement_start_date DATE DEFAULT NULL;

-- Industry benchmarks reference table (Canadian solo/2-lawyer law firm averages)
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key       TEXT        NOT NULL UNIQUE,
  label            TEXT        NOT NULL,
  benchmark_value  NUMERIC     NOT NULL,
  unit             TEXT        NOT NULL DEFAULT 'number',
  direction        TEXT        NOT NULL DEFAULT 'higher_better',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO industry_benchmarks (metric_key, label, benchmark_value, unit, direction) VALUES
  ('inquiries',        'Monthly Inquiries',      40,     'number',   'higher_better'),
  ('qualified',        'Qualified Leads/Month',  14,     'number',   'higher_better'),
  ('signed',           'Signed Cases/Month',      4,     'number',   'higher_better'),
  ('cpsc',             'Cost per Signed Case',  2500,    'currency', 'lower_better'),
  ('avgResponseSecs',  'Median Response (sec)',    60,   'seconds',  'lower_better'),
  ('pipelineValue',    'Pipeline Value',         50000,  'currency', 'higher_better'),
  ('funnelConversion', 'Funnel Conversion %',      10,   'percent',  'higher_better')
ON CONFLICT (metric_key) DO NOTHING;


-- ==============================================================
-- FILE: 20260417_sub_type_conflicts.sql
-- ==============================================================
-- Sub-Type Conflict Log
-- Fire-and-forget table: populated when regex and GPT disagree on sub-type
-- classification. Rows are inserted with ON CONFLICT DO NOTHING and the insert
-- is deliberately never awaited in the application path. If the insert fails
-- (table absent, RLS, network), the session continues unaffected.
--
-- Purpose: surface systematic misclassifications so question sets can be tuned.
-- Query: SELECT practice_area, regex_result, gpt_result, COUNT(*) FROM
--        sub_type_conflicts GROUP BY 1,2,3 ORDER BY 4 DESC;

CREATE TABLE IF NOT EXISTS sub_type_conflicts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid REFERENCES intake_sessions(id) ON DELETE SET NULL,
  firm_id            uuid REFERENCES intake_firms(id)   ON DELETE SET NULL,
  practice_area      text NOT NULL,
  regex_result       text,           -- sub-type key returned by regex fast-path (null = no match)
  gpt_result         text NOT NULL,  -- sub-type key returned by GPT classification
  situation_hash     text,           -- SHA-256 hex of first 500 chars of situation text (PII-free)
  app_version        text,           -- git SHA or semver, populated by the app if available
  created_at         timestamptz DEFAULT now()
);

-- Index to support the per-firm and per-PA aggregation queries.
CREATE INDEX IF NOT EXISTS idx_sub_type_conflicts_pa
  ON sub_type_conflicts (practice_area, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sub_type_conflicts_firm
  ON sub_type_conflicts (firm_id, created_at DESC)
  WHERE firm_id IS NOT NULL;

-- RLS: service-role only. Conflict logs are internal telemetry, never client-facing.
ALTER TABLE sub_type_conflicts ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT policies for anon or authenticated roles.
-- All writes go through the service-role key on the API route.


-- ==============================================================
-- FILE: 20260417_round3_memo.sql
-- ==============================================================
-- S10: Round 3 post-capture deep qualification + Case Intake Memo
-- Adds round3 answer storage and memo generation columns to intake_sessions.

ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS round3_answers       jsonb,
  ADD COLUMN IF NOT EXISTS round3_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS round3_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS memo_text            text,
  ADD COLUMN IF NOT EXISTS memo_generated_at    timestamptz;

-- Index for portal queries: find sessions with memos ready for a firm
CREATE INDEX IF NOT EXISTS idx_intake_sessions_memo
  ON intake_sessions (firm_id, memo_generated_at)
  WHERE memo_generated_at IS NOT NULL;

-- Index for stalled-round3 cron: find sessions started but not completed
CREATE INDEX IF NOT EXISTS idx_intake_sessions_round3_stalled
  ON intake_sessions (round3_started_at)
  WHERE round3_started_at IS NOT NULL AND round3_completed_at IS NULL;


-- ==============================================================
-- FILE: 20260418_retainer_fks.sql
-- ==============================================================
-- retainer_agreements FK constraints
-- Adds foreign keys so Supabase auto-join works in the /retainers page
-- and so cascade-delete keeps the table clean.
--
-- Idempotent: uses DO $$ blocks with existence checks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'retainer_agreements_firm_id_fkey'
      AND table_name = 'retainer_agreements'
  ) THEN
    ALTER TABLE retainer_agreements
      ADD CONSTRAINT retainer_agreements_firm_id_fkey
      FOREIGN KEY (firm_id) REFERENCES intake_firms(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'retainer_agreements_session_id_fkey'
      AND table_name = 'retainer_agreements'
  ) THEN
    ALTER TABLE retainer_agreements
      ADD CONSTRAINT retainer_agreements_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES intake_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ==============================================================
-- FILE: 20260418_matter_routing.sql
-- ==============================================================
-- Matter Routing Config
-- Per-firm table mapping practice area sub-type → GHL pipeline/stage/staff.
-- Read exclusively server-side via supabaseAdmin (service-role). No anon exposure.
--
-- Usage (all server-side through supabaseAdmin):
--   src/lib/matter-routing.ts            - read during finalize
--   src/app/api/admin/routing/**         - admin CRUD
--
-- A missing row means fall through to the default band→stage mapping.
--
-- ghl_pipeline_id:      GHL pipeline UUID. null = use firm's default pipeline.
-- ghl_stage:            Override stage name. null = use standard band→stage mapping.
-- assigned_staff_id:    GHL user/staff UUID for auto-assignment. null = unassigned.
-- assigned_staff_email: Staff email for reference/notification. null = unassigned.

CREATE TABLE IF NOT EXISTS matter_routing (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              uuid NOT NULL REFERENCES intake_firms(id) ON DELETE CASCADE,
  sub_type             text NOT NULL,
  ghl_pipeline_id      text,
  ghl_stage            text,
  assigned_staff_id    text,
  assigned_staff_email text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (firm_id, sub_type)
);

CREATE INDEX IF NOT EXISTS idx_matter_routing_firm
  ON matter_routing (firm_id, sub_type);

-- Keep updated_at current on row updates. search_path locked to match the
-- hardening sweep pattern (function-level security).
CREATE OR REPLACE FUNCTION set_matter_routing_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matter_routing_updated_at ON matter_routing;
CREATE TRIGGER matter_routing_updated_at
  BEFORE UPDATE ON matter_routing
  FOR EACH ROW EXECUTE FUNCTION set_matter_routing_updated_at();

-- Hardening pattern: enable + force RLS, strip anon/authenticated/PUBLIC grants.
-- No policies needed - service-role bypasses RLS and is the only caller.
ALTER TABLE matter_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_routing FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE matter_routing FROM anon;
REVOKE ALL ON TABLE matter_routing FROM authenticated;
REVOKE ALL ON TABLE matter_routing FROM PUBLIC;

NOTIFY pgrst, 'reload schema';


-- ==============================================================
-- FILE: 20260418_storage_intake_attachments.sql
-- ==============================================================
-- intake-attachments Storage Bucket
-- Public-read bucket for Round 3 file uploads.
--
-- Security model:
--   Writes:          service-role only. Upload route (src/app/api/screen/upload/route.ts)
--                    uses supabaseAdmin; its server-side OTP check is the access gate.
--   Reads (SELECT):  public. Required so getPublicUrl() returns accessible URLs for
--                    intake attachments shared with operators.
--   Updates/deletes: service-role only (not exposed).
--
-- File-size and MIME limits are enforced both at the bucket (below) and in the
-- upload route (belt-and-braces).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-attachments',
  'intake-attachments',
  true,
  10485760,   -- 10 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public SELECT - required so getPublicUrl() returns accessible URLs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'intake_attachments_public_read'
  ) THEN
    CREATE POLICY "intake_attachments_public_read"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'intake-attachments');
  END IF;
END $$;

-- Drop the stale anon INSERT policy if a prior revision of this migration
-- ever created it in any environment. Writes go through service-role only -
-- anon has no legitimate write path to this bucket.
DROP POLICY IF EXISTS "intake_attachments_anon_insert" ON storage.objects;

NOTIFY pgrst, 'reload schema';


-- ==============================================================
-- FILE: 20260421_intake_sessions_practice_sub_type.sql
-- ==============================================================
-- intake_sessions.practice_sub_type
--
-- Adds the missing practice_sub_type column. The column is referenced
-- throughout the codebase (classifier, screen-prompt, slot-registry,
-- sub-type-detect, /api/screen route) and is documented in schema.sql
-- at line 229, but was never created by a migration.
--
-- Impact of the missing column: every write to intake_sessions that
-- includes practice_sub_type fails atomically with PGRST204, silently
-- dropping conversation, scoring, practice_area, and every other field
-- in the same UPDATE. This causes total session-state loss across turns
-- in widget / multi-turn flows: isFirstTurn is always true, situationText
-- collapses to the current-turn message, and every redundancy-trap filter
-- stops working after round 1.
--
-- Idempotent: uses IF NOT EXISTS so safe to re-run.

ALTER TABLE intake_sessions
  ADD COLUMN IF NOT EXISTS practice_sub_type text;

COMMENT ON COLUMN intake_sessions.practice_sub_type IS
  'Matched sub-type key (e.g. "pi_mva", "emp_dismissal"). Used by slot-registry, question-set routing, and final matter routing.';

-- Index for analytics / per-sub-type session queries.
CREATE INDEX IF NOT EXISTS idx_intake_sessions_sub_type
  ON intake_sessions (firm_id, practice_sub_type)
  WHERE practice_sub_type IS NOT NULL;


-- ==============================================================
-- FILE: 20260423_leads_cpi_explainability.sql
-- ==============================================================
-- CPI Explainability columns for leads (v2.2 scoring engine)
-- =============================================================================
-- computeScore() in src/lib/scoring.ts returns three fields that persist
-- the "why this band" rationale for each lead:
--   - confidence:     high | medium | low  - weighted data completeness
--   - explanation:    1-3 sentence plain-English summary
--   - missing_fields: string[] of human-readable labels
--
-- These columns are read by the incomplete-intake nudge cron
-- (src/lib/incomplete-intake.ts), the admin lead detail page
-- (src/app/leads/[id]/page.tsx), and the portal lead detail page
-- (src/app/portal/[firmId]/leads/[leadId]/page.tsx).
--
-- Code follow-up: src/app/api/otp/verify/route.ts currently writes cpi_score
-- and priority_index but not the explainability fields returned by
-- computeScore(). A subsequent code change wires the write-back; this
-- migration lands the columns so that change cannot fail on missing schema.
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cpi_confidence     text,
  ADD COLUMN IF NOT EXISTS cpi_explanation    text,
  ADD COLUMN IF NOT EXISTS cpi_missing_fields jsonb;

-- Enforce the confidence domain. Named constraint so a future rewrite can
-- ALTER/DROP it by name without a schema sniff. NULL allowed for historical
-- rows and for rows created before explainability is wired into the insert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_cpi_confidence_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_cpi_confidence_check
      CHECK (cpi_confidence IS NULL OR cpi_confidence IN ('high','medium','low'));
  END IF;
END $$;

-- The incomplete-intake cron filters on cpi_confidence='low' among recent
-- leads; a partial index keeps that scan tight even once the leads table grows.
CREATE INDEX IF NOT EXISTS idx_leads_cpi_confidence_recent
  ON leads (cpi_confidence, created_at DESC)
  WHERE cpi_confidence = 'low';

NOTIFY pgrst, 'reload schema';


-- ==============================================================
-- FILE: 20260423_leads_scoring_model.sql
-- ==============================================================
-- Scoring model + full component snapshot on leads
-- =============================================================================
-- leads currently has sub-score columns (geo_score, contactability_score,
-- legitimacy_score, complexity_score, urgency_score, strategic_score,
-- fee_score, fit_score, value_score) that were shaped for the v2.1 form
-- scoring engine in src/lib/scoring.ts (fit max 30, value max 65, 7 factors).
--
-- The CaseLoad Screen (GPT) path runs a different engine  -  CpiBreakdown in
-- src/lib/cpi-calculator.ts  -  with 8 factors (fit max 40, value max 60):
-- geo, practice, legitimacy, referral, urgency, complexity, multi_practice, fee.
-- Five factors overlap (geo, legitimacy, complexity, urgency, fee); three do
-- not (practice, referral, multi_practice) and have no leads columns.
--
-- Writing GPT's fit_score (0-40) into a column the admin UI labels "/30"
-- would show "35/30" for strong fits  -  visually broken. Keeping it all-null
-- would drop the full breakdown on the floor.
--
-- Solution:
--   - scoring_model flags which engine produced the row (v2.1_form | gpt_cpi_v1)
--   - score_components JSONB holds the full native breakdown from that engine
--   - The overlapping 5 sub-score columns still fill from GPT sessions so the
--     current admin score-bar UI renders something useful today without a UI
--     rewrite; fit_score / value_score stay null for GPT rows until the UI
--     becomes source-aware
--
-- Consumers (future):
--   - src/lib/score-components.ts (helper that reads scoring_model and builds
--     the right ScoreRationaleInput per source)
--   - src/app/leads/[id]/page.tsx (admin lead detail rewrite)
--   - src/app/portal/[firmId]/leads/[leadId]/page.tsx (portal lead detail)
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS scoring_model    text,
  ADD COLUMN IF NOT EXISTS score_components jsonb;

-- Domain guard. Named so a future engine swap can ALTER the constraint cleanly.
-- NULL allowed for historical rows and any third-party ingest paths that have
-- not been wired yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_scoring_model_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_scoring_model_check
      CHECK (scoring_model IS NULL OR scoring_model IN ('v2.1_form','gpt_cpi_v1'));
  END IF;
END $$;

-- Analytics often wants to slice by scoring source (e.g. conversion by engine).
-- Partial index to keep the scan cheap without an index on every null row.
CREATE INDEX IF NOT EXISTS idx_leads_scoring_model
  ON leads (scoring_model, created_at DESC)
  WHERE scoring_model IS NOT NULL;

NOTIFY pgrst, 'reload schema';


-- ==============================================================
-- FILE: 20260423_rls_hardening.sql
-- ==============================================================
-- =============================================================================
-- RLS Hardening — 20260423
-- =============================================================================
-- Phase 2 of the Supabase security fix. Phase 1 (commit 064831c) split the
-- Supabase clients so server code uses SUPABASE_SERVICE_ROLE_KEY and no
-- browser bundle ships a privileged client. This migration tightens the
-- database itself so that, even if the anon key leaks, a caller cannot
-- read or mutate privileged tables.
--
-- Security model established by this migration:
--   * service_role  — bypasses RLS (Postgres BYPASSRLS grant). Used by every
--                     server-side API route via supabaseAdmin. Full access.
--   * authenticated — not used by this app. Portal uses HMAC magic links,
--                     not Supabase Auth. No policies granted.
--   * anon          — used ONLY by the edge middleware (src/proxy.ts) for the
--                     custom-domain → firm lookup. Narrowly permitted to
--                     SELECT (id, custom_domain) on intake_firms where
--                     custom_domain IS NOT NULL. Nothing else.
--
-- Changes:
--   1. Enable (and FORCE) RLS on 4 tables created without it:
--      conflict_register, conflict_checks, industry_benchmarks,
--      retainer_agreements.
--   2. Drop every permissive USING(true) / WITH CHECK(true) policy in the
--      public schema. These are the default policies added by the Dashboard
--      "Enable RLS" button and are a security anti-pattern when access is
--      already mediated by service_role.
--   3. Revoke broad grants on intake_firms from anon and grant back only
--      column-level SELECT(id, custom_domain), then add a row-filter policy
--      so anon can only see rows where a custom_domain is configured.
--   4. Lock search_path on the three exposed functions flagged by Supabase's
--      linter: get_dashboard_stats, touch_updated_at, make_channels.
--
-- Idempotent: every statement is IF EXISTS / IF NOT EXISTS / upsert-style.
-- Safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on privileged tables created without it
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.conflict_register     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conflict_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.industry_benchmarks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retainer_agreements   ENABLE ROW LEVEL SECURITY;

-- FORCE RLS also applies policies to table owners. Service role retains its
-- BYPASSRLS grant and is unaffected; this closes a loophole where a role
-- happens to own the table.
ALTER TABLE IF EXISTS public.conflict_register     FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conflict_checks       FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.industry_benchmarks   FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.retainer_agreements   FORCE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop all permissive USING(true) / WITH CHECK(true) policies in public
-- ─────────────────────────────────────────────────────────────────────────────
-- These were auto-created when RLS was toggled on via the Dashboard UI. They
-- allow any anon/authenticated caller unlimited access to the row. Service
-- role reads bypass RLS anyway, so dropping them does not affect server code.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual       = 'true'
        OR with_check = 'true'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped permissive policy: %.% -> %',
      pol.schemaname, pol.tablename, pol.policyname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Narrow anon access on intake_firms (middleware custom-domain lookup)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Edge middleware (src/proxy.ts) issues:
--   GET /rest/v1/intake_firms?select=id&custom_domain=eq.<hostname>&limit=1
-- with the anon key. Every other read/write on intake_firms is done server-side
-- with the service role. We lock anon down to exactly what the middleware needs.

-- Ensure RLS is on (no-op if already).
ALTER TABLE IF EXISTS public.intake_firms ENABLE ROW LEVEL SECURITY;

-- Strip every grant anon may have on the base table.
REVOKE ALL ON TABLE public.intake_firms FROM anon;

-- Grant back only the two columns the middleware needs.
-- Column-level SELECT: PostgREST will 401/403 on `select=*` and permit
-- `select=id,custom_domain` or subsets.
GRANT SELECT (id, custom_domain) ON public.intake_firms TO anon;

-- Row filter: only rows with a custom_domain set. Firms without a white-label
-- domain are invisible to anon entirely.
DROP POLICY IF EXISTS anon_read_intake_firms_domain_lookup ON public.intake_firms;
CREATE POLICY anon_read_intake_firms_domain_lookup
  ON public.intake_firms
  FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock search_path on flagged functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Functions without a fixed search_path can be hijacked if an attacker can
-- create objects in any schema the function resolves through. Pinning the
-- search_path to 'public, pg_catalog' eliminates the ambiguity. We iterate
-- pg_proc so we do not need to know each function's argument signature up
-- front and the migration stays stable across overloaded or future-edited
-- versions.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_dashboard_stats', 'touch_updated_at', 'make_channels')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      fn.proname, fn.args
    );
    RAISE NOTICE 'Locked search_path on: public.%(%)', fn.proname, fn.args;
  END LOOP;
END
$$;


-- =============================================================================
-- Post-apply verification queries (run manually to confirm state)
-- =============================================================================
--
-- -- RLS enabled on all privileged tables:
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN ('conflict_register','conflict_checks','industry_benchmarks',
--                   'retainer_agreements','intake_firms','matter_routing')
-- ORDER BY relname;
--
-- -- No permissive policies remain:
-- SELECT schemaname, tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true');
-- -- Expected: 0 rows.
--
-- -- Anon's only grant on intake_firms is column-level SELECT:
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public' AND table_name = 'intake_firms' AND grantee = 'anon'
-- ORDER BY column_name;
-- -- Expected: (anon, SELECT, id) and (anon, SELECT, custom_domain).
--
-- -- Function search_paths locked:
-- SELECT n.nspname, p.proname, p.proconfig
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_dashboard_stats','touch_updated_at','make_channels');
-- -- Expected: proconfig contains 'search_path=public, pg_catalog' for each.
-- =============================================================================


-- ==============================================================
-- FILE: 20260423_rls_hardening_fix.sql
-- ==============================================================
-- =============================================================================
-- RLS Hardening — Fix  20260423 (follow-up to 20260423_rls_hardening.sql)
-- =============================================================================
-- The first migration left intake_firms still readable by anon. Verification
-- with the anon key showed:
--   GET /rest/v1/intake_firms?select=name   → 200, returns "Sakuraba Law"
--   GET /rest/v1/intake_firms?select=*      → 200, returns full row including
--                                              practice_areas, clio_config,
--                                              ghl_webhook_url
-- while RLS-enabled tables with no anon policy (conflict_register,
-- retainer_agreements) correctly returned [].
--
-- Root cause, almost certain: a legacy permissive policy on intake_firms with
-- a qual expression that did not match qual='true' (e.g. USING(auth.role()=
-- 'anon') or USING(TRUE) with a cast). PERMISSIVE policies OR together, so
-- any one permissive policy leaves anon with full access — the narrow policy
-- we added does not restrict anything, it only expands.
--
-- Strategy: drop EVERY policy on public.intake_firms regardless of qual, then
-- recreate only the single narrow anon_read_intake_firms_domain_lookup policy.
-- Also revoke at both the anon role and the PUBLIC pseudo-role level, and
-- block anon grants that may have been layered in via schema defaults.
-- Idempotent.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop EVERY policy on public.intake_firms (no matter its qual)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'intake_firms'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.intake_firms',
      pol.policyname
    );
    RAISE NOTICE 'Dropped policy on intake_firms: %', pol.policyname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Force RLS on and enable it (no-op if already enabled)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.intake_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_firms FORCE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Strip every grant path anon, authenticated, and PUBLIC might hold
-- ─────────────────────────────────────────────────────────────────────────────
-- Table-level REVOKE ALL cascades to column-level grants in Postgres 15+
-- which is what Supabase runs, so no separate column-level REVOKE is needed
-- (and enumerating columns risks drift with the real schema).
--
-- We hit all three grantee paths: anon (direct), authenticated (direct, not
-- used by this app but may have been granted by the Dashboard), and PUBLIC
-- (the implicit "all roles" pseudo-role — earlier migrations or the
-- Dashboard may have layered a PUBLIC grant on, and anon inherits from it).
REVOKE ALL ON TABLE public.intake_firms FROM anon;
REVOKE ALL ON TABLE public.intake_firms FROM authenticated;
REVOKE ALL ON TABLE public.intake_firms FROM PUBLIC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Re-add only the narrow column grant anon needs
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the ONLY thing anon can see on intake_firms. Combined with the
-- policy below, anon can only SELECT (id, custom_domain) for rows where a
-- custom_domain is configured.
GRANT SELECT (id, custom_domain) ON public.intake_firms TO anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Re-create the single narrow policy
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS anon_read_intake_firms_domain_lookup ON public.intake_firms;
CREATE POLICY anon_read_intake_firms_domain_lookup
  ON public.intake_firms
  FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Reload PostgREST schema cache so revoked column grants take effect
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';


-- =============================================================================
-- Post-apply verification (run with anon key; expected results inline):
--
--   GET /rest/v1/intake_firms?select=*&limit=1
--     → either 401 "permission denied for column ..."
--       or [] if RLS filters everything out
--     In either case, name/practice_areas/clio_config MUST NOT appear.
--
--   GET /rest/v1/intake_firms?select=name&limit=1
--     → 401 "permission denied for column name"
--
--   GET /rest/v1/intake_firms?select=id,custom_domain
--     → 200, only rows where custom_domain IS NOT NULL
--
--   GET /rest/v1/intake_firms?select=id&custom_domain=eq.<configured-domain>
--     → 200, returns the matching firm's id  (proxy.ts still works)
-- =============================================================================


-- ==============================================================
-- FILE: 20260423_rls_hardening_sweep.sql
-- ==============================================================
-- =============================================================================
-- RLS Hardening — Full Sweep  20260423 (follow-up to rls_hardening + rls_hardening_fix)
-- =============================================================================
-- Context: live DB audit revealed the first rls_hardening migration only landed
-- on intake_firms. Every other privileged table in public still has:
--   * RLS off (conflict_checks, conflict_register, industry_benchmarks,
--     retainer_agreements), or
--   * a permissive USING(true) / WITH CHECK(true) policy granting anon full
--     access via the {public} role (leads, intake_sessions, email_sequences,
--     sequence_steps, sequence_templates, review_requests, state_history,
--     law_firm_clients, discovery_reports)
--   * direct ALL-privileges grants to anon at the table level
--
-- Shape of the defect: dashboard-button "Enable RLS" permissive defaults plus
-- table-creation grants that default to including anon. The intake_firms fix
-- was a single-table patch; this migration applies the same pattern across
-- every public table so the same class of defect is resolved everywhere.
--
-- Strategy:
--   1. Enable + FORCE RLS on every public table that has it off.
--   2. Drop every permissive qual='true' / with_check='true' policy in public.
--   3. REVOKE ALL from anon and PUBLIC on every public table except the one
--      whitelisted anon read path (public.intake_firms). The narrow
--      column-level GRANT for anon on (id, custom_domain) stays intact,
--      combined with the anon_read_intake_firms_domain_lookup row policy.
--   4. Lock search_path on the 3 flagged SECURITY-sensitive functions.
--   5. Reload PostgREST schema cache.
--
-- All reads/writes for the app go through service_role (BYPASSRLS). So
-- stripping anon from every other table cannot break any server-side code
-- path. If any client-side code is still issuing anon reads to these tables
-- it was already a data-exposure bug; this migration surfaces it instead of
-- masking it.
--
-- Idempotent. Safe to re-run.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable + FORCE RLS on every public table that currently has it off
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',  t.relname);
    RAISE NOTICE 'RLS enabled+forced on public.%', t.relname;
  END LOOP;
END
$$;

-- Also FORCE RLS on tables that already had it enabled but not forced.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE 'RLS forced on public.%', t.relname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop every permissive USING(true) / WITH CHECK(true) policy in public
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped permissive policy: %.% -> %',
      pol.schemaname, pol.tablename, pol.policyname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Strip anon + PUBLIC + authenticated grants from every public table
--    (except intake_firms, which keeps its narrow column-level GRANT)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'intake_firms'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',          t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',        t.relname);
    RAISE NOTICE 'Stripped grants on public.%', t.relname;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lock search_path on flagged functions
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical block to the first migration — idempotent, harmless if already set.
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_dashboard_stats', 'touch_updated_at', 'make_channels')
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_catalog',
      fn.proname, fn.args
    );
    RAISE NOTICE 'Locked search_path on: public.%(%)', fn.proname, fn.args;
  END LOOP;
END
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reload PostgREST schema cache
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';


-- =============================================================================
-- Post-apply verification (expected results after running this migration):
--
-- 1. No table in public with RLS off:
--    SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--    → 0 rows
--
-- 2. No permissive qual='true'/with_check='true' policies in public:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname='public' AND (qual='true' OR with_check='true');
--    → 0 rows
--
-- 3. anon has grants on intake_firms ONLY (and only (id, custom_domain)):
--    SELECT table_name FROM information_schema.table_privileges
--    WHERE table_schema='public' AND grantee='anon';
--    → 0 rows at the table level
--    SELECT column_name, privilege_type FROM information_schema.column_privileges
--    WHERE table_schema='public' AND grantee='anon';
--    → exactly: (custom_domain, SELECT), (id, SELECT) on intake_firms
--
-- 4. Anon probes via PostgREST:
--    GET /rest/v1/leads?select=*&limit=1                 → 401 permission denied
--    GET /rest/v1/intake_sessions?select=*&limit=1       → 401 permission denied
--    GET /rest/v1/email_sequences?select=*&limit=1       → 401 permission denied
--    GET /rest/v1/intake_firms?select=id&custom_domain=eq.<hostname>&limit=1
--                                                        → 200 (proxy.ts path)
-- =============================================================================


