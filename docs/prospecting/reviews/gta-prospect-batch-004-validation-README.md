# GTA prospect batch 004 role and count QA

This independent, read-only review validates the roster-role and office evidence in `gta-prospect-batch-004`, pinned to commit `0bf2aa7f31fddf75d585efa93cb52caf7c7913e7`. It follows the earlier transport review; it is not an import or an acceptance action.

## Outcome

- **8 accepted for later staging:** B004-01, B004-02, B004-04, B004-05, B004-08, B004-09, B004-12, and B004-14.
- **4 count holds:** B004-06 does not label the founder as a lawyer on its cited roster; B004-10 now shows three, rather than the captured four, lawyer-role entries; B004-13 now lists six, rather than five, people in its Lawyers roster; B004-15 has a newer team page which does not support the captured four-person count.
- **1 identity/office hold:** B004-07's cited page currently presents the team as North York/Toronto, while the candidate records Thornhill. The GTA scope remains plausible, but the office fact must be resolved before staging.
- **2 access holds:** B004-03 returned 403 to one ordinary request and B004-11's cited HTTPS URL had a TLS error. Neither was retried aggressively or accessed by relaxing verification.

All 15 source records retain `workflow_status=candidate` and `accepted=false`. `accepted_for_staging` in the report is a QA disposition only; it is not a database write, import, CRM action, contact list, outreach authorization, legal-standing conclusion, or recommendation to contact any firm.

## Method and limits

One low-rate, ordinary GET request was made only to the candidate's recorded public first-party roster page. Where a current first-party page was reachable, the review checked the published firm identity, GTA office fact, role separation, and captured count. It excluded clerks, students, assistants, consultants, and other clearly non-lawyer roles; it did not infer an unlabelled person's professional status. Current public presentation can change and is not proof of licence status, full headcount, legal entity, contactability, advertising, practice competence, or historical legacy-row identity.

No LSO access or automation, access-control bypass, certificate-verification bypass, form/chat action, contact, outreach, CRM activity, import, deployment, or merge was performed.
