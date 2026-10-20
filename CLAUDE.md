# Project Instructions

## Project

Xatlov is a regional monitoring application. Follow the requirements in `TASK.md`.

## Technology Stack

- Frontend: React, Vite, TypeScript, Ant Design, Tailwind CSS, shadcn/ui.
- Backend: Node.js, Express.js, TypeScript.
- Database: PostgreSQL on Railway.
- ORM: Prisma.

Inspect the existing code and configuration before making changes.

## Planning and Implementation

- Follow `context/PLAN.md` as the implementation roadmap.
- Follow `context/PLAN_REVIEW.md` when it contains relevant findings.
- Implement only one explicitly identified increment at a time.
- Update `context/PROGRESS.md` after completing an increment.
- Do not start another increment without user approval.
- If an increment is ambiguous or its prerequisites are incomplete, stop and ask for clarification.

## Code Quality

- Keep implementations simple and avoid overengineering.
- Reuse existing code and dependencies where appropriate.
- Do not introduce unnecessary abstractions, libraries, or architectural layers.
- Follow existing naming conventions and project structure.
- Validate inputs and enforce authorization on the backend.
- Never commit secrets or real credentials.
- Do not modify requirements to accommodate an implementation choice.

## Testing Restriction

- Do not create unit tests, integration tests, end-to-end tests, or other automated tests.
- Do not add testing frameworks or testing dependencies.
- Do not run test commands.
- Verify work through code inspection and relevant non-test checks, such as confirming configuration and build commands where appropriate.
- Report any verification that could not be completed.

## Git

- Do not commit, push, or modify Git history unless explicitly requested.
- Report changed files and summarize the completed work.

## Scope

- Do not implement features outside `TASK.md` and the approved implementation plan.
- Do not modify planning documents unnecessarily.
- Ask before making important business-rule assumptions.
