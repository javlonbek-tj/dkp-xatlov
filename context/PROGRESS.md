# Implementation Progress

## Current Status

- Overall status: In progress
- Current increment: None
- Last completed increment: P5-T1 - Implement dashboard indicators and filters

## Increment History

### P0-T1 — Resolve schema and authorization rules (completed)

- Employees are represented by `User` accounts; each person may hold only one assignment type (Republic-level or regional).
- A region may have no group leader or at most one; the leader must be among that region's Republic-level assignees.
- Administrators may enter and update monitoring data for any district.
- Regional employees may view reports for all districts in their region.
- No geography importer is assumed; the separately supplied geography list is not needed to establish the base schema.
- Files changed: `context/PROGRESS.md`.
- Acceptance criteria: All schema cardinality and access-scope decisions required by P0-T1 are recorded.
- Verification: Cross-checked the recorded answers against P0-T1 in `context/PLAN.md` and the permission rules in `TASK.md`.

### P0-T2 — Select the minimal UI approach (completed)

- Chose Ant Design as the primary standard component library and Tailwind CSS v4 for layout and utility styling.
- Configured Ant Design's CSS-in-JS output in the `antd` cascade layer so Tailwind utility rules can override it.
- Deferred shadcn/ui until a specific component need justifies it.
- Files changed: `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/README.md`, and `context/PROGRESS.md`.
- Acceptance criteria: Ant Design is installed as the primary UI component library; Tailwind is available through Vite; no additional shadcn/ui dependency or duplicate component library was added; the selected approach and versions are documented.
- Verification: `npm run lint` passed. `npm run build` passed when rerun outside the sandbox after an initial sandbox `spawn EPERM`/native-binding failure. No automated tests were created or run.

### P1-T1 — Define core Prisma schema and migration (completed)

- Expanded the Prisma schema with `User`, `Region`, `District`, `EmployeeRegionAssignment`, and the `UserRole` enum. Monitoring-record models are deferred to their module increments.
- Added unique usernames and region names, district-name uniqueness within a region, one optional group-leader assignment per region, and explicit Republic-level and regional district-assignment relations.
- Composite foreign keys keep district assignments and a region's group-leader assignment within the matching region. Districts can carry an optional engineer count.
- Added the initial PostgreSQL migration and migration lock file; updated backend setup instructions.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261012190000_init_core/migration.sql`, `backend/prisma/migrations/migration_lock.toml`, `backend/README.md`, and `context/PROGRESS.md`.
- Acceptance criteria: Core models and relations are represented; role types distinguish administrators and employee types; uniqueness and region relations are present; PostgreSQL remains configured through `DATABASE_URL`; no credentials were added.
- Verification: `npx prisma validate` passed; Prisma Client generation passed; migration SQL was generated from the schema; `npm run build` passed. No automated tests were created or run.

### P1-T2 - Establish shared backend API and error conventions (completed)

- Added a reusable `ApiError` type for future route validation and client errors.
- Added JSON responses for unknown `/api` endpoints, malformed JSON request bodies, known API errors, and unexpected server errors. Unexpected errors return a generic message without exposing internals.
- Kept the existing health endpoint and JSON request parser.
- Files changed: `backend/src/api-error.ts`, `backend/src/server.ts`, and `context/PROGRESS.md`.
- Acceptance criteria: JSON bodies are parsed; malformed JSON and API errors use a consistent `{ error: { code, message } }` response; unhandled failures are sanitized; the health endpoint remains; no auth or monitoring functionality was added.
- Verification: `npm run build` passed. Manual requests returned `200` JSON from `/api/health`, `400` with the standard error envelope for malformed JSON, and `404` with the standard envelope for an unknown `/api` route. Unhandled-error response was inspected in code. No automated tests were created or run.

### P2-T1 - Implement login, logout, and protected access (completed)

- Added opaque random bearer sessions stored as SHA-256 hashes in PostgreSQL, with configurable expiry and logout revocation.
- Added scrypt password verification, login/logout/current-user endpoints, and reusable authentication, role, and district-scope guards.
- Added a session model and migration. Administrators may write any district; Republic employees may write assigned districts; regional employees may view reports across their assigned region.
- Replaced the frontend demo with a minimal Uzbek login/session view. The token remains in memory and the Vite dev server proxies `/api` to the backend.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261012200000_add_sessions/migration.sql`, `backend/src/auth.ts`, `backend/src/db.ts`, `backend/src/password.ts`, `backend/src/server.ts`, `backend/.env.example`, `backend/README.md`, `frontend/src/App.tsx`, `frontend/vite.config.ts`, and `context/PROGRESS.md`.
- Acceptance criteria: Passwords use scrypt; all three account roles are returned after successful login; sessions are hashed, expire, and can be revoked; protected identity endpoint and reusable role/scope guards enforce backend access policy; no credentials are committed.
- Verification: `npx prisma validate` passed; generated Prisma Client types reflect the new schema; backend `npm run build`, frontend `npm run lint`, and frontend `npm run build` passed. Prisma generation reported Windows `EPERM` while replacing the existing query engine DLL, although the client types were updated. No automated tests were created or run.
- Remaining setup at this increment: Apply the session migration to the configured development database. P3-T1 later added first-administrator bootstrapping and user provisioning.

### P3-T1 - Manage regions, districts, users, and employee assignments (completed)

