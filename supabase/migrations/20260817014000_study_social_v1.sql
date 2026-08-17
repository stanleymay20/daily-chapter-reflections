-- Personal study + opt-in community schema.
-- Scripture itself stays in YouVersion; cloud tables store references, user content, and AI commentary only.

create extension if not exists pgcrypto;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  reading_date date not null,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\\.[0-9]{1,3}$'),
  status text not null check (status in ('not_started','reading','complete')),
  updated_at timestamptz not null default now(),
  primary key (user_id, reading_date, passage)
);

create table if not exists public.verse_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id integer not null,
  passage text not null,
  verse text not null,
  reference text not null,
  highlight text check (highlight is null or highlight in ('yellow','green','blue','pink','purple')),
  note text,
  bookmarked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, version_id, passage, verse)
);

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  chapters_per_day integer not null check (chapters_per_day between 1 and 7),
  active_tracks jsonb not null default '[]'::jsonb,
  start_date date not null default current_date,
  paused boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_insights_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id integer not null,
  passage text not null,
  insights jsonb not null,
  generated_at timestamptz not null default now(),
  primary key(user_id, version_id, passage)
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null,
  excerpt text check (excerpt is null or char_length(excerpt) <= 240),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);

alter table public.user_settings enable row level security;
alter table public.reading_progress enable row level security;
alter table public.verse_saves enable row level security;
alter table public.study_plans enable row level security;
alter table public.ai_insights_cache enable row level security;
alter table public.community_posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments enable row level security;
alter table public.post_reports enable row level security;

-- Private user-owned data
create policy "settings own select" on public.user_settings for select using (auth.uid() = user_id);
create policy "settings own insert" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "settings own update" on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "progress own select" on public.reading_progress for select using (auth.uid() = user_id);
create policy "progress own insert" on public.reading_progress for insert with check (auth.uid() = user_id);
create policy "progress own update" on public.reading_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "progress own delete" on public.reading_progress for delete using (auth.uid() = user_id);

create policy "verse saves own select" on public.verse_saves for select using (auth.uid() = user_id);
create policy "verse saves own insert" on public.verse_saves for insert with check (auth.uid() = user_id);
create policy "verse saves own update" on public.verse_saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "verse saves own delete" on public.verse_saves for delete using (auth.uid() = user_id);

create policy "plans own select" on public.study_plans for select using (auth.uid() = user_id);
create policy "plans own insert" on public.study_plans for insert with check (auth.uid() = user_id);
create policy "plans own update" on public.study_plans for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plans own delete" on public.study_plans for delete using (auth.uid() = user_id);

create policy "ai cache own select" on public.ai_insights_cache for select using (auth.uid() = user_id);
create policy "ai cache own insert" on public.ai_insights_cache for insert with check (auth.uid() = user_id);
create policy "ai cache own update" on public.ai_insights_cache for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai cache own delete" on public.ai_insights_cache for delete using (auth.uid() = user_id);

-- Community is readable by everyone, write actions require authenticated ownership.
create policy "community public select" on public.community_posts for select using (true);
create policy "community own insert" on public.community_posts for insert with check (auth.uid() = user_id);
create policy "community own update" on public.community_posts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "community own delete" on public.community_posts for delete using (auth.uid() = user_id);

create policy "likes public select" on public.post_likes for select using (true);
create policy "likes own insert" on public.post_likes for insert with check (auth.uid() = user_id);
create policy "likes own delete" on public.post_likes for delete using (auth.uid() = user_id);

create policy "comments public select" on public.comments for select using (true);
create policy "comments own insert" on public.comments for insert with check (auth.uid() = user_id);
create policy "comments own update" on public.comments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments own delete" on public.comments for delete using (auth.uid() = user_id);

create policy "reports own select" on public.post_reports for select using (auth.uid() = user_id);
create policy "reports own insert" on public.post_reports for insert with check (auth.uid() = user_id);

create index if not exists reading_progress_user_date_idx on public.reading_progress(user_id, reading_date);
create index if not exists verse_saves_user_updated_idx on public.verse_saves(user_id, updated_at desc);
create index if not exists community_posts_created_idx on public.community_posts(created_at desc);
create index if not exists comments_post_created_idx on public.comments(post_id, created_at);
