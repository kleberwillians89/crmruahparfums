create policy ai_runs_update_own on public.ai_runs for update
  using(
    user_id=auth.uid()
    and organization_id in(select public.current_user_org_ids())
  )
  with check(
    user_id=auth.uid()
    and organization_id in(select public.current_user_org_ids())
  );

update public.ai_runs
set status='failed',error_code='INTERRUPTED_EXECUTION',completed_at=now()
where status='running' and created_at<now()-interval '5 minutes';