- Added admin-only APIs for user, region, and district listing and CRUD, plus employee-to-region assignment and group-leader management.
- Validated employee roles and matching region for district assignments; group leaders must be Republic-level employees assigned to that region. Database uniqueness and foreign-key conflicts return clear API errors.
- Added an interactive, one-time first-Administrator bootstrap command; password input is hidden and passwords are stored with the existing scrypt utility.
- Added an Uzbek administrator interface for users, regions, districts, employee assignments, and group-leader selection.
- Files changed: `backend/src/admin.ts`, `backend/src/bootstrap-admin.ts`, `backend/src/server.ts`, `backend/package.json`, `backend/README.md`, `frontend/src/AdminPanel.tsx`, `frontend/src/App.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: Admin-only backend management; employee types and district/region constraints enforced; one optional Republic-level group leader per region; district assignment rows support at most one employee of each type; the approximate Republic employee district count is not enforced; no importer was added because the geography workbook and import rules are not available.
- Verification: Backend `npm run build`, frontend `npm run lint`, and frontend `npm run build` passed. Database-backed endpoint interaction could not be exercised because migrations have not been applied to a configured development database. No automated tests were created or run.
- Remaining setup: Configure `DATABASE_URL`, run `npm run prisma:migrate`, then run `npm run admin:bootstrap` once to create the first administrator.

### P4-T1 - Implement Census (Xatlov) (completed)

- Added dated Xatlov snapshots with numeric census fields, multiple completed/nearing MFY names, and a unique district/date constraint. The user resolved the open rules: one snapshot per district/date; Administrators and Republic employees currently assigned to the district may edit historical snapshots; Administrators can write in any district.
- Added authenticated list/filter, create, and edit APIs. Backend scoping limits Republic employees to assigned districts and regional employees to report access across their region. Counts and dates are validated; duplicate district/date snapshots return a conflict.
- Added an Uzbek Xatlov page with region, district, and date filters; assignment-derived district and employee details; record entry and editing. Admins can navigate from the existing management screen, and employee roles open the report page after login.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261012210000_add_xatlov_records/migration.sql`, `backend/src/xatlov.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/XatlovPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: dated history, multiple MFY names, filters, automatically sourced assignments, authorized create/edit actions, and database uniqueness are implemented.
- Verification: `npx prisma validate`, Prisma Client generation, backend `npm run build`, frontend `npm run lint`, frontend `npx tsc -b`, and frontend `npm run build` passed. The production frontend build reports its existing large-bundle warning. No automated tests were created or run. Database-backed behavior was not exercised because the migration has not been applied to a development database.
- Remaining setup: Configure `DATABASE_URL` and run `npm run prisma:migrate` in `backend/` before using the monitoring API.

### P4-T2 - Implement MKD tracking (completed)

- Added MKD records for 2025, 2024, and Yangi O'zbekiston with one record per district/type/target date. The user confirmed that multiple plan dates may coexist for a district/type.
- Added scoped list/filter, create, and edit APIs. Backend validation rejects negative counts and impossible relationships; remaining building and plan values are derived instead of stored. Administrators may write any district, Republic employees only assigned districts, and regional employees have report-only access within their region.
- Added an Uzbek MKD page with region, district, type, and date filters; assignment-derived district details; create/edit forms; and calculated remaining columns. Added navigation between MKD and Xatlov for signed-in users.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261012220000_add_mkd_records/migration.sql`, `backend/src/mkd.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/MkdPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/XatlovPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: All three types are supported; remaining values are calculated; invalid/negative/impossible values are rejected; records are distinct by district/type/target date with multiple dates supported; write authorization is enforced.
- Verification: `npx prisma validate`, Prisma Client generation, backend `npm run build`, frontend `npm run lint`, and frontend `npx tsc -b` passed. No automated tests were created or run. Database-backed behavior remains unverified until migrations are applied to a development database.
- Remaining setup: Configure `DATABASE_URL` and run `npm run prisma:migrate` in `backend/` before using the MKD API.

### P4-T3 - Implement monthly RAD limits (completed)

- Added monthly RAD records keyed uniquely by district, month, and year. The remaining limit is calculated as monthly limit minus rejected applications and is not stored separately.
- Added authenticated list/filter, create, and edit APIs. Administrators may write any district, Republic employees may write assigned districts only, and regional employees have report-only access for districts in their region. Inputs validate month/year ranges and non-negative whole-number counts; duplicate monthly entries return a conflict.
- Added an Uzbek RAD page with region, district, month, and year filters, current-month defaults, historical viewing, assignment-derived employee names, and create/edit forms. Added navigation among the implemented monitoring pages.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261012230000_add_rad_limits/migration.sql`, `backend/src/rad-limits.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/RadLimitPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/XatlovPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: one record per district/month/year; historical month records; calculated remaining limit; authorized writes and scoped reports; filters.
- Verification: `npx prisma validate` passed. Prisma Client generation updated schema types using `--no-engine`; normal engine generation failed because Windows denied replacing the locked query-engine DLL. Backend build, frontend lint, and frontend TypeScript build passed. No automated tests were created or run. Database-backed behavior has not been exercised; migrations are not applied to a development database.
- Remaining setup: Close any process holding the Prisma query-engine DLL, run `npx prisma generate` in `backend/` to restore the normal runtime client, configure `DATABASE_URL`, and run `npm run prisma:migrate` before using the RAD API.

### P4-T4 - Implement overdue applications (completed)

- Added individual application records with application number, reason, deadline date, and optional cleared date. The user resolved the date/status rules: overdue days count calendar days after the deadline through today; future and cleared records are excluded from the active list; records beyond 90 days remain visible as `90+`.
- Added authenticated list/filter, create, and edit APIs. Stages (1–3, 4–7, 8–14, 15–30, 31–90, 90+) and overdue-day totals are calculated in Tashkent's calendar date; active/all views preserve future and cleared records for review. Republic writes require district assignment; Administrators can write all districts; regional employees have report-only access across their region.
- Added an Uzbek overdue-applications page with district, stage, and reason filters, active/all views, assignment-derived district/employee details, and create/edit forms. Linked it into signed-in monitoring navigation.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261013000000_add_overdue_applications/migration.sql`, `backend/src/overdue-applications.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/OverdueApplicationsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: separate editable application records; validated required fields and dates; computed overdue days and the five specified stages plus the resolved `90+` display; assignment-derived names; district/stage/reason filters; backend write/read scope.
- Verification: `npx prisma validate`, standard Prisma Client generation, backend `npm run build`, frontend `npm run lint`, frontend `npx tsc -b`, and frontend `npm run build` passed. The frontend production build reports its existing large-bundle warning. No automated tests were created or run. Database-backed behavior has not been exercised because migrations have not been applied to a development database.
- Remaining setup: Configure `DATABASE_URL` and run `npm run prisma:migrate` in `backend/` before using the API.

### P5-T1 - Implement dashboard indicators and filters (completed)

- Added an authenticated dashboard aggregation endpoint that derives region/district totals, Xatlov statistics, MKD completion/remaining values, current-month RAD totals, and active overdue counts by stage from persisted records.
- Reports use the same server-side geography scope as the monitoring pages. Date filters apply to Xatlov snapshots, MKD target dates, and overdue deadlines; RAD is always current Tashkent month/year as required. Dashboard Xatlov totals use the latest record per district in the selected range; MKD totals use the latest record per district/type in range to avoid double-counting dated history.
- Added an Uzbek dashboard page with region, district, and date-range filters; loading/error states; statistics cards; current RAD indicators; and overdue-stage breakdown. It opens after employee login and is accessible to Administrators from the management screen and monitoring navigation.
- Files changed: `backend/src/dashboard.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/DashboardPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: all required indicators are derived from persisted rows; current-month/year RAD behavior is explicit; geography/date filters and authorization scope are enforced.
- Verification: Backend `npm run build`, frontend `npm run lint`, and frontend `npx tsc -b` passed. No automated tests were created or run. Database-backed aggregate comparisons were not possible because migrations have not been applied to a development database.
- Remaining setup: Configure `DATABASE_URL` and apply pending migrations with `npm run prisma:migrate` in `backend/` before using dashboard data.
## Current Blockers

