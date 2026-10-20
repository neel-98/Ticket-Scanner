begin;

-- Expose ownership so the app can show lifecycle controls only to the creator.
drop function public.list_events();
create function public.list_events() returns table (
  id uuid, name text, event_date date, timezone text, venue text, archived_at timestamptz,
  created_at timestamptz, created_by uuid, attendee_count bigint, checked_in_count bigint
) language sql stable security invoker set search_path = '' as $$
  select e.id, e.name, e.event_date, e.timezone, e.venue, e.archived_at, e.created_at, e.created_by,
    count(a.id), count(a.checked_in_at)
  from public.events e left join public.attendees a on a.event_id = e.id
  group by e.id order by e.event_date desc, e.created_at desc;
$$;

create or replace function public.archive_event(p_event_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  update public.events set archived_at = coalesce(archived_at, now())
    where id = p_event_id and created_by = auth.uid();
  if not found then raise exception 'Event not found or only its creator can archive it'; end if;
end;
$$;

create function public.unarchive_event(p_event_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  update public.events set archived_at = null where id = p_event_id and created_by = auth.uid();
  if not found then raise exception 'Event not found or only its creator can unarchive it'; end if;
end;
$$;

create function public.delete_event(p_event_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  -- Serialize against check-ins, undo, staff assignment, and archive changes.
  perform 1 from public.events where id = p_event_id and created_by = auth.uid() for update;
  if not found then raise exception 'Event not found or only its creator can delete it'; end if;

  -- Request caches also contain imported guest data and attendance results.
  delete from private.rpc_requests r where
    (r.payload->>'op' = 'import' and r.result->>'id' = p_event_id::text)
    or (r.payload->>'op' = 'checkin' and r.payload->>'event' = p_event_id::text)
    or (r.payload->>'op' = 'undo' and r.payload->>'attendee' in (
      select a.id::text from public.attendees a where a.event_id = p_event_id
    ));
  -- Audit references are intentionally restrictive; remove them before guests.
  delete from public.attendance_actions where event_id = p_event_id;
  -- Attendees and staff assignments are removed by their ON DELETE CASCADE FKs.
  delete from public.events where id = p_event_id;
end;
$$;

revoke execute on function public.list_events(), public.archive_event(uuid),
  public.unarchive_event(uuid), public.delete_event(uuid) from public, anon, authenticated;
grant execute on function public.list_events(), public.archive_event(uuid),
  public.unarchive_event(uuid), public.delete_event(uuid) to authenticated;

commit;
