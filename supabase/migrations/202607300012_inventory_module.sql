create type public.inventory_movement_type as enum (
  'opening','entry','sale_out','positive_adjustment','negative_adjustment',
  'cancellation_reversal','administrative_correction'
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  perfume_id uuid not null references public.perfumes(id),
  reference_date date not null,
  available_ml numeric(14,3) not null check(available_ml >= 0),
  minimum_ml numeric(14,3) not null default 0 check(minimum_ml >= 0),
  status text not null default 'active' check(status in('active','inactive')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,perfume_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  perfume_id uuid not null references public.perfumes(id),
  sale_id uuid references public.sales(id),
  movement_type public.inventory_movement_type not null,
  quantity_ml numeric(14,3) not null check(quantity_ml <> 0),
  balance_before numeric(14,3) not null,
  balance_after numeric(14,3) not null check(balance_after >= 0),
  reason text not null check(btrim(reason) <> ''),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index inventory_items_org_status_idx on public.inventory_items(organization_id,status);
create index inventory_movements_org_date_idx on public.inventory_movements(organization_id,created_at desc);
create index inventory_movements_sale_idx on public.inventory_movements(sale_id) where sale_id is not null;

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy inventory_items_select on public.inventory_items for select
  using(organization_id in(select public.current_user_org_ids()));
create policy inventory_items_write on public.inventory_items for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
create policy inventory_movements_select on public.inventory_movements for select
  using(organization_id in(select public.current_user_org_ids()));
create policy inventory_movements_insert on public.inventory_movements for insert
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

revoke update,delete on public.inventory_movements from authenticated;

create or replace function public.inventory_apply(
  p_item_id uuid,p_quantity_ml numeric,p_type public.inventory_movement_type,
  p_reason text,p_notes text default null,p_sale_id uuid default null
) returns public.inventory_movements
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_movement public.inventory_movements; v_after numeric;
begin
  select * into v_item from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if auth.uid() is not null and not public.has_org_role(v_item.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml=0 or btrim(coalesce(p_reason,''))='' then raise exception 'inventory_reason_and_quantity_required'; end if;
  v_after:=v_item.available_ml+p_quantity_ml;
  if v_after<0 then raise exception 'insufficient_inventory'; end if;
  update public.inventory_items set available_ml=v_after,updated_at=now() where id=v_item.id;
  insert into public.inventory_movements(
    organization_id,inventory_item_id,perfume_id,sale_id,movement_type,quantity_ml,
    balance_before,balance_after,reason,notes,created_by
  ) values(
    v_item.organization_id,v_item.id,v_item.perfume_id,p_sale_id,p_type,p_quantity_ml,
    v_item.available_ml,v_after,p_reason,p_notes,auth.uid()
  ) returning * into v_movement;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_movement','inventory_item',v_item.id::text,
    jsonb_build_object('movement_id',v_movement.id,'type',p_type,'quantity_ml',p_quantity_ml,'sale_id',p_sale_id));
  return v_movement;
end;
$$;

create or replace function public.inventory_create_item(
  p_organization_id uuid,p_perfume_id uuid,p_opening_ml numeric,p_minimum_ml numeric,
  p_reference_date date,p_notes text default null
) returns public.inventory_items
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_opening_ml<0 or p_minimum_ml<0 then raise exception 'invalid_inventory_amount'; end if;
  if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=p_organization_id)
    then raise exception 'perfume_not_found'; end if;
  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,minimum_ml,notes,created_by)
  values(p_organization_id,p_perfume_id,p_reference_date,0,p_minimum_ml,p_notes,auth.uid())
  returning * into v_item;
  if p_opening_ml>0 then
    perform public.inventory_apply(v_item.id,p_opening_ml,'opening','Saldo inicial do estoque',p_notes,null);
  end if;
  select * into v_item from public.inventory_items where id=v_item.id;
  return v_item;
end;
$$;

