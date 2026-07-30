alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.sales enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.import_errors enable row level security;
alter table public.ai_insights enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_runs enable row level security;
alter table public.audit_logs enable row level security;

create policy org_select on public.organizations for select using(id in(select public.current_user_org_ids()));
create policy profile_self on public.profiles for select using(id=auth.uid());
create policy memberships_select on public.organization_members for select using(organization_id in(select public.current_user_org_ids()));
create policy memberships_admin_write on public.organization_members for all using(public.has_org_role(organization_id,array['admin']::public.member_role[])) with check(public.has_org_role(organization_id,array['admin']::public.member_role[]));

do $$ declare t text; begin
  foreach t in array array['clients','sales','import_batches','import_rows','import_errors','ai_insights','ai_conversations','ai_messages'] loop
    execute format('create policy %I on public.%I for select using (organization_id in (select public.current_user_org_ids()))',t||'_org_select',t);
    execute format('create policy %I on public.%I for all using (public.has_org_role(organization_id,array[''admin'',''manager'',''operator'']::public.member_role[])) with check (public.has_org_role(organization_id,array[''admin'',''manager'',''operator'']::public.member_role[]))',t||'_org_write',t);
  end loop;
end $$;
create policy ai_runs_select on public.ai_runs for select using(organization_id in(select public.current_user_org_ids()));
create policy ai_runs_insert on public.ai_runs for insert with check(organization_id in(select public.current_user_org_ids()) and user_id=auth.uid());
create policy audit_select on public.audit_logs for select using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
create policy audit_insert on public.audit_logs for insert with check(organization_id in(select public.current_user_org_ids()) and actor_id=auth.uid());
create policy imports_storage_select on storage.objects for select using(bucket_id='commercial-imports' and (storage.foldername(name))[1] in(select public.current_user_org_ids()::text));
create policy imports_storage_write on storage.objects for insert with check(bucket_id='commercial-imports' and public.has_org_role(((storage.foldername(name))[1])::uuid,array['admin','manager','operator']::public.member_role[]));

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$
declare org uuid; entity text;
begin
  org:=coalesce(new.organization_id,old.organization_id); entity:=coalesce(new.id::text,old.id::text);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(org,auth.uid(),lower(tg_op),tg_table_name,entity,jsonb_build_object('source','database_trigger'));
  return coalesce(new,old);
end $$;
create trigger audit_sales after insert or update or delete on public.sales for each row execute function public.audit_row_change();
create trigger audit_clients after insert or update or delete on public.clients for each row execute function public.audit_row_change();
create trigger audit_imports after insert or update or delete on public.import_batches for each row execute function public.audit_row_change();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,full_name) values(new.id,new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
