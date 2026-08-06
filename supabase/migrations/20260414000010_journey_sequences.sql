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
