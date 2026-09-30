# Practice-direction amendment for current implementation

This amendment governs the current six-section Desired Client discovery update. Earlier documents in this folder describe a previous accepted blueprint and are retained as history. Where they conflict with this amendment, this amendment controls this update only; unrelated product and repository rules remain in force.

## Discovery and answer contract

Keep the six sections in order: Practice, Client & matter, Value, Fit, Opportunity, and Repeatability, followed by Review. The answer schema is `dcm-v3.1`. Practice asks what the firm currently does, what it enjoys, and what it wants to market less, including the reason. Client & matter captures the target work and client situation, then asks whether the firm has regular, occasional, adjacent, new, or unknown experience supporting that direction. Capability detail is optional, specific, and limited to 180 characters. Adjacent or new directions may collect at most two development needs: expertise, support, process, capacity, or unknown. Unknown is an explicit usable answer. No demographic attribute is required or used to score a lead.

When existing `dcm-v3.0` drafts resume, preserve all existing answer text, leave experience unanswered, and return the user to Client & matter to answer the new experience question. A selected unknown experience maps to the existing exploratory route so legacy route validation remains satisfied. Clear downstream answers only when the selected area or matter changes.

## Report contract

The report contract is `dcm-blueprint-v3`. Its opening sentence speaks from the law firm's perspective and defines the desired client and matter, why the firm wants that work, and a proposed measure of progress. It must never describe the law firm as its own desired client. A target remains proposed even after the user reviews the wording.

The Practice card is a fixed, source-linked sequence of five statements: Current practice; Work to grow; Experience supporting this direction; Development needs; Marketing emphasis to reduce. Preserve all five slots when information is unknown and label uncertainty accurately. Do not infer expertise, specialization, demand, economics, or capacity. Other existing report cards retain their fact and evidence status, decision pathway, and proposed-outcome guardrails. The structured fallback uses the same contract and clearly remains a structured draft.

Preserve valid saved `dcm-blueprint-v1` and `dcm-blueprint-v2` reports on their original rendering paths. The new report schema does not rewrite those historical reports. HTML is the downloadable, print-ready document; do not create a PDF in this update. Screen remains a proposal only and does not score or decide whether to accept a lead. No CRM or lead-scoring behavior changes.

## Implementation boundary

Update answer validation/migration, the six-stage UI and review summary, AI instructions and output validation, deterministic structured fallback, on-screen rendering, and HTML/text/source exports together. Keep answer provenance and explicit unknowns. This is an implementation amendment, not a deployment or production-activation authorization.