`npx prisma migrate status` confirmed that all seven migrations are applied and the configured Neon database schema is up to date. Database-backed workflow checks have not yet been exercised. P3-T1 validates employee roles and regions for assignments in the admin API.

Open questions in `context/PLAN.md` remain only where they affect future work. The user resolved call-log uniqueness as one record per district/date for P5-T2. Census history policy is resolved for P4-T1, MKD plan-date policy for P4-T2, and overdue calculation/status policy for P4-T4. Bearer sessions were selected for authentication, so cookie deployment settings do not apply. The recorded user decisions supersede corresponding open questions in the plan.

## Next Action

Wait for review before starting another increment. P5-T2 is complete; P6-T1 code integration is ready, with database-backed workflow exercise still pending migration setup.

### P5-T2 - Implement daily call log (completed)

- Added the `CallLog` Prisma model and PostgreSQL migration. The user confirmed one record per district/date; a database unique constraint enforces this while retaining prior dates.
- Added authenticated list/create/edit API endpoints. Republic employees can write for assigned districts, Administrators for any district, and regional employees can view reports within their region. The date response lists districts with no record or with callback required.
- Added an Uzbek call-log page with date selection, call status, monitoring areas, issues, next action/notes, and follow-up date. Added navigation from the dashboard, admin page, and monitoring pages.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261013010000_add_call_logs/migration.sql`, `backend/src/call-log.ts`, `backend/src/server.ts`, `backend/README.md`, `frontend/src/CallLogPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/DashboardPage.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria: all three statuses are supported; areas, issues, next action, and follow-up date persist; call history is retained; duplicate district/date calls are blocked; the selected-date view identifies uncontacted and callback-required districts; backend authorization enforces role scope.
- Verification: `npx prisma validate`, `npx prisma generate`, backend `npm run build`, frontend `npm run lint`, frontend `npx tsc -b`, and frontend `npm run build` passed. The frontend production build reports the existing large-bundle warning. No automated tests were created or run. Database-backed endpoint behavior remains unverified until the migration is applied to a configured development database.
- Remaining setup: Configure `DATABASE_URL` and apply pending migrations with `npm run prisma:migrate` in `backend/` before using the call-log API.

### P6-T1 - Complete API integration and workflow checks (in progress)

- Confirmed the dashboard, monitoring pages, login flow, and administrator management page are connected to the authenticated backend APIs. Existing forms, module filters, pagination, loading/error/empty states, validation feedback, and administrator destructive-action confirmations are retained.
- Added case-insensitive client-side search to the Xatlov, MKD, RAD, overdue-application, and call-log tables. Added dependency-free CSV exports of the currently filtered and searched records; files use UTF-8 BOM and are compatible with Excel.
- Files changed: `frontend/src/csv-export.ts`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, `frontend/src/CallLogPage.tsx`, and `context/PROGRESS.md`.
- Acceptance criteria addressed in code: Uzbek pages, CRUD forms, applicable filters, search, pagination, export, clear loading/empty/error feedback, and backend-enforced authorization.
- Verification: Backend `npm run build`, frontend `npm run lint`, `npx tsc -b`, and frontend `npm run build` passed; production build retains the existing large-bundle warning. No automated tests were added or run, following project instructions.
- Remaining verification: End-to-end workflows against PostgreSQL still need representative users and monitoring records. Prisma confirmed all migrations are applied and the configured Neon schema is up to date. I have not created sample records pending confirmation that this database is appropriate for temporary QA data. Then manually exercise Administrator setup, Republic employee entry, regional reports, module calculations, dashboard filters, and call-log history/callback flows.

### UI refresh - Sidebar layout and modern styling (completed, frontend only)

