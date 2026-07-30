create or replace function public.dashboard_commercial_metrics(org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  with sale_totals as (
    select
      count(*) as sales,
      count(*) filter(where payment_status='paid') as paid_rows,
      count(*) filter(where payment_status='pending') as pending_rows,
      count(*) filter(where payment_status='cancelled') as cancelled_rows,
      count(*) filter(where payment_status='unknown') as review_rows,
      count(*) filter(where is_possible_duplicate) as possible_duplicates,
      coalesce(sum(amount) filter(where payment_status='paid'),0) as paid,
      coalesce(sum(amount) filter(where payment_status='pending'),0) as pending,
      coalesce(sum(amount) filter(where payment_status='cancelled'),0) as cancelled,
      coalesce(sum(amount) filter(where payment_status='unknown'),0) as review,
      min(sale_date) as first_sale,
      max(sale_date) as last_sale
    from public.sales
    where organization_id=org_id and deleted_at is null
  ), client_totals as (
    select count(*) as clients
    from public.clients
    where organization_id=org_id and deleted_at is null
  ), batch_totals as (
    select count(*) as batches,coalesce(sum(raw_total),0) as raw_gross
    from public.import_batches
    where organization_id=org_id and status='completed'
  ), row_totals as (
    select
      count(*) as batch_rows,
      count(*) filter(where row_type='stock') as stock_rows,
      count(*) filter(where row_type<>'sale') as preserved_review_rows,
      coalesce(sum((normalized_data->>'amount')::numeric) filter(
        where row_type='stock' and normalized_data->>'payment_status'='pending'
      ),0) as stock_pending
    from public.import_rows
    where organization_id=org_id
  )
  select to_jsonb(sale_totals)||to_jsonb(client_totals)||to_jsonb(batch_totals)||to_jsonb(row_totals)
  from sale_totals,client_totals,batch_totals,row_totals;
$$;
