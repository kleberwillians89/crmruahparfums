alter table public.import_batches
  add column if not exists file_hash text,
  add column if not exists raw_total numeric(14,2),
  add column if not exists metadata jsonb not null default '{}';

create unique index if not exists import_batches_org_file_hash_unique
  on public.import_batches(organization_id,file_hash)
  where file_hash is not null;

alter table public.import_rows
  add column if not exists row_type text not null default 'sale'
    check(row_type in('sale','stock','rejected'));

create or replace function public.import_commercial_batch(
  p_organization_id uuid,
  p_user_id uuid,
  p_file_name text,
  p_file_hash text,
  p_sheet_name text,
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
  v_gross numeric(14,2);
  v_paid numeric(14,2);
  v_pending numeric(14,2);
  v_stock_pending numeric(14,2);
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if not exists(
    select 1 from public.organization_members
    where organization_id=p_organization_id and user_id=p_user_id and role='admin'
  ) then
    raise exception 'administrator_membership_required';
  end if;
  if exists(
    select 1 from public.import_batches
    where organization_id=p_organization_id and file_hash=p_file_hash
  ) then
    raise exception 'file_already_imported';
  end if;

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
       v_duplicates,v_gross,v_paid,v_pending,v_stock_pending
  from jsonb_array_elements(p_rows) item;

  if v_total_rows<>5926 or v_sale_rows<>5892 or v_review_rows<>34
    or v_stock_rows<>15 or v_clients<>418 or v_duplicates<>20
    or v_gross<>1673690.78 or v_paid<>1561552.38
    or v_pending<>91257.80 or v_stock_pending<>1340.20 then
    raise exception 'pre_import_reconciliation_failed: rows %, sales %, review %, stock %, clients %, duplicates %, gross %, paid %, pending %, stock_pending %',
      v_total_rows,v_sale_rows,v_review_rows,v_stock_rows,v_clients,
      v_duplicates,v_gross,v_paid,v_pending,v_stock_pending;
  end if;

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
      'stock_rows',v_stock_rows,
      'stock_pending',v_stock_pending,
      'credit_policy','raw_json_only',
      'transactional',true
    ),
    p_user_id
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
  group by item->>'normalized_client';

  insert into public.import_rows(
    import_batch_id,organization_id,row_number,raw_data,normalized_data,
    is_valid,is_duplicate,import_signature,source_file,source_sheet,
    original_client,original_date,original_amount,original_payment_status,
    original_payment_method,warnings,blockers,is_accountable,row_type
  )
  select
    v_batch_id,p_organization_id,(item->>'source_row')::integer,item->'raw_data',
    jsonb_build_object(
      'client',item->>'normalized_client',
      'date',item->>'sale_date',
      'amount',item->'amount',
      'payment_status',item->>'payment_status',
      'row_type',item->>'row_type'
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
    organization_id,client_id,sale_date,amount,payment_status,payment_method,
    notes,source,import_batch_id,import_signature,created_by,
    original_client,original_date,original_amount,original_payment_status,
    original_payment_method,source_file,source_sheet,source_row,raw_data,
    quality_warnings,data_quality_status,is_possible_duplicate
  )
  select
    p_organization_id,c.id,nullif(item->>'sale_date','')::date,
    (item->>'amount')::numeric,(item->>'payment_status')::public.payment_status,
    nullif(item->>'payment_method',''),nullif(item->>'note',''),
    'spreadsheet',v_batch_id,item->>'signature',p_user_id,
    item->>'display_client',item->>'original_date',item->>'original_amount',
    item->>'original_payment_status',item->>'original_payment_method',
    p_file_name,p_sheet_name,(item->>'source_row')::integer,item->'raw_data',
    coalesce(array(select jsonb_array_elements_text(item->'warnings')),'{}'),
    case when item->>'payment_status'='unknown' then 'review'::public.data_quality_status
      else 'verified'::public.data_quality_status end,
    coalesce((item->>'is_duplicate')::boolean,false)
  from jsonb_array_elements(p_rows) item
  join public.clients c
    on c.organization_id=p_organization_id
   and c.normalized_name=item->>'normalized_client'
  where item->>'row_type'='sale';

  update public.import_rows ir
  set sale_id=s.id
  from public.sales s
  where ir.import_batch_id=v_batch_id
    and s.import_batch_id=v_batch_id
    and ir.row_number=s.source_row;

  if (select count(*) from public.clients where organization_id=p_organization_id and deleted_at is null)<>418
    or (select count(*) from public.sales where import_batch_id=v_batch_id and deleted_at is null)<>5892
    or (select count(*) from public.import_rows where import_batch_id=v_batch_id)<>5926
    or (select count(*) from public.import_rows where import_batch_id=v_batch_id and row_type='stock')<>15
    or (select count(*) from public.sales where import_batch_id=v_batch_id and is_possible_duplicate)<>20
    or (select coalesce(sum(amount),0) from public.sales where import_batch_id=v_batch_id and payment_status='paid')<>1561552.38
    or (select coalesce(sum(amount),0) from public.sales where import_batch_id=v_batch_id and payment_status='pending')<>91257.80 then
    raise exception 'post_import_reconciliation_failed';
  end if;

  update public.import_batches
  set status='completed',processed_rows=v_sale_rows,completed_at=now()
  where id=v_batch_id;

  insert into public.audit_logs(
    organization_id,actor_id,action,entity_type,entity_id,metadata
  ) values(
    p_organization_id,p_user_id,'commercial_import_completed','import_batch',
    v_batch_id::text,
    jsonb_build_object(
      'file_hash',p_file_hash,
      'rows',v_total_rows,
      'sales',v_sale_rows,
      'clients',v_clients,
      'stock',v_stock_rows,
      'possible_duplicates',v_duplicates,
      'gross',v_gross
    )
  );
  return v_batch_id;
end;
$$;

revoke all on function public.import_commercial_batch(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_commercial_batch(uuid,uuid,text,text,text,jsonb) to service_role;
