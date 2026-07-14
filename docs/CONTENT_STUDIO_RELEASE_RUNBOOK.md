---
doc-type: release-runbook
scope: content-studio-code-and-database-releases
status: active
version: v1
last-edited: 2026-07-13
---

# Content Studio release runbook

Use this runbook for changes to suggestions, comments, approval gates,
deliverable versions, or their database enforcement.

## 1. Source and identity

- Start from a clean worktree based on the current `origin/main`.
- Keep unrelated dirty work untouched.
- Record the branch, commit SHA, repository, and changed migration names.
- For Vercel, use the token file and account scope assigned to the project.
- Verify the Git commit author is a member of the Vercel team. A valid token
  does not compensate for a blocked Git author identity.
- Never print token contents or paste them into logs, tickets, or chat.

## 2. Local and focused gates

- Run focused tests for every changed behavior.
- Run `npx tsc --noEmit --pretty false`.
- Run `git diff --check`.
- Run the production build where the filesystem permits it.
- Distinguish pre-existing failures from failures introduced by the release;
  do not silently waive a changed-file failure.

## 3. Database-first deployment

Before deploying code that reads a new function, trigger, column, or table:

1. Apply the migration to production.
2. Confirm the migration appears in the production migration list.
3. Verify function signatures, trigger existence, and role privileges.
4. Confirm existing suggestion/event counts and approval counts are unchanged.
5. Run security and performance advisors; document expected informational
   notices separately from release blockers.

Service-role access bypasses RLS policies but does not bypass triggers. Use
database triggers and transactional RPCs for integrity that must hold in this
application.

## 4. Preview and production

- Deploy an immutable preview artifact from the audited commit.
- Confirm the remote Vercel build and TypeScript phases pass.
- If preview protection is enabled, use the approved protection-bypass method;
  do not weaken project protection.
- Smoke-test the public root and unauthenticated portal/API behavior.
- Perform an authenticated operator and lawyer portal pass before promotion.
- Promote the exact successful preview artifact to production.
- Record the production deployment ID, URL, commit SHA, and timestamp.

## 5. Authenticated acceptance test

Use a reversible, low-risk deliverable and verify:

- Open a passage comment.
- Reply in the same thread.
- Switch between current and historical versions.
- Create a suggestion with original text, replacement, and rationale.
- Confirm open suggestions block approval.
- Apply the suggestion and confirm a new version is created.
- Confirm the previous comment thread remains visible on the current version.
- Confirm the lawyer review notification is queued.
- Confirm no test content was published.

## 6. Emergency or direct SQL changes

Direct production SQL is not the normal path for user-facing workflow changes.
If it is unavoidable, record the reason and reproduce every application side
effect: suggestion event, comment reply, notification outbox row,
`review_notified_at`, version pointer, and audit IDs. Verify the result through
the portal immediately afterward.

## 7. Rollback and handoff

- Keep the prior production deployment available for rollback.
- Never delete an immutable version or approval record to undo a release.
- Revert code by promoting the prior known-good artifact.
- Repair data with a forward migration or compensating event.
- Add any new failure mode to the decision-record registry and this runbook.
