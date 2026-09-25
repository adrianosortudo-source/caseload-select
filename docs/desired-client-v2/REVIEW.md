# Desired Client V2 review

This records review of the implementation, not approval to publish it.

## Product and content review

Astra reviewed the deterministic outputs regenerated from the fixed fictional fixtures in `review/structured-fixtures.json` on 2026-09-24. The checks below record the original structured-path review. The separate 25 September audit now includes five real provider samples and their remaining quality limits.

| Fixture | Review finding |
|---|---|
| P01 established commercial agreements | Preserves the chosen work, client role, timing, Ontario, fee/effort and capacity. Treats the intended direction as a preference. |
| P02 new acquisition practice | Calls the direction a hypothesis. Shows capacity, evidence and economics as checks rather than presenting future capability as demonstrated. |
| P03 difficult economics | Retains the difficult fee/effort answer and calls for a check; does not calculate profitability or rank the work. |
| P04 unknown answers | Completes without mandatory prose, labels unresolved work and client goal, and prioritizes capacity as the third check. Other unknown answers remain visible in their sections. |
| P05 communication demands | Frames the issue as service conditions and an important limit. Does not label a person undesirable or determine matter acceptance. |
| P08 provisional comparison | Keeps the lawyer’s acquisition choice and explicitly calls it provisional. The unselected agreement work is not substituted as the winner. |
| P09 commercial ranges | Preserves supplied fee, total team time and payment bands. Does not derive a rate, profit, margin or forecast. |

All seven outputs retain the intended direction separately from evidence, and every delivery section includes fee compared with effort. Suggestions are labeled as suggestions. The output guides marketing priorities; individual matter acceptance remains a lawyer’s decision.

## Corrections found during integration

- Preserve a full brief while an optional clarification is shown; leaving it open must not create a new request or change the answer revision.
- Remove stale “Other” wording when a concrete work or role is selected.
- Keep the lawyer’s two-work comparison and provisional choice; prefill only unanswered fields.
- Bound requests across failures and clarifications, and ignore stale responses.
- Include dismissed clarification notes in the view and exports without simultaneously claiming that no question remains.
- Preserve the creation date and original seven-day expiry when merely resuming or downloading a draft.
- Put the API route at the exact `/api/tools/desired-client-matter/analyze` path used by the client.

These are review requirements. Their automated/rendered verification is recorded separately in `VERIFICATION.md`; this list alone is not evidence that each fix passed.

## Outstanding review gates

- Functional browser, keyboard, print and iframe checks pass. Final responsive verification is recorded in `VERIFICATION.md` and the combined browser report.
- The optional Gemini adapter was authorized and implemented. The 25 September audit exercised it with five fictional live profiles; see AUDIT_2026-09-25.md. Local preview AI remains disabled because preview Redis configuration is absent.
- Astra reviewed five live fictional outputs in the 25 September audit. The full deployed AI journey and five-lawyer usability study remain outstanding.
- No merge or deployment is authorized by this review document.

A final source review verified abort/listener/observer cleanup, draft restoration/expiry and the exact framing route. The framing matcher regression covers the trailing-slash alias, similarly prefixed siblings and deeper paths. Phone spacing and the fee/effort label-value presentation are recorded in engineering amendment 25.
