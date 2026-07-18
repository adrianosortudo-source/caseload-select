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
