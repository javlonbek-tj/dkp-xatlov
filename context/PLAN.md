# Implementation Plan

## Current state

- `frontend/` is a React 19, Vite, TypeScript starter. `App.tsx` is the Vite counter/demo; no application pages or API integration exist. Ant Design, Tailwind CSS, and shadcn/ui are not in `package.json` or configured.
- `backend/` is an Express 5, TypeScript starter with `GET /api/health`, dotenv, Prisma 6, PostgreSQL `DATABASE_URL`, and a minimal `Region` model. No application API, Prisma client integration, migrations, or auth exists. `.env` exists and is ignored; its contents were not inspected.
- Both areas contain dependencies; backend also contains generated `dist/`. Keep frontend/backend boundaries. Current READMEs are scaffold/template-level.
- Root `.CLAUDE` was not accessible in this inspection; `.claude/agents/planner.md` and the plan review/revision command guidance were inspected.
- Requirements source: root `TASK.md`. Resolve its open business rules before implementing dependent behavior.

## Phase 0 — Confirm requirements and implementation foundation

### P0-T1 - Resolve schema and authorization rules
**Objective:** Confirm the core employee/assignment relationships and access rules before implementing dependent constraints or protected writes.
**Dependencies:** None; unrelated decisions can be answered in parallel.
**Expected changes:** Documented decisions that affect schema cardinality or authorization.
**Acceptance criteria:** Employee identity, employee assignment types, group-leader cardinality, Administrator monitoring-write scope, and regional report scope are recorded. The separately supplied geography spreadsheet is not required to design the base schema; do not assume an import feature.
**Verification:** Check decisions against `TASK.md`; when the geography list is supplied, validate its rows before loading through the chosen admin workflow.

### P0-T2 — Select the minimal UI approach
**Objective:** Confirm the frontend component/styling setup against the specified React, Ant Design, Tailwind, and shadcn/ui stack.
**Dependencies:** None.
**Expected changes:** `frontend/package.json`, Vite/CSS configuration, shared app entry styling as needed.
**Acceptance criteria:** Ant Design is the primary tables/forms/modals solution; Tailwind is available for layout; shadcn/ui is added only for a needed component. No duplicate UI stack is introduced.
**Verification:** Build and lint the frontend after setup; document the chosen versions and setup in the frontend README.

## Phase 1 — Data model and backend foundation

### P1-T1 — Define core Prisma schema and migration
**Objective:** Model users, regions, districts, explicit employee-district assignments, and the minimal structure needed for monitoring records.
**Dependencies:** P0-T1 for employee/assignment cardinality and group-leader constraints. The geography spreadsheet and import approach do not block the base schema.
**Expected changes:** `backend/prisma/schema.prisma`, Prisma migration files, `backend` DB setup docs/config. Reuse the existing `Region` model where appropriate.
**Acceptance criteria:** District belongs to one region; assignment distinguishes Republic/regional employee; group leader designation is representable; required relations and uniqueness are enforced; PostgreSQL uses `DATABASE_URL`; no secrets are committed. Avoid storing calculated dashboard values or duplicate assignment data.
**Verification:** `npx prisma validate`, generate client, and apply migration against a configured development database; inspect resulting constraints and relations.

### P1-T2 — Establish shared backend API and error conventions
**Objective:** Add only the small foundations needed for JSON APIs, request validation, and consistent errors.
**Dependencies:** P1-T1.
**Expected changes:** `backend/src/server.ts` and minimal backend modules only where useful; dependencies only if existing tools are insufficient.
**Acceptance criteria:** JSON requests are parsed; validation failures and unhandled errors return clear consistent responses; health endpoint remains available; no monitoring/auth features are embedded prematurely.
**Verification:** Build backend and exercise health plus representative valid/invalid API requests once an endpoint is added.

## Phase 2 — Authentication and authorization

