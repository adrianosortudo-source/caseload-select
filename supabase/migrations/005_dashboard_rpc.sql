-- Migration 005 — dashboard stats RPC
-- Run once in Supabase → SQL Editor

create or replace function get_dashboard_stats()
returns json
language sql
security definer
stable
as $$
  select json_build_object(

    -- ── Core KPIs ─────────────────────────────────────────────────────────
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
      (select coalesce(round(avg(cpi_score)), 0) from leads),

    'avg_value',
      (select coalesce(round(avg(estimated_value)), 0) from leads),

    'revenue_forecast',
      (select coalesce(
         sum(estimated_value * (score::float / 100.0)), 0
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

    -- ── Chart data ────────────────────────────────────────────────────────
    'by_stage',
      (select coalesce(
         json_agg(
           json_build_object('stage', stage, 'count', cnt)
           order by cnt desc
         ), '[]'::json
       )
       from (
         select stage, count(*) as cnt
         from leads
         group by stage
       ) t),

    'by_band',
      (select coalesce(
         json_agg(
           json_build_object('band', band, 'count', cnt)
           order by band
         ), '[]'::json
       )
       from (
         select band, count(*) as cnt
         from leads
         where band is not null
         group by band
       ) t),

    'by_case_type',
      (select coalesce(
         json_agg(
           json_build_object('case_type', case_type, 'count', cnt)
           order by cnt desc
         ), '[]'::json
       )
       from (
         select case_type, count(*) as cnt
         from leads
         where case_type is not null
         group by case_type
       ) t),

    -- ── Law Firm Health table ─────────────────────────────────────────────
    'firms',
      (select coalesce(
         json_agg(
           json_build_object(
             'id',             f.id,
             'name',           f.name,
             'location',       f.location,
             'status',         f.status,
             'lead_count',     (select count(*) from leads l where l.law_firm_id = f.id),
             'won_count',      (select count(*) from leads l where l.law_firm_id = f.id and l.stage = 'client_won'),
             'pipeline_value', (select coalesce(sum(l.estimated_value), 0) from leads l
                                where l.law_firm_id = f.id
                                  and l.stage in ('qualified', 'proposal_sent'))
           )
         ), '[]'::json
       )
       from law_firm_clients f)

  );
$$;
