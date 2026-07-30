create or replace function public.inventory_sale_sync()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_net numeric;
begin
  if tg_op='UPDATE' then
    select coalesce(sum(quantity_ml),0) into v_net from public.inventory_movements where sale_id=old.id;
    if v_net<>0 then
      select * into v_item from public.inventory_items where organization_id=old.organization_id and perfume_id=old.perfume_id;
      if found then
        perform public.inventory_apply(
          v_item.id,-v_net,'cancellation_reversal',
          'Estorno automático antes da reavaliação da venda',null,old.id
        );
      end if;
    end if;
  end if;
  if new.source='manual' and new.deleted_at is null and new.payment_status<>'cancelled'
    and new.perfume_id is not null and new.volume_ml is not null and new.volume_ml>0 then
    select * into v_item from public.inventory_items
      where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active';
    if found and new.sale_date>=v_item.reference_date then
      perform public.inventory_apply(
        v_item.id,-new.volume_ml,'sale_out','Abatimento automático da venda',null,new.id
      );
    end if;
  end if;
  return new;
end;
$$;
