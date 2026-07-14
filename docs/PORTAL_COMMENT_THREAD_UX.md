---
doc-type: ux-specification
scope: deliverable-comment-and-version-threading
status: active
version: v1
last-edited: 2026-07-13
---

# Deliverable comment-thread UX

The approval portal follows the Google Docs mental model: a comment is a
conversation attached to a passage, not a disposable annotation tied only to
one render of a document.

## Display rules

- The root comment and all replies render as one visual card.
- A thread created on an earlier version remains visible when the current
  version is selected.
- If its quoted text is no longer present, the card is unanchored and appears
  in the margin's unanchored section.
- Historical version selection shows the thread in the historical context in
  which it was created.
- Resolved threads remain readable; resolution changes state, not history.
- Open-question state must be visually distinct from resolved state.

## Interaction rules

- “Reply” creates a child comment with the same parent thread ID.
- “Resolve” is available only after a reply or corrective action when the root
  is a lawyer question.
- Applying a suggestion selects the resulting version and keeps the related
  thread visible.
- Approval is disabled while the selected version has open or
  needs-discussion suggestions.
- Mutation errors remain visible and do not clear the user's draft or pretend
  that the action succeeded.

## Version and data contract

Every comment records its source `version_id`; every reply records its
`parent_comment_id`. The UI may project an earlier thread onto the current
version for continuity, but must not rewrite historical text or silently drop
the original version identity.

## Acceptance examples

1. Damaris comments on Version 2.
2. The operator replies and applies a wording correction, creating Version 3.
3. Version 3 is selected by default.
4. The Version 2 thread is still visible, with the operator reply nested.
5. The corrected Version 3 text is visible in the article.
6. Switching to Version 2 shows the original wording and original context.
