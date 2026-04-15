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