- Added a shared `AppLayout` with a dark left sidebar (grouped navigation, user card, logout), a sticky top bar, and content on the right; mobile uses a slide-out drawer. Replaced per-page button navigation and the admin/monitoring page toggle with a single page state in `App.tsx`.
- Applied an Ant Design theme (indigo primary, rounded corners, Inter font, softer card shadows), redesigned the login screen, and restyled the dashboard with icon KPI tiles and progress meters. Data, API calls, filters, and business logic are unchanged. Backend untouched.
- Added `@ant-design/icons` (already installed as an antd dependency) to `package.json`.
- Files changed: `frontend/index.html`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/src/App.tsx`, `frontend/src/AppLayout.tsx` (new), `frontend/src/AdminPanel.tsx`, `frontend/src/DashboardPage.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, `frontend/src/CallLogPage.tsx`, `context/PROGRESS.md`.
- Verification: `npx tsc -b`, `npm run lint`, and `npm run build` passed (existing large-bundle warning remains). Not visually checked in a browser.

### Xatlov page - Single date filter and weekly totals (completed)

- Replaced the "Sanadan"/"Sanagacha" filters with a single date picker (same as the report page), defaulting to yesterday. The API now requires `date` and returns that date's records.
- Added a "Haftalik (Du–Ju)" column group with weekly census and migration totals per district, summed from Monday to Friday of the selected date's week (up to the selected date). Other columns stay daily values. The weekly columns are included in the totals row and the Excel export.
- Files changed: `backend/src/xatlov.ts`, `frontend/src/XatlovPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. No automated tests were added or run. Not checked in a browser.

### Report page - Weekly migration column (completed)

- Added a "Du–Ju" column next to "bir kunda" in the report: each district's migration total from Monday to Friday of the report date's week (up to the report date). It is included in the region total row and the Excel export; export highlight column positions were shifted accordingly.
- Files changed: `backend/src/report.ts`, `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. No automated tests were added or run. Not checked in a browser.

### Xatlov and report - Migration per employee per day (completed)

- Added "1 xodimga kunlik migratsiya" (Xatlov page) and "1 xodimga kunlik" (report, next to "Du–Ju"): Monday–Friday migration total ÷ days worked this week ÷ Xatlov employee count, rounded to 2 decimals. Days worked = the district's saved Xatlov records from Monday up to the selected date. Total rows use total migration ÷ Σ(days × employees). Both Excel exports include the new column; report export highlight positions were shifted.
- Files changed: `backend/src/xatlov.ts`, `backend/src/report.ts`, `frontend/src/XatlovPage.tsx`, `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. No automated tests were added or run. Not checked in a browser.

### Xatlov and report - Lowest per-employee migration highlighted (completed)

- The three districts with the lowest "1 xodimga kunlik" value (empty values ignored) are highlighted in red on the Xatlov page and in the report, including both Excel exports.
- Files changed: `frontend/src/XatlovPage.tsx`, `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. No automated tests were added or run. Not checked in a browser.

### Report - Badge key migration columns (completed)

- "bir kunda" (blue) and "Du–Ju" (purple) values are shown as badges in the report table, like the Xatlov page. Excel export is unchanged.
- Files changed: `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### Overdue applications - Single date filter (completed)

- Replaced "Sanadan"/"Sanagacha" with a single date picker defaulting to yesterday; the API now requires `date` and returns that date's snapshots. New records default to the selected date; the export filename includes the date.
- Files changed: `backend/src/overdue-applications.ts`, `frontend/src/OverdueApplicationsPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### RAD limits - Daily dated records (completed in code, migration pending)

- User decisions: each RAD record is a month-to-date snapshot for a date (limit and rejections from the start of the month up to that date); existing monthly rows take the Tashkent date of their last edit, clamped to their own month.
- `RadLimit` now has `recordDate` (unique per district/date) instead of `month`/`year`. Migration `20261015000000_rad_limits_daily` converts existing rows.
- The RAD page uses a single date filter (default yesterday) and a date field in the form. The report uses each district's latest snapshot from the start of the report month up to the report date; the dashboard does the same for the current month up to today.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261015000000_rad_limits_daily/migration.sql`, `backend/src/rad-limits.ts`, `backend/src/report.ts`, `backend/src/dashboard.ts`, `frontend/src/RadLimitPage.tsx`, `context/PROGRESS.md`.
- Verification: `npx prisma validate`, `npx prisma generate`, backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. The migration has not been applied to the database yet. Not checked in a browser.

### RAD limits - Prefill from the previous record (completed)

- New `GET /api/rad-limits/districts/:districtId/previous?date=` (write access) returns the district's latest record before the date. When adding a record, the form prefills the monthly limit from it and the rejected count too if it is in the same month (otherwise 0); changing the date in the form refreshes the prefill. Values stay editable.
- Files changed: `backend/src/rad-limits.ts`, `frontend/src/RadLimitPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser; the daily RAD migration is still pending.

### MKD - Daily in-progress records by year (completed in code, migration pending)

- User decisions: the old MKD table (type, total/completed/planned buildings) is fully replaced and its data dropped; any year from 2020 to the current year can be chosen; the report uses each district's latest record per year on or before the report date; the dashboard shows the in-progress total.
- `MkdRecord` now stores `year`, `recordDate` and `inProgressCount` (unique per district/year/date); enum `MkdType` was removed. Migration `20261016000000_mkd_in_progress` drops and recreates the table.
- The MKD page was rewritten like the RAD page: region, district, year and a single date filter (default yesterday), totals row, Excel export, and a form with date, year and in-progress count.
- The report has a new "MKD (jarayonda)" group after "Muddat kechikishi": "Jami" plus a "shundan" column for every year that has MKD data up to the report date (included in the Excel export). The dashboard has an "MKD (jarayonda)" card.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261016000000_mkd_in_progress/migration.sql`, `backend/src/mkd.ts`, `backend/src/report.ts`, `backend/src/dashboard.ts`, `backend/.qa-cleanup.ts`, `backend/README.md`, `frontend/src/MkdPage.tsx`, `frontend/src/ReportPage.tsx`, `frontend/src/DashboardPage.tsx`, `context/PROGRESS.md`.
- Verification: `npx prisma validate`, `npx prisma generate`, backend `npm run build`, frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. The migration has not been applied to the database yet. Not checked in a browser.