### P2-T1 — Implement login, logout, and protected access
**Objective:** Provide secure username/password login, logout, password hashing, and protected backend routes with role checks.
**Dependencies:** P1-T1, P1-T2, P0-T1.
**Expected changes:** Backend auth routes/middleware and minimal login UI/session handling; environment example/docs for required secrets.
**Acceptance criteria:** Admin, Republic-level employee, and regional employee can log in; passwords are securely hashed; credentials/session tokens are protected; API enforces permissions, including assigned-district write restriction, the resolved Administrator monitoring-write policy, and regional report scope. Frontend guards are supplementary only.
**Verification:** Test successful/failed login, logout, unauthenticated requests, role-denied requests, and allowed district/scope cases.

## Phase 3 — Organizational data and assignments

### P3-T1 — Manage regions, districts, users, and employee assignments
**Objective:** Provide admin workflows and APIs to manage regions, districts, users, and assignments; populate initial geography through a lightweight process agreed once the supplied list is available.
**Dependencies:** P1-T1, P2-T1, P0-T1.
**Expected changes:** Admin APIs and frontend Employees/Assignments pages; use existing Prisma relations.
**Acceptance criteria:** Admin can manage users, regions, districts, Republic/regional assignments, and group leader; multiple Republic employees may serve a region; each district has at most one assignment of each employee type; the approximately 3-4 district allocation for Republic employees is treated as planning guidance, not a hard constraint; assignments display consistently wherever needed.
**Verification:** Test CRUD, uniqueness/relational constraints, role protection, and assignment updates reflected in district views.

## Phase 4 — Monitoring modules

### P4-T1 — Implement Census (Xatlov)
**Objective:** Record and view dated census snapshots for assigned districts.
**Dependencies:** P3-T1, P2-T1, P0-T1 for Administrator write scope.
**Expected changes:** Prisma model/migration, validated API, frontend table/form.
**Acceptance criteria:** Assignment-derived names are not manually duplicated; authorized Republic employees create/update only assigned districts; Administrators can enter/update records as permitted by the resolved admin policy; multiple completed/nearing MFY names and historical date records are supported; region/district/date filters work.
**Verification:** Test CRUD, authorization, MFY lists, historical retrieval, filtering, and invalid numeric/date inputs.

### P4-T2 — Implement MKD tracking
**Objective:** Record building totals and planned progress per district, type, and target date.
**Dependencies:** P3-T1, P2-T1, P0-T1 for Administrator write scope.
**Expected changes:** Prisma model/migration, API validation/calculations, frontend table/form.
**Acceptance criteria:** Types are 2025, 2024, or Yangi O'zbekiston; remaining values derive from totals; negative/impossible values are rejected; authorized Republic employees write only assigned districts; Administrators can enter/update records as permitted by the resolved admin policy; district/type records and plan dates are represented as specified.
**Verification:** Test each type, calculations, validation boundaries, permissions, and district/date filtering.

### P4-T3 — Implement monthly RAD limits
**Objective:** Track monthly district limits and rejected applications.
**Dependencies:** P3-T1, P2-T1, P0-T1 for Administrator write scope.
**Expected changes:** Prisma model/migration, API, frontend table/form.
**Acceptance criteria:** Unique district/month/year record; remaining limit is calculated; historical months retained; authorized Republic employees write only assigned districts; Administrators can enter/update records as permitted by the resolved admin policy; unauthorized writes denied.
**Verification:** Test uniqueness, calculation, month/year history, filters, and authorization.

### P4-T4 — Implement overdue applications
**Objective:** Record individual overdue applications and derive elapsed days/stage.
**Dependencies:** P3-T1, P2-T1, P0-T1 for Administrator write scope and overdue-date rules.
**Expected changes:** Prisma model/migration, API, frontend table/form.
**Acceptance criteria:** Separate editable records hold application number, reason, relevant dates; stage follows the specified five bands; authorized Republic employees write only assigned districts; Administrators can enter/update records as permitted by the resolved admin policy; responsible employees derive from assignments; filters work.
**Verification:** Test stage boundaries, date validation, CRUD, assignment display, filters, and role scope.

