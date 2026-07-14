---
doc-type: operating-playbook
scope: content-studio-lawyer-review-and-comment-resolution
status: active
version: v1
last-edited: 2026-07-13
---

# Content Studio approval playbook

This is the operating procedure for moving a deliverable from lawyer review
to an approved, publishable version. The lawyer remains the legal gate. An
operator may prepare, explain, and apply wording changes, but cannot turn a
response into approval.

## The complete comment-response loop

1. Read the entire lawyer comment and identify whether it is a legal question,
   translation question, factual correction, terminology request, or editorial
   preference.
2. Reply directly in the existing thread. Answer the question before marking
   it resolved. Use the commenter's language when practical.
3. If wording must change, create a structured suggestion against the current
   version. Include the exact original text, replacement text, and a concise
   rationale.
4. Apply the suggestion only after checking the resulting text in context.
   Applying creates a new immutable version and returns the deliverable to
   `in_review`.
5. Confirm the review notification was queued. Do not assume a database write
   sent an email.
6. Resolve the original comment only after the reply and correction are
   visible in the thread.
7. Leave approval to the lawyer. Do not publish or mark approved on the
   lawyer's behalf.

## Thread and version rules

- A reply is a child of the original comment, not a new root comment.
- The reply must remain visible when the current version is shown, even when
  the original highlighted passage changed or disappeared.
- If the passage no longer exists, show the thread as unanchored; do not hide
  it.
- Selecting a historical version should show the comments belonging to that
  historical view.
- A comment marked resolved must still show its reply and correction history.

## Suggestion invariants

- Suggestions target only the deliverable's current version.
- The deliverable must be `in_review` or `changes_requested`.
- Open or discussion-needed suggestions block approval.
- Applying suggestions is atomic and creates one new version.
- Stale, cross-firm, cross-deliverable, or cross-version suggestions fail
  closed.
- A change-request link belongs on the answering version.

## Required response language for common cases

| Comment type | Required response |
|---|---|
| Legal question | Explain the legal distinction and identify what changed; flag anything requiring Damaris's confirmation. |
| Translation question | State whether the issue is language, jurisdiction, or both; avoid implying the translation is legal advice in another jurisdiction. |
| Factual correction | Identify the source of truth and record the corrected fact. |
| Terminology request | Confirm the chosen term and apply it consistently across the asset set. |
| Editorial preference | Explain whether it is a DRG judgment or a legal requirement. |

## Release evidence

Record these IDs in the release note or portal audit trail:

- Original comment ID.
- Reply comment ID.
- Suggestion ID and lifecycle event ID.
- Source and resulting version IDs.
- Notification outbox ID.
- Approval record ID, when approval occurs.

## Definition of done

- The lawyer's question has a visible answer in the same thread.
- The corrected wording is visible in the current version.
- The comment is resolved only after the answer is posted.
- The deliverable is still awaiting lawyer approval.
- The lawyer received the review notification.
- No unrelated content changed.
