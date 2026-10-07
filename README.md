# Entrydesk — event ticket scanner

A phone-first event check-in application built from `plan..txt`. React + TypeScript + Vite on Cloudflare Pages; Supabase Auth + PostgreSQL enforce all attendance changes.

## Run locally

Use Node.js **22 LTS (22.13+) or 24 LTS** and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173). With no Supabase variables, select **Explore the app preview**. This displays sample events and lets you walk through imports, search guests, open the scanner layout and export sample data. Preview mode never saves events or admissions. Sample totals are illustrative; its guest table contains eight sample records.

## Connect Supabase

For a short guide to test, check-in staff and organiser accounts, see [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md).

1. Create a Supabase project.
2. Run `supabase/migrations/202610070001_initial.sql` in the project's SQL Editor. This creates tables, RLS policies, grants and transactional functions. Keep migrations in the repository for future schema changes.
3. In Authentication settings, **disable “Allow new users to sign up”**. There is no public registration screen.
4. In Authentication → Users, create staff email/password users. Auto-confirm the pre-provisioned accounts if they should sign in immediately.
5. Provision the first organiser using the user ID from that dashboard:

```sql
insert into public.staff_profiles (user_id, role, active)
values ('REPLACE_WITH_AUTH_USER_UUID', 'organiser', true);
```

For each check-in-only staff member:

```sql
insert into public.staff_profiles (user_id, role, active)
values ('REPLACE_WITH_STAFF_AUTH_USER_UUID', 'checkin', true);
```

6. Get the project URL and **publishable key** from the project Connect/API settings.
7. Create `.env.local` using `.env.example` as a template:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

8. Restart Vite and sign in. Create an event, import a file, then use **Manage check-in staff** on the event page to assign staff IDs. Match the displayed IDs to users in the Supabase dashboard.
9. In Supabase Auth URL Configuration, set the Site URL to your production site. Include local development URLs and any auth redirect destinations you actually use. This version uses password sign-in without an auth callback route.

The publishable key is public frontend configuration. Never use a secret/service-role key in a `VITE_` variable. Browser clients have SELECT access filtered by RLS and can change attendance only through permission-checked RPCs. Role provisioning is dashboard/SQL-only.

## Import your ticket spreadsheet

- Generate tickets and QR codes beforehand using your existing workflow.
- The file must contain **the literal text encoded in each QR**, not just QR images or formulas.
- CSV and `.xlsx` supported; first row is headings. For Excel, choose a worksheet.
- Map ticket code and full name, or ticket code plus first/last names. Email is optional. Unmapped columns, including QR formulas/images, are ignored.
- Codes are case-sensitive strings scoped to an event. `AbC`, `abc`, and `00123` are different values. Ticket codes may repeat across different events.
- Surrounding whitespace is an error. Correct it in the source file rather than silently changing payloads.
- Excel numeric ticket cells trigger a warning: zeros already lost in Excel cannot be recovered. Format ticket columns as **Text** before entering/importing codes.
- Imports: up to 5 MB, 5,000 attendees, 256-character ticket codes and 200-character names. Very large source sheets are rejected (200 columns / 20,000 rows). Initial limits are in `src/lib/parsing.ts`; database limits must be kept in sync.
- Mapped formulas and unsupported cell values are rejected. Names/emails may repeat; duplicate event ticket codes block the import.
- Files are parsed locally and not uploaded or retained. Event and attendees save in one transaction; retries reuse the same request ID.

## Check-in and manual attendance

1. Select the right event and choose **Start scanner**.
2. Allow camera access. Rear camera is preferred; select another camera if available.
3. Scan the QR or enter its exact text manually. Camera scanning requires HTTPS (localhost is also allowed).
4. Wait for database confirmation. Results distinguish success, an original duplicate timestamp, and an invalid event ticket.
5. Press **Scan next** before processing the next ticket. Processing is locked during requests and results.

On network failure, **Retry same request** confirms the original saved outcome if the response was lost. No offline writes are queued. Closing a scanner stops camera tracks. Permission failures and missing cameras show manual-entry guidance.

Guest-list **Check in** uses the same transactional operation. Organisers can enter a past observed admission time in the **event timezone**, preserving both admission and audit-entry time. Daylight-saving gaps/ambiguous wall times are rejected. Existing admissions are never overwritten. Organiser-only undo is confirmed, version-checked, retry-safe and audited. Archived events are read-only.

## Reports and outage backup

Organisers can export attendance CSV and print an alphabetical paper list. CSV cells are escaped and spreadsheet formula prefixes are neutralised. When opening CSV in Excel, import the ticket-code column as **Text** to retain leading zeros. Exported times include the event timezone.

Before the event, keep the printed list available. During an outage:

1. Mark admissions and their local event times on paper.
2. Restore connectivity.
3. Reconcile all paper admissions with manual check-in before resuming scanning.
4. Download the final report after the event.

Exports are snapshots; they do not update with subsequent check-ins. For a current paper backup, tick paper alongside online admissions.

## Deploy to Cloudflare Pages

1. Put the app in a GitHub/GitLab repository.
2. Create a Cloudflare Pages project and connect that repository.
3. Configure:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `24` (set `NODE_VERSION` if needed) |

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as production build variables. Preview deployments need their own configuration if enabled. Redeploy after changing build variables.
5. Deploy to the supplied HTTPS `pages.dev` address. An optional custom domain can be added in Pages settings.
6. Update Supabase Auth Site URL to the deployed address.
7. Verify direct navigation and refresh on `/events/<id>`. Pages automatically falls back to the SPA entry point when no top-level `404.html` is provided. This repository intentionally uses that behaviour.
8. Smoke-test staff login, imports, scanning and exports on the actual phones. Supabase is called directly by the browser; no Node server or Pages Functions are required.

```
Developer → Git repository → Cloudflare Pages → Browser
Developer → SQL migrations → Supabase
Browser ↔ Supabase Auth / Data API / transactional RPCs
Excel/CSV → Browser parser → Validated attendees → Supabase
Phone camera → QR payload → Check-in RPC → Confirmed result
```

## Verification

```sh
npm run typecheck
npm run lint
npm run build
```

On the deployed site, verify login, imports, repeat and unknown tickets, undo, manual reconciliation and exports. Scan the same unused ticket from two devices simultaneously: exactly one admission should succeed. Verify assigned-event access and organiser-only controls with a check-in staff account. Test real phone camera scanning of both printed QR codes and codes displayed on another phone.

Only the generated `dist` directory is served by Cloudflare Pages. Build tools remain in `devDependencies` because Cloudflare needs them to compile the app; `.env.local`, `node_modules` and `dist` are excluded from Git.

Before each event: restore a paused Free Supabase project if applicable, verify staff access, try unused/repeat/unknown tickets, prepare the backup list and export the final report afterwards.

## Project map

```
src/app/             Authentication, layout and workspace context
src/features/        Dashboard, import wizard, event details and scanner
src/lib/             Supabase calls, parsers, exports and timezone logic
src/types.ts         Shared application types
supabase/migrations/ Tables, RLS policies and protected transactional RPCs
```

Original planning document: `plan..txt`.
