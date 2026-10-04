-- Chapter Video Aid: durable, owner-only AI study clips generated from the persisted chapter guide.
-- Scripture text is never stored here; only study metadata, guide-derived scene notes and private asset paths.

-- 1) Dedicated 'video' quota feature (video is far costlier than images; never charged to the image quota).
alter table public.ai_usage_counters drop constraint if exists ai_usage_counters_feature_check;
alter table public.ai_usage_counters add constraint ai_usage_counters_feature_check
  check (feature in ('insights', 'ask_chapter', 'study_memory', 'narration', 'image', 'video'));

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
    when 'video' then v_hour_limit := 2; v_day_limit := 3;
    else
      raise exception using errcode = '22023', message = 'unknown AI feature';
  end case;

  insert into public.ai_usage_counters (
    user_id, feature, hour_bucket, hour_count, day_bucket, day_count
  ) values (
    v_user_id, p_feature, v_hour_bucket, 0, v_day_bucket, 0
  )
  on conflict (user_id, feature) do nothing;

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
$function$;

revoke all on function public.consume_ai_quota(text) from public, anon;
grant execute on function public.consume_ai_quota(text) to authenticated;

-- 2) Video jobs + assets (one row per generation attempt; completed rows are saved versions).
create table if not exists public.study_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'),
  version_id integer not null check (version_id > 0),
  guide_hash text not null check (guide_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  provider text not null default 'lovable-ai-gateway' check (char_length(provider) between 1 and 80),
  model text not null check (char_length(model) between 1 and 120),
  status text not null default 'queued' check (status in ('queued','generating','completed','failed','cancelled')),
  provider_job_id text check (provider_job_id is null or char_length(provider_job_id) between 1 and 200),
  progress integer check (progress is null or progress between 0 and 100),
  storage_path text unique check (storage_path is null or (char_length(storage_path) between 1 and 500 and storage_path like user_id::text || '/%')),
  duration_seconds integer not null default 8 check (duration_seconds between 3 and 10),
  scenes jsonb not null default '[]'::jsonb check (jsonb_typeof(scenes) = 'array' and jsonb_array_length(scenes) <= 8),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  selected_at timestamptz not null default now()
);

create unique index if not exists study_videos_one_active_idx
  on public.study_videos(user_id, passage, version_id, guide_hash, prompt_version)
  where status in ('queued','generating');
create index if not exists study_videos_lookup_idx
  on public.study_videos(user_id, passage, version_id, selected_at desc, created_at desc);

grant select, insert, delete on public.study_videos to authenticated;
-- Owner rows may only change lifecycle fields; identity, passage, guide hash and model are immutable.
grant update (status, provider_job_id, progress, storage_path, scenes, last_error, updated_at, selected_at)
  on public.study_videos to authenticated;
grant all on public.study_videos to service_role;
revoke all on public.study_videos from anon;

alter table public.study_videos enable row level security;

create policy "study videos own select" on public.study_videos
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "study videos own insert" on public.study_videos
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "study videos own update" on public.study_videos
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "study videos own delete" on public.study_videos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 3) Reserve one active generation per exact user/chapter/translation/guide/prompt. SECURITY INVOKER: RLS stays in force.
create or replace function public.reserve_study_video_job(
  p_passage text,
  p_version_id integer,
  p_guide_hash text,
  p_prompt_version text,
  p_model text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.study_videos;
  v_created boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_passage !~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'
     or p_version_id <= 0
     or p_guide_hash !~ '^[0-9a-f]{64}$'
     or char_length(p_prompt_version) not between 1 and 80
     or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid study video job input' using errcode = '22023';
  end if;

  -- Abandoned generations (closed tab, lost device) release their lock after 20 minutes.
  update public.study_videos
     set status = 'failed',
         last_error = 'Generation lease expired before completion.',
         updated_at = now()
   where user_id = v_user_id
     and passage = p_passage
     and version_id = p_version_id
     and guide_hash = p_guide_hash
     and prompt_version = p_prompt_version
     and status in ('queued','generating')
     and updated_at < now() - interval '20 minutes';

  begin
    insert into public.study_videos(user_id, passage, version_id, guide_hash, prompt_version, model, status)
    values(v_user_id, p_passage, p_version_id, p_guide_hash, p_prompt_version, p_model, 'queued')
    returning * into v_job;
    v_created := true;
  exception when unique_violation then
    select * into v_job
      from public.study_videos
     where user_id = v_user_id
       and passage = p_passage
       and version_id = p_version_id
       and guide_hash = p_guide_hash
       and prompt_version = p_prompt_version
       and status in ('queued','generating')
     order by created_at desc
     limit 1;
  end;

  if v_job.id is null then
    raise exception 'unable to reserve video generation job';
  end if;

  return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'created', v_created, 'createdAt', v_job.created_at);
end;
$$;

revoke all on function public.reserve_study_video_job(text, integer, text, text, text) from public, anon;
grant execute on function public.reserve_study_video_job(text, integer, text, text, text) to authenticated;

-- 4) Private storage policies for bucket 'study-videos' (bucket provisioned through the Storage API).
create policy "study video objects own select" on storage.objects
  for select to authenticated
  using (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "study video objects own insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "study video objects own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'study-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
