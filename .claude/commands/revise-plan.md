---
description: Revise context/PLAN.md based on context/PLAN_REVIEW.md while preserving TASK.md requirements and avoiding overengineering.
---

# Revise Implementation Plan

Revise `context/PLAN.md` using the findings in `context/PLAN_REVIEW.md`.

The goal is to produce a complete, clear, minimal implementation plan that satisfies `TASK.md` and is ready for implementation.

## 1. Read the Required Files

Read:

- `TASK.md`
- `context/PLAN.md`
- `context/PLAN_REVIEW.md`
- `CLAUDE.md`, if present
- Relevant existing project files when necessary to verify findings

Inspect the existing `frontend/` and `backend/` structure when a review finding depends on the current implementation.

Do not assume the review is correct without checking its findings against the requirements and actual project state.

## 2. Review Findings

For each finding in `context/PLAN_REVIEW.md`:

1. Determine whether it is valid.
2. Identify the affected task or phase.
3. Correct the plan if a change is necessary.
4. Avoid changes that contradict `TASK.md` or existing working functionality.
5. Do not introduce new requirements that were not requested.

Prioritize:

- Critical issues first.
- Important issues second.
- Minor issues only when they provide meaningful value.

If a finding is incorrect, do not make an unnecessary change. Record a brief explanation in the revision summary.

## 3. Revise the Plan

Update `context/PLAN.md` directly.

Preserve useful existing content and completed work. Make only the changes needed to resolve valid findings.

Ensure the revised plan:

- Covers all requirements in `TASK.md`.
- Includes authentication and backend authorization.
- Correctly represents regions, districts, employees, assignments, and the group leader designation.
- Covers Census (Xatlov), MKD, RAD Limits, Overdue Applications, the dashboard, and the call log.
- Defines logical implementation phases and task dependencies.
- Includes actionable tasks with acceptance criteria and appropriate verification steps.
- Reflects the actual project structure.
- Avoids duplicating existing functionality.
- Avoids unnecessary libraries, abstractions, architectural layers, and unrelated features.
- Includes testing and documentation where appropriate.

Do not rewrite the entire plan when a small correction is sufficient.

## 4. Keep the Plan Under 200 Lines

**Strict limit: `context/PLAN.md` must contain no more than 200 lines.**

Before finishing:

1. Count the lines in `context/PLAN.md`.
2. If the file exceeds 200 lines, consolidate duplicated content and shorten explanations.
3. Preserve all essential requirements, dependencies, acceptance criteria, and verification steps.
4. Recount the lines to confirm the limit is satisfied.

The 200-line limit is mandatory, not a target to exceed when convenient.

## 5. Handle Unclear Requirements

Do not invent business rules to resolve ambiguity.

If an important decision cannot be determined from `TASK.md`, the review, or the existing code:

- Keep the plan as complete as possible without making assumptions.
- Record the unresolved question in the revision summary.
- Explain which implementation task depends on the answer.

Do not block unrelated tasks unnecessarily.

## 6. Update the Revision Summary

After revising the plan, update `context/PLAN_REVIEW.md` with a concise revision summary.

Include:

- Findings addressed.
- Findings rejected, with brief reasons.
- Important changes to the implementation order.
- Remaining unresolved questions.
- Whether the plan is ready for implementation.

Do not silently delete important findings from the review.

Keep `context/PLAN_REVIEW.md` at **200 lines or fewer**. Verify the line count before finishing.

## 7. Restrictions

You must not:

- Modify `TASK.md`.
- Modify application source code.
- Implement frontend or backend features.
- Install dependencies.
- Run database migrations.
- Change environment variables or secrets.
- Commit or push Git changes.
- Create additional agents or commands.
- Add unnecessary scope to the project.

Only update `context/PLAN.md` and `context/PLAN_REVIEW.md`.

## 8. Final Response

Report:

1. Whether the plan was revised.
2. The main corrections made.
3. The line count of `context/PLAN.md`.
4. Any unresolved business questions.
5. Whether the plan is ready for implementation.
6. The first task to execute next.

Keep the response concise.
