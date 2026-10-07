# Create test and staff accounts

App: https://ticket-scanner.gannafour.workers.dev

Accounts are created by an administrator in Supabase. Attendees do not need accounts: their imported ticket codes are used for admission.

## 1. Create the login

Repeat these steps for each test or real staff account:

1. Open your project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Authentication → Users → Add user → Create new user**.
3. Enter the user's email and a unique password.
4. Enable **Auto confirm user** so the account can sign in immediately.
5. Create the user and copy its **User UID**.

Keep **Allow new users to sign up** disabled in Authentication settings; staff are provisioned by administrators.

## 2. Give the account an app role

In **SQL Editor**, run the appropriate statement. Replace the placeholder with the User UID copied above.

### Test account — check-in only

```sql
insert into public.staff_profiles (user_id, role, active)
values ('TEST_USER_UID', 'checkin', true);
```

Create a separate event named **TEST — Check-in practice**, with sample tickets. As an organiser, open that event → **Manage check-in staff**, then assign this test user's UID.

The test account can check in tickets for assigned events. It cannot create events, undo admissions, export reports or archive events. A test account is a real database user: use the test event to avoid changing live attendance.

### Real staff account — check-in only

```sql
insert into public.staff_profiles (user_id, role, active)
values ('STAFF_USER_UID', 'checkin', true);
```

As an organiser, assign this user to the appropriate event through **Manage check-in staff**.

### Organiser account — event management

```sql
insert into public.staff_profiles (user_id, role, active)
values ('ORGANISER_USER_UID', 'organiser', true);
```

Organisers can manage all events, import guests, check in tickets, undo admissions, reconcile paper admissions, export reports and assign check-in staff. No event assignment is needed.

## 3. Verify the account

1. Open the app in a private/incognito browser window.
2. Sign in using the new account's email and password; do not enter preview mode.
3. For check-in staff, confirm that only assigned events appear.
4. In the test event, check in an unused test ticket, then repeat it. The second attempt should show **Already checked in** and the original time.

If login succeeds but staff access fails, verify that a `staff_profiles` row exists for the correct UID and `active` is `true`. If no events appear for check-in staff, check their event assignment.

## Disable a test or former staff account

Run in SQL Editor:

```sql
update public.staff_profiles
set active = false
where user_id = 'USER_UID';
```

This removes app data/check-in access while preserving attendance audit history.
