-- Video Aid v1: raise the per-generation planning ceiling from 4 to 6 calls so that an explicit
-- retry gets a full draft -> repair -> grounding-audit cycle. Applies to new generations only;
-- existing rows keep the budget they were reserved with. Other ceilings are unchanged.
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
    when 'quick' then v_budget := '{"plan":6,"still":3,"clip":3,"tts":7}'; v_seconds := 60;
    when 'standard' then v_budget := '{"plan":6,"still":6,"clip":4,"tts":11}'; v_seconds := 120;
    when 'deep' then v_budget := '{"plan":6,"still":11,"clip":5,"tts":17}'; v_seconds := 180;
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
