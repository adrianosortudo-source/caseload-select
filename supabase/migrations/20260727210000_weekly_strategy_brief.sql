alter table public.content_periods
  alter column starts_on drop not null,
  alter column ends_on drop not null,
  add column if not exists week_number integer,
  add column if not exists strategy_brief jsonb;

alter table public.content_periods
  drop constraint if exists content_periods_week_number_positive,
  drop constraint if exists content_periods_strategy_brief_complete;

alter table public.content_periods
  add constraint content_periods_week_number_positive
    check (week_number is null or week_number > 0),
  add constraint content_periods_strategy_brief_complete check (
    strategy_brief is null
    or (
      jsonb_typeof(strategy_brief) = 'object'
      and strategy_brief ?& array[
        'readerAndSituation',
        'workSupported',
        'whyThisWeek',
        'practicalAngle',
        'authorityAndEvidence',
        'websiteAndConversionRole'
      ]
      and strategy_brief - array[
        'readerAndSituation',
        'workSupported',
        'whyThisWeek',
        'practicalAngle',
        'authorityAndEvidence',
        'websiteAndConversionRole'
      ] = '{}'::jsonb
      and jsonb_typeof(strategy_brief -> 'readerAndSituation') = 'string'
      and jsonb_typeof(strategy_brief -> 'workSupported') = 'string'
      and jsonb_typeof(strategy_brief -> 'whyThisWeek') = 'string'
      and jsonb_typeof(strategy_brief -> 'practicalAngle') = 'string'
      and jsonb_typeof(strategy_brief -> 'authorityAndEvidence') = 'string'
      and jsonb_typeof(strategy_brief -> 'websiteAndConversionRole') = 'string'
      and length(trim(strategy_brief ->> 'readerAndSituation')) > 0
      and length(trim(strategy_brief ->> 'workSupported')) > 0
      and length(trim(strategy_brief ->> 'whyThisWeek')) > 0
      and length(trim(strategy_brief ->> 'practicalAngle')) > 0
      and length(trim(strategy_brief ->> 'authorityAndEvidence')) > 0
      and length(trim(strategy_brief ->> 'websiteAndConversionRole')) > 0
    )
  );

create unique index if not exists content_periods_firm_week_number_unique
  on public.content_periods (firm_id, week_number)
  where week_number is not null;

notify pgrst, 'reload schema';
