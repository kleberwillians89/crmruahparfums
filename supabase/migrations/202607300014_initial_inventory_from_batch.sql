alter table public.inventory_movements
  add column source text not null default 'manual',
  add column import_batch_id uuid references public.import_batches(id),
  add column import_row_number integer;

create unique index inventory_initial_import_row_uidx
  on public.inventory_movements(import_batch_id,import_row_number)
  where source='initial_import';

create or replace function public.initialize_inventory_from_stock_rows(
  p_organization_id uuid,p_batch_id uuid
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_rows integer;v_total_ml numeric;v_unique integer;v_created_items integer:=0;
  v_created_movements integer:=0;r record;v_item public.inventory_items;v_after numeric;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  perform 1 from public.import_batches where id=p_batch_id and organization_id=p_organization_id and status='completed';
  if not found then raise exception 'completed_batch_not_found'; end if;

  select count(*),coalesce(sum((normalized_data->>'volume_ml')::numeric),0),
    count(distinct public.normalize_person_name(normalized_data->>'perfume_name_raw'))
  into v_rows,v_total_ml,v_unique
  from public.import_rows
  where import_batch_id=p_batch_id and organization_id=p_organization_id and row_type='stock';
  if v_rows<>15 or v_total_ml<>78 or v_unique<>15 then raise exception 'initial_inventory_reconciliation_failed'; end if;

  for r in
    select ir.row_number,(ir.normalized_data->>'volume_ml')::numeric as ml,
      (ir.normalized_data->>'sale_date')::timestamptz::date as reference_date,
      p.id as perfume_id
    from public.import_rows ir
    join public.perfumes p on p.organization_id=ir.organization_id
      and p.normalized_name=public.normalize_person_name(ir.normalized_data->>'perfume_name_raw')
    where ir.import_batch_id=p_batch_id and ir.organization_id=p_organization_id and ir.row_type='stock'
    order by ir.row_number
  loop
    insert into public.inventory_items(
      organization_id,perfume_id,reference_date,available_ml,minimum_ml,status,notes
    ) values(
      p_organization_id,r.perfume_id,r.reference_date,0,0,'active',
      'Saldo inicial preservado do lote comercial aprovado'
    ) on conflict(organization_id,perfume_id) do nothing returning * into v_item;
    if found then v_created_items:=v_created_items+1;
    else select * into v_item from public.inventory_items where organization_id=p_organization_id and perfume_id=r.perfume_id for update;
    end if;

    if not exists(select 1 from public.inventory_movements where import_batch_id=p_batch_id and import_row_number=r.row_number and source='initial_import') then
      v_after:=v_item.available_ml+r.ml;
      update public.inventory_items set available_ml=v_after,reference_date=greatest(reference_date,r.reference_date),updated_at=now() where id=v_item.id;
      insert into public.inventory_movements(
        organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,
        balance_before,balance_after,reason,notes,source,import_batch_id,import_row_number
      ) values(
        p_organization_id,v_item.id,r.perfume_id,'opening',r.ml,
        v_item.available_ml,v_after,'Saldo inicial da planilha aprovada',
        'Linha de estoque preservada; não é venda comercial','initial_import',p_batch_id,r.row_number
      );
      v_created_movements:=v_created_movements+1;
    end if;
  end loop;

  if (select coalesce(sum(quantity_ml),0) from public.inventory_movements where import_batch_id=p_batch_id and source='initial_import')<>78
    or (select count(*) from public.inventory_movements where import_batch_id=p_batch_id and source='initial_import')<>15
  then raise exception 'initial_inventory_post_reconciliation_failed'; end if;

  insert into public.audit_logs(organization_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,'inventory_initialized','import_batch',p_batch_id::text,
    jsonb_build_object('rows',v_rows,'unique_perfumes',v_unique,'total_ml',v_total_ml,'created_items',v_created_items,'created_movements',v_created_movements));
  return jsonb_build_object(
    'rows',v_rows,'unique_perfumes',v_unique,'total_ml',v_total_ml,
    'created_items',v_created_items,'created_movements',v_created_movements,
    'idempotent',v_created_movements=0
  );
end;
$$;

revoke all on function public.initialize_inventory_from_stock_rows(uuid,uuid) from public,anon,authenticated;
grant execute on function public.initialize_inventory_from_stock_rows(uuid,uuid) to service_role;
