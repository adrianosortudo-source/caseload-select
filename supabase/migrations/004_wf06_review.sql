-- WF-06 migration: review_requests pending status + law_firm contact email
-- Run once in Supabase → SQL Editor

-- 1. Add contact_email to law_firm_clients (for review email targeting)
alter table law_firm_clients
  add column if not exists contact_email text;

-- 2. Widen the status check on review_requests to include 'pending'
--    (stub mode: row inserted but Resend key absent → status = 'pending')
alter table review_requests
  drop constraint if exists review_requests_status_check;

alter table review_requests
  add constraint review_requests_status_check
    check (status in ('pending','sent','opened','completed','failed'));
