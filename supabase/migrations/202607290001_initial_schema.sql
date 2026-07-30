create extension if not exists pgcrypto;
create extension if not exists unaccent;

create type public.member_role as enum ('admin','manager','operator','viewer');
create type public.payment_status as enum ('paid','pending','cancelled','unknown');
create type public.import_status as enum ('uploaded','validating','awaiting_confirmation','processing','completed','completed_with_errors','cancelled','reverted','failed');
create type public.insight_status as enum ('new','viewed','archived','resolved');
create type public.insight_impact as enum ('high','medium','low');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null,
  status text not null default 'active',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_org_normalized_idx on public.clients(organization_id,normalized_name);
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  sheet_name text,
  status public.import_status not null default 'uploaded',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  rejected_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  processed_rows integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz
);
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  sale_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  payment_status public.payment_status not null default 'unknown',
  payment_method text,
  notes text,
  source text not null default 'manual',
  import_batch_id uuid references public.import_batches(id),
  import_signature text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index sales_org_date_idx on public.sales(organization_id,sale_date);
create index sales_org_client_idx on public.sales(organization_id,client_id);
create index sales_import_signature_idx on public.sales(organization_id,import_signature);
create table public.import_rows (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null,
  normalized_data jsonb,
  is_valid boolean not null default false,
  is_duplicate boolean not null default false,
  import_signature text,
  sale_id uuid references public.sales(id),
  created_at timestamptz not null default now(),
  unique(import_batch_id,row_number)
);
create table public.import_errors (
  id bigint generated always as identity primary key,
  import_row_id bigint not null references public.import_rows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  field_name text,
  error_code text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  category text not null,
  period_start date,
  period_end date,
  metrics jsonb not null default '{}',
  explanation text not null,
  recommendation text not null,
  impact public.insight_impact not null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  status public.insight_status not null default 'new',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  title text,
  created_at timestamptz not null default now()
);
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  run_type text not null,
  status text not null,
  metric_keys text[] not null default '{}',
  model text,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
revoke update, delete on public.audit_logs from authenticated;

create or replace function public.normalize_person_name(value text)
returns text language sql immutable parallel safe as $$
  select lower(btrim(regexp_replace(unaccent(replace(replace(replace(coalesce(value,''),chr(8203),''),chr(8204),''),chr(65279),'')),'\s+',' ','g')));
$$;
create or replace function public.current_user_org_ids()
returns setof uuid language sql stable security definer set search_path=public as $$
  select organization_id from public.organization_members where user_id = auth.uid();
$$;
create or replace function public.has_org_role(org_id uuid, allowed public.member_role[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members where organization_id=org_id and user_id=auth.uid() and role=any(allowed));
$$;
create or replace function public.sales_metrics(org_id uuid, start_date date, end_date date)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'period_start',start_date,'period_end',end_date,
    'revenue',coalesce(sum(amount) filter(where payment_status <> 'cancelled'),0),
    'paid',coalesce(sum(amount) filter(where payment_status='paid'),0),
    'pending',coalesce(sum(amount) filter(where payment_status='pending'),0),
    'cancelled',coalesce(sum(amount) filter(where payment_status='cancelled'),0),
    'sales',count(*) filter(where payment_status <> 'cancelled'),
    'unique_clients',count(distinct client_id) filter(where payment_status <> 'cancelled'),
    'average_ticket',coalesce(avg(amount) filter(where payment_status <> 'cancelled'),0)
  ) from public.sales where organization_id=org_id and deleted_at is null and sale_date between start_date and end_date;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('commercial-imports','commercial-imports',false,52428800,array['text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
