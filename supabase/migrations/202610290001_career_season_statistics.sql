-- Career, season and coach statistics foundation.
-- Apply only to the dedicated Football Trainer Supabase project, never to the unrelated ne-po-spisku project.
create extension if not exists pgcrypto;

create table if not exists public.coach_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  season_number integer not null unique check (season_number > 0),
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'planned' check (status in ('planned','active','completed','archived')),
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  birth_date date,
  debut_season_id uuid references public.seasons(id) on delete set null,
  retired_at timestamptz,
  retirement_reason text check (retirement_reason is null or retirement_reason in ('age_21','retired','other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  source_match_key text not null unique,
  season_id uuid not null references public.seasons(id) on delete restrict,
  competition_name text not null,
  home_team_id uuid not null references public.teams(id) on delete restrict,
  away_team_id uuid not null references public.teams(id) on delete restrict,
  coach_id uuid references public.coach_profiles(id) on delete set null,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  status text not null default 'finalized' check (status in ('finalized','voided')),
  is_official boolean not null default true,
  started_at timestamptz,
  finalized_at timestamptz not null default now(),
  protocol jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  check (is_official or status = 'voided')
);

create table if not exists public.match_player_stats (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  started boolean not null default false,
  appeared boolean not null default false,
  minutes_played numeric(6,2) not null default 0 check (minutes_played >= 0),
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  shots integer not null default 0 check (shots >= 0),
  shots_on_target integer not null default 0 check (shots_on_target >= 0 and shots_on_target <= shots),
  saves integer not null default 0 check (saves >= 0),
  yellow_cards integer not null default 0 check (yellow_cards >= 0),
  red_cards integer not null default 0 check (red_cards >= 0),
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  event_key text not null,
  minute numeric(5,2) not null check (minute >= 0),
  event_type text not null check (event_type in ('goal','own_goal','substitution','yellow_card','red_card','injury','key_moment')),
  team_id uuid references public.teams(id) on delete restrict,
  player_id uuid references public.players(id) on delete restrict,
  secondary_player_id uuid references public.players(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, event_key)
);

create table if not exists public.player_team_history (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  reason text check (reason is null or reason in ('transfer','age_21','release','other')),
  created_at timestamptz not null default now(),
  check (left_at is null or left_at >= joined_at)
);
create unique index if not exists player_team_history_one_active_team
  on public.player_team_history(player_id) where left_at is null;

create table if not exists public.coach_team_history (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coach_profiles(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  reason text check (reason is null or reason in ('appointment','resignation','dismissal','other')),
  created_at timestamptz not null default now(),
  check (left_at is null or left_at >= joined_at)
);
create unique index if not exists coach_team_history_one_active_team
  on public.coach_team_history(coach_id) where left_at is null;

create table if not exists public.player_season_stats (
  player_id uuid not null references public.players(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  appearances integer not null default 0 check (appearances >= 0),
  starts integer not null default 0 check (starts >= 0),
  minutes_played numeric(8,2) not null default 0 check (minutes_played >= 0),
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  shots integer not null default 0 check (shots >= 0),
  shots_on_target integer not null default 0 check (shots_on_target >= 0),
  saves integer not null default 0 check (saves >= 0),
  updated_at timestamptz not null default now(),
  primary key (player_id, season_id, team_id)
);

create table if not exists public.coach_season_stats (
  coach_id uuid not null references public.coach_profiles(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  played integer not null default 0 check (played >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  goals_for integer not null default 0 check (goals_for >= 0),
  goals_against integer not null default 0 check (goals_against >= 0),
  final_place integer check (final_place is null or final_place > 0),
  trophies jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coach_id, season_id, team_id),
  check (wins + draws + losses = played)
);

create table if not exists public.team_season_stats (
  team_id uuid not null references public.teams(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  played integer not null default 0 check (played >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  goals_for integer not null default 0 check (goals_for >= 0),
  goals_against integer not null default 0 check (goals_against >= 0),
  points integer not null default 0 check (points >= 0),
  final_place integer check (final_place is null or final_place > 0),
  updated_at timestamptz not null default now(),
  primary key (team_id, season_id),
  check (wins + draws + losses = played)
);

create table if not exists public.career_achievements (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  entity_type text not null check (entity_type in ('coach','player','team')),
  entity_id uuid not null,
  season_id uuid references public.seasons(id) on delete set null,
  achievement_type text not null,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  achieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, season_id, achievement_type)
);

create index if not exists matches_season_idx on public.matches(season_id, finalized_at);
create index if not exists matches_home_team_idx on public.matches(home_team_id, season_id);
create index if not exists matches_away_team_idx on public.matches(away_team_id, season_id);
create index if not exists match_events_match_minute_idx on public.match_events(match_id, minute);
create index if not exists match_player_stats_player_idx on public.match_player_stats(player_id, match_id);
create index if not exists player_season_stats_season_idx on public.player_season_stats(season_id, team_id);

-- No browser-facing write policies are added. Official match writes must go through a
-- trusted server/Edge Function that authenticates the owner and validates the protocol.
alter table public.coach_profiles enable row level security;
alter table public.teams enable row level security;
alter table public.seasons enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_player_stats enable row level security;
alter table public.match_events enable row level security;
alter table public.player_team_history enable row level security;
alter table public.coach_team_history enable row level security;
alter table public.player_season_stats enable row level security;
alter table public.coach_season_stats enable row level security;
alter table public.team_season_stats enable row level security;
alter table public.career_achievements enable row level security;
