# GHL → CaseLoad Select WhatsApp Bridge — Block 4 Architecture Plan

**Status:** Research-only deliverable. No code, no migrations, no commits attached to this plan.

**Date drafted:** 2026-05-15

**Author:** Research session (Claude Code), commissioned to map the GHL webhook spec against existing CaseLoad Select infrastructure before implementation begins.

**Predecessor commits referenced:** `fb4fd7e` (channel-origin + Band D doctrine), `2d46bb2` (original Meta-direct engine wiring).

**Gate for implementation:**
1. Meta App Review Block 2 submitted
2. Block 3 (review) approved by Meta
3. Channel-origin + Band D doctrine already in working tree (confirmed present)
4. DRG Law GHL sub-account provisioned with a LeadConnector WhatsApp number

Until those four conditions hold, this file is the only authoritative source. Re-spawning the research from scratch later risks drift in three places: the GHL API docs may rev, the codebase patterns may evolve, and the 3-4 hour estimate becomes wishful without the mappings below.

---

## 1. Why a bridge exists at all

After Meta App Review approval, client firms (starting with DRG Law) will provision WhatsApp Business numbers through GoHighLevel (LeadConnector / Twilio carrier, Meta Cloud API protocol underneath, GHL-owned WABA). Inbound WA messages land in GHL's Conversations inbox first, alongside the firm's SMS and voice, giving the lawyer a unified surface.

CaseLoad Select needs to receive those WA inbounds for triage and scoring without duplicating the lawyer's inbox. Architecture decision (locked 2026-05-15): **Path B for DRG**. The Meta Cloud API direct path (Path A, what Block 2 built) stays in the codebase for firms that want their own WABA, but Path B is the default for GHL-heavy firms.

## 2. Correction to original task spec — signature mechanism

The task brief assumed GHL signs custom webhooks with **HMAC + shared secret** and proposed a `META_GHL_WEBHOOK_SECRET` env var (or per-location `intake_firms.ghl_webhook_secret`).

Actual mechanism per GHL's Webhook Integration Guide:

| Header | Algorithm | Status |
|---|---|---|
| `X-GHL-Signature` | Ed25519 (public-key) | Current, preferred |
| `X-WH-Signature` | RSA-SHA256 (public-key) | Legacy, deprecated 2026-07-01 |

Signatures are base64-encoded, verified against a **global public key** GHL publishes, not a per-firm or per-location secret. Use `crypto.verify(null, payloadBuffer, publicKeyPem, signatureBuffer)` for Ed25519. Use raw body as-is (no JSON re-stringify) since re-encoding invalidates the signature. The same scheme covers both native marketplace events (InboundMessage) and Custom Workflow Webhook actions.

