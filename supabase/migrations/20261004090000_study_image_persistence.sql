-- Durable, user-owned Bible study illustrations with concurrency-safe generation jobs.
-- Scripture text remains in YouVersion; these tables store only AI study metadata and image references.

create extension if not exists pgcrypto;

create table if not exists public.study_image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'),
  version_id integer not null check (version_id > 0),
  guide_hash text not null check (guide_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  status text not null default 'queued' check (status in ('queued','generating','completed','failed','cancelled')),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique references public.study_image_jobs(id) on delete cascade,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'),
  version_id integer not null check (version_id > 0),
  guide_hash text not null check (guide_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  created_at timestamptz not null default now(),
  selected_at timestamptz not null default now()
);

create unique index if not exists study_image_jobs_one_active_idx
  on public.study_image_jobs(user_id, passage, version_id, guide_hash, prompt_version)
  where status in ('queued','generating');
create index if not exists study_image_jobs_user_recent_idx
  on public.study_image_jobs(user_id, created_at desc);
create index if not exists study_images_lookup_idx
  on public.study_images(user_id, passage, version_id, selected_at desc, created_at desc);

alter table public.study_image_jobs enable row level security;
alter table public.study_images enable row level security;

drop policy if exists "study image jobs own select" on public.study_image_jobs;
create policy "study image jobs own select" on public.study_image_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "study image jobs own insert" on public.study_image_jobs;
create policy "study image jobs own insert" on public.study_image_jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "study image jobs own update" on public.study_image_jobs;
create policy "study image jobs own update" on public.study_image_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "study image jobs own delete" on public.study_image_jobs;
create policy "study image jobs own delete" on public.study_image_jobs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "study images own select" on public.study_images;
create policy "study images own select" on public.study_images
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "study images own insert" on public.study_images;
create policy "study images own insert" on public.study_images
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "study images own update" on public.study_images;
create policy "study images own update" on public.study_images
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "study images own delete" on public.study_images;
create policy "study images own delete" on public.study_images
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.study_image_jobs to authenticated;
grant select, insert, update, delete on public.study_images to authenticated;
-- The existing cache becomes the durable source for chapter guides used by image generation.
grant select, insert, update, delete on public.ai_insights_cache to authenticated;

-- Reserve one active generation per exact user/chapter/translation/guide/prompt combination.
-- SECURITY INVOKER is intentional: normal RLS remains in force.
create or replace function public.reserve_study_image_job(
  p_passage text,
  p_version_id integer,
  p_guide_hash text,
  p_prompt_version text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.study_image_jobs;
  v_created boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_passage !~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'
     or p_version_id <= 0
     or p_guide_hash !~ '^[0-9a-f]{64}$'
     or char_length(p_prompt_version) not between 1 and 80 then
    raise exception 'invalid study image job input' using errcode = '22023';
  end if;

  -- A tab/device can disappear without sending cancellation. Expire such locks safely.
  update public.study_image_jobs
     set status = 'failed',
         last_error = 'Generation lease expired before completion.',
         updated_at = now()
   where user_id = v_user_id
     and passage = p_passage
     and version_id = p_version_id
     and guide_hash = p_guide_hash
     and prompt_version = p_prompt_version
     and status in ('queued','generating')
     and updated_at < now() - interval '15 minutes';

  begin
    insert into public.study_image_jobs(user_id, passage, version_id, guide_hash, prompt_version, status)
    values(v_user_id, p_passage, p_version_id, p_guide_hash, p_prompt_version, 'queued')
    returning * into v_job;
    v_created := true;
  exception when unique_violation then
    select * into v_job
      from public.study_image_jobs
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
    raise exception 'unable to reserve image generation job';
  end if;

  return jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'created', v_created,
    'createdAt', v_job.created_at
  );
end;
$$;

revoke all on function public.reserve_study_image_job(text, integer, text, text) from public, anon;
grant execute on function public.reserve_study_image_job(text, integer, text, text) to authenticated;

-- Private media bucket. Browser uploads/downloads stay behind the signed-in user's JWT.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('study-images', 'study-images', false, 10485760, array['image/png']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "study image objects own select" on storage.objects;
create policy "study image objects own select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'study-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "study image objects own insert" on storage.objects;
create policy "study image objects own insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'study-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "study image objects own delete" on storage.objects;
create policy "study image objects own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'study-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
