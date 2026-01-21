-- Function to finalize campaign status (source of truth)
create or replace function public.finalize_campaign_status(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_pending_queue boolean;
  v_pending_leads int;
begin
  select exists (
    select 1
    from public.campaign_queue q
    where q.campaign_id = p_campaign_id
      and q.status = 'queued'
      and coalesce(q.leads_sent,0) < coalesce(q.leads_to_send,0)
  ) into v_has_pending_queue;

  if v_has_pending_queue then
    return 'queued';
  end if;

  select count(*)
  into v_pending_leads
  from public.campaign_leads cl
  where cl.campaign_id = p_campaign_id
    and cl.status = 'pending';

  if v_pending_leads > 0 then
    return 'sending';
  end if;

  update public.campaigns
    set status = 'completed',
        updated_at = now()
  where id = p_campaign_id;

  return 'completed';
end;
$$;

-- Trigger function to call finalize on lead/queue changes
create or replace function public._trg_finalize_campaign_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
begin
  v_campaign_id := coalesce(new.campaign_id, old.campaign_id);
  perform public.finalize_campaign_status(v_campaign_id);
  return null;
end;
$$;

-- Trigger on campaign_leads
drop trigger if exists trg_finalize_campaign_on_lead_change on public.campaign_leads;
create trigger trg_finalize_campaign_on_lead_change
after insert or update of status or delete
on public.campaign_leads
for each row
execute function public._trg_finalize_campaign_status();

-- Trigger on campaign_queue
drop trigger if exists trg_finalize_campaign_on_queue_change on public.campaign_queue;
create trigger trg_finalize_campaign_on_queue_change
after insert or update or delete
on public.campaign_queue
for each row
execute function public._trg_finalize_campaign_status();