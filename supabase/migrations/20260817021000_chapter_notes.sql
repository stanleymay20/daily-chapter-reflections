create table if not exists public.chapter_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  passage text not null check (passage ~ '^[1-3]?[A-Z]{2,3}\\.[0-9]{1,3}$'),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, passage)
);

alter table public.chapter_notes enable row level security;

create policy "chapter notes own select" on public.chapter_notes for select using (auth.uid() = user_id);
create policy "chapter notes own insert" on public.chapter_notes for insert with check (auth.uid() = user_id);
create policy "chapter notes own update" on public.chapter_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chapter notes own delete" on public.chapter_notes for delete using (auth.uid() = user_id);
