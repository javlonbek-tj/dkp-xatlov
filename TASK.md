# TASK.md — Regional Monitoring System

## 1. Project Overview

Build a web application for monitoring and managing regional and district-level data across four areas:

1. **Census (Xatlov)**
2. **MKD (Multi-Apartment Buildings)**
3. **RAD Limits**
4. **Overdue Applications**

The application must be simple, reliable, secure, and easy to use for daily monitoring activities.

The user interface must be in Uzbek.

## 2. Technology Stack

### Frontend

- React
- Vite
- TypeScript
- Ant Design
- Tailwind CSS
- shadcn/ui

Use Ant Design primarily for tables, forms, modals, and standard UI components. Use Tailwind CSS for layouts and styling. Use shadcn/ui only where it provides useful components.

Avoid unnecessary libraries and duplicate UI solutions.

### Backend

- Node.js
- Express.js
- TypeScript
- PostgreSQL hosted on Neon
- Prisma ORM

Keep the frontend and backend separated into clear, maintainable parts.

## 3. Employees and Regional Assignments

The system will have a list of regions and districts. The user will provide these lists in an Excel file separately.

### Employee Types

1. **Republic-level employee** — enters and updates monitoring data for assigned districts.
2. **Group leader** — one of the Republic-level employees assigned to lead a group within a region.
3. **Regional employee** — responsible for assigned districts within a region.
4. **Administrator** — manages users, regions, districts, and employee assignments.

The group leader is a designation assigned to a Republic-level employee, not a separate employee role.

### Assignment Rules

- Multiple Republic-level employees can be assigned to one region.
- Each region can have multiple regional employees.
- Each Republic-level employee can be assigned approximately 3–4 districts.
- Each regional employee can also be assigned specific districts within their region.
- Each district can have one assigned Republic-level employee and one assigned regional employee.
- One of the Republic-level employees assigned to a region can be designated as the group leader.
- Administrators manage employee assignments.

The system must store and display these assignments consistently across all monitoring sections.

## 4. Authentication and Access Control

Implement login and logout using a username and password.

Requirements:

- Secure password hashing.
- Protected API endpoints.
- Backend authorization checks.
- Secure session or token management.
- Access permissions based on user roles.

### Permissions

| Action                       | Administrator | Republic Employee | Regional Employee           |
| ---------------------------- | ------------- | ----------------- | --------------------------- |
| Log in                       | Yes           | Yes               | Yes                         |
| Manage users                 | Yes           | No                | No                          |
| Manage regions and districts | Yes           | No                | No                          |
| Manage employee assignments  | Yes           | No                | No                          |
| Enter monitoring data        | As needed     | Yes               | No                          |
| Update monitoring data       | As needed     | Yes               | No                          |
| View monitoring reports      | Yes           | Yes               | Yes, within permitted scope |

Republic-level employees can create and update monitoring records only for their assigned districts.

Regional employees can view monitoring reports within their permitted scope but cannot create or update monitoring records.

All permissions must be enforced by the backend, not only by the frontend.

## 5. Main Pages

The application should include the following pages:

1. Login
2. Dashboard
3. Census (Xatlov)
4. MKD
5. RAD Limits
6. Overdue Applications
7. Call Log
8. Employees and Assignments — administrator only

## 6. Dashboard

The dashboard must display an overview of the monitoring activities.

Required indicators:

- Number of regions and districts.
- Key census statistics.
- Completed and remaining MKD work.
- Current month's RAD limit and rejected application count.
- Number of overdue applications grouped by delay stage.

Allow filtering by region, district, and date where applicable.

Calculate dashboard indicators from existing records instead of storing duplicate summary data.

## 7. Census (Xatlov)

Republic-level employees must be able to enter and update census information for their assigned districts.

### Table Columns

1. District name
2. Number of engineers in the district
3. Assigned Republic-level employee
4. Assigned regional employee
5. Number of completed MFYs
6. Census count
7. Migration count
8. Names of completed MFYs
9. Names of MFYs nearing completion

### Requirements

- District names and assigned employees must be retrieved automatically from the assignment data.
- Other monitoring values must be entered by authorized users.
- Multiple MFY names may be recorded.
- Users must be able to create and edit records.
- Historical records must be preserved and viewable by date.
- Provide filtering by region, district, and date.

## 8. MKD (Multi-Apartment Buildings)

This section tracks multi-apartment building registration or processing progress.

### Table Columns

1. District name
2. Number of engineers in the district
3. Assigned Republic-level employee
4. Assigned regional employee
5. MKD type: 2025, 2024, or Yangi O‘zbekiston
6. Total number of multi-apartment buildings
7. Number completed
8. Number remaining
9. Plan to be completed by a specified date
10. Number completed against the plan
11. Number remaining against the plan

### Calculation Rules

