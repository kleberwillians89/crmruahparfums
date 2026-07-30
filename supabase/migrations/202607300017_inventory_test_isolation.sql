update public.inventory_movements
set source='controlled_test'
where notes like 'Teste controlado concluído; venda temporária removida (%)';

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
    'consumed_ml',coalesce((select -sum(m.quantity_ml) from public.inventory_movements m where m.organization_id=org_id and m.movement_type='sale_out' and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    'movements',coalesce((select count(*) from public.inventory_movements m where m.organization_id=org_id and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0)
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
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and (m.created_at at time zone 'America/Sao_Paulo')::date between start_date and end_date),0),
    coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days'),0),
    case when coalesce(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days'),0)>0
      then round(i.available_ml/(-sum(m.quantity_ml) filter(where m.movement_type='sale_out' and m.source<>'controlled_test' and m.created_at>=now()-interval '30 days')/30),1) end,
    max(m.created_at) filter(where m.source<>'controlled_test')
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_movements m on m.inventory_item_id=i.id
  where i.organization_id=org_id group by i.id,p.id,p.full_name_raw order by i.available_ml asc,p.full_name_raw;
$$;
