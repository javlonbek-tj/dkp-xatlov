# Backend

Minimal Express and TypeScript API scaffold with Prisma configured for PostgreSQL (Neon).

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your Neon connection string. Keep `.env` private.
3. Generate the Prisma client with `npx prisma generate`.
4. Apply pending migrations with `npm run prisma:migrate`.
5. Start the development server with `npm run dev`.

The server listens on port 3000 by default (or `PORT` from `.env`). Check `GET http://localhost:3000/api/health` for the health response.

The initial core migration is in `prisma/migrations/20261012190000_init_core`. With a valid `DATABASE_URL`, apply pending migrations in development with `npx prisma migrate dev`; deploy an existing migration set with `npx prisma migrate deploy`.

The schema contains users, regions, districts, employee assignments, dated Xatlov snapshots, daily in-progress MKD snapshots per year, monthly RAD limits, overdue applications, and call logs. The APIs are available at `/api/xatlov`, `/api/mkd`, `/api/rad-limits`, `/api/overdue-applications`, `/api/dashboard`, and `/api/call-log`. Authenticated users can view records in their permitted scope; Administrators may create and edit records in any district; Republic employees may create and edit records for their assigned districts; regional employees have report-only access within their region. Viewers ("Kuzatuvchi") also have read-only access to the regions they are assigned to, but cannot see call logs or the assignments page and are not assigned to districts. Call logs are unique per district/date and preserve history; the selected-date response identifies districts without a call record or with a callback required. Xatlov snapshots are unique per district/date; MKD snapshots per district/year/date; RAD limits per district/month/year. Remaining values are calculated by the API. Overdue applications store a manually chosen delay stage (`1-3`, `4-7`, `8-14`, `15-30`, `31-90`, `90+`) that changes only when edited; the reason is optional, and cleared applications are hidden from the active view. Migration `20261013040000_overdue_manual_stage` fills the stage of existing rows from their old deadline. The dashboard uses the latest Xatlov record per district and latest MKD snapshot per district/year within its selected date range. RAD dashboard values always use the current Tashkent month/year. Apply pending migrations with `npm run prisma:migrate` after configuring `DATABASE_URL`.

## Authentication

- `POST /api/auth/login` accepts `{ "username": "...", "password": "..." }` and returns a bearer session token and user details.
- Send the token as `Authorization: Bearer <token>` to `GET /api/auth/me` and `POST /api/auth/logout`.
- Passwords are verified against scrypt hashes; session tokens are random, stored as SHA-256 hashes, expire after `SESSION_TTL_HOURS` (12 hours by default), and are revoked on logout.
- Use HTTPS in deployed environments. The frontend keeps the bearer token in memory, so reloading the page requires signing in again.
- Backend route guards are exported from `src/auth.ts`: `requireAuth`, `requireRole`, and `requireDistrictAccess`. Use them on protected routes; administrator writes are allowed for any district, Republic employees can write assigned districts, and regional employees can access reports for all districts in their assigned region.

To create the first Administrator after applying migrations, run `npm run admin:bootstrap` in an interactive terminal. It refuses to create another bootstrap account once an Administrator exists. Further user, region, district, and assignment management is available in the authenticated Administrator interface. To load the regions and districts from `Viloyat_tuman.xlsx`, run `npm run seed:regions`; it only creates missing regions and districts, so it is safe to run again.

The protected `/api/admin` routes support listing and creating, updating, or deleting users, regions, and districts. Region assignment routes add/remove Republic-level or regional employees and set the optional group leader. District routes validate that selected employee assignments match both the required employee type and district region. Group leaders can use the same `/api/admin` region, district and assignment routes for the regions they lead: they see only those regions and districts, can create new Republic-level or regional employee accounts directly in them (`POST /api/admin/regions/:regionId/employees`), edit the full name and phone number of employees assigned to them (`PATCH /api/admin/users/:userId`), add or remove employees in them, assign employees to districts, and update engineer counts. User management, creating, renaming, moving or deleting regions and districts, and setting the group leader remain Administrator-only. `GET /api/auth/me` includes `isGroupLeader`. In Xatlov, MKD, RAD limits and overdue applications, a group leader can also view and enter records for every district in the regions they lead; call logs stay limited to their own assigned districts.

## Report

`GET /api/report?date=YYYY-MM-DD&regionId=...` returns one row per district of a region in the caller's scope (date defaults to today in Tashkent, region to the first accessible one). Each row combines district data (employee phones, total/Xatlov employee counts, object and MFY counts), the latest Xatlov snapshot on or before the date (completed MFY, completed objects, migration count shown as "bir kunda", payment debt in million soums), the RAD limit for the date's month, and counts of applications still open on that date in the `15-30` stage or a later stage (`31-90`, `90+`). Apply the migrations `20261013020000_add_district_counts_and_phone` and `20261013030000_add_xatlov_report_fields` with `npm run prisma:migrate`.
