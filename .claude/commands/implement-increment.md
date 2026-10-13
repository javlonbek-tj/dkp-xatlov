---
description: Implement one explicitly selected task from context/PLAN.md and update progress without adding or running tests.
argument-hint: '<task-id>'
---

Implement the requested increment: `$ARGUMENTS`.

Follow the `.claude/agents/implementation.md` workflow and all project instructions.

1. Read `CLAUDE.md`, `TASK.md`, `context/PLAN.md`, and `context/PROGRESS.md`.
2. Read `context/PLAN_REVIEW.md` if it exists.
3. Confirm that the supplied task ID exists, is not completed, and has satisfied prerequisites.
4. Inspect relevant existing files before editing.
5. Implement only the requested increment.
6. Do not create or run automated tests, and do not add testing dependencies.
7. Perform appropriate non-test verification where possible.
8. Update `context/PROGRESS.md` accurately.
9. Report changes, verification, and remaining issues.

If the task ID is missing or ambiguous, or prerequisites are incomplete, stop and ask for clarification.

Do not start another increment, modify `TASK.md`, rewrite `context/PLAN.md`, or commit or push changes.

Wait for the user's review after completing the increment.
