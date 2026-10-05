-- Close a table-wide UPDATE grant on study_videos: owners may change only lifecycle fields.
-- Call budget/usage, plan lock, kind and mode stay writable only through SECURITY DEFINER functions.
revoke update on public.study_videos from authenticated;
grant update (status, provider_job_id, progress, storage_path, scenes, last_error, updated_at, selected_at,
  stage, stage_error, manifest, duration_seconds) on public.study_videos to authenticated;
