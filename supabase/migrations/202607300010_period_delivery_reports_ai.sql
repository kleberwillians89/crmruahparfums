alter table public.ai_runs
  add column if not exists duration_ms integer,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists request_hash text;
create index if not exists ai_runs_user_created_idx on public.ai_runs(user_id,created_at desc);

create or replace function public.delivery_status(
  deadline date,shipped date,deadline_raw text default null
) returns text
language sql stable
as $$
  select case
    when shipped is not null and deadline is not null and shipped<=deadline then 'shipped_on_time'
    when shipped is not null and deadline is not null and shipped>deadline then 'shipped_late'
    when shipped is not null then 'shipped'
    when deadline is not null and deadline<(now() at time zone 'America/Sao_Paulo')::date then 'overdue'
    when deadline is not null then 'awaiting_shipment'
    when coalesce(btrim(deadline_raw),'')='' then 'no_deadline'
    else 'awaiting_shipment'
  end;
$$;

create or replace function public.commercial_period_summary(
  org_id uuid,start_date date,end_date date
) returns jsonb
language sql stable security invoker set search_path=public
as $$
  with base as (
    select s.*,public.delivery_status(
      s.shipping_deadline_date,s.shipped_at,s.shipping_deadline_raw
    ) as delivery_state
    from public.sales s
    where s.organization_id=org_id and s.deleted_at is null
      and s.sale_date between start_date and end_date
  ), client_first as (
    select client_id,min(sale_date) first_date
    from public.sales
    where organization_id=org_id and deleted_at is null
    group by client_id
  ), daily as (
    select sale_date period_date,count(*) sales,
      coalesce(sum(amount) filter(where payment_status='paid'),0) paid,
      coalesce(sum(amount) filter(where payment_status='pending'),0) pending
    from base group by sale_date order by sale_date
  ), methods as (
    select coalesce(payment_method,'Não informado') name,count(*) items,
      coalesce(sum(amount),0) value
    from base group by 1 order by 3 desc
  ), perfumes_value as (
    select perfume_name_raw name,count(*) items,coalesce(sum(volume_ml),0) ml,
      coalesce(sum(amount),0) value
    from base group by perfume_name_raw order by value desc limit 10
  ), clients_value as (
    select c.name,count(*) items,coalesce(sum(b.amount),0) value
    from base b join public.clients c on c.id=b.client_id
    group by c.id,c.name order by value desc limit 10
  )
  select jsonb_build_object(
    'period_start',start_date,'period_end',end_date,
    'sales',count(*),'total',coalesce(sum(amount),0),
    'paid',coalesce(sum(amount) filter(where payment_status='paid'),0),
    'pending',coalesce(sum(amount) filter(where payment_status='pending'),0),
    'cancelled',coalesce(sum(amount) filter(where payment_status='cancelled'),0),
    'review',coalesce(sum(amount) filter(where payment_status='unknown'),0),
    'paid_count',count(*) filter(where payment_status='paid'),
    'pending_count',count(*) filter(where payment_status='pending'),
    'cancelled_count',count(*) filter(where payment_status='cancelled'),
    'review_count',count(*) filter(where payment_status='unknown'),
    'average_ticket',coalesce(avg(amount),0),
    'buying_clients',count(distinct client_id),
    'new_clients',count(distinct base.client_id) filter(
      where client_first.first_date between start_date and end_date
    ),
    'recurring_clients',count(distinct base.client_id) filter(
      where client_first.first_date<start_date
    ),
    'deliveries_pending',count(*) filter(where delivery_state='awaiting_shipment'),
    'deliveries_overdue',count(*) filter(where delivery_state='overdue'),
    'shipped_today',count(*) filter(
      where shipped_at=(now() at time zone 'America/Sao_Paulo')::date
    ),
    'shipped_in_period',count(*) filter(where shipped_at between start_date and end_date),
    'shipped_on_time',count(*) filter(where delivery_state='shipped_on_time'),
    'shipped_late',count(*) filter(where delivery_state='shipped_late'),
    'without_deadline',count(*) filter(where delivery_state='no_deadline'),
    'daily',coalesce((select jsonb_agg(to_jsonb(daily)) from daily),'[]'::jsonb),
    'payment_methods',coalesce((select jsonb_agg(to_jsonb(methods)) from methods),'[]'::jsonb),
    'top_perfumes',coalesce((select jsonb_agg(to_jsonb(perfumes_value)) from perfumes_value),'[]'::jsonb),
    'top_clients',coalesce((select jsonb_agg(to_jsonb(clients_value)) from clients_value),'[]'::jsonb)
  )
  from base left join client_first using(client_id);
