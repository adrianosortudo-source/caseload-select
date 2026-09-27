# Fictional welcome-page example

This example represents an Ontario business firm that wants more purchase and sale work. Its input selections are fixed in `src/lib/desired-client/example.ts`. No real client or firm facts were used.

On 27 September 2026, `gemini-2.5-flash` was called with the current Desired Client system prompt, user prompt, response schema and fictional selections. The original model response is saved in `source-gemini-response.json`. It did not pass the tool's strict validator: it exceeded field budgets, introduced an unsupported numeric boundary, and cited an unfilled field. The displayed HTML example was edited to remove those errors and to make the business work and hypothetical decision needs precise. The edited version is checked by `example.test.ts` against the same validator as a live result.

The example shows the report format and possible use, not an assurance that every AI run will produce identical wording or quality. Its proposed Screen questions do not change any scoring configuration. The real tool requires the user's review before a Blueprint is treated as their firm's working direction.

The welcome page shows a short excerpt and expandable full example. `/tools/desired-client-matter/example` presents the same report as standalone HTML. The print stylesheet keeps the concise profile and Screen row summaries while omitting the supporting answer transcript and individual proposed questions. No example PDF file is generated or stored; the browser's Print action can be used for later conversion.
