-- À exécuter dans Supabase : SQL Editor > New query > Run
create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text        not null check (char_length(name) between 1 and 16),
  score      integer     not null check (score between 0 and 1000000),
  towers     integer     not null default 0 check (towers between 0 and 20),
  shrines    integer     not null default 0 check (shrines between 0 and 40),
  lumis      integer     not null default 0 check (lumis between 0 and 200),
  created_at timestamptz not null default now()
);
create index if not exists scores_score_idx on public.scores (score desc);

alter table public.scores enable row level security;

drop policy if exists "lecture publique" on public.scores;
create policy "lecture publique" on public.scores for select to anon using (true);

drop policy if exists "ajout public" on public.scores;
create policy "ajout public" on public.scores for insert to anon
  with check (char_length(name) between 1 and 16 and score between 0 and 1000000);
