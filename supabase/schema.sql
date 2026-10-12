-- GTD dashboard sync: one JSON state blob per signed-in user.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.gtd_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.gtd_state enable row level security;

-- Each user can only see and change their own row.
drop policy if exists "own row select" on public.gtd_state;
drop policy if exists "own row insert" on public.gtd_state;
drop policy if exists "own row update" on public.gtd_state;

create policy "own row select" on public.gtd_state
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.gtd_state
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.gtd_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