## Phase 5 — Dashboard and call log

### P5-T1 — Implement dashboard indicators and filters
**Objective:** Summarize current persisted monitoring records without duplicate summary storage.
**Dependencies:** P4-T1 through P4-T4.
**Expected changes:** Aggregate backend endpoint and dashboard page.
**Acceptance criteria:** All required region/district counts, census/MKD/overdue indicators are calculated from records; RAD limit and rejected-application indicators use the current month and year; applicable region/district/date filters work; reports obey role scope.
**Verification:** Compare endpoint/UI aggregates to known fixture records; verify RAD month/year selection, filters, and role scope.

### P5-T2 — Implement daily call log
**Objective:** Record calls and expose districts not contacted or needing follow-up.
**Dependencies:** P3-T1, P2-T1, P0-T1.
**Expected changes:** Prisma model/migration, API, call-log page.
**Acceptance criteria:** Status is one of the three specified options; issues, areas, next action and follow-up date persist; history is retained; duplicate district/date calls follow the resolved rule.
**Verification:** Test statuses, date history, duplicate handling, pending callbacks/not-contacted view, filters, and access scope.

## Phase 6 — Integration and release readiness

### P6-T1 — Complete API integration and workflow checks
**Objective:** Connect frontend pages to backend and verify end-to-end daily workflows.
**Dependencies:** P2-T1 through P5-T2.
**Expected changes:** Frontend API calls, loading/empty/error states, validation feedback, table pagination/search/export, confirmation dialogs, backend/frontend tests.
**Acceptance criteria:** All required pages are Uzbek-language; monitoring tables support required create/edit/filter/search/pagination/export behaviors; errors are understandable; backend remains source of authorization truth.
**Verification:** Run frontend lint/build, backend build and tests; exercise admin setup, employee entry, regional report, module calculations, dashboard, and call-log workflows.

### P6-T2 — Finish setup and operational documentation
**Objective:** Document reproducible local setup and migration workflow.
**Dependencies:** P6-T1.
**Expected changes:** Root and backend/frontend README files; `.env.example` files only.
**Acceptance criteria:** Setup, Neon `DATABASE_URL`, secret handling, migrations, dev/build/test commands, and application access are documented without credentials.
**Verification:** Follow README steps in a clean local setup and confirm commands succeed.

## Open business-rule questions

1. **Admin write scope:** Does Administrator "as needed" mean writes to any district, or should admin writes also follow district assignments? Resolve before implementing monitoring write authorization.
2. **Geography source:** When will the region/district Excel file be supplied, and what columns/normalization are expected? It is needed before loading data, but does not block schema design. Confirm whether an import workflow is wanted before building one.
3. **Employee identity:** Are employees represented by `User` records, and can a person hold both Republic and regional assignment types? Impacts assignment constraints and permissions.
4. **Group leader:** Is there exactly one leader per region, and must the leader always be one of that region's Republic-level assignees?
5. **Auth/session:** A server-side session or token is permitted by `TASK.md`; confirm deployment origin/domain constraints before selecting cookie settings, but this need not block the core schema.
6. **Census history:** Can there be multiple snapshots per district on the same date, and who may edit historical snapshots?
7. **MKD plan:** Is one plan per district/type/target date allowed, and can multiple plan dates coexist?
8. **Overdue stage:** Which date determines elapsed overdue days (deadline, registration date, or another date), and how should a future/cleared application be represented?
9. **Call-log uniqueness:** Are multiple calls per district/date needed, despite the default rule to prevent duplicates?
10. **Regional scope:** Does "permitted scope" mean assigned districts only, or all districts in the employee's region?

Resolve each question before its dependent task; unrelated work can proceed. Do not add authentication or monitoring features before their listed phases.
