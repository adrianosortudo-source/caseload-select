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
