-- firm_files: per-firm document store for operator <-> lawyer file exchange.
--
-- Operator uploads contracts, reports, diagnostics here. Firm lawyers can
-- upload back (signed copies, redacted incident reports, etc.). Soft-delete
-- via archived flag — storage objects are kept for audit but hidden from
-- the UI on archive. Hard delete only via PIPEDA right-to-deletion path.

create table if not exists firm_files (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references intake_firms(id) on delete cascade,
  uploaded_by_role text not null check (uploaded_by_role in ('operator', 'lawyer')),
  uploaded_by_id  uuid references firm_lawyers(id) on delete set null,
  category        text not null check (category in ('contract', 'report', 'onboarding', 'diagnostic', 'correspondence', 'other')),
  display_name    text not null,
  storage_path    text not null unique,
  size_bytes      bigint not null check (size_bytes >= 0),
  mime_type       text not null,
  description     text,
  archived        boolean not null default false,
  archived_at     timestamptz,
  archived_by_role text check (archived_by_role in ('operator', 'lawyer')),
  archived_by_id  uuid references firm_lawyers(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_firm_files_firm_active
  on firm_files (firm_id, archived, created_at desc);

create index if not exists idx_firm_files_firm_category
  on firm_files (firm_id, category, created_at desc)
  where archived = false;

alter table firm_files enable row level security;
alter table firm_files force row level security;

comment on table firm_files is
  'Per-firm document store for operator <-> lawyer file exchange. Service-role only; UI gates access by session role and firm_id.';

-- Audit trail. Soft-deleted rows in firm_files keep their event chain.
create table if not exists firm_file_events (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references firm_files(id) on delete cascade,
  firm_id     uuid not null,
  actor_role  text not null check (actor_role in ('operator', 'lawyer')),
  actor_id    uuid references firm_lawyers(id) on delete set null,
  event_type  text not null check (event_type in ('uploaded', 'downloaded', 'archived', 'restored')),
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_firm_file_events_file
  on firm_file_events (file_id, created_at desc);

create index if not exists idx_firm_file_events_firm
  on firm_file_events (firm_id, created_at desc);

alter table firm_file_events enable row level security;
alter table firm_file_events force row level security;

comment on table firm_file_events is
  'Audit log of upload, download, archive, restore events on firm_files. Append-only; never updated.';

-- updated_at trigger on firm_files
create or replace function public.fn_firm_files_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_firm_files_touch on firm_files;
create trigger trg_firm_files_touch
before update on firm_files
for each row
execute function public.fn_firm_files_touch_updated_at();

-- Storage bucket. Private. 25 MB per file ceiling. Service-role only via the
-- app; browser direct uploads are not used (signed URLs handle it).
insert into storage.buckets (id, name, public, file_size_limit)
values ('firm-files', 'firm-files', false, 26214400)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
