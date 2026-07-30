create type public.data_quality_status as enum ('verified','review','blocked');

alter table public.clients
  add column original_name text,
  add column phone text,
  add column email text,
  add column instagram text,
  add column cpf text,
  add column birth_date date,
  add column postal_code text,
  add column address_line text,
  add column address_number text,
  add column complement text,
  add column district text,
  add column city text,
  add column state text,
  add column source text not null default 'manual',
  add column merged_into_id uuid references public.clients(id),
  add column deleted_at timestamptz;

create unique index clients_org_cpf_unique
  on public.clients(organization_id,cpf) where cpf is not null and btrim(cpf)<>'';
create index clients_org_contact_idx on public.clients(organization_id,email,phone);

alter table public.sales alter column sale_date drop not null;
alter table public.sales
  add column original_client text,
  add column original_date text,
  add column original_amount text,
  add column original_payment_status text,
  add column original_payment_method text,
  add column source_file text,
  add column source_sheet text,
  add column source_row integer,
  add column raw_data jsonb,
  add column quality_warnings text[] not null default '{}',
  add column data_quality_status public.data_quality_status not null default 'verified',
  add column is_possible_duplicate boolean not null default false,
  add column is_financially_accountable boolean generated always as
    (deleted_at is null and sale_date is not null and payment_status in ('paid','pending')) stored;

alter table public.import_rows
  add column source_file text,
  add column source_sheet text,
  add column original_client text,
  add column original_date text,
  add column original_amount text,
  add column original_payment_status text,
  add column original_payment_method text,
  add column warnings text[] not null default '{}',
  add column blockers text[] not null default '{}',
  add column is_accountable boolean not null default false;

create table public.client_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  possible_duplicate_id uuid not null references public.clients(id) on delete cascade,
  reason text not null,
  score numeric(4,3),
  status text not null default 'pending' check(status in('pending','dismissed','merged')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check(client_id <> possible_duplicate_id),
  unique(organization_id,client_id,possible_duplicate_id)
);
create table public.client_merge_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_client_id uuid not null references public.clients(id),
  target_client_id uuid not null references public.clients(id),
  moved_sale_ids uuid[] not null default '{}',
  merged_by uuid not null references public.profiles(id),
  merged_at timestamptz not null default now(),
  reverted_by uuid references public.profiles(id),
  reverted_at timestamptz,
  check(source_client_id <> target_client_id)
);

alter table public.client_duplicate_candidates enable row level security;
alter table public.client_merge_history enable row level security;
create policy client_duplicate_select on public.client_duplicate_candidates for select
  using(organization_id in(select public.current_user_org_ids()));
create policy client_duplicate_write on public.client_duplicate_candidates for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));
create policy client_merge_select on public.client_merge_history for select
  using(organization_id in(select public.current_user_org_ids()));
create policy client_merge_write on public.client_merge_history for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));

create trigger audit_client_duplicates after insert or update or delete on public.client_duplicate_candidates
  for each row execute function public.audit_row_change();
create trigger audit_client_merges after insert or update or delete on public.client_merge_history
  for each row execute function public.audit_row_change();

create or replace function public.merge_clients(source_id uuid,target_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid; moved uuid[]; history_id uuid;
begin
  select organization_id into org from public.clients where id=source_id and deleted_at is null;
  if org is null or not public.has_org_role(org,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.clients where id=target_id and organization_id=org and deleted_at is null) then raise exception 'invalid target'; end if;
  select coalesce(array_agg(id),'{}') into moved from public.sales where client_id=source_id and deleted_at is null;
  update public.sales set client_id=target_id,updated_at=now() where client_id=source_id and deleted_at is null;
  update public.clients set merged_into_id=target_id,deleted_at=now(),updated_at=now() where id=source_id;
  insert into public.client_merge_history(organization_id,source_client_id,target_client_id,moved_sale_ids,merged_by)
    values(org,source_id,target_id,moved,auth.uid()) returning id into history_id;
  return history_id;
end $$;

create or replace function public.revert_client_merge(history_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare h public.client_merge_history;
begin
  select * into h from public.client_merge_history where id=history_id and reverted_at is null;
  if h.id is null or not public.has_org_role(h.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.sales where id=any(h.moved_sale_ids) and client_id<>h.target_client_id) then raise exception 'merge can no longer be reverted safely'; end if;
  update public.sales set client_id=h.source_client_id,updated_at=now() where id=any(h.moved_sale_ids);
  update public.clients set merged_into_id=null,deleted_at=null,updated_at=now() where id=h.source_client_id;
  update public.client_merge_history set reverted_by=auth.uid(),reverted_at=now() where id=history_id;
end $$;

create or replace function public.sales_metrics(org_id uuid,start_date date,end_date date)
returns jsonb language sql stable security invoker set search_path=public as $$
  with base as (
    select * from public.sales where organization_id=org_id and deleted_at is null
      and (sale_date between start_date and end_date or (sale_date is null and data_quality_status='review'))
  )
  select jsonb_build_object(
    'period_start',start_date,'period_end',end_date,
    'gross_volume',coalesce(sum(amount),0),
    'revenue',coalesce(sum(amount) filter(where is_financially_accountable),0),
    'paid',coalesce(sum(amount) filter(where payment_status='paid'),0),
    'pending',coalesce(sum(amount) filter(where payment_status='pending'),0),
    'cancelled',coalesce(sum(amount) filter(where payment_status='cancelled'),0),
    'review_value',coalesce(sum(amount) filter(where data_quality_status='review'),0),
    'total_records',count(*),
    'accounted_records',count(*) filter(where is_financially_accountable),
    'review_records',count(*) filter(where data_quality_status='review'),
    'possible_duplicates',count(*) filter(where is_possible_duplicate),
    'unique_clients',count(distinct client_id),
    'quality_percent',case when count(*)=0 then 0 else round(100.0*count(*) filter(where data_quality_status='verified')/count(*),2) end,
    'average_ticket',coalesce(avg(amount) filter(where is_financially_accountable),0),
    'last_updated',max(updated_at)
  ) from base;
$$;
