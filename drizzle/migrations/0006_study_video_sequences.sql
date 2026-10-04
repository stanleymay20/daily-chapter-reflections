-- Video Aid v1: guide-grounded study sequences (scene visuals + narration + captions).
-- Additive only. v0 single-clip rows keep working unchanged (kind defaults to 'clip').

-- 1) Video quota is now charged once per sequence generation, so the window is tighter.
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
    when 'video' then v_hour_limit := 1; v_day_limit := 2;
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

-- 2) Sequence columns on study_videos. Budget/usage/plan lock are written only by SECURITY DEFINER functions.
alter table public.study_videos add column if not exists kind text not null default 'clip';
alter table public.study_videos add column if not exists study_mode text;
alter table public.study_videos add column if not exists plan_version text;
alter table public.study_videos add column if not exists stage text;
alter table public.study_videos add column if not exists stage_error text;
alter table public.study_videos add column if not exists plan_title text;
alter table public.study_videos add column if not exists plan_hash text;
alter table public.study_videos add column if not exists manifest jsonb;
alter table public.study_videos add column if not exists estimated_seconds integer;
alter table public.study_videos add column if not exists call_budget jsonb not null default '{}'::jsonb;
alter table public.study_videos add column if not exists call_usage jsonb not null default '{}'::jsonb;

alter table public.study_videos add constraint study_videos_kind_check check (kind in ('clip','sequence'));
alter table public.study_videos add constraint study_videos_mode_check
  check ((kind = 'clip' and study_mode is null) or (kind = 'sequence' and study_mode in ('quick','standard','deep')));
alter table public.study_videos add constraint study_videos_stage_check
  check (stage is null or stage in ('planning','visuals','narration','finalizing','done'));
alter table public.study_videos add constraint study_videos_stage_error_check check (stage_error is null or char_length(stage_error) <= 2000);
alter table public.study_videos add constraint study_videos_plan_title_check check (plan_title is null or char_length(plan_title) <= 160);
alter table public.study_videos add constraint study_videos_plan_hash_check check (plan_hash is null or plan_hash ~ '^[0-9a-f]{64}$');
alter table public.study_videos add constraint study_videos_manifest_check check (manifest is null or jsonb_typeof(manifest) = 'object');
alter table public.study_videos add constraint study_videos_budget_shape_check
  check (jsonb_typeof(call_budget) = 'object' and jsonb_typeof(call_usage) = 'object');

-- v0 clips stay 3-10 s; sequences may run up to 5 minutes.
alter table public.study_videos drop constraint if exists study_videos_duration_seconds_check;
alter table public.study_videos add constraint study_videos_duration_seconds_check
  check ((kind = 'clip' and duration_seconds between 3 and 10) or (kind = 'sequence' and duration_seconds between 0 and 300));

-- Direct inserts may only set identity fields (budget/kind/mode come from the definer reservation).
revoke insert on public.study_videos from authenticated;
grant insert (user_id, passage, version_id, guide_hash, prompt_version, model, status) on public.study_videos to authenticated;
grant update (stage, stage_error, manifest, duration_seconds) on public.study_videos to authenticated;

-- 3) Normalized scenes for sequences.
create table if not exists public.study_video_scenes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.study_videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scene_index integer not null check (scene_index between 0 and 19),
  role text not null check (role in ('opening','content','closing')),
  visual_kind text not null check (visual_kind in ('title','still','clip','closing')),
  claim_type text not null check (claim_type in ('chapter','context','uncertain')),
  narration text not null check (char_length(narration) between 1 and 800),
  visual_brief text not null check (char_length(visual_brief) <= 800),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  scripture_quote text check (scripture_quote is null or char_length(scripture_quote) <= 400),
  visual_key text check (visual_key is null or visual_key ~ '^[0-9a-f]{64}$'),
  visual_status text not null default 'pending' check (visual_status in ('pending','generating','done','failed')),
  visual_path text check (visual_path is null or (char_length(visual_path) <= 500 and visual_path like user_id::text || '/%')),
  visual_job_id text check (visual_job_id is null or char_length(visual_job_id) <= 200),
  narration_key text check (narration_key is null or narration_key ~ '^[0-9a-f]{64}$'),
  narration_status text not null default 'pending' check (narration_status in ('pending','generating','done','failed')),
  narration_path text check (narration_path is null or (char_length(narration_path) <= 500 and narration_path like user_id::text || '/%')),
  narration_seconds numeric(7,3) check (narration_seconds is null or (narration_seconds > 0 and narration_seconds <= 120)),
  tts_text text check (tts_text is null or char_length(tts_text) <= 800),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, scene_index)
);
create index if not exists study_video_scenes_visual_key_idx on public.study_video_scenes(user_id, visual_key) where visual_status = 'done';
create index if not exists study_video_scenes_narration_key_idx on public.study_video_scenes(user_id, narration_key) where narration_status = 'done';

grant select, insert, update, delete on public.study_video_scenes to authenticated;
grant all on public.study_video_scenes to service_role;
revoke all on public.study_video_scenes from anon;

alter table public.study_video_scenes enable row level security;