### Xatlov - Prefill from the previous record (completed)

- New `GET /api/xatlov/districts/:districtId/previous?date=` (write access) returns the district's latest record before the date. When adding a record, all form fields (counts, payment debt, completed MFY names) are prefilled from it; changing the date in the form refreshes the prefill. Values stay editable; with no previous record the fields start at 0/empty.
- Files changed: `backend/src/xatlov.ts`, `frontend/src/XatlovPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### MKD - Prefill from the previous record (completed)

- New `GET /api/mkd/districts/:districtId/previous?year=&date=` (write access) returns the district's latest record of that year before the date. When adding a record, the in-progress count is prefilled from it (0 if none); changing the year or date refreshes it. The value stays editable.
- Files changed: `backend/src/mkd.ts`, `frontend/src/MkdPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser; the MKD migration is still pending.

### Navigation - MKD page restored (completed)

- The MKD page had no menu item or route. Added "MKD" to the Monitoring menu after "Xatlov" and the matching route in `App.tsx`.
- Files changed: `frontend/src/App.tsx`, `frontend/src/AppLayout.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### Report - PDF export and title (completed)

- User decisions: the title is in Latin script; the note shows the report date and the export time. The PDF first used the browser print dialog; the user then asked for a direct download, so `jspdf` 3.0.1 and `html2canvas` 1.4.1 were added (loaded on demand, like `exceljs`).
- Added "PDF yuklab olish" next to the Excel export. `frontend/src/pdf-export.ts` builds an A4 landscape page from the same headers, rows and red highlights as the Excel export, renders it to an image in a hidden frame and downloads `hisobot-YYYY-MM-DD.pdf`. Long tables are split between rows and the column headers repeat on following pages. The PDF content is an image (text is not selectable).
- Both exports have the title "“Dolzarb 90 kunlik” doirasida <region> boshqarmasi tomonidan amalga oshirilgan ishlar to‘g‘risida" / "MA’LUMOT" with "<date> y. soat <time>" on the right. `exportExcel` accepts an optional `title` option.
- Files changed: `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/excel-export.ts`, `frontend/src/pdf-export.ts` (new), `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. `exportPdf` was run with sample data in headless Chrome: 22 districts fit on one A4 landscape page; 31 rows split into two pages between rows with repeated headers. Not checked inside the running app.

### MKD and report - Top in-progress districts highlighted (completed)

- MKD page: the three districts with the largest in-progress count (summed over the records shown for the selected date and year filter; zero ignored) are highlighted in red, including the Excel export.
- Report: the three districts with the highest MKD "Jami" are highlighted in red in the "Jami" and year columns, in the table and in the Excel and PDF exports.
- Files changed: `frontend/src/MkdPage.tsx`, `frontend/src/ReportPage.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### MKD - Default year filter (completed)

- The MKD page now loads all years for the selected date and filters by year on the client. Until the user picks a year, 2024 is shown if any shown district has a non-zero 2024 in-progress count on that date, otherwise 2023. Clearing the year filter shows all years. Totals, the top-3 highlight, the export and the new-record default year follow the shown year.
- Files changed: `frontend/src/MkdPage.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### Report - PDF text alignment fix (completed)

- On some systems html2canvas drew text lower than the browser, so words touched the cell borders. The PDF page now uses fixed pixel font sizes and line heights, a little more cell padding, and single-word header titles (e.g. "T/r") no longer wrap. The page is widened to the table's real width before rendering, so the title and date stay aligned with the table.
- Files changed: `frontend/src/pdf-export.ts`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. `exportPdf` was rerun with sample data in headless Chrome and the output checked visually; the original misalignment could not be reproduced on this machine, so the fix should be confirmed on the machine that showed it.

### MKD - Fill zero for all districts (completed)

- New `POST /api/mkd/fill-zero` (`{ year, recordDate, regionId?, districtId? }`) creates a 0 in-progress record for that year and date in every district the user may edit (within the optional filter) that has no record yet; existing records are never changed. Regional employees get 403.
- MKD page: "Barchasiga 0 kiritish" button (with confirmation) uses the shown year, selected date and region/district filter; it is disabled when all years are shown. After it runs, only non-zero districts need editing.
- Files changed: `backend/src/mkd.ts`, `frontend/src/MkdPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### UI - Smaller text (completed)

- Theme tokens: base font size 14px → 13px, table cells 12px (all table sizes), menu item height 42 → 38, card header 15px → 14px.
- Files changed: `frontend/src/main.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

### Roles - Viewer ("Kuzatuvchi") (completed in code, migration pending)

