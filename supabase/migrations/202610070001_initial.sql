create schema if not exists private;

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('organiser', 'checkin')),
  active boolean not null default true
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  event_date date not null,
  timezone text not null,
  venue text,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  import_request_id uuid not null unique
);
create table public.event_staff (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
  primary key(event_id, user_id)
);
create index event_staff_user_idx on public.event_staff(user_id, event_id);
create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ticket_code text collate "C" not null check (length(ticket_code) between 1 and 256 and ticket_code = btrim(ticket_code)),
  name text not null check (length(btrim(name)) between 1 and 200),
  email text,
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id),
  checkin_method text check (checkin_method in ('qr', 'manual')),
  version integer not null default 0,
  created_at timestamptz not null default now(),
  unique(event_id, ticket_code),
  check ((checked_in_at is null and checked_in_by is null and checkin_method is null)
    or (checked_in_at is not null and checked_in_by is not null and checkin_method is not null))
);
create index attendees_name_idx on public.attendees(event_id, name, id);
create table public.attendance_actions (
  id uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references public.attendees(id),
  event_id uuid not null references public.events(id),
  action text not null check (action in ('check-in', 'undo')),
  staff_user uuid not null references auth.users(id),
  method text not null check (method in ('qr', 'manual')),
  action_time timestamptz not null default now(),
  effective_admission_time timestamptz,
  previous_state jsonb not null,
  new_state jsonb not null,
  request_id uuid not null,
  unique(staff_user, request_id)
);
create table private.rpc_requests (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key(user_id, request_id)
);

create function private.is_organiser() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_profiles where user_id = auth.uid() and active and role = 'organiser');
$$;
create function private.can_access(p_event_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.staff_profiles p where p.user_id = auth.uid() and p.active
    and (p.role = 'organiser' or exists(select 1 from public.event_staff s where s.event_id = p_event_id and s.user_id = p.user_id)));
$$;

alter table public.staff_profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_staff enable row level security;
alter table public.attendees enable row level security;
alter table public.attendance_actions enable row level security;
alter table private.rpc_requests enable row level security;
revoke all on public.staff_profiles, public.events, public.event_staff, public.attendees, public.attendance_actions from anon, authenticated;
grant select on public.staff_profiles, public.events, public.event_staff, public.attendees, public.attendance_actions to authenticated;
create policy profile_read on public.staff_profiles for select to authenticated using (user_id = auth.uid() or private.is_organiser());
create policy event_read on public.events for select to authenticated using (private.can_access(id));
create policy assignment_read on public.event_staff for select to authenticated using (private.is_organiser() or (user_id = auth.uid() and private.can_access(event_id)));
create policy attendee_read on public.attendees for select to authenticated using (private.can_access(event_id));
create policy audit_read on public.attendance_actions for select to authenticated using (private.is_organiser());

create function public.list_events() returns table (
  id uuid, name text, event_date date, timezone text, venue text, archived_at timestamptz,
  created_at timestamptz, attendee_count bigint, checked_in_count bigint
) language sql stable security invoker set search_path = '' as $$
  select e.id, e.name, e.event_date, e.timezone, e.venue, e.archived_at, e.created_at,
    count(a.id), count(a.checked_in_at)
  from public.events e left join public.attendees a on a.event_id = e.id
  group by e.id order by e.event_date desc, e.created_at desc;
$$;

