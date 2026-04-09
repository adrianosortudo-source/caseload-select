-- CaseLoad Select — CPI engine columns
-- Run once in Supabase → SQL Editor.

alter table leads
  add column if not exists fit_score int default 0,
  add column if not exists value_score int default 0,
  add column if not exists cpi_score int default 0,
  add column if not exists band text check (band in ('A','B','C','D','E')),
  add column if not exists referral_source text,
  add column if not exists urgency text,
  add column if not exists timeline text,
  add column if not exists city text;