$$;

create or replace function public.client_period_summary(
  org_id uuid,start_date date,end_date date
) returns table(
  client_id uuid,client text,total_purchased numeric,paid numeric,pending numeric,
  item_count bigint,average_ticket numeric,total_ml numeric,top_perfume text,
  first_purchase date,last_purchase date,pending_deliveries bigint,
  relationship_status text
)
language sql stable security invoker set search_path=public
as $$
  with filtered as (
    select *,public.delivery_status(
      shipping_deadline_date,shipped_at,shipping_deadline_raw
    ) delivery_state
    from public.sales where organization_id=org_id and deleted_at is null
      and sale_date between start_date and end_date
  ), favorites as (
    select client_id,perfume_name_raw,count(*) items,
      row_number() over(partition by client_id order by count(*) desc,perfume_name_raw) position
    from filtered group by client_id,perfume_name_raw
  )
  select c.id,c.name,coalesce(sum(f.amount),0),
    coalesce(sum(f.amount) filter(where f.payment_status='paid'),0),
    coalesce(sum(f.amount) filter(where f.payment_status='pending'),0),
    count(f.id),coalesce(avg(f.amount),0),coalesce(sum(f.volume_ml),0),
    max(favorites.perfume_name_raw) filter(where favorites.position=1),
    min(f.sale_date),max(f.sale_date),
    count(*) filter(where f.delivery_state in('awaiting_shipment','overdue')),
    case
      when max(f.sale_date)>=(now() at time zone 'America/Sao_Paulo')::date-30 then
        case when count(f.id)>1 then 'recurring' else 'new' end
      when max(f.sale_date)<(now() at time zone 'America/Sao_Paulo')::date-90 then 'inactive'
      else 'active'
    end
  from public.clients c
  left join filtered f on f.client_id=c.id
  left join favorites on favorites.client_id=c.id and favorites.position=1
  where c.organization_id=org_id and c.deleted_at is null
  group by c.id,c.name order by 4 desc,c.name;
$$;

create or replace function public.ai_authorized_aggregates(
  org_id uuid,start_date date,end_date date
) returns jsonb
language sql stable security invoker set search_path=public
as $$
  select public.commercial_period_summary(org_id,start_date,end_date)
    - 'daily'
    || jsonb_build_object(
      'data_source','Supabase RUAH - agregados autorizados',
      'generated_at',now(),
      'timezone','America/Sao_Paulo'
    );
$$;

revoke all on function public.commercial_period_summary(uuid,date,date) from public,anon;
revoke all on function public.client_period_summary(uuid,date,date) from public,anon;
revoke all on function public.ai_authorized_aggregates(uuid,date,date) from public,anon;
grant execute on function public.commercial_period_summary(uuid,date,date) to authenticated,service_role;
grant execute on function public.client_period_summary(uuid,date,date) to authenticated,service_role;
grant execute on function public.ai_authorized_aggregates(uuid,date,date) to authenticated,service_role;

create or replace function public.protect_operator_sale_changes()
returns trigger language plpgsql security definer set search_path=public
as $$
declare user_role public.member_role;
begin
  if auth.uid() is null then return new; end if;
  select role into user_role from public.organization_members
    where organization_id=old.organization_id and user_id=auth.uid();
  if user_role='viewer' then raise exception 'viewer_read_only'; end if;
  if user_role='operator' and (
    new.client_id is distinct from old.client_id
    or new.sale_date is distinct from old.sale_date
    or new.amount is distinct from old.amount
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.perfume_id is distinct from old.perfume_id
    or new.sale_type is distinct from old.sale_type
    or new.volume_ml is distinct from old.volume_ml
  ) then raise exception 'operator_shipping_only'; end if;
  return new;
end;
$$;
drop trigger if exists protect_operator_sale_changes on public.sales;
create trigger protect_operator_sale_changes before update on public.sales
  for each row execute function public.protect_operator_sale_changes();
