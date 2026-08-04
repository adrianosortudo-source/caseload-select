-- firm_files: support link items + workstream sections, and raise the file ceiling.
--
-- Adds two item kinds to the operator <-> firm file exchange:
--   kind='file'  the existing behaviour (object in the firm-files bucket)
--   kind='link'  an external URL (HTML deliverables: brand book, strategy deck, dashboards)
--
-- Regroups deliverables by workstream (Brand / Strategy / Reports / Assets / Admin)
-- via a new `section` column. The legacy `category` column is retained (now
-- nullable) for the one pre-existing row and back-compat; new writes use `section`.
--
-- Storage columns (storage_path / size_bytes / mime_type) become optional so a
-- link row can omit them. A shape CHECK enforces that a file has a stored object
-- and a link has a URL. Idempotent so `supabase db push` is safe after MCP apply.

-- 1. New columns
alter table public.firm_files
  add column if not exists kind text not null default 'file',
  add column if not exists external_url text,
  add column if not exists section text;

-- 2. Backfill section from the legacy category on existing rows
update public.firm_files
set section = case category
  when 'report' then 'reports'
  when 'diagnostic' then 'reports'
  when 'contract' then 'admin'
  when 'onboarding' then 'admin'
  when 'correspondence' then 'admin'
  else 'admin'
end
where section is null;

-- 3. Relax the storage columns + legacy category so links can omit them
alter table public.firm_files alter column storage_path drop not null;
alter table public.firm_files alter column size_bytes drop not null;
alter table public.firm_files alter column mime_type drop not null;
alter table public.firm_files alter column category drop not null;

-- 4. Section is now the canonical grouping: default + not null
alter table public.firm_files alter column section set default 'admin';
alter table public.firm_files alter column section set not null;

-- 5. Constraints
alter table public.firm_files drop constraint if exists firm_files_kind_check;
alter table public.firm_files
  add constraint firm_files_kind_check check (kind in ('file', 'link'));

alter table public.firm_files drop constraint if exists firm_files_section_check;
alter table public.firm_files
  add constraint firm_files_section_check
  check (section in ('brand', 'strategy', 'reports', 'assets', 'admin'));

-- A file needs a stored object; a link needs a URL. The two kinds are exclusive.
alter table public.firm_files drop constraint if exists firm_files_kind_shape_check;
alter table public.firm_files
  add constraint firm_files_kind_shape_check check (
    (kind = 'file' and storage_path is not null and size_bytes is not null
       and mime_type is not null and external_url is null)
    or
    (kind = 'link' and external_url is not null and storage_path is null)
  );

-- 6. Audit log learns the 'opened' event (link click)
alter table public.firm_file_events drop constraint if exists firm_file_events_event_type_check;
alter table public.firm_file_events
  add constraint firm_file_events_event_type_check
  check (event_type in ('uploaded', 'downloaded', 'archived', 'restored', 'opened'));