Ed25519 public key (transcribed from marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide on 2026-05-15):

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----
```

Verification helper sketch:

```ts
function verifyGhl(payload: string, signature: string, publicKeyPem: string) {
  if (!signature || signature === 'N/A') return { ok: false, reason: 'no signature' };
  try {
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'base64');
    const ok = crypto.verify(null, payloadBuffer, publicKeyPem, signatureBuffer);
    return { ok, reason: ok ? null : 'verify failed' };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
```

**Consequences for implementation:**

- Drop the `META_GHL_WEBHOOK_SECRET` env var idea.
- Drop the `intake_firms.ghl_webhook_secret` column idea.
- One env var `GHL_WEBHOOK_PUBLIC_KEY_ED25519` (or hardcoded constant, since it is literally public) handles every firm.
- Both Ed25519 and RSA verifiers must ship in the first cut to cover GHL's own transition window. Mark the RSA branch with `// REMOVE AFTER 2026-07-01`.

## 3. Webhook path selection — Custom Workflow Webhook (Path B)

Two paths exist for receiving inbound WA from GHL:

**Path B1 — Marketplace InboundMessage subscription.** Requires a GHL Marketplace app and OAuth. Payload references contact by ID only (no embedded name or phone), which forces a follow-up GHL API call per inbound to enrich. More setup, more latency, more failure modes.

**Path B2 — Per-firm Custom Workflow Webhook action.** Operator creates a workflow in each firm's GHL sub-account triggered by "Inbound WhatsApp Message", with one Custom Webhook action pointing at our endpoint. Fully customisable JSON body templated with merge tags. No OAuth, no marketplace app. Same `X-GHL-Signature` signing.

**Decision:** Path B2. Simpler onboarding, no marketplace app dependency, no API enrichment round-trip. The operator templates name and phone directly into the body via `{{contact.first_name}}` and `{{contact.phone}}`.

## 4. Inbound payload contract

The firm operator must template this exact JSON in the workflow's Custom Webhook action body:

```json
{
  "type": "InboundMessage",
  "messageType": "WhatsApp",
  "direction": "inbound",
  "locationId": "{{location.id}}",
  "messageId": "{{message.id}}",
  "contactId": "{{contact.id}}",
  "conversationId": "{{conversation.id}}",
  "dateAdded": "{{message.date_added}}",
  "body": "{{message.body}}",
  "from": "{{contact.phone}}",
  "contactName": "{{contact.full_name}}"
}
```

Design notes:

- Strict superset of GHL's native InboundMessage shape, so a future switch to marketplace subscription path needs no receiver rewrite. The contactName and from fields would fall back to null on that path and we would enrich via API.
- `messageType: "WhatsApp"` is the discriminator GHL uses on its native event. We require the operator to set it in the workflow body to keep our parser uniform across paths.
- `messageId` is the dedup key.
- `from` carries the WhatsApp number in E.164 (operator-templated from `{{contact.phone}}`).
- `contactName` may be null if the contact record has no name set in GHL.

## 5. Schema delta

| Change | Decision | Mirror pattern |
|---|---|---|
| `ALTER TABLE intake_firms ADD COLUMN ghl_location_id text` | YES | `20260514_intake_firms_channel_asset_ids.sql` |
| `CREATE UNIQUE INDEX uq_intake_firms_ghl_location_id ON intake_firms (ghl_location_id) WHERE ghl_location_id IS NOT NULL` | YES | same migration |
| `COMMENT ON COLUMN intake_firms.ghl_location_id IS '…GoHighLevel sub-account (location) ID…'` | YES | same migration |
| `NOTIFY pgrst, 'reload schema'` | YES | same migration |
| `intake_firms.ghl_webhook_secret` | NO | Ed25519 public key is global; no per-firm secret |
| New `inbound_message_dedup` table | NO on first cut | use slot_answers JSONB existence check; escalate to a dedicated table only if prod sees real duplication |

`intake_firms.ghl_webhook_url` (outbound, already present from earlier work) is untouched. The new column is inbound resolution only.

Apply via `mcp__supabase__apply_migration` against project_id `qpzopweonveumvuqkqgw` on the day implementation starts (datestamp the migration to that day, not today).

## 6. Code surface delta

### New files

- `src/lib/ghl-webhook-auth.ts`
  - Exported: `verifyGhlSignature({ rawBody, ed25519Header, rsaHeader }) → { valid: boolean, algorithm: 'ed25519' | 'rsa-legacy' | null, reason: string | null }`
  - Algorithm precedence: Ed25519 first, RSA fallback, reject if neither present.
  - Public keys loaded from env (`GHL_WEBHOOK_PUBLIC_KEY_ED25519`, `GHL_WEBHOOK_PUBLIC_KEY_RSA_LEGACY`) with hardcoded fallback constants for safety.

- `src/app/api/ghl-whatsapp-intake/route.ts`
  - POST handler: read raw body, verify signature, parse JSON, filter `direction !== 'inbound'`, filter `messageType !== 'WhatsApp'`, resolve firm by `locationId`, idempotency check on `messageId`, build `WhatsAppSender` with `source: 'ghl_bridge'`, dispatch `processChannelInbound` in `waitUntil`, return 200 within 1-2s.
  - Optional GET handler: returns 200 OK for GHL connectivity validation.

- `src/app/api/ghl-whatsapp-intake/README.md`
  - Documents the payload contract from section 4.
  - Documents the signature scheme from section 2.
  - Sample curl with a valid signature for local smoke testing.

- `caseload-select-app/docs/GHL_WhatsApp_Bridge_Setup.md`
  - Per-firm operator runbook (5 steps from the original task spec section 7).
  - Conceptual steps only; screen-share walk-through at onboarding rather than versioned screenshots, because GHL UI drifts.

### Edits

- `src/lib/firm-resolver.ts`
  - Add `resolveFirmByGhlLocationId(ghlLocationId: string): Promise<FirmContext | null>` mirroring the three existing resolvers exactly. Hits `intake_firms.ghl_location_id`, returns FirmContext or null, logs structured error on Supabase failure.

- `src/lib/channel-intake-processor.ts`
  - Extend `WhatsAppSender` interface with `source?: 'meta_direct' | 'ghl_bridge'` (optional, defaults `'meta_direct'` if undefined so the existing Meta-direct receiver code path continues working with no edit).
  - In `channelMeta.whatsapp_meta` block, include `source: sender.source ?? 'meta_direct'`. Audit-only. No UI surface; the lawyer brief stays identical between paths.

- `caseload-select-app/CLAUDE.md`
  - Add Channels-table row for "WhatsApp via GHL".
  - Section caption notes the two parallel WA paths and that Path B is default for GHL-heavy firms post-2026-05-15.

### Untouched

- `src/lib/meta-webhook-auth.ts` — Meta uses HMAC; GHL uses public-key signing. Different file.
- Engine pipeline, brief renderer, lead notification, OOS handling, GHL outbound webhook contract, screened_leads schema — all unchanged.

## 7. Idempotency design — first cut

Pre-insert check inside the receiver, before invoking `processChannelInbound`:

```ts
const { data: existing } = await supabaseAdmin
  .from('screened_leads')
  .select('id, lead_id')
  .eq('firm_id', firm.firmId)
  .filter('slot_answers->whatsapp_meta->>message_mid', 'eq', payload.messageId)
  .limit(1)
  .maybeSingle();
if (existing) {
  console.log(`[ghl-whatsapp-intake] duplicate messageId=${payload.messageId}; no-op`);
  return NextResponse.json({ ok: true, deduplicated: true });
}
```

Promotion path: if prod logs show duplicate inserts (race during retries within the same `waitUntil` window, or JSONB index miss under load), add a dedicated table:

```sql
CREATE TABLE inbound_message_dedup (
  provider     text NOT NULL,
  message_id   text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, message_id)
);
CREATE INDEX idx_inbound_message_dedup_received_at
  ON inbound_message_dedup (received_at);
```

With a daily pg_cron sweep removing rows older than 24h.

## 8. Test plan

`src/app/api/ghl-whatsapp-intake/__tests__/route.test.ts`:

- Missing X-GHL-Signature and missing X-WH-Signature, returns 401.
- Wrong Ed25519 signature, returns 401.
- Valid RSA-legacy signature (no Ed25519 header), accepts and processes.
- `direction !== 'inbound'`, returns 200, no processor invocation.
- `messageType !== 'WhatsApp'` (e.g. SMS, Email), returns 200, no processor invocation.
- Unknown locationId, returns 200, warning logged, no processor invocation.
- Happy path: resolver called with locationId, processor called once with `WhatsAppSender { source: 'ghl_bridge', phoneNumberId: '<location-id-fallback>', senderWaId: from, senderName: contactName, messageMid: messageId }` and correct text body.
- Repeat messageId for same firm, second call returns 200 with no second processor invocation (idempotency).

`src/lib/__tests__/firm-resolver.test.ts` extension (4 cases for `resolveFirmByGhlLocationId`):

- Match: returns FirmContext for a row Supabase produces.
- No match: returns null when supabase data is null.
- Empty input: returns null without hitting supabase.
- Supabase error: returns null and logs.

Verification gates before commit:

```
npx vitest run
npx tsc --noEmit
```

Both must be clean.

## 9. Open questions to resolve before implementation

1. **Workflow trigger granularity.** Does GHL's "Inbound WhatsApp Message" workflow trigger fire on non-text inbound (image, audio, document)? If yes, the operator must add a filter step before the webhook action, or our receiver must drop on empty body. Verifiable with a sandbox GHL trial; cost about 15 min.
2. **GHL retry policy on non-2xx.** Custom Webhook docs do not specify. Assume retries DO happen; idempotency must ship in the first cut.
3. **Legacy header support window.** RSA verifier needs to live in the code through 2026-07-01. After that, deletable. Mark the RSA branch with a `// REMOVE AFTER 2026-07-01` comment so a future cleanup pass finds it.
4. **Operator self-service vs. screen-share onboarding.** GHL UI changes often; the runbook documents conceptual steps and plans a screen-share walk-through at onboarding rather than carrying screenshots that drift.

## 10. Estimated effort once unblocked

Per original task spec: 3-4 hours, distributed as

- 30 min: migration + firm-resolver extension (mechanical mirror of existing patterns)
- 60 min: `ghl-webhook-auth.ts` + route + idempotency
- 30 min: WhatsAppSender source field + channel-intake-processor edit
- 45 min: tests (route + firm-resolver)
- 45 min: docs (API README + operator runbook + CLAUDE.md row)
- 30 min: typecheck, test run, commit

The research below is now mapped against existing infrastructure; implementation should be straight glue work when it resumes.

## 11. Sources cited (2026-05-15)

- InboundMessage payload reference: https://marketplace.gohighlevel.com/docs/webhook/InboundMessage/index.html
- Webhook Integration Guide (signature scheme, public keys): https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/index.html
- Workflow Action - Custom Webhook: https://help.gohighlevel.com/support/solutions/articles/155000003305-workflow-action-custom-webhook
- Workflow Trigger - Inbound Webhook: https://help.gohighlevel.com/support/solutions/articles/155000003147-workflow-trigger-inbound-webhook

If any of these URLs 404 or return materially different content when implementation resumes, re-run the research before trusting the plan above.

## 12. Out of scope (reaffirmed)

- Outbound WhatsApp sending from CaseLoad Select via GHL. Sending stays in GHL's domain for Path B.
- Migration of historical WA leads. Not applicable; DRG has not gone live.
- GHL OAuth flow for self-service firm onboarding. Adriano handles per-firm setup manually.
- Cross-channel multi-touch dedup between Meta-direct and GHL-bridge WA. Firms use one path or the other for any given number, never both.

## 13. Commit convention for the implementation session

Prefix: `feat(ghl-bridge):`. Commit body explains Path B architecture and the per-firm choice between direct Meta and GHL-bridged. References predecessors `fb4fd7e` (channel-origin + Band D doctrine) and `2d46bb2` (original Meta-direct engine wiring).
