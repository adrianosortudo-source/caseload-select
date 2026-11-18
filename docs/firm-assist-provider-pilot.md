# Firm Assist answer provider pilot

Existing firm widgets can continue sending `{ "question": "…" }` to `POST /api/assist/[firmId]`. Google processes the question for retrieval and generates the answer. The firm’s stored corpus and query vectors use `gemini-embedding-001` at 768 dimensions.

## Offering OpenAI answers

An operator enrolls an approved firm by setting `FIRM_ASSIST_ANSWER_AI_PROVIDER=openai` and adding its exact database UUID to `FIRM_ASSIST_OPENAI_FIRM_IDS`. The server needs its CaseLoad project key for Responses and its Google key for retrieval. The allowlist is empty by default. Removing a firm withdraws its option on the next deployment.

On an allowed firm origin, `GET /api/assist/[firmId]/config` includes `openaiAnswerOption` when the firm has an included page and the option is available. The object contains a disclosure and a consent version. The embedding widget should show the disclosure before submission, leave the OpenAI choice unchecked, and send `openaiAnswerConsent` equal to the returned version only when the visitor selects it. A stale choice returns HTTP 409 so the widget can refresh the available options. The existing firm-owned widget caches only the enabled state and sends only the question. It needs an update to offer this choice.

For an opted-in question, Google creates the search vector and OpenAI receives the question, firm name and relevant excerpts from currently included pages belonging to that firm. The app returns its fixed handoff for case-specific questions. An informational GPT answer requires a citation to an approved, retrieved page. The app continues its existing query logging, including the question, answer when provided, source IDs and model.

The CaseLoad Responses client sets `store: false`, and the OpenAI organization reports API call logging as “Enabled per call.” Before enrolling a real firm, the operator needs approval from that named firm for sending visitor questions and source excerpts under the project’s actual abuse-monitoring retention and processing-region terms. Record which project and settings the firm approved, along with the agreed visitor disclosure. An API credit grant or per-call storage setting alone cannot establish those commitments. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
