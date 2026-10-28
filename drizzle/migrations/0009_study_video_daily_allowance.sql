-- Raise the video aid allowance to 3 per hour and 8 per day so every daily chapter can get one.
create or replace function public.consume_ai_quota(p_feature text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
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
    when 'video' then v_hour_limit := 3; v_day_limit := 8;
    else
      raise exception using errcode = '22023', message = 'unknown AI feature';
  end case;

  insert into public.ai_usage_counters (user_id, feature, hour_bucket, hour_count, day_bucket, day_count)
  values (v_user_id, p_feature, v_hour_bucket, 0, v_day_bucket, 0)
  on conflict (user_id, feature) do nothing;

  select hour_bucket, hour_count, day_bucket, day_count
    into v_stored_hour, v_hour_count, v_stored_day, v_day_count
  from public.ai_usage_counters
  where user_id = v_user_id and feature = p_feature
  for update;

  if v_stored_hour <> v_hour_bucket then v_hour_count := 0; end if;
  if v_stored_day <> v_day_bucket then v_day_count := 0; end if;

  if v_day_count >= v_day_limit then
    v_retry_after := greatest(1, ceil(extract(epoch from (((v_day_bucket + 1)::timestamp at time zone 'UTC') - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'scope', 'day', 'retryAfter', v_retry_after);
  end if;
  if v_hour_count >= v_hour_limit then
    v_retry_after := greatest(1, ceil(extract(epoch from ((v_hour_bucket + interval '1 hour') - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'scope', 'hour', 'retryAfter', v_retry_after);
  end if;

  update public.ai_usage_counters
  set hour_bucket = v_hour_bucket, hour_count = v_hour_count + 1,
      day_bucket = v_day_bucket, day_count = v_day_count + 1, updated_at = v_now
  where user_id = v_user_id and feature = p_feature;

  return jsonb_build_object('allowed', true,
    'hourRemaining', greatest(0, v_hour_limit - (v_hour_count + 1)),
    'dayRemaining', greatest(0, v_day_limit - (v_day_count + 1)));
end;
$function$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;