create function public.import_event(p_name text, p_event_date date, p_timezone text, p_venue text, p_attendees jsonb, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb; v_prior private.rpc_requests;
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  v_payload := jsonb_build_object('op', 'import', 'name', p_name, 'date', p_event_date, 'timezone', p_timezone, 'venue', p_venue, 'attendees', p_attendees);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_prior from private.rpc_requests where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if v_prior.payload <> v_payload then raise exception 'Request ID reused with different data'; end if;
    return (v_prior.result->>'id')::uuid;
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid IANA timezone'; end if;
  if jsonb_typeof(p_attendees) is distinct from 'array' then raise exception 'Attendee array required'; end if;
  if jsonb_array_length(p_attendees) not between 1 and 5000 then raise exception 'Import must contain 1–5,000 attendees'; end if;
  if exists(select 1 from jsonb_array_elements(p_attendees) a where
    jsonb_typeof(a->'ticket_code') is distinct from 'string' or jsonb_typeof(a->'name') is distinct from 'string'
    or (a->'email' is not null and jsonb_typeof(a->'email') not in ('string', 'null'))
    or (a->>'ticket_code') ~ '^\s|\s$') then raise exception 'Invalid attendee fields or surrounding ticket whitespace'; end if;
  insert into public.events(name, event_date, timezone, venue, created_by, import_request_id)
    values(p_name, p_event_date, p_timezone, p_venue, auth.uid(), p_request_id) returning id into v_id;
  insert into public.attendees(event_id, ticket_code, name, email)
    select v_id, a->>'ticket_code', a->>'name', nullif(a->>'email', '') from jsonb_array_elements(p_attendees) a;
  insert into private.rpc_requests values(auth.uid(), p_request_id, v_payload, jsonb_build_object('id', v_id));
  return v_id;
end;
$$;

create function public.check_in_ticket(p_event_id uuid, p_ticket_code text, p_request_id uuid, p_method text, p_admission_time timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_att public.attendees; v_before jsonb; v_result jsonb; v_payload jsonb; v_prior private.rpc_requests; v_archived timestamptz;
begin
  if not private.can_access(p_event_id) then raise exception 'Event access denied'; end if;
  if p_request_id is null or p_method is null or p_method not in ('qr', 'manual') then raise exception 'Invalid check-in request'; end if;
  if p_admission_time is not null and (not private.is_organiser() or p_method <> 'manual' or not isfinite(p_admission_time) or p_admission_time > now()) then
    raise exception 'Only organisers can reconcile past manual admissions'; end if;
  v_payload := jsonb_build_object('op', 'checkin', 'event', p_event_id, 'code', p_ticket_code, 'method', p_method, 'time', p_admission_time);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_prior from private.rpc_requests where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if v_prior.payload <> v_payload then raise exception 'Request ID reused with different data'; end if;
    return v_prior.result;
  end if;
  select archived_at into v_archived from public.events where id = p_event_id for share;
  if not found then raise exception 'Event not found'; end if;
  if v_archived is not null then raise exception 'Archived events are read-only'; end if;
  select * into v_att from public.attendees where event_id = p_event_id and ticket_code = p_ticket_code collate "C" for update;
  if not found then
    v_result := jsonb_build_object('status', 'not_found');
  elsif v_att.checked_in_at is not null then
    v_result := jsonb_build_object('status', 'already_checked_in', 'name', v_att.name, 'checked_in_at', v_att.checked_in_at);
  else
    v_before := to_jsonb(v_att);
    update public.attendees set checked_in_at = coalesce(p_admission_time, now()), checked_in_by = auth.uid(),
      checkin_method = p_method, version = version + 1 where id = v_att.id returning * into v_att;
    insert into public.attendance_actions(attendee_id, event_id, action, staff_user, method, effective_admission_time, previous_state, new_state, request_id)
      values(v_att.id, p_event_id, 'check-in', auth.uid(), p_method, v_att.checked_in_at, v_before, to_jsonb(v_att), p_request_id);
    v_result := jsonb_build_object('status', 'checked_in', 'name', v_att.name, 'checked_in_at', v_att.checked_in_at);
  end if;
  insert into private.rpc_requests values(auth.uid(), p_request_id, v_payload, v_result);
  return v_result;
end;
$$;

create function public.undo_check_in(p_attendee_id uuid, p_expected_version integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_att public.attendees; v_before jsonb; v_payload jsonb; v_prior private.rpc_requests; v_result jsonb; v_event uuid;
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  v_payload := jsonb_build_object('op', 'undo', 'attendee', p_attendee_id, 'version', p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_prior from private.rpc_requests where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if v_prior.payload <> v_payload then raise exception 'Request ID reused with different data'; end if;
    return v_prior.result;
  end if;
  select event_id into v_event from public.attendees where id = p_attendee_id;
  if not found then raise exception 'Attendee not found'; end if;
  perform 1 from public.events where id = v_event and archived_at is null for share;
  if not found then raise exception 'Archived events are read-only'; end if;
  select * into v_att from public.attendees where id = p_attendee_id for update;
  if p_expected_version is distinct from v_att.version or v_att.checked_in_at is null then raise exception 'Attendance changed. Refresh before undoing.'; end if;
  v_before := to_jsonb(v_att);
  update public.attendees set checked_in_at = null, checked_in_by = null, checkin_method = null, version = version + 1
    where id = p_attendee_id returning * into v_att;
  insert into public.attendance_actions(attendee_id, event_id, action, staff_user, method, effective_admission_time, previous_state, new_state, request_id)
    values(v_att.id, v_att.event_id, 'undo', auth.uid(), v_before->>'checkin_method', (v_before->>'checked_in_at')::timestamptz, v_before, to_jsonb(v_att), p_request_id);
  v_result := jsonb_build_object('status', 'undone');
  insert into private.rpc_requests values(auth.uid(), p_request_id, v_payload, v_result);
  return v_result;
end;
$$;

create function public.archive_event(p_event_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  update public.events set archived_at = coalesce(archived_at, now()) where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;
end;
$$;
create function public.assign_event_staff(p_event_id uuid, p_user_id uuid, p_assigned boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_organiser() then raise exception 'Organiser access required'; end if;
  perform 1 from public.events where id = p_event_id and archived_at is null for share;
  if not found then raise exception 'Event unavailable or archived'; end if;
  if not exists(select 1 from public.staff_profiles where user_id = p_user_id and active and role = 'checkin') then raise exception 'Active check-in staff required'; end if;
  if p_assigned then insert into public.event_staff values(p_event_id, p_user_id) on conflict do nothing;
  else delete from public.event_staff where event_id = p_event_id and user_id = p_user_id; end if;
end;
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_organiser(), private.can_access(uuid) to authenticated;
revoke execute on function public.list_events(), public.import_event(text,date,text,text,jsonb,uuid),
  public.check_in_ticket(uuid,text,uuid,text,timestamptz), public.undo_check_in(uuid,integer,uuid),
  public.archive_event(uuid), public.assign_event_staff(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.list_events(), public.import_event(text,date,text,text,jsonb,uuid),
  public.check_in_ticket(uuid,text,uuid,text,timestamptz), public.undo_check_in(uuid,integer,uuid),
  public.archive_event(uuid), public.assign_event_staff(uuid,uuid,boolean) to authenticated;
