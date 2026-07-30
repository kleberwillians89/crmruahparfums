create table if not exists public.perfumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name_raw text not null,
  normalized_name text not null,
  base_name text not null,
  brand_house text,
  bottle_identifier text,
  created_at timestamptz not null default now(),
  unique(organization_id,normalized_name)
);
alter table public.perfumes enable row level security;
create policy perfume_org_select on public.perfumes for select
  using(organization_id in(select public.current_user_org_ids()));
create policy perfume_org_write on public.perfumes for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

alter table public.sales
  add column if not exists perfume_id uuid references public.perfumes(id),
  add column if not exists client_name_raw text,
  add column if not exists shipping_deadline_raw text,
  add column if not exists shipping_deadline_date date,
  add column if not exists shipping_operational_status text,
  add column if not exists shipped_at date,
  add column if not exists sale_type text check(sale_type is null or sale_type in('APC','SPLIT')),
  add column if not exists volume_ml numeric(12,3) check(volume_ml is null or volume_ml>=0),
  add column if not exists volume_ml_raw text,
  add column if not exists perfume_name_raw text,
  add column if not exists perfume_base_name text,
  add column if not exists bottle_identifier text,
  add column if not exists paid_at date,
  add column if not exists credit_reference_amount numeric(14,2);

create index if not exists sales_org_perfume_idx on public.sales(organization_id,perfume_id);
create index if not exists sales_org_type_idx on public.sales(organization_id,sale_type);
create index if not exists sales_org_shipping_idx
  on public.sales(organization_id,shipping_operational_status,shipped_at);

