# Email authentication fix runbook: drglaw.ca (GHL) + caseloadselect.ca DMARC cleanup

Status: READY TO EXECUTE. Diagnosis verified against live DNS on 2026-07-09.

## The problem

Damaris (DRG Law) reports that every email the system sends her shows this Outlook banner:

> "We can't verify that this email came from the sender so it might not be safe to respond to it."

The screenshot she sent is the "Closing Cash-to-Close Calculator" result email (DRG Law · Real Estate), which is GHL email-step HTML sent through GoHighLevel's LC Email (Mailgun) servers with a `From:` address at `@drglaw.ca`.

Root cause, confirmed by live DNS on 2026-07-09:

| Record | Live value | Consequence |
|---|---|---|
| `drglaw.ca` TXT (SPF) | `v=spf1 include:spf.protection.outlook.com -all` | Only Microsoft 365 may send as `@drglaw.ca`, hard fail (`-all`) for everything else. Every GHL send fails SPF outright. |
| GHL/Mailgun DKIM on drglaw.ca | none exists (no `mail.`, `replies.`, `*._domainkey` records) | No aligned DKIM signature to rescue the SPF fail. GHL dedicated sending domain was never set up. |
| `_dmarc.drglaw.ca` TXT | NXDOMAIN (no record) | No DMARC policy at all. |
| `drglaw.ca` MX | `drglaw-ca.mail.protection.outlook.com` | Damaris's own mailbox is Microsoft 365, so an external server claiming her own domain trips Microsoft anti-spoofing (compauth fail) and shows the banner. |

This is a deliverability problem, not only cosmetic: prospects on Outlook/Hotmail see the same warning or get these emails junked.

Secondary defect found on the same pass: `_dmarc.caseloadselect.ca` has TWO TXT records (`v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` AND `v=DMARC1; p=none;`). Multiple DMARC records are invalid per RFC 7489; receivers treat the domain as having no usable DMARC. Resend itself is correctly configured (`send.caseloadselect.ca` SPF for amazonses + `resend._domainkey` TXT both verified live), so only the duplicate DMARC needs fixing.

## Fixed facts (do not re-derive, verified 2026-07-09)

- DRG firm id in `intake_firms`: `eec1d25e-a047-4827-8e4a-6eb96becca2b`
- DRG GHL location id: `KwpSaMUehIN25dMG4WZB`
- drglaw.ca DNS host: **Wix** (`ns14.wixdns.net` / `ns15.wixdns.net`). Wix site, so DNS is managed in the Wix dashboard (Domains → drglaw.ca → advanced DNS).
- caseloadselect.ca DNS host: **GoDaddy** (`ns17.domaincontrol.com` / `ns18.domaincontrol.com`). The `onsecureserver.net` rua address in the quarantine DMARC record is GoDaddy-generated, consistent with this.
- No code changes are needed in this repo. The entire fix is GHL settings + DNS records.

## Actors

- **AGENT**: steps a Claude session (Sonnet 5) executes directly with the tools available in the remote environment (Bash + dnspython for DNS checks, Supabase MCP, GHL MCP, WebFetch).
- **OPERATOR**: steps Adriano performs in a browser (GHL settings UI, Wix DNS, GoDaddy DNS). The agent prepares the exact values, the operator pastes them, the agent verifies afterward.

The agent should run each phase's verification itself and only hand the operator the paste-ready values plus a one-line "done? reply here" checkpoint. `dig`/`nslookup` are not installed in the remote container; use the dnspython snippet below.

```python
# AGENT: reusable DNS check (pip install dnspython first)
import dns.resolver as r
def q(name, t):
    try:
        return [str(a) for a in r.resolve(name, t)]
    except Exception as e:
        return f"ERR {type(e).__name__}"
```

## Phase 0: preflight (AGENT)

1. Re-run the DNS queries from the table above. If `_dmarc.drglaw.ca` now resolves or a `*._domainkey` record exists under drglaw.ca, the operator may have started already: reconcile before continuing instead of blindly following the phases.
2. Confirm the GHL MCP connection works: `locations_get-location` for `KwpSaMUehIN25dMG4WZB`. If GHL MCP is not connected in the session, that is fine; it is only used for the optional test send in Phase 4.

## Phase 1: GHL dedicated sending domain for DRG

This is the load-bearing fix. It gives GHL an aligned DKIM signature so DMARC passes even though root SPF stays Microsoft-only.

1. **OPERATOR** in GHL, inside the DRG sub-account (location `KwpSaMUehIN25dMG4WZB`): Settings → Email Services → Dedicated Domain and IP → Add Domain. Enter `replies.drglaw.ca` (subdomain choice is free; `replies` keeps it separate from any future use of `mail.`). GHL then displays a set of DNS records to add: typically TXT SPF for the subdomain, one or two DKIM records, MX records for the subdomain, and a tracking CNAME. **The values GHL shows in that wizard are authoritative; use them verbatim, not from memory.**
2. **OPERATOR** in Wix (Domains → drglaw.ca → Advanced DNS): add every record from step 1 exactly as shown. Add nothing else and change nothing else. In particular, do NOT edit the existing root SPF record.
3. **OPERATOR** back in GHL: click Verify on the dedicated domain. GHL polls DNS; propagation is usually minutes on Wix but can take up to an hour.
4. **AGENT** verify: query the records the operator added (ask the operator to paste the record names GHL showed, or probe `replies.drglaw.ca` TXT/MX and common DKIM names under `*._domainkey.replies.drglaw.ca` / `*._domainkey.drglaw.ca`). All must resolve. Then have the operator confirm GHL shows the domain as Verified.
5. Once verified, GHL routes sends with `From: ...@drglaw.ca` through the dedicated domain automatically for that location. No change to workflow email steps is required.

