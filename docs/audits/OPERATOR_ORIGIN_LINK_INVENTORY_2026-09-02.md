# Operator-origin outbound-link inventory

Date: 2026-09-02
Scope: dedicated `admin.caseloadselect.ca` operator origin

## Routing decisions

| Link source | Recipient or use | Canonical origin | Path |
| --- | --- | --- | --- |
| Operator magic-link email, including member resend | Operator | Operator | `/api/operator/login` |
| Lawyer magic-link email, admin-generated portal link, and `/api/portal/generate` | Lawyer | App | `/api/portal/login` |
| Copied short sign-in code | Role on the member record | Role-aware | `/l/[code]` |
| Short-code redemption | Role resolved from the code | Role-aware | Operator or portal login consumer |
| Firm-onboarding notification | Operator | Operator | `/admin/onboarding-submissions/[id]` |
| Deliverable notification | Notification recipient | Role-aware | `/portal/[firmId]/deliverables/[deliverableId]` |
| File notification | Opposite of uploader role | Role-aware | `/portal/[firmId]/files` |
| Matter and firm-message digest | Notification recipient | Role-aware | Recipient-specific portal or admin path |
| Copied or previewed public onboarding form | Firm representative | App | `/firm-onboarding/[token]` or `/firm-profile/[token]` |
| Reciprocal lawyer/operator sign-in navigation | Destination role | Role-aware | `/portal/login` or `/operator/login` |

## Guardrails

- Production operator URLs use `admin.caseloadselect.ca`; lawyer, client, and public URLs use `app.caseloadselect.ca`.
- Preview deployments and local development intentionally remain single-origin.
- Production `*.vercel.app` aliases are not preview exceptions; only deployments
  with `VERCEL_ENV=preview` may remain single-origin.
- A valid short code is canonicalized by its resolved role before a session cookie can be written.
- An invalid short code uses the request host only to choose the correct login surface.
- Public onboarding links never inherit the operator console's browser origin.
- Trusted-browser access lasts up to 30 days unless the user signs out or clears browser data. No IP-address recognition is used.
- Every operator request revalidates the signed `lawyer_id` against an active,
  exact `firm_lawyers` operator membership. Removing or disabling that row
  revokes the session on the next request.
- Legacy operator cookies on `app.caseloadselect.ca` are deliberately not
  accepted for operator authorization. The operator signs in again on the
  admin origin, establishing a host-only session there.

## Release gate

`admin.caseloadselect.ca` must be provisioned and verified in Vercel and DNS
before this branch is merged. The production middleware and automatic operator
invitation trigger intentionally target that canonical host; merging first
would redirect operators and invitation requests to an unresolved hostname.
After provisioning, verify the operator login page and request-link endpoint on
the admin origin before approving the PR merge.

The executable inventory is pinned by `src/lib/__tests__/operator-origin-link-inventory.test.ts`.
