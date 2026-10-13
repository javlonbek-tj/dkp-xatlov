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
