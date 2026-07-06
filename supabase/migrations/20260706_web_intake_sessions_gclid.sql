-- P12 Phase 1: carry gclid through the web-widget drop-off checkpoint so
-- thin briefs finalized by the expiry sweeper (contact-complete but
-- abandoned sessions) keep the same attribution as a normal submit.
-- Additive, nullable; existing rows unaffected.
alter table public.web_intake_sessions
  add column if not exists gclid text;
