-- Atomic, database-backed quotas for cost-bearing AI features.
-- The counter table is never exposed to browser roles. Authenticated users may
-- only execute the SECURITY DEFINER function, which derives identity from
-- auth.uid() and owns the feature limits server-side.

create table if not exists public.ai_usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('insights', 'ask_chapter', 'study_memory', 'narration', 'image')),
  hour_bucket timestamptz not null,
  hour_count integer not null default 0 check (hour_count >= 0),
  day_bucket date not null,
  day_count integer not null default 0 check (day_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);

alter table public.ai_usage_counters enable row level security;
revoke all on table public.ai_usage_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_usage_counters to service_role;

create or replace function public.consume_ai_quota(p_feature text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_hour_limit integer;
  v_day_limit integer;
  v_now timestamptz := clock_timestamp();
  v_hour_bucket timestamptz := date_trunc('hour', v_now, 'UTC');
  v_day_bucket date := (v_now at time zone 'UTC')::date;
  v_hour_count integer;
  v_day_count integer;
  v_stored_hour timestamptz;
  v_stored_day date;
  v_retry_after integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  case p_feature
    when 'insights' then v_hour_limit := 24; v_day_limit := 80;
    when 'ask_chapter' then v_hour_limit := 60; v_day_limit := 200;
    when 'study_memory' then v_hour_limit := 20; v_day_limit := 60;
    when 'narration' then v_hour_limit := 12; v_day_limit := 40;
    when 'image' then v_hour_limit := 6; v_day_limit := 15;
    else
      raise exception using errcode = '22023', message = 'unknown AI feature';
  end case;

  insert into public.ai_usage_counters (
    user_id, feature, hour_bucket, hour_count, day_bucket, day_count
  ) values (
    v_user_id, p_feature, v_hour_bucket, 0, v_day_bucket, 0
  )
  on conflict (user_id, feature) do nothing;

  -- Serialize quota decisions globally, across workers and regions.
  select hour_bucket, hour_count, day_bucket, day_count
    into v_stored_hour, v_hour_count, v_stored_day, v_day_count
  from public.ai_usage_counters
  where user_id = v_user_id and feature = p_feature
  for update;

  if v_stored_hour <> v_hour_bucket then
    v_hour_count := 0;
  end if;
  if v_stored_day <> v_day_bucket then
    v_day_count := 0;
  end if;

  if v_day_count >= v_day_limit then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (((v_day_bucket + 1)::timestamp at time zone 'UTC') - v_now)))::integer
    );
    return jsonb_build_object('allowed', false, 'scope', 'day', 'retryAfter', v_retry_after);
  end if;

  if v_hour_count >= v_hour_limit then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from ((v_hour_bucket + interval '1 hour') - v_now)))::integer
    );
    return jsonb_build_object('allowed', false, 'scope', 'hour', 'retryAfter', v_retry_after);
  end if;

  update public.ai_usage_counters
  set hour_bucket = v_hour_bucket,
      hour_count = v_hour_count + 1,
      day_bucket = v_day_bucket,
      day_count = v_day_count + 1,
      updated_at = v_now
  where user_id = v_user_id and feature = p_feature;

  return jsonb_build_object(
    'allowed', true,
    'hourRemaining', greatest(0, v_hour_limit - (v_hour_count + 1)),
    'dayRemaining', greatest(0, v_day_limit - (v_day_count + 1))
  );
end;
$$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated, service_role;
