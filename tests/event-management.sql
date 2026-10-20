-- Run as the database owner against a disposable database with all migrations applied.
-- Fixtures and mutations are rolled back at the end.
\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(value boolean, description text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'Assertion failed: %', description; end if;
end;
$$;
create function pg_temp.expect_error(statement text, expected_message text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected_message in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'Expected an error containing: %', expected_message;
end;
$$;

insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003');
insert into public.staff_profiles(user_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'organiser'),
  ('10000000-0000-0000-0000-000000000002', 'organiser'),
  ('10000000-0000-0000-0000-000000000003', 'checkin');

do $$
#variable_conflict use_variable
declare
  owner_id uuid := '10000000-0000-0000-0000-000000000001';
  other_id uuid := '10000000-0000-0000-0000-000000000002';
  staff_id uuid := '10000000-0000-0000-0000-000000000003';
  event_id uuid; other_event_id uuid; guest_id uuid; outcome jsonb; archived_time timestamptz;
  action text;
begin
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  event_id := public.import_event('Optional emails', current_date, 'UTC', null,
    '[{"name":"Alex Morgan","ticket_code":"00123"},{"name":"Maya Patel","ticket_code":"AbC","email":null}]', gen_random_uuid());
  perform pg_temp.assert_true((select count(*) = 2 and count(email) = 0 from public.attendees where attendees.event_id = event_id), 'missing/null emails save successfully');
  perform pg_temp.assert_true((select created_by = owner_id from public.list_events() e where e.id = event_id), 'list_events returns creator');
  perform public.assign_event_staff(event_id, staff_id, true);
  outcome := public.check_in_ticket(event_id, '00123', gen_random_uuid(), 'manual');
  perform pg_temp.assert_true(outcome->>'status' = 'checked_in', 'active event permits check-in');
  select id into guest_id from public.attendees where attendees.event_id = event_id and ticket_code = '00123';
  perform public.undo_check_in(guest_id, 1, gen_random_uuid());
  perform public.check_in_ticket(event_id, '00123', gen_random_uuid(), 'manual');
  perform public.archive_event(event_id);
  select archived_at into archived_time from public.events where id = event_id;
  perform pg_temp.assert_true(archived_time is not null, 'creator can archive');
  perform public.archive_event(event_id);
  perform pg_temp.assert_true((select archived_at = archived_time from public.events where id = event_id), 'repeat archive preserves timestamp');
  perform pg_temp.expect_error(format('select public.check_in_ticket(%L, %L, %L, %L)', event_id, 'AbC', gen_random_uuid(), 'manual'), 'Archived events are read-only');
  perform pg_temp.expect_error(format('select public.undo_check_in(%L, 3, %L)', guest_id, gen_random_uuid()), 'Archived events are read-only');
  perform pg_temp.expect_error(format('select public.assign_event_staff(%L, %L, false)', event_id, staff_id), 'Event unavailable or archived');

  -- A different organiser can view the event, but cannot manage its lifecycle.
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  other_event_id := public.import_event('Keep this event', current_date, 'UTC', null,
    '[{"name":"Other Guest","ticket_code":"00123","email":"other@example.com"}]', gen_random_uuid());
  foreach action in array array['archive', 'unarchive', 'delete'] loop
    perform pg_temp.expect_error(format('select public.%I(%L)', action || '_event', event_id), 'only its creator');
  end loop;
  perform pg_temp.assert_true((select archived_at = archived_time from public.events where id = event_id), 'denied actions preserve event');

  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  foreach action in array array['archive', 'unarchive', 'delete'] loop
    perform pg_temp.expect_error(format('select public.%I(%L)', action || '_event', event_id), 'Organiser access required');
  end loop;
  perform pg_temp.assert_true((select count(*) = 1 from public.list_events()), 'staff list remains restricted to assigned events');

  reset role;
  update public.staff_profiles set active = false where user_id = owner_id;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  foreach action in array array['archive', 'unarchive', 'delete'] loop
    perform pg_temp.expect_error(format('select public.%I(%L)', action || '_event', event_id), 'Organiser access required');
  end loop;
  reset role;
  update public.staff_profiles set active = true where user_id = owner_id;
  set local role authenticated;
  perform public.unarchive_event(event_id);
  perform public.unarchive_event(event_id);
  perform pg_temp.assert_true((select archived_at is null from public.events where id = event_id), 'creator can unarchive repeatedly');
  outcome := public.check_in_ticket(event_id, 'AbC', gen_random_uuid(), 'manual');
  perform pg_temp.assert_true(outcome->>'status' = 'checked_in', 'unarchive re-enables check-in');
  perform public.assign_event_staff(event_id, staff_id, false);
  perform public.assign_event_staff(event_id, staff_id, true);
  perform public.archive_event(event_id);
  perform public.delete_event(event_id);
  reset role;
  perform pg_temp.assert_true(not exists(select 1 from public.events where id = event_id), 'archived event removed');
  perform pg_temp.assert_true(not exists(select 1 from public.attendees where attendees.event_id = event_id), 'guests removed');
  perform pg_temp.assert_true(not exists(select 1 from public.event_staff where event_staff.event_id = event_id), 'assignments removed');
  perform pg_temp.assert_true(not exists(select 1 from public.attendance_actions where attendance_actions.event_id = event_id), 'audit history removed');
  perform pg_temp.assert_true((select count(*) = 1 from private.rpc_requests), 'only unrelated event request cache remains');
  perform pg_temp.assert_true(exists(select 1 from public.events where id = other_event_id), 'other event preserved');
  perform pg_temp.assert_true(exists(select 1 from public.attendees where attendees.event_id = other_event_id), 'other guests preserved');

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  set local role authenticated;
  perform public.delete_event(other_event_id);
  perform pg_temp.assert_true(not exists(select 1 from public.events where id = other_event_id), 'active event can also be deleted');
  foreach action in array array['archive', 'unarchive', 'delete'] loop
    perform pg_temp.expect_error(format('select public.%I(%L)', action || '_event', other_event_id), 'Event not found');
  end loop;
  reset role;
  foreach action in array array['archive', 'unarchive', 'delete'] loop
    perform pg_temp.assert_true(not has_function_privilege('anon', 'public.' || action || '_event(uuid)', 'execute'), 'anonymous execution denied: ' || action);
  end loop;
  raise notice 'Event management and optional-email database checks passed';
end;
$$;

rollback;