- User decisions: a read-only role that sees only the regions it is assigned to; pages: Dashboard, Hisobot, Xatlov, MKD, RAD and Muddati o‘tgan, with Excel/PDF export; no call logs, assignments or admin pages.
- `UserRole` gains `VIEWER` (migration `20261016010000_add_viewer_role`). Viewers use region assignments for scope, so all read endpoints work unchanged; every write endpoint already requires an Administrator or responsible Republic employee. `GET /api/call-log` returns 403 for viewers. Administrators and group leaders can create viewers and assign them to regions; viewers cannot be assigned to districts.
- Frontend: "Kuzatuvchi" label and option in the user forms; write controls are shown only to Administrators and Republic employees; viewers do not see the call-log menu item or the "Boshqaruv" group; the region assignment table shows "Butun hudud (faqat ko‘rish)" instead of a district picker for viewers.
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261016010000_add_viewer_role/migration.sql`, `backend/src/auth.ts`, `backend/src/admin.ts`, `backend/src/call-log.ts`, `backend/README.md`, `frontend/src/App.tsx`, `frontend/src/AppLayout.tsx`, `frontend/src/AdminPanel.tsx`, `frontend/src/AssignmentsPage.tsx`, `frontend/src/DashboardPage.tsx`, `frontend/src/ReportPage.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, `frontend/src/CallLogPage.tsx`, `context/PROGRESS.md`.
- Verification: `npx prisma validate`, backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. `npx prisma generate` updated the client types but could not replace the query engine file because the running backend holds it; restart the backend after migrating. The migration has not been applied. Not checked in a browser.

### Xatlov - Daily work per district employee (completed in code, migration pending)

- User decisions: a new "Tuman rahbari" role with a login, created by a Republic employee assigned to the district's region; district employees have no login and their list is kept by Republic employees; each day the district head enters the Xatlov count and migration count per employee; one record per employee per day; the district head cannot change a saved record, only the Republic employee can; Administrators, Republic employees, regional employees and viewers can see the records in their scope; the breakdown lives in the Xatlov page.
- `UserRole` gains `DISTRICT_HEAD`; `User.districtId` links a district head to their district. New models `DistrictEmployee` (full name, position, phone) and `EmployeeDailyWork` (unique per employee/date). Migration `20261020000000_district_employee_daily_work`. Existing Xatlov district records are unchanged and not calculated from employee records.
- New `/api/district-employees`: `GET ?date=&regionId=&districtId=` returns employees in scope with their record for the date; employee CRUD, district head account CRUD (create, edit name/phone/password, delete) and record editing are allowed to Administrators and Republic employees assigned to the district's region; district heads may only add records for their own district. Employees with saved records cannot be deleted (409). Admin endpoints no longer create district heads, change a role to or from district head, or assign them to regions.
- Frontend: the Xatlov page has two tabs, "Tumanlar bo‘yicha" (the existing table) and "Xodimlar kesimida" (region, district and date filters, totals row, Excel export, "Kiritish" / "Tahrirlash" actions, and a "Tuman xodimlari ro‘yxati" window for the staff list and district head accounts). District heads see only the Xatlov menu item and the employee tab for their district; a saved record shows as "Kiritilgan".
- Files changed: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261020000000_district_employee_daily_work/migration.sql` (new), `backend/src/district-employees.ts` (new), `backend/src/server.ts`, `backend/src/admin.ts`, `backend/README.md`, `frontend/src/XatlovEmployeesTab.tsx` (new), `frontend/src/XatlovPage.tsx`, `frontend/src/App.tsx`, `frontend/src/AppLayout.tsx`, `frontend/src/AdminPanel.tsx`, role types in the other page files, `context/PROGRESS.md`.
- Verification: `npx prisma validate`, backend `npm run build`, frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. `npx prisma generate` updated the client types but could not replace the query engine file because the running backend holds it; restart the backend after migrating. The migration has not been applied. Not checked in a browser.

### Database - Moved from Neon to Railway PostgreSQL (completed)

- User decision: use Railway PostgreSQL next to the Railway backend to remove the Neon (ap-southeast-1) round trips, about 122 ms per query from the development machine.
- Data copied with PostgreSQL 18.6 client tools (installed via winget, command line tools only): `pg_dump` of Neon's `public` schema, then `pg_restore --single-transaction` into Railway PostgreSQL 18.6. Row counts match in all 13 tables, and `prisma migrate status` against Railway reports all 18 migrations applied.
- Local `backend/.env` now points to the Railway public proxy; the Neon URL is kept there as a commented backup. The dump files and `backend/.env.railway` were deleted.
- `TASK.md`, `CLAUDE.md`, `context/PLAN.md`, `backend/README.md`, `.claude/agents/planner.md` and `.claude/commands/evaluate-plan.md` now name Railway instead of Neon.
- Still to do by the user: set the Railway backend service's `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` (private network) and redeploy. From the development machine the public proxy measured about 248 ms per query, slower than Neon, so the speed-up applies only to the backend running on Railway.

### Performance - Prisma relationJoins and TanStack Query on the Xatlov page (completed)

- User decision: speed up API reads and saves with Prisma `relationJoins` and TanStack Query with optimistic updates; this increment covers the backend change and the Xatlov page (both tabs) only.
- Backend: the Prisma generator enables the `relationJoins` preview feature, so every `include` is loaded in one SQL query. Measured on 50 Xatlov records with the district include: 7 queries / 3546 ms before, 1 query / 862 ms after (from the development machine over the Railway public proxy; on Railway's private network each query is much faster).
- Frontend: added `@tanstack/react-query` 5.104.1 and `frontend/src/api.ts` (shared `queryClient` with a 30 s stale time and an `apiFetch` helper). The cache is cleared on logout. The Xatlov "Tumanlar bo‘yicha" and "Xodimlar kesimida" tabs load through `useQuery` (cached per date/filter, previous rows kept while a new filter loads). Saves update the table at once: the editor closes, the row shows the new values, a failed save restores the previous rows and shows the error, and the data is refetched after every change. Rows that are not yet confirmed cannot be edited. District head accounts are not optimistic: their window stays open until the server accepts them (e.g. a taken username).
- Files changed: `backend/prisma/schema.prisma`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/api.ts` (new), `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/XatlovPage.tsx`, `frontend/src/XatlovEmployeesTab.tsx`, `context/PROGRESS.md`.
- Verification: `npx prisma validate`, backend `npm run build`, frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. `npx prisma generate` updated the client but could not replace the query engine file because the running backend holds it (the engine version is unchanged); restart the backend to load the new client. Not checked in a browser. Other pages (MKD, RAD, Muddati o‘tgan, Hisobot, Dashboard, Qo‘ng‘iroqlar, admin pages) still use plain `fetch`.