- Remaining buildings = Total buildings − Completed buildings.
- Remaining plan = Planned amount − Completed against the plan.

Calculated values must update automatically.

Prevent negative values and invalid data.

Store records separately for each district and MKD type. Allow users to specify the target date for planned work.

## 9. RAD Limits

This section tracks monthly limits and rejected applications.

### Table Columns

1. District name
2. Assigned Republic-level employee
3. Assigned regional employee
4. Limit for the current month
5. Number of rejected applications

### Requirements

- Store limits by month and year.
- Allow authorized users to enter and update the monthly limit and rejection count.
- Preserve historical monthly records.
- Display the remaining limit.

Calculation:

Remaining limit = Monthly limit − Rejected applications.

Prevent duplicate limit records for the same district and month.

## 10. Overdue Applications

This section tracks applications whose processing deadlines have been exceeded.

### Table Columns

1. District name
2. Number of engineers in the district
3. Assigned Republic-level employee
4. Assigned regional employee
5. Application number
6. Reason for missing the deadline
7. Delay stage

### Delay Stages

- 1–3 days
- 4–7 days
- 8–14 days
- 15–30 days
- 31–90 days

### Requirements

- Each application must be stored as a separate record.
- Users must be able to create and edit application records.
- Store the application number, reason for delay, relevant dates, and other required information.
- Calculate the number of overdue days and determine the delay stage from the relevant dates.
- Allow filtering by district, delay stage, and reason.
- Display the responsible Republic-level and regional employees automatically.

## 11. Call Log

Create a separate section for recording daily monitoring calls, particularly calls made around 9:00 AM.

### Table Columns

1. Date
2. District
3. Responsible Republic-level employee
4. Call status:
   - Called successfully
   - No answer
   - Callback required
5. Monitoring areas discussed
6. Identified issues
7. Next action or notes
8. Follow-up date

### Requirements

- Record which districts were contacted on each date.
- Identify districts that have not been contacted or require a callback.
- Allow users to record identified issues and follow-up actions.
- Preserve historical call records.
- Prevent duplicate call-log records for the same district and date unless multiple calls are explicitly supported.

## 12. Tables and User Interface

All monitoring tables should support:

- Search and filtering.
- Pagination.
- Creating and editing records.
- Filtering by region, district, and date where applicable.
- Loading, empty, and error states.
- Confirmation dialogs for destructive actions.
- Exporting table data to Excel.

District names and employee assignments must be populated automatically wherever possible.

Do not require users to manually enter assignment information that already exists in the system.

Keep the interface consistent and straightforward.

## 13. Database Design

Use Prisma ORM with PostgreSQL hosted on Neon.

Required core models may include:

- `User`
- `Region`
- `District`
- `EmployeeDistrictAssignment` or an equivalent assignment model
- `Xatlov`
- `MKD`
- `RADLimit`
- `OverdueApplication`
- `CallLog`

Choose model names and relationships that fit the existing project structure.

### Requirements

- Every district must belong to a region.
- Employee-to-district assignments must be stored explicitly.
- Republic-level and regional assignments must be distinguishable.
- Group leader designation must be supported.
- Apply appropriate required-field, uniqueness, and relational constraints.
- Use `DATABASE_URL` as an environment variable for the Neon PostgreSQL connection.
- Never commit credentials or secrets to the repository.

Avoid unnecessary database models and duplicate data.

## 14. General Requirements

- Validate input on the backend.
- Return clear and consistent API errors.
- Enforce authentication and authorization on the backend.
- Validate dates, numeric fields, and required fields.
- Add basic tests for important functionality.
- Provide a README with setup and run instructions.
- Provide a `.env.example` file without real credentials.
- Ensure Prisma migrations can be applied consistently.
- Keep the code readable and easy to maintain.

## 15. Implementation Order

Implement the application in the following order:

1. Inspect the existing project structure.
2. Review this specification and prepare a short implementation plan.
3. Set up the database schema and Prisma.
4. Implement authentication and access control.
5. Implement regions, districts, employees, and assignments.
6. Implement the Census, MKD, RAD Limits, and Overdue Applications sections.
7. Implement the dashboard and call log.
8. Add Excel export for monitoring tables.
9. Test the main workflows and document setup instructions.

Complete and verify each stage before moving to the next.

## 16. Avoid Overengineering

- Do not use microservices.
- Do not introduce unnecessary abstractions or design patterns.
- Do not store the same information in multiple places without a clear reason.
- Do not install unnecessary dependencies.
- Do not rewrite existing working code without a good reason.
- Do not add features that are not required by this specification.
- Follow the existing project conventions where practical.
- If a business rule is unclear, ask before implementing it instead of making assumptions.

**Main goal:** Build a simple, secure, maintainable monitoring application that supports daily work across regions and districts.
