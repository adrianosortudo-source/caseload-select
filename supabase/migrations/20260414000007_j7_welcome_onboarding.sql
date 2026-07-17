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