### Performance - TanStack Query on the remaining pages (completed)

- User decision: move every remaining page to TanStack Query, with optimistic saves where possible.
- `frontend/src/api.ts` gained shared helpers: `useOptimisticMutation` (shows a change at once, restores the previous data if the server refuses it, then refetches the page plus the report and dashboard), `applySaved` (puts a saved row into a one-date list), `optimisticId` / `isOptimistic`; `apiFetch` errors now carry the API error code. The Xatlov page and its employee tab were switched to these helpers.
- MKD, RAD limitlari, Muddati o‘tgan arizalar and Qo‘ng‘iroqlar jurnali load through `useQuery` (cached per date and filter, previous rows kept while loading) and save optimistically; the editor closes at once and unconfirmed rows cannot be edited. The call log also updates the "needs attention" list and moves to the saved call's date. MKD "Barchasiga 0 kiritish" is not optimistic (the server decides which districts get a 0) and shows a loading state.
- Hisobot, Bosh sahifa and Tayinlangan xodimlar load through `useQuery` (read-only). The report's PDF error is kept separately from the load error.
- Boshqaruv (`AdminPanel`) loads users, regions and districts as three cached queries. Its changes are not optimistic because the server often refuses them (taken username, assignments in use); the page is no longer locked while an action runs, the lists refresh in the background, and every cached page is marked stale so changed assignments appear everywhere. District assignment changes are sent in parallel instead of one by one.
- Still using plain `fetch`: login/logout/`me` in `App.tsx` and the one-off "previous record" prefill requests of Xatlov, MKD and RAD.
- Files changed: `frontend/src/api.ts`, `frontend/src/XatlovPage.tsx`, `frontend/src/XatlovEmployeesTab.tsx`, `frontend/src/MkdPage.tsx`, `frontend/src/RadLimitPage.tsx`, `frontend/src/OverdueApplicationsPage.tsx`, `frontend/src/CallLogPage.tsx`, `frontend/src/ReportPage.tsx`, `frontend/src/DashboardPage.tsx`, `frontend/src/AssignmentsPage.tsx`, `frontend/src/AdminPanel.tsx`, `context/PROGRESS.md`.
- Verification: Frontend `npx tsc -b`, `npm run lint` and `npm run build` passed. Not checked in a browser.

### Overdue applications - Fill zero for all districts (completed)

- User decision: add the MKD "Barchasiga 0 kiritish" action to the overdue applications page.
- New `POST /api/overdue-applications/fill-zero` (`{ recordDate, regionId?, districtId? }`) creates an all-zero record for that date in every district the user may edit (within the optional filter) that has no record yet; existing records are never changed. Users who cannot edit any district get 403.
- Muddati o‘tgan arizalar page: "Barchasiga 0 kiritish" button (with confirmation, for Administrators and Republic employees) uses the selected date and region/district filter and reports how many districts got a zero record.
- Files changed: `backend/src/overdue-applications.ts`, `frontend/src/OverdueApplicationsPage.tsx`, `context/PROGRESS.md`.
- Verification: Backend `npm run build`, frontend `npx tsc -b` and `npm run lint` passed. Not checked in a browser.

## Login page - Redesigned form, autofill off

- Login page reworked as a two-column card: a brand panel on the left (hidden on mobile) and the form on the right.
- Browser autofill turned off: the form and the username field use `autoComplete="off"`, the password field `new-password`.
- Added placeholders and autofocus; the username cannot be only spaces.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov employees tab - Yesterday as default date

- The "Xodimlar kesimida" tab now opens on yesterday's date (as the district tab already did), so census and migration counts are entered for the previous day by default.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov employees tab - 16 rows per page

- The "Xodimlar kesimida" table shows 16 rows per page by default (size options 16, 50, 100).
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## District head - Dashboard and report for own district

- District heads now also see "Bosh sahifa" and "Hisobot" in the menu, next to Xatlov; no other pages.
- Backend: new `reportDistrictScope` in `auth.ts` limits a district head to the district they head; used by `/api/report` and `/api/dashboard` only, so every other endpoint still returns nothing to them.
- Dashboard region list is now derived from the readable districts (same result for existing roles).
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov employees tab - Compact rows

- The "Xodimlar kesimida" table uses the compact (`small`) size so 16 rows fit on screen with less scrolling.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov employees tab - Weekly (Du–Ju) totals and lowest migration first

- `GET /api/district-employees` now also returns `weeklyCensusCount` and `weeklyMigrationCount` per employee: Monday to Friday of the selected date's week, up to that date (same rule as the district tab).
- The table groups columns into "Kunlik" and "Haftalik (Du–Ju)", with weekly totals in the summary row and the Excel export.
- Rows are sorted by weekly migration, lowest first; the three lowest have the weekly migration cell in red (also in Excel). Optimistic saves adjust the weekly totals for weekday dates.
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## District employees - Note (izoh)

- `DistrictEmployee.note` (optional text, up to 300 chars) for cases such as annual leave or study; migration `20261021000000_district_employee_note` applied on Railway.
- Employee create/edit accepts `note`; the add/edit form has an "Izoh" field.
- The note is shown in orange under the position in the employees table, as a column in the staff list window, in search and in the Excel export.
- Verified with `prisma migrate deploy`, backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov page - PDF export with title

