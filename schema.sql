-- Postgres starter schema for multi-user campaign planning workspace

create table if not exists app_user (
  id uuid primary key,
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace (
  id uuid primary key,
  owner_user_id uuid not null references app_user(id),
  name text not null,
  layout_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists widget_instance (
  id uuid primary key,
  workspace_id uuid not null references workspace(id) on delete cascade,
  widget_type text not null,
  title text not null,
  x integer not null default 0,
  y integer not null default 0,
  w integer not null default 4,
  h integer not null default 4,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists planning_event (
  id uuid primary key,
  workspace_id uuid not null references workspace(id) on delete cascade,
  event_type text not null check (event_type in ('holiday','recurring','campaign')),
  event_name text not null,
  start_date date not null,
  end_date date not null,
  attributes_json jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists llm_run (
  id uuid primary key,
  workspace_id uuid not null references workspace(id) on delete cascade,
  user_id uuid references app_user(id),
  run_type text not null,
  model_name text not null,
  request_hash text not null,
  prompt_version text,
  input_json jsonb not null,
  output_json jsonb,
  explainability_json jsonb,
  latency_ms integer,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_widget_workspace on widget_instance(workspace_id);
create index if not exists idx_event_workspace_dates on planning_event(workspace_id, start_date, end_date);
create index if not exists idx_llm_run_workspace_type on llm_run(workspace_id, run_type, created_at desc);
