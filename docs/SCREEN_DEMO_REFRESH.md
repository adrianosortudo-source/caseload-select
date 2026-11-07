# SCREEN AI demonstration refresh

Scope: `/demo/prospect/[profileId]`, including the Walker Law starter profile.

The standalone presentation adopts the current caseloadselect.ca palette, self-hosted Manrope and DM Sans, canonical logo, square controls, full-width copy and a clean intake/brief split. It opens in Live AI and Split view. Website view remains available for screenshot-based prospect presentations; switching views preserves the mounted intake. The builder and real client intake keep their existing appearance and behavior.

## Captured facts

The live engine intentionally treats `llm_inferred` values as unconfirmed. The AI demo now displays canonical selectable extracted facts together for one explicit readback. Only the user's Confirm details and continue action marks the displayed facts answered. Unstated facts still receive questions. Edit my description discards the pending result and allows correction and fresh extraction. Invalid options, unknown fields, contact details and routing proposals are excluded from readback promotion. No changes to global engine provenance, classification, scoring or readiness extraction rules are required.

The phrase “I am the owner and can approve hiring a lawyer” can propose Just me for that same readback; business ownership alone never does. An explicitly requested demand letter is offered in the same review, so that request is not asked again. This is scoped to a fictional demo and requires user confirmation.

Live AI success, loading and fallback are separately labelled. Guided mode makes no AI request. Neither mode persists intake, sends messages, requests audio, captures consent or creates CRM records.

## Validation contract

Run the focused confirmation and widget component tests, TypeScript, ESLint, the full required CI suite and the existing prospect-demo rendered journey. The rendered tests cover 1440, 1024, 768, 640, 375 and 320 CSS pixels, original website/long-input/view-switch journeys, Live AI readback and the resulting brief. Deterministic browser tests stub extraction; a separate preview test must exercise the configured live extraction provider before claiming live-AI verification.

The page shell and screenshot placement are structural widths. They are not copy exceptions. Governed copy fills its component content box. No editorial copy exceptions are introduced.

Release through a pushed PR. Merge requires Adriano's approval of the specific PR after required checks pass. No migrations or direct production deployment.
