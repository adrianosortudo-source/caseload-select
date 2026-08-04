-- CRM Migration Plan, Phase 2 rail 3 (review automation), WP-4.
--
-- Adds intake_firms.gbp_review_url so J9's shadow copy can interpolate the
-- firm's real Google Business Profile review link. Additive, nullable: a
-- firm with no configured URL renders J9 copy without a link (still valid
-- review-ask copy, just without the direct link), never breaks.
--
-- Still shadow-only. The manual "Request review" trigger enrolls a matter
-- into J9 the same way the automatic active->closing transition does; both
-- paths only ever write to outbound_messages with shadow=true.

BEGIN;

ALTER TABLE public.intake_firms
  ADD COLUMN IF NOT EXISTS gbp_review_url text;

-- J9 steps 2 and 3 (the ones that actually ask for the review action) gain
-- the {gbp_review_url} token. Step 1 stays a pure thank-you, no ask yet.
-- Renders blank (trailing space, harmless) for a firm with no URL configured;
-- final production copy is a Phase 3 concern, this proves the token plumbing.
UPDATE public.cadence_steps s
SET body_template = CASE s.step_number
  WHEN 2 THEN 'Hi {first_name}, following up on a review for your {matter_type}. A few honest sentences are plenty, and it makes a real difference. {gbp_review_url}'
  WHEN 3 THEN 'Hi {first_name}, a final note. If you would share a review of your {matter_type} experience, the firm would be grateful. Either way, thank you. {gbp_review_url}'
  ELSE s.body_template
END
FROM public.cadence_rules r
WHERE s.cadence_rule_id = r.id AND r.cadence_key = 'J9' AND r.firm_id IS NULL AND s.step_number IN (2,3);

COMMIT;
