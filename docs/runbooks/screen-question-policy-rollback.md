# Screen question policy rollback

This procedure applies to the private app and embedded demo used for Screen review. The server admits the new question policy only on Preview or local development and only when `SCREEN_PARITY_QUESTION_POLICY` is set to `grounded_v1`. The website widget sends the version returned by its first successful extraction with each written follow-up. The API accepts that pinned version even after opening admissions are turned off.

## Return to the previous behaviour

1. Deploy the same compatible Preview code with `SCREEN_PARITY_QUESTION_POLICY` unset. On Vercel, the configuration takes effect on the next deployment. Keep the Preview address that serves the active widget connected to the compatible code.
2. In an existing tab on the new question policy, enter a written answer and complete the enquiry. Compare the opening, the written answer and the full brief. Start another enquiry in that same tab and verify it uses the previous question policy. After the switch, a widget that already started on that policy can also finish.
3. Open a brief completed before the switch and one completed after it. Verify both stored JSON and HTML. Retain the existing lead IDs and the saved briefs. A retry with the same lead ID must leave one complete record.
4. If a code backout is necessary, wait for active sessions using the new policy to finish while the compatible API is available. Revert only the feature changes with a normal pull request and the repository’s required checks. Use the normal deployment path.

The rollback adds no database migration. The version is an optional field in the existing intake data. An ordinary browser tab holds the active web enquiry in memory. The recovery test covers the tab staying open through the switch. Reloading or closing a tab can clear unfinished or unsubmitted text.

## Saved versions

| Surface | Revision |
| --- | --- |
| App and embedded demo private review | `f9a3701c88c42291613c058fc4c49da87cf4f842` |
| Shared engine private review | `18805b3ae5878c941f32910ee295e938cee3b340` |
| Live app and Admin at review start | `dca3af5d77fe3ab4415e19fd2c6f3654cbd45b14` |
| Live marketing website at review start | `8e9fbb375250a472b4e61552361dd0b7d2c3fe35` |
