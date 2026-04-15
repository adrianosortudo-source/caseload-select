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
