-- A firm's public marketing website is not its CaseLoad Select white-label
-- portal host. Publisher-facing content links (GBP, LinkedIn, email) need a
-- dedicated, explicit HTTPS origin so relative canonical routes can be made
-- absolute without guessing or leaking portal routing into public copy.

alter table public.intake_firms
  add column if not exists public_website_origin text;

comment on column public.intake_firms.public_website_origin is
  'Canonical HTTPS origin for the firm public website, with no path, query, fragment, or trailing slash. Distinct from custom_domain/subdomain portal routing.';

alter table public.intake_firms
  drop constraint if exists intake_firms_public_website_origin_format;

alter table public.intake_firms
  add constraint intake_firms_public_website_origin_format
  check (
    public_website_origin is null
    or public_website_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
  );

update public.intake_firms
set public_website_origin = 'https://drglaw.ca'
where id = 'eec1d25e-a047-4827-8e4a-6eb96becca2b'
  and public_website_origin is distinct from 'https://drglaw.ca';