create or replace function public.replace_commercial_batch_v2(
  p_organization_id uuid,
  p_user_id uuid,
  p_old_batch_id uuid,
  p_file_name text,
  p_file_hash text,
  p_sheet_name text,
  p_raw_headers jsonb,
  p_rows jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch_id uuid;
  v_total_rows integer;
  v_sale_rows integer;
  v_review_rows integer;
  v_stock_rows integer;
  v_clients integer;
  v_duplicates integer;
  v_missing_ml integer;
  v_gross numeric(14,2);
  v_paid numeric(14,2);
  v_pending numeric(14,2);
  v_stock_pending numeric(14,2);
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(
    select 1 from public.organization_members
    where organization_id=p_organization_id and user_id=p_user_id and role='admin'
  ) then raise exception 'administrator_membership_required'; end if;

  perform 1 from public.import_batches
    where id=p_old_batch_id and organization_id=p_organization_id
      and file_hash=p_file_hash and status='completed'
    for update;
  if not found then raise exception 'approved_batch_not_found'; end if;

  select
    count(*),
    count(*) filter(where item->>'row_type'='sale'),
    count(*) filter(where item->>'row_type'<>'sale'),
    count(*) filter(where item->>'row_type'='stock'),
    count(distinct item->>'normalized_client') filter(
      where coalesce(item->>'normalized_client','')<>'' and item->>'row_type'<>'stock'
    ),
    count(*) filter(
      where item->>'row_type'='sale' and coalesce((item->>'is_duplicate')::boolean,false)
    ),
    count(*) filter(where item->>'row_type'='sale' and item->>'volume_ml' is null),
    coalesce(sum((item->>'amount')::numeric) filter(where item->>'amount' is not null),0),
    coalesce(sum((item->>'amount')::numeric) filter(
      where item->>'row_type'='sale' and item->>'payment_status'='paid'
    ),0),
    coalesce(sum((item->>'amount')::numeric) filter(
      where item->>'row_type'='sale' and item->>'payment_status'='pending'
    ),0),
    coalesce(sum((item->>'amount')::numeric) filter(
      where item->>'row_type'='stock' and item->>'payment_status'='pending'
    ),0)
  into v_total_rows,v_sale_rows,v_review_rows,v_stock_rows,v_clients,
       v_duplicates,v_missing_ml,v_gross,v_paid,v_pending,v_stock_pending
  from jsonb_array_elements(p_rows) item;

  if v_total_rows<>5926 or v_sale_rows<>5892 or v_review_rows<>34
    or v_stock_rows<>15 or v_clients<>418 or v_duplicates<>20 or v_missing_ml<>1
    or v_gross<>1673690.78 or v_paid<>1561552.38
    or v_pending<>91257.80 or v_stock_pending<>1340.20
    or exists(select 1 from jsonb_array_elements(p_rows) item
      where coalesce(item->>'perfume_name_raw','')='' or item->>'sale_type' not in('APC','SPLIT')) then
    raise exception 'v2_pre_import_reconciliation_failed';
  end if;

  update public.import_rows set sale_id=null where import_batch_id=p_old_batch_id;
  delete from public.sales where import_batch_id=p_old_batch_id;
  delete from public.import_batches where id=p_old_batch_id;

  insert into public.import_batches(
    organization_id,file_name,file_hash,storage_path,sheet_name,status,
    total_rows,valid_rows,rejected_rows,duplicate_rows,processed_rows,
    raw_total,metadata,created_by
  ) values(
    p_organization_id,p_file_name,p_file_hash,
    p_organization_id::text||'/'||p_file_hash||'/'||p_file_name,
    p_sheet_name,'processing',v_total_rows,v_sale_rows,v_review_rows,
    v_duplicates,0,v_gross,
    jsonb_build_object(
      'raw_headers',p_raw_headers,
      'stock_rows',v_stock_rows,
      'stock_pending',v_stock_pending,
      'commercial_items_without_numeric_ml',v_missing_ml,
      'credit_policy','reference_only_never_aggregated',
      'transactional_replacement',true,
      'replaced_batch_id',p_old_batch_id
    ),p_user_id
  ) returning id into v_batch_id;

  insert into public.clients(
    organization_id,name,original_name,normalized_name,status,source,created_by
  )
  select
    p_organization_id,
    (array_agg(item->>'display_client' order by (item->>'source_row')::integer))[1],
    (array_agg(item->>'display_client' order by (item->>'source_row')::integer))[1],
    item->>'normalized_client','active','spreadsheet',p_user_id
  from jsonb_array_elements(p_rows) item
  where coalesce(item->>'normalized_client','')<>'' and item->>'row_type'<>'stock'
    and not exists(
      select 1 from public.clients c
      where c.organization_id=p_organization_id
        and c.normalized_name=item->>'normalized_client'
        and c.deleted_at is null
    )
  group by item->>'normalized_client';

  insert into public.perfumes(
    organization_id,full_name_raw,normalized_name,base_name,bottle_identifier
  )
  select
    p_organization_id,
    (array_agg(item->>'perfume_name_raw' order by (item->>'source_row')::integer))[1],
    public.normalize_person_name(item->>'perfume_name_raw'),
    (array_agg(item->>'perfume_base_name' order by (item->>'source_row')::integer))[1],
    nullif((array_agg(item->>'bottle_identifier' order by (item->>'source_row')::integer))[1],'')
  from jsonb_array_elements(p_rows) item
  where coalesce(item->>'perfume_name_raw','')<>''
  group by public.normalize_person_name(item->>'perfume_name_raw')
  on conflict(organization_id,normalized_name) do nothing;

  insert into public.import_rows(
    import_batch_id,organization_id,row_number,raw_data,normalized_data,
    is_valid,is_duplicate,import_signature,source_file,source_sheet,
    original_client,original_date,original_amount,original_payment_status,
    original_payment_method,warnings,blockers,is_accountable,row_type
  )
  select
    v_batch_id,p_organization_id,(item->>'source_row')::integer,item->'raw_data',
    jsonb_build_object(
      'client',item->>'normalized_client','date',item->>'sale_date',
      'amount',item->'amount','payment_status',item->>'payment_status',
      'row_type',item->>'row_type','perfume_name_raw',item->>'perfume_name_raw',
      'perfume_base_name',item->>'perfume_base_name',
      'bottle_identifier',item->>'bottle_identifier','sale_type',item->>'sale_type',
      'volume_ml',item->'volume_ml','volume_ml_raw',item->>'volume_ml_raw',
      'shipping_deadline_raw',item->>'shipping_deadline_raw',
      'shipping_deadline_date',item->>'shipping_deadline_date',
      'shipping_operational_status',item->>'shipping_operational_status',
      'shipped_at',item->>'shipped_at','paid_at',item->>'paid_at',
      'credit_reference_amount',item->'credit_reference_amount'
    ),
    item->>'row_type'='sale',
    coalesce((item->>'is_duplicate')::boolean,false),
    item->>'signature',p_file_name,p_sheet_name,
    item->>'display_client',item->>'original_date',item->>'original_amount',
    item->>'original_payment_status',item->>'original_payment_method',
    coalesce(array(select jsonb_array_elements_text(item->'warnings')),'{}'),
    coalesce(array(select jsonb_array_elements_text(item->'blockers')),'{}'),
    item->>'row_type'='sale' and item->>'sale_date' is not null
      and item->>'payment_status' in('paid','pending'),
    item->>'row_type'
  from jsonb_array_elements(p_rows) item;

  insert into public.sales(
    organization_id,client_id,perfume_id,sale_date,amount,payment_status,
    payment_method,notes,source,import_batch_id,import_signature,created_by,
    original_client,client_name_raw,original_date,original_amount,
    original_payment_status,original_payment_method,source_file,source_sheet,
    source_row,raw_data,quality_warnings,data_quality_status,is_possible_duplicate,
    shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,
    shipped_at,sale_type,volume_ml,volume_ml_raw,perfume_name_raw,
    perfume_base_name,bottle_identifier,paid_at,credit_reference_amount
  )
  select
    p_organization_id,c.id,p.id,nullif(item->>'sale_date','')::date,
    (item->>'amount')::numeric,(item->>'payment_status')::public.payment_status,
    nullif(item->>'payment_method',''),nullif(item->>'note',''),
    'spreadsheet',v_batch_id,item->>'signature',p_user_id,
    item->>'display_client',item->>'display_client',item->>'original_date',
    item->>'original_amount',item->>'original_payment_status',
    item->>'original_payment_method',p_file_name,p_sheet_name,
    (item->>'source_row')::integer,item->'raw_data',
    coalesce(array(select jsonb_array_elements_text(item->'warnings')),'{}'),
    case when item->>'payment_status'='unknown' or item->>'volume_ml' is null
      then 'review'::public.data_quality_status else 'verified'::public.data_quality_status end,
    coalesce((item->>'is_duplicate')::boolean,false),
    nullif(item->>'shipping_deadline_raw',''),
    nullif(item->>'shipping_deadline_date','')::date,
    nullif(item->>'shipping_operational_status',''),
    nullif(item->>'shipped_at','')::date,item->>'sale_type',
    nullif(item->>'volume_ml','')::numeric,item->>'volume_ml_raw',
    item->>'perfume_name_raw',item->>'perfume_base_name',
    nullif(item->>'bottle_identifier',''),nullif(item->>'paid_at','')::date,
    nullif(item->>'credit_reference_amount','')::numeric
  from jsonb_array_elements(p_rows) item
  join public.clients c on c.organization_id=p_organization_id
    and c.normalized_name=item->>'normalized_client' and c.deleted_at is null
  join public.perfumes p on p.organization_id=p_organization_id
    and p.normalized_name=public.normalize_person_name(item->>'perfume_name_raw')
  where item->>'row_type'='sale';

  update public.import_rows ir set sale_id=s.id
  from public.sales s
  where ir.import_batch_id=v_batch_id and s.import_batch_id=v_batch_id
    and ir.row_number=s.source_row;

  if (select count(*) from public.sales where import_batch_id=v_batch_id)<>5892
    or (select count(*) from public.sales where import_batch_id=v_batch_id and perfume_id is null)<>0
    or (select count(*) from public.sales where import_batch_id=v_batch_id and sale_type in('APC','SPLIT'))<>5892
    or (select count(*) from public.sales where import_batch_id=v_batch_id and volume_ml is null)<>1
    or (select count(*) from public.import_rows where import_batch_id=v_batch_id)<>5926
    or (select count(*) from public.import_rows where import_batch_id=v_batch_id and row_type='stock')<>15
    or (select coalesce(sum(amount),0) from public.sales where import_batch_id=v_batch_id and payment_status='paid')<>1561552.38
    or (select coalesce(sum(amount),0) from public.sales where import_batch_id=v_batch_id and payment_status='pending')<>91257.80
  then raise exception 'v2_post_import_reconciliation_failed'; end if;

  update public.import_batches set status='completed',processed_rows=v_sale_rows,completed_at=now()
  where id=v_batch_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_user_id,'commercial_import_replaced_v2','import_batch',
    v_batch_id::text,jsonb_build_object(
      'replaced_batch_id',p_old_batch_id,'file_hash',p_file_hash,
      'sales',v_sale_rows,'stock',v_stock_rows,'gross',v_gross,
      'commercial_items_without_numeric_ml',v_missing_ml
    ));
  return v_batch_id;
