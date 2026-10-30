-- Public online leaderboards for trainer XP and career-wide rating.
-- Writes and reads are performed by the authenticated career-api Edge Function only.
create table if not exists public.online_coach_ratings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  coach_name text not null check (char_length(btrim(coach_name)) between 1 and 40),
  team_name text not null check (char_length(btrim(team_name)) between 1 and 60),
  season_number integer not null default 1 check (season_number between 1 and 10000),
  avatar_index integer not null default 1 check (avatar_index between 1 and 6),
  team_logo_index integer not null default 1 check (team_logo_index between 1 and 6),
  awards jsonb not null default '[]'::jsonb check (jsonb_typeof(awards) = 'array'),
  xp bigint not null default 0 check (xp between 0 and 1000000000),
  general_rating bigint not null default 0 check (general_rating between 0 and 1000000000),
  xp_submitted_at timestamptz,
  general_rating_submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists online_coach_ratings_xp_order_idx
  on public.online_coach_ratings (xp desc, updated_at asc);
create index if not exists online_coach_ratings_general_order_idx
  on public.online_coach_ratings (general_rating desc, updated_at asc);
alter table public.online_coach_ratings enable row level security;
revoke all on public.online_coach_ratings from anon, authenticated;
grant all on public.online_coach_ratings to service_role;
