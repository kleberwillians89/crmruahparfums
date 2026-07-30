drop function if exists public.client_commercial_summary(uuid);
create function public.client_commercial_summary(org_id uuid)
returns table(
  client_id uuid,client text,total_purchased numeric,paid numeric,pending numeric,
  cancelled numeric,review numeric,item_count bigint,average_ticket numeric,
  total_ml numeric,perfumes text[],sale_types text[],
  first_purchase date,last_purchase date
)
language sql stable security invoker set search_path=public
as $$
  select
    c.id,c.name,
    coalesce(sum(s.amount) filter(where s.deleted_at is null),0),
    coalesce(sum(s.amount) filter(where s.deleted_at is null and s.payment_status='paid'),0),
    coalesce(sum(s.amount) filter(where s.deleted_at is null and s.payment_status='pending'),0),
    coalesce(sum(s.amount) filter(where s.deleted_at is null and s.payment_status='cancelled'),0),
    coalesce(sum(s.amount) filter(where s.deleted_at is null and s.payment_status='unknown'),0),
    count(s.id) filter(where s.deleted_at is null),
    coalesce(avg(s.amount) filter(where s.deleted_at is null),0),
    coalesce(sum(s.volume_ml) filter(where s.deleted_at is null),0),
    array_remove(array_agg(distinct s.perfume_name_raw) filter(where s.deleted_at is null),null),
    array_remove(array_agg(distinct s.sale_type) filter(where s.deleted_at is null),null),
    min(s.sale_date) filter(where s.deleted_at is null),
    max(s.sale_date) filter(where s.deleted_at is null)
  from public.clients c
  left join public.sales s on s.client_id=c.id and s.organization_id=org_id
  where c.organization_id=org_id and c.deleted_at is null
  group by c.id,c.name
  order by 4 desc,c.name;
$$;
revoke all on function public.client_commercial_summary(uuid) from public,anon;
grant execute on function public.client_commercial_summary(uuid) to authenticated,service_role;

drop function if exists public.perfume_commercial_summary(uuid);
create function public.perfume_commercial_summary(org_id uuid)
returns table(
  perfume_id uuid,perfume_name text,bottle_identifier text,total_ml numeric,
  paid_ml numeric,pending_ml numeric,stock_ml numeric,stock_items bigint,
  client_count bigint,item_count bigint,total_value numeric,paid_value numeric,
  pending_value numeric,sale_types text[],shipping_deadlines text[],
  shipping_statuses text[],shipped_dates date[]
)
language sql stable security invoker set search_path=public
as $$
  with stock as (
    select
      public.normalize_person_name(normalized_data->>'perfume_name_raw') as perfume_key,
      coalesce(sum((normalized_data->>'volume_ml')::numeric),0) as stock_ml,
      count(*) as stock_items
    from public.import_rows
    where organization_id=org_id and row_type='stock'
    group by 1
  )
  select
    p.id,p.full_name_raw,p.bottle_identifier,
    coalesce(sum(s.volume_ml),0),
    coalesce(sum(s.volume_ml) filter(where s.payment_status='paid'),0),
    coalesce(sum(s.volume_ml) filter(where s.payment_status='pending'),0),
    coalesce(stock.stock_ml,0),coalesce(stock.stock_items,0),
    count(distinct s.client_id),count(s.id),
    coalesce(sum(s.amount),0),
    coalesce(sum(s.amount) filter(where s.payment_status='paid'),0),
    coalesce(sum(s.amount) filter(where s.payment_status='pending'),0),
    array_remove(array_agg(distinct s.sale_type),null),
    array_remove(array_agg(distinct s.shipping_deadline_raw),null),
    array_remove(array_agg(distinct s.shipping_operational_status),null),
    array_remove(array_agg(distinct s.shipped_at),null)
  from public.perfumes p
  left join public.sales s on s.perfume_id=p.id and s.deleted_at is null
  left join stock on stock.perfume_key=p.normalized_name
  where p.organization_id=org_id
  group by p.id,p.full_name_raw,p.bottle_identifier,stock.stock_ml,stock.stock_items
  order by 4 desc,p.full_name_raw;
$$;
revoke all on function public.perfume_commercial_summary(uuid) from public,anon;
grant execute on function public.perfume_commercial_summary(uuid) to authenticated,service_role;