end;
$$;

revoke all on function public.replace_commercial_batch_v2(uuid,uuid,uuid,text,text,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.replace_commercial_batch_v2(uuid,uuid,uuid,text,text,text,jsonb,jsonb)
  to service_role;

create or replace function public.perfume_commercial_summary(org_id uuid)
returns table(
  perfume_id uuid,perfume_name text,bottle_identifier text,total_ml numeric,
  paid_ml numeric,pending_ml numeric,client_count bigint,item_count bigint,
  total_value numeric,paid_value numeric,sale_types text[],
  shipping_deadlines text[],shipping_statuses text[],shipped_dates date[]
)
language sql stable security invoker set search_path=public
as $$
  select
    p.id,p.full_name_raw,p.bottle_identifier,
    coalesce(sum(s.volume_ml),0),
    coalesce(sum(s.volume_ml) filter(where s.payment_status='paid'),0),
    coalesce(sum(s.volume_ml) filter(where s.payment_status='pending'),0),
    count(distinct s.client_id),count(s.id),
    coalesce(sum(s.amount),0),
    coalesce(sum(s.amount) filter(where s.payment_status='paid'),0),
    array_remove(array_agg(distinct s.sale_type),null),
    array_remove(array_agg(distinct s.shipping_deadline_raw),null),
    array_remove(array_agg(distinct s.shipping_operational_status),null),
    array_remove(array_agg(distinct s.shipped_at),null)
  from public.perfumes p
  left join public.sales s on s.perfume_id=p.id and s.deleted_at is null
  where p.organization_id=org_id
  group by p.id,p.full_name_raw,p.bottle_identifier
  order by 4 desc,p.full_name_raw;
$$;
revoke all on function public.perfume_commercial_summary(uuid) from public,anon;
grant execute on function public.perfume_commercial_summary(uuid) to authenticated,service_role;