create or replace function public.inventory_sale_sync()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_net numeric;
begin
  if tg_op='UPDATE' then
    select coalesce(sum(quantity_ml),0) into v_net from public.inventory_movements where sale_id=old.id;
    if v_net<>0 then
      select * into v_item from public.inventory_items where organization_id=old.organization_id and perfume_id=old.perfume_id;
      if found then perform public.inventory_apply(v_item.id,-v_net,'cancellation_reversal','Estorno automático antes da reavaliação da venda',old.id); end if;
    end if;
  end if;
  if new.source='manual' and new.deleted_at is null and new.payment_status<>'cancelled'
    and new.perfume_id is not null and new.volume_ml is not null and new.volume_ml>0 then
    select * into v_item from public.inventory_items
      where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active';
    if found and new.sale_date>=v_item.reference_date then
      perform public.inventory_apply(v_item.id,-new.volume_ml,'sale_out','Abatimento automático da venda',new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_sale_sync on public.sales;
create trigger inventory_sale_sync after insert or update of perfume_id,volume_ml,payment_status,sale_date,deleted_at
on public.sales for each row execute function public.inventory_sale_sync();

create or replace function public.inventory_summary(org_id uuid,start_date date,end_date date)
returns jsonb language sql stable security invoker set search_path=public
as $$
  select jsonb_build_object(
    'items',count(*),
    'available_ml',coalesce(sum(i.available_ml),0),
    'healthy',count(*) filter(where i.available_ml>i.minimum_ml),
    'low',count(*) filter(where i.available_ml>0 and i.available_ml<=i.minimum_ml),
    'critical',count(*) filter(where i.available_ml>0 and i.available_ml<=greatest(i.minimum_ml*.5,1)),
    'out_of_stock',count(*) filter(where i.available_ml=0),
    'consumed_ml',coalesce((select -sum(m.quantity_ml) from public.inventory_movements m where m.organization_id=org_id and m.movement_type='sale_out' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    'movements',coalesce((select count(*) from public.inventory_movements m where m.organization_id=org_id and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0)
  ) from public.inventory_items i where i.organization_id=org_id and i.status='active';
$$;

create or replace function public.inventory_rows(org_id uuid,start_date date,end_date date)
returns table(
  item_id uuid,perfume_id uuid,perfume text,available_ml numeric,minimum_ml numeric,status text,
  sold_ml numeric,monthly_average numeric,estimated_days numeric,last_movement timestamptz
) language sql stable security invoker set search_path=public
as $$
  select i.id,p.id,p.full_name_raw,i.available_ml,i.minimum_ml,
    case when i.available_ml=0 then 'Esgotado' when i.available_ml<=i.minimum_ml then 'Baixo' else 'Saudável' end,
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.created_at>=now()-interval '30 days'),0),
    case when coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.created_at>=now()-interval '30 days'),0)>0
      then round(i.available_ml/(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.created_at>=now()-interval '30 days')/30),1) end,
    max(m.created_at)
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_movements m on m.inventory_item_id=i.id
  where i.organization_id=org_id group by i.id,p.id,p.full_name_raw order by i.available_ml asc,p.full_name_raw;
$$;

create or replace function public.ai_authorized_aggregates(org_id uuid,start_date date,end_date date)
returns jsonb language sql stable security invoker set search_path=public
as $$
  select public.commercial_period_summary(org_id,start_date,end_date)-'daily'
    ||jsonb_build_object(
      'inventory',public.inventory_summary(org_id,start_date,end_date),
      'inventory_attention',(select coalesce(jsonb_agg(jsonb_build_object('perfume',perfume,'available_ml',available_ml,'minimum_ml',minimum_ml,'status',status)),'[]'::jsonb)
        from public.inventory_rows(org_id,start_date,end_date) where status<>'Saudável'),
      'data_source','Supabase RUAH - agregados autorizados','generated_at',now(),'timezone','America/Sao_Paulo'
    );
$$;

grant execute on function public.inventory_apply(uuid,numeric,public.inventory_movement_type,text,text,uuid) to authenticated,service_role;
grant execute on function public.inventory_create_item(uuid,uuid,numeric,numeric,date,text) to authenticated,service_role;
grant execute on function public.inventory_summary(uuid,date,date) to authenticated,service_role;
grant execute on function public.inventory_rows(uuid,date,date) to authenticated,service_role;
