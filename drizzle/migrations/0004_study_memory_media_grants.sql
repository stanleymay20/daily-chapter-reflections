-- Explicit Data API grants for private study memory and study media.
-- Owner-scoped RLS remains the row boundary; signed-out visitors get no table access at all.
grant select, insert, update, delete on public.chapter_studies to authenticated;
grant select, insert, update, delete on public.daily_reviews to authenticated;
grant all on public.chapter_studies to service_role;
grant all on public.daily_reviews to service_role;
grant all on public.study_image_jobs to service_role;
grant all on public.study_images to service_role;
revoke all on public.chapter_studies from anon;
revoke all on public.daily_reviews from anon;
revoke all on public.study_image_jobs from anon;
revoke all on public.study_images from anon;