- Both Xatlov tabs ("Tumanlar bo‘yicha" and "Xodimlar kesimida") have a "PDF yuklab olish" button next to the Excel export, using the report's `exportPdf` (A4 landscape, grouped headers, totals row, red highlights).
- Excel and PDF now carry a report-style title: "“Dolzarb 90 kunlik” doirasida <district | region | Respublika> bo‘yicha (xodimlar kesimida) xatlov va migratsiya ishlari to‘g‘risida", "MA’LUMOT", and the date and time.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Call log - Hidden from regional employees

- Regional employees no longer see "Qo‘ng‘iroqlar" in the menu, and `GET /api/call-log` returns 403 for them (as for viewers). Writing was already limited to Republic employees and admins.
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Regional employees - Only their own districts

- `readableDistrictScope` now limits a regional employee to the districts where they are the assigned regional representative (previously every district of their region). Viewers and Republic employees are unchanged.
- `requireDistrictAccess('report')` follows the same rule.
- Applies to every page that uses the shared scope: dashboard, report, Xatlov (both tabs), MKD, RAD, overdue applications.
- Checked on Railway data: e.g. `navoiy-qiziltepa` → Qiziltepa tumani only; `navoiy-nurota` → G‘ozg‘on shahar and Nurota tumani.
- Verified with backend `npm run build`; not checked in a browser.

## Admin panel - User list filters

- The "Foydalanuvchilar" tab has a search (full name, login, phone), a role filter and a region filter (users assigned to that region), like the districts tab.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Viewers - One region or the whole republic

- Cause of "viewer sees nothing": the viewer account had no region assignment, and viewers only saw assigned regions.
- `User.allRegions` (migration `20261021010000_viewer_all_regions`, applied on Railway): a viewer with it sees every region; otherwise exactly one region via a region assignment.
- Admin `POST /users` and `PATCH /users/:id` take `viewerRegionId` (region ID, or null for the whole republic); it is required when creating a viewer or changing a user to viewer, and replaces the viewer's region. Leaving the viewer role clears it. Group leaders cannot change it.
- Adding a second region to a viewer through region assignments is refused (`VIEWER_HAS_SCOPE`).
- `readableDistrictScope` and `requireDistrictAccess('report')` honour `allRegions`.
- Admin panel user form shows "Ko‘rish doirasi" (Respublika or one region) for viewers; the users table shows "Respublika" for such viewers.
- Verified with `prisma migrate deploy`, backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov district tab - Compact table

- The "Tumanlar bo‘yicha" table uses the compact (`small`) size, narrower columns (long titles on two lines) and a 1690 px scroll width instead of 2030 px.
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov page - Default region

- On both Xatlov tabs a non-admin user who can see a single region (e.g. a Republic employee or viewer assigned to Navoiy) has that region selected in the "Hudud" filter by default; it cannot be cleared. Admins and users with several regions still start with all regions.
- The default region is also used for the district list and the Excel/PDF title (no extra request: the data is already limited to that region).
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov - Daily plan to 31.12.2027

- `backend/src/xatlov-plan.ts`: deadline 31.12.2027 and the official holidays of Uzbekistan (Ramazon/Qurbon hayiti dates are estimates and must be corrected when announced). A holiday on a day off moves to the next working day. Working days are counted after the given date up to the deadline for a 5-day and a 6-day week, holidays excluded.
- `GET /api/xatlov` returns `plan` counted after the selected date. The "Tumanlar bo‘yicha" table has a "Kunlik reja" group: remaining objects (`objectCount` − `completedObjectCount` of the day's record), daily plan for a 5-day and a 6-day week (rounded up), with totals; the 5-day cell is red when the day's migration is below it. An info line above the table shows the working days and the excluded holidays. Excel/PDF include the new columns and the red highlight.
- `GET /api/dashboard` returns `plan` with total, completed and remaining objects of the selected districts (latest records), counted after the newest record date; the dashboard shows a "Xatlov rejasi" card.
- Checked on Railway data from 26.10.2026: Navoiy viloyati 226 526 objects, 55 048 completed, 299 / 360 working days.
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov - Finish-date forecast

- The "Kunlik reja" group of the "Tumanlar bo‘yicha" table has a "Taxminiy tugash" column: the day the remaining objects are done if the district keeps this week's average daily migration (weekly migration ÷ days with a record since Monday), counted in a 5-day week with holidays skipped from the selected date. The totals row gives the forecast for the visible districts together (sum of their daily paces), i.e. the region when one region is shown.
- Green when on or before 31.12.2027, red after it; "Muddatsiz" when there is no migration this week or the forecast is over 10 years. Excel/PDF include the column and the red highlight.
- `plan.fiveDayDaysOff` (holiday days off of a 5-day week after the selected date) is returned by `GET /api/xatlov`. Holidays after 2027 are not known, so later forecasts skip weekends only.
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov - Forecast on the last 5 working days

- The "Taxminiy tugash" pace is now the average daily migration over the last 5 working days up to the selected date (5-day week, holidays excluded; `lastWorkDaysStart` in `xatlov-plan.ts`), divided by the days with a record in that window, instead of the current week.
- `GET /api/xatlov` returns `paceMigrationCount` and `paceDays` per record; the optimistic save adjusts them like the weekly totals.
- Checked on Railway data for 26.10.2026 (window 20.10–26.10): Navoiy viloyati 242 migrations a day, forecast 27.07.2029.
- Verified with backend `npm run build`, frontend `npx tsc -b` and `npm run lint`; not checked in a browser.

## Xatlov - Shorter plan note

- The info line above the "Tumanlar bo‘yicha" table shows only the working days left to 31.12.2027 for a 5-day and a 6-day week; the colour explanations and the holiday list were removed (holidays are still excluded from the count).
- Verified with `npx tsc -b` and `npm run lint`; not checked in a browser.
