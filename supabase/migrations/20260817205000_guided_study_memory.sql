-- Private guided-study memory. Stores only user-authored content and Bible references, never Scripture text.
create table if not exists public.chapter_studies (
  user_id uuid not null references auth.users(id) on delete cascade,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$'),
  intention text,
  reflections jsonb not null default '{}'::jsonb,
  prayer text,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id, passage)
);

create table if not exists public.daily_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  gratitude text,
  takeaway text,
  prayer text,
  updated_at timestamptz not null default now(),
  primary key(user_id, review_date)
);

alter table public.chapter_studies enable row level security;
alter table public.daily_reviews enable row level security;

create policy "chapter studies own select" on public.chapter_studies for select using (auth.uid() = user_id);
create policy "chapter studies own insert" on public.chapter_studies for insert with check (auth.uid() = user_id);
create policy "chapter studies own update" on public.chapter_studies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chapter studies own delete" on public.chapter_studies for delete using (auth.uid() = user_id);

create policy "daily reviews own select" on public.daily_reviews for select using (auth.uid() = user_id);
create policy "daily reviews own insert" on public.daily_reviews for insert with check (auth.uid() = user_id);
create policy "daily reviews own update" on public.daily_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily reviews own delete" on public.daily_reviews for delete using (auth.uid() = user_id);

create index if not exists chapter_studies_user_updated_idx on public.chapter_studies(user_id, updated_at desc);
create index if not exists daily_reviews_user_date_idx on public.daily_reviews(user_id, review_date desc);
