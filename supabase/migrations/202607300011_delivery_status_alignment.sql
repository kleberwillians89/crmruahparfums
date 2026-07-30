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
    else 'no_deadline'
  end;
$$;
