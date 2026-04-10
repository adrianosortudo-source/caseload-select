-- Migration 006 — Phase 2 priority scoring engine
-- Run once in Supabase → SQL Editor

-- ── 1. New sub-score columns ──────────────────────────────────────────────
alter table leads
  add column if not exists geo_score             integer,
  add column if not exists contactability_score  integer,
  add column if not exists legitimacy_score      integer,
  add column if not exists complexity_score      integer,
  add column if not exists urgency_score         integer,
  add column if not exists strategic_score       integer,
  add column if not exists fee_score             integer;

-- ── 2. New composite score columns ───────────────────────────────────────
alter table leads
  add column if not exists priority_index  integer,
  add column if not exists priority_band   text
    check (priority_band in ('A','B','C','D','E'));

-- ── 3. New intake fields ──────────────────────────────────────────────────
alter table leads
  add column if not exists source         text
    check (source in ('gbp','organic','paid','referral','directory','social','direct')),
  add column if not exists location       text,
  add column if not exists referral       boolean default false,
  add column if not exists multi_practice boolean default false;

-- ── 4. Widen urgency check to accept both old and new value sets ──────────
alter table leads drop constraint if exists leads_urgency_check;
alter table leads
  add constraint leads_urgency_check
    check (urgency in ('immediate','near_term','medium','long','low','high'));

-- ── 5. Update get_dashboard_stats RPC ────────────────────────────────────
--   Use priority_index where available, fall back to cpi_score for existing rows.
create or replace function get_dashboard_stats()
returns json
language sql
security definer
stable
as $$
  select json_build_object(

    'total_leads',
      (select count(*) from leads),

    'qualified_leads',
      (select count(*) from leads where stage = 'qualified'),

    'client_won',
      (select count(*) from leads where stage = 'client_won'),

    'client_lost',
      (select count(*) from leads where stage = 'client_lost'),

    'overdue_leads',
      (select count(*)
       from leads
       where stage not in ('client_won', 'client_lost')
         and updated_at < now() - interval '72 hours'),

    'active_firms',
      (select count(*) from law_firm_clients where status = 'active'),

    'avg_cpi',
      (select coalesce(round(avg(coalesce(priority_index, cpi_score))), 0) from leads),

    'avg_value',
      (select coalesce(round(avg(estimated_value)), 0) from leads),

    'revenue_forecast',
      (select coalesce(
         sum(estimated_value * (coalesce(priority_index, score, 50)::float / 100.0)), 0
       )
       from leads
       where stage in ('qualified', 'proposal_sent')),

    'review_open_rate',
      (select case
         when count(*) = 0 then 0
         else round(
           100.0
           * count(*) filter (where status in ('opened', 'completed'))
           / count(*)
         )
       end
       from review_requests),

    'by_stage',
      (select coalesce(
         json_agg(json_build_object('stage', stage, 'count', cnt) order by cnt desc),
         '[]'::json
       )
       from (select stage, count(*) as cnt from leads group by stage) t),

    'by_band',
      (select coalesce(
         json_agg(json_build_object('band', band, 'count', cnt) order by band),
         '[]'::json
       )
       from (
         select coalesce(priority_band, band) as band, count(*) as cnt
         from leads
         where coalesce(priority_band, band) is not null
         group by coalesce(priority_band, band)
       ) t),

    'by_case_type',
      (select coalesce(
         json_agg(json_build_object('case_type', case_type, 'count', cnt) order by cnt desc),
         '[]'::json
       )
       from (select case_type, count(*) as cnt from leads where case_type is not null group by case_type) t),

    'firms',
      (select coalesce(
         json_agg(json_build_object(
           'id',             f.id,
           'name',           f.name,
           'location',       f.location,
           'status',         f.status,
           'lead_count',     (select count(*) from leads l where l.law_firm_id = f.id),
           'won_count',      (select count(*) from leads l where l.law_firm_id = f.id and l.stage = 'client_won'),
           'pipeline_value', (select coalesce(sum(l.estimated_value), 0) from leads l
                              where l.law_firm_id = f.id and l.stage in ('qualified', 'proposal_sent'))
         )),
         '[]'::json
       )
       from law_firm_clients f)

  );
$$;
