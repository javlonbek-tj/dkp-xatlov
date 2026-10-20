---
description: Review context/PLAN.md against TASK.md for completeness, dependencies, security, and overengineering without implementing anything.
---

# Evaluate Implementation Plan

Review the implementation plan in `context/PLAN.md` against the requirements in the root `TASK.md`.

## Instructions

### 1. Read the Requirements and Plan

Read:

- `TASK.md`
- `context/PLAN.md`
- `CLAUDE.md`, if present
- Relevant existing project files when needed to verify assumptions

Inspect the current project structure, including `frontend/` and `backend/`, to ensure the plan reflects the actual state of the project.

Do not assume that a feature is missing without checking the existing implementation.

### 2. Evaluate the Plan

Review the plan using these criteria:

**Requirements coverage**

- Does the plan cover all four monitoring modules: Census (Xatlov), MKD, RAD Limits, and Overdue Applications?
- Does it include authentication and backend authorization?
- Does it account for regions, districts, employees, employee assignments, and the group leader designation?
- Does it include the dashboard and call log?
- Does it include validation, testing, and documentation?
- Does it respect the requirements and exclusions in `TASK.md`?

**Task quality**

- Are tasks small, actionable, and understandable?
- Does each task have clear acceptance criteria?
- Are dependencies identified correctly?
- Is the implementation order logical?
- Are expected file changes realistic?

**Technical correctness**

- Does the plan match the existing React, Vite, Express, TypeScript, Prisma, and Railway PostgreSQL setup?
- Does it account for frontend/backend integration?
- Does it avoid duplicate data and inconsistent employee assignments?
- Does it include appropriate validation, authentication, and access control?
- Are database migrations and environment configuration considered where necessary?

**Overengineering**

- Does the plan introduce unnecessary libraries, abstractions, design patterns, or architectural layers?
- Does it propose microservices or unrelated features?
- Does it duplicate functionality already available in the project?
- Can any tasks be removed or combined without losing required functionality?

**Consistency**

- Are there contradictions between tasks?
- Are any important business rules assumed without evidence?
- Does the plan distinguish existing functionality from work that remains to be done?

### 3. Assign Findings

Classify each finding as:

- **Critical:** A major security issue, blocking dependency, or fundamental requirement missing from the plan.
- **Important:** A missing requirement, incorrect task order, or significant technical concern.
- **Minor:** A small improvement or clarification that does not block implementation.

Do not report stylistic preferences as defects unless they materially affect maintainability or correctness.

For each finding, include:

- Severity
- Relevant task ID, if available
- The issue
- Why it matters
- A concrete recommended correction

### 4. Produce the Review

Create or update `context/PLAN_REVIEW.md`.

Use this structure:

# Plan Review

## Overall Assessment

Choose one:

- **PASS** — Ready for implementation.
- **PASS WITH MINOR CHANGES** — Implementation can begin after minor corrections.
- **NEEDS REVISION** — Important issues must be fixed first.

Briefly explain the assessment.

## Findings

List findings by severity, from Critical to Minor.

If no findings exist, explicitly state that.

## Missing Requirements

List any requirements from `TASK.md` that are not adequately covered by the plan.

## Overengineering

Identify unnecessary complexity, if any.

## Recommended Changes

List concrete changes needed before implementation.

## Final Recommendation

State whether the plan is ready for implementation and identify the first task that should be started.

### 5. Constraints

- Do not modify `TASK.md`.
- Do not modify `context/PLAN.md`.
- Do not modify application source code.
- Do not install dependencies or run database migrations.
- Do not implement features.
- Do not automatically fix findings.
- Do not invent requirements or business rules.
- Keep the review concise and actionable.

**Strict limit:** `context/PLAN_REVIEW.md` must contain no more than 200 lines.

If the plan exceeds 200 lines, evaluate it without reproducing it. Prioritize material issues and avoid duplicate findings.

Before finishing, verify that `context/PLAN_REVIEW.md` contains no more than 200 lines.

Report the review file created or updated, the overall assessment, and any Critical or Important findings.
