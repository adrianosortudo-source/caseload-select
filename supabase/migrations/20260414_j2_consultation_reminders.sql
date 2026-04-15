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
