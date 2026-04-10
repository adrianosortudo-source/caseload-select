-- Migration 007 — WF-03 Persistence Engine columns
-- Run once in Supabase → SQL Editor

alter table leads
  add column if not exists persistence_step            integer     default 0,
  add column if not exists persistence_started_at      timestamptz,
  add column if not exists persistence_last_action_at  timestamptz,
  add column if not exists persistence_status          text        default 'inactive'
    check (persistence_status in ('inactive','active','paused','completed','exited')),
  add column if not exists persistence_exit_reason     text
    check (persistence_exit_reason in ('engaged','won','lost','day11'));