Acceptance: GHL dashboard shows the dedicated domain Verified, and the DNS records resolve from the agent's environment.

## Phase 2: DMARC for drglaw.ca

1. **OPERATOR** in Wix DNS, add one TXT record:
   - Host/name: `_dmarc`
   - Value: `v=DMARC1; p=none; rua=mailto:adriano@caseloadselect.ca; adkim=r; aspf=r;`
2. Because the rua address is on a different domain than drglaw.ca, DMARC external destination verification applies. **OPERATOR** in GoDaddy DNS for caseloadselect.ca, add one TXT record:
   - Host/name: `drglaw.ca._report._dmarc`
   - Value: `v=DMARC1`
3. **AGENT** verify both records resolve: `_dmarc.drglaw.ca` TXT and `drglaw.ca._report._dmarc.caseloadselect.ca` TXT.

Start at `p=none` (monitor only). Tightening to `p=quarantine` is a later decision, taken only after at least two weeks of rua reports show GHL and Microsoft 365 both passing. Do not skip ahead.

Acceptance: both TXT records resolve; exactly one DMARC record exists on `_dmarc.drglaw.ca`.

## Phase 3: caseloadselect.ca duplicate DMARC removal

1. **OPERATOR** in GoDaddy DNS for caseloadselect.ca: there are two TXT records on host `_dmarc`. DELETE the one whose value is exactly `v=DMARC1; p=none;`. KEEP the one starting `v=DMARC1; p=quarantine;` (Resend is fully authenticated, so quarantine is safe to enforce).
2. **AGENT** verify: `_dmarc.caseloadselect.ca` TXT returns exactly one record, the quarantine one.

Acceptance: exactly one DMARC record on caseloadselect.ca.

## Phase 4: end-to-end validation

1. **AGENT (optional, only if GHL MCP is connected)**: send a test email from the DRG location to `adriano@caseloadselect.ca` via `conversations_send-a-new-message` (create/upsert a contact for that address first if needed). Otherwise **OPERATOR** triggers any GHL email (the Cash-to-Close calculator itself works) to a mailbox he controls.
2. Mail-tester pass: **OPERATOR** sends one GHL email to the unique address shown at mail-tester.com, then gives the agent the results URL. **AGENT** WebFetch that URL and confirm: SPF pass, DKIM pass (signing domain under drglaw.ca), DMARC pass.
3. Outlook pass, the actual symptom: **OPERATOR** (or Damaris) opens a fresh post-fix email in Outlook. The red banner and the "?" sender avatar must be gone. For proof, open the message headers (File → Properties, or "View message source") and check the `Authentication-Results` line reads `spf=pass` (or fail is acceptable here), `dkim=pass`, `dmarc=pass`, `compauth=pass`. DKIM+DMARC pass is what clears the banner; root SPF staying Microsoft-only is fine because DKIM provides the aligned pass.
4. **AGENT**: message Damaris is NOT part of this runbook. Report completion to the operator only; the operator tells Damaris.

Acceptance: a post-fix GHL email renders in Outlook with no warning banner and `dmarc=pass` + `compauth=pass` in headers.

## Stop-lines (hard rules for the executing agent)

1. Do NOT edit the existing root SPF record on drglaw.ca. Loosening `-all` to `~all`, or appending `include:mailgun.org` to the root record, are the tempting shortcuts; both are wrong (the first weakens the domain for everyone, the second still fails DMARC SPF alignment for Mailgun's envelope domain and bloats the lookup count). The dedicated-subdomain + DKIM path is the only approved fix.
2. Do NOT set `p=quarantine` or `p=reject` on drglaw.ca in this pass. `p=none` only.
3. Do NOT touch any other DNS record in Wix or GoDaddy. Both zones serve live production sites and mail.
4. Do NOT change anything in this repo's email code (Resend paths are unaffected) and do NOT touch `intake_firms` rows. This is a settings-and-DNS task.
5. drglaw.ca DNS and the GHL UI are operator-access-only. The agent never asks for those credentials; it prepares values and verifies results from the outside.
6. If the operator reports the GHL wizard offers "use a subdomain of your existing dedicated domain" or similar variants that differ from this runbook, stop and reconcile with him rather than improvising.

## Completion checklist

- [ ] GHL dedicated sending domain `replies.drglaw.ca` shows Verified in the DRG sub-account
- [ ] All GHL-provided DNS records resolve publicly
- [ ] `_dmarc.drglaw.ca` exists, `p=none`, single record
- [ ] `drglaw.ca._report._dmarc.caseloadselect.ca` TXT `v=DMARC1` exists
- [ ] `_dmarc.caseloadselect.ca` has exactly one record (the `p=quarantine` one)
- [ ] Mail-tester shows SPF/DKIM/DMARC pass for a GHL send
- [ ] Fresh GHL email in Outlook shows no banner; headers show `dkim=pass dmarc=pass compauth=pass`
- [ ] Operator notified with the header evidence; follow-up reminder set (2 weeks) to review DMARC rua reports before considering `p=quarantine` on drglaw.ca