create policy "study video scenes own select" on public.study_video_scenes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "study video scenes own insert" on public.study_video_scenes
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.study_videos v where v.id = video_id and v.user_id = (select auth.uid()) and v.kind = 'sequence')
  );
create policy "study video scenes own update" on public.study_video_scenes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "study video scenes own delete" on public.study_video_scenes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 4) Reserve a sequence. Budget is derived server-side from the mode; callers cannot set it.
create or replace function public.reserve_study_sequence(
  p_passage text, p_version_id integer, p_guide_hash text, p_mode text, p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_prompt text := 'study-seq-v1:' || coalesce(p_mode, '');
  v_budget jsonb;
  v_seconds integer;
  v_job public.study_videos;
  v_created boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_passage !~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$' or p_version_id <= 0 or p_guide_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid study sequence input' using errcode = '22023';
  end if;
  case p_mode
    when 'quick' then v_budget := '{"plan":4,"still":3,"clip":3,"tts":7}'; v_seconds := 60;
    when 'standard' then v_budget := '{"plan":4,"still":6,"clip":4,"tts":11}'; v_seconds := 120;
    when 'deep' then v_budget := '{"plan":4,"still":11,"clip":5,"tts":17}'; v_seconds := 180;
    else raise exception 'invalid study mode' using errcode = '22023';
  end case;

  update public.study_videos
     set status = 'failed', last_error = 'Generation lease expired before completion.', updated_at = now()
   where user_id = v_user_id and passage = p_passage and version_id = p_version_id
     and guide_hash = p_guide_hash and prompt_version = v_prompt
     and status in ('queued','generating') and updated_at < now() - interval '45 minutes';

  -- Unchanged guide + mode already completed: reuse it unless the user explicitly asks for a new version.
  if not p_force then
    select * into v_job from public.study_videos
     where user_id = v_user_id and passage = p_passage and version_id = p_version_id
       and guide_hash = p_guide_hash and prompt_version = v_prompt and status = 'completed'
     order by created_at desc limit 1;
    if v_job.id is not null then
      return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'created', false, 'reused', true);
    end if;
  end if;

  begin
    insert into public.study_videos(user_id, passage, version_id, guide_hash, prompt_version, model, status,
      kind, study_mode, plan_version, stage, estimated_seconds, duration_seconds, call_budget, call_usage)
    values (v_user_id, p_passage, p_version_id, p_guide_hash, v_prompt, 'pipeline:study-seq-v1', 'queued',
      'sequence', p_mode, 'study-seq-v1', 'planning', v_seconds, 0, v_budget,
      '{"plan":0,"still":0,"clip":0,"tts":0}')
    returning * into v_job;
    v_created := true;
  exception when unique_violation then
    select * into v_job from public.study_videos
     where user_id = v_user_id and passage = p_passage and version_id = p_version_id
       and guide_hash = p_guide_hash and prompt_version = v_prompt and status in ('queued','generating')
     order by created_at desc limit 1;
  end;
  if v_job.id is null then
    raise exception 'unable to reserve study sequence';
  end if;
  return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'created', v_created, 'reused', false);
end;
$$;
revoke all on function public.reserve_study_sequence(text, integer, text, text, boolean) from public, anon;
grant execute on function public.reserve_study_sequence(text, integer, text, text, boolean) to authenticated;

-- 5) Atomically consume one provider call against the generation's hard ceiling.
create or replace function public.consume_study_video_call(p_video_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.study_videos;
  v_used integer;
  v_cap integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_kind not in ('plan','still','clip','tts') then
    raise exception 'invalid call kind' using errcode = '22023';
  end if;
  select * into v_row from public.study_videos
   where id = p_video_id and user_id = v_user_id and kind = 'sequence' and status = 'generating'
   for update;
  if v_row.id is null then
    return false;
  end if;
  v_used := coalesce((v_row.call_usage ->> p_kind)::integer, 0);
  v_cap := coalesce((v_row.call_budget ->> p_kind)::integer, 0);
  if v_used >= v_cap then
    return false;
  end if;
  update public.study_videos
     set call_usage = jsonb_set(call_usage, array[p_kind], to_jsonb(v_used + 1), true), updated_at = now()
   where id = v_row.id;
  return true;
end;
$$;
revoke all on function public.consume_study_video_call(uuid, text) from public, anon;
grant execute on function public.consume_study_video_call(uuid, text) to authenticated;

-- 6) Lock the validated plan once; later stages verify scene rows against this hash.
create or replace function public.lock_study_video_plan(p_video_id uuid, p_plan_hash text, p_title text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_plan_hash !~ '^[0-9a-f]{64}$' or char_length(coalesce(p_title, '')) not between 1 and 160 then
    raise exception 'invalid plan lock' using errcode = '22023';
  end if;
  update public.study_videos
     set plan_hash = p_plan_hash, plan_title = p_title, stage = 'visuals', stage_error = null, updated_at = now()
   where id = p_video_id and user_id = v_user_id and kind = 'sequence'
     and status = 'generating' and stage = 'planning' and plan_hash is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
revoke all on function public.lock_study_video_plan(uuid, text, text) from public, anon;
grant execute on function public.lock_study_video_plan(uuid, text, text) to authenticated;
