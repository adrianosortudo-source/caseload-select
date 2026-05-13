# Multilingual Screen Engine · Overnight Build Prompt

**Audience:** Next Claude session in the `caseload-select-app` codebase. Operator (Adriano) has briefed the spec; this doc is the build prompt.
**Drafted:** 2026-05-12
**Estimated effort:** 6-10 hours of autonomous coding + testing
**Status:** Ready to execute. Read entire doc before starting; execute steps in order.

---

## Mission

CaseLoad Select's intake tool currently treats all input as English. A Portuguese-speaking lead types `quero abrir uma empresa no canada`; the screen engine accepts it and proceeds to the next question in English. The lead's experience fragments; the brief that reaches the lawyer carries Portuguese text the screen treated opaquely.

The operator's correction (2026-05-12): the platform is **language-agnostic at intake, English at the lawyer surface**. Toronto is the most multilingual major city on the planet; filtering intake by language at the door costs 30-60% of addressable market before legal merit is considered.

This build makes the screen engine multilingual end-to-end across both web widget and voice intake channels, while keeping the lawyer's brief consistently English with a "Language of communication" field surfacing what language the lead used.

Workflows (J1-J12, DECLINE) remain English-only for now. Out of scope.

---

## Read these before starting

| File | Why |
|---|---|
| `D:\00_Work\01_CaseLoad_Select\CLAUDE.md` § Language Position | The doctrine. Four axes (intake tool / client language / brief language / lawyer capacity). |
| `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\CLAUDE.md` § Language Position | Implementation notes from the doctrine. |
| `src/lib/screen-prompt.ts` | The Gemini prompt builder. Current state: English-only assumption baked in. |
| `src/lib/screen-engine/` | Server-side port of the screen engine. Mirrors the Vite sandbox. |
| `src/app/api/intake-v2/route.ts` | Web widget persistence endpoint. Receives the brief from Vite sandbox. |
| `src/app/api/voice-intake/route.ts` | Voice channel persistence endpoint. Receives the GHL Voice AI post-call payload. |
| `docs/ghl-webhook-contract.md` | The contract on outbound webhooks to GHL. Will need a new field (`intake_language`). |
| `src/app/portal/[firmId]/triage/[leadId]/page.tsx` | Triage brief display. Needs the language field rendered. |
| `lib/lead-notify-pure.ts` and `lib/lead-notify.ts` | New-lead notification email to the lawyer. Should include intake language. |

---

## Goals (acceptance criteria)

A build is complete when all of these are verifiable:

1. **Conversation matches the lead's language.** When the lead writes Portuguese, the next question renders in Portuguese. When they write Spanish, next question is Spanish. When they write English, English. Tested across at least 3 languages (en, pt, es).

2. **Brief is always English.** The structured doc the lawyer reads in the triage portal renders in English regardless of intake language. No toggle, no translation pane, no "view English translation" affordance. The brief HTML at `screened_leads.brief_html` is always English content.

3. **Raw transcript is preserved.** The lead's original-language responses are stored verbatim in `screened_leads.raw_transcript` (or equivalent audit field) for LSO compliance and audit reference.

4. **"Language of communication" field surfaces on the brief.** The lawyer sees the language the lead used at intake, rendered human-readable (e.g., "Portuguese", "Spanish", "English"). Sits prominently near the lead's identity block in the brief.

5. **Voice intake works the same way.** A Portuguese voice call lands a brief in English with `intake_language = pt`. Verified via `/api/voice-intake` integration test with a Portuguese transcript fixture.

6. **`intake_language` propagates to GHL.** The webhook payload to GHL includes `intake_language` so the future workflow-level routing can use it without another build. Added to the common envelope in `docs/ghl-webhook-contract.md`.

7. **Engine sync preserved.** Changes to `src/lib/screen-engine/` propagate to the Vite sandbox repo in the same commit. `bash scripts/check-engine-sync.sh` passes.

8. **Tests cover the failure mode.** A test fixture using the prompt from the screenshot (`quero abrir uma empresa no canada`) flows end-to-end: conversation in Portuguese, brief in English, `intake_language = pt`, raw transcript preserves the Portuguese input.

---

## In scope · Out of scope

**In scope:**
- Screen engine prompt builder (web + voice path)
- `screened_leads` schema (intake_language, raw_transcript columns)
- Brief HTML generation (English output, language field display)
- Triage portal brief display
- `/api/intake-v2` and `/api/voice-intake` route handlers
- New-lead notification email (include intake language)
- GHL webhook contract (add field to common envelope)
- Engine sync verification

**Out of scope:**
- J1-J12 and DECLINE workflow content (stays English for v1)
- Per-firm language whitelist (the platform is wildcard by default)
- Translation of outbound cadence comms (deferred to v1.1)
- Brief content rewrites (separate brand voice work)
- UI chrome translation (English only)

---

## Implementation steps

### Step 1 · Schema migration

Add two columns to `screened_leads`:

```sql
-- migrations/20260512_intake_language_and_raw_transcript.sql
ALTER TABLE screened_leads
  ADD COLUMN IF NOT EXISTS intake_language TEXT,
  ADD COLUMN IF NOT EXISTS raw_transcript TEXT;

COMMENT ON COLUMN screened_leads.intake_language IS
  'ISO 639-1 language code detected from the lead intake conversation. e.g. "en", "pt", "es", "zh". Null if not detected. Stored at brief-generation time by the screen engine.';

COMMENT ON COLUMN screened_leads.raw_transcript IS
  'Verbatim lead-language responses preserved for audit. The brief_html column is always English; this column preserves what the lead actually said in their language. LSO/PIPEDA compliance reference.';
```

Run via `supabase migration new` then `supabase db push`. Verify with `\d screened_leads` in psql.

### Step 2 · Engine prompt builder

Update `src/lib/screen-prompt.ts` to instruct Gemini on language behavior. Add a section to the system prompt:

```
## Language behavior

You will be conversing with a lead who may write in any language.

DURING THE CONVERSATION:
- Detect the language of the lead's most recent message
- Respond in that same language
- If the lead switches language mid-conversation, follow the switch
- Default to English only if the first message is ambiguous (single word, emoji, etc.)

WHEN GENERATING THE FINAL BRIEF (the structured output for the lawyer):
- The entire brief MUST be in English
- Translate the lead's responses to fluent professional English
- Preserve names, addresses, and proper nouns verbatim
- Preserve any English terms the lead used as-is
- If a term has no clean English equivalent (cultural concepts, specific legal terms from the lead's jurisdiction), keep the original and add a brief English gloss in parentheses

WHEN GENERATING THE RAW TRANSCRIPT (the audit field):
- Output the lead's responses verbatim in their original language
- No translation, no editorial changes

LANGUAGE METADATA:
- Emit `intake_language` as an ISO 639-1 code (en, pt, es, zh, ar, etc.) representing the dominant language of the conversation
- If the lead's language is genuinely mixed (e.g., Spanglish), pick the dominant language and note the mix in the brief's notes section
```

Mirror the same changes in `src/lib/screen-engine/` (the server-side port).

### Step 3 · Engine output schema

The screen engine's output must now carry three pieces of information that previously didn't exist:

```typescript
// src/lib/screen-engine/types.ts (or equivalent)
export interface ScreenEngineOutput {
  brief_html: string;        // ALWAYS English. Existing field.
  raw_transcript: string;    // NEW. Lead's responses in original language.
  intake_language: string;   // NEW. ISO 639-1 code.
  // ... existing fields (scores, band, matter_type, etc.)
}
```

Update the engine to emit all three. The Vite sandbox engine (separate repo) needs the same changes; commit both in the same atomic unit, verified by `bash scripts/check-engine-sync.sh`.

### Step 4 · Web intake endpoint

Update `src/app/api/intake-v2/route.ts` to accept and persist the new fields:

```typescript
const { brief_html, raw_transcript, intake_language, /* existing fields */ } = req.body;

await supabase
  .from('screened_leads')
  .insert({
    brief_html,
    raw_transcript,
    intake_language,
    // ... existing fields
  });
```

Verify with curl against the dev server using the Portuguese fixture (see Test Plan below).

### Step 5 · Voice intake endpoint

Update `src/app/api/voice-intake/route.ts` to handle multilingual transcripts.

Current state (per app CLAUDE.md DR-033): the endpoint receives GHL Voice AI post-call payload, runs the screen engine server-side on the transcript, inserts a `screened_leads` row.

Changes needed:
1. The transcript may be in any language. The screen engine prompt handles this natively (per Step 2).
2. Persist `intake_language` and `raw_transcript` to `screened_leads`.
3. The original-language transcript IS the `raw_transcript`. The brief is English-translated as in the web path.

Verify GHL Voice AI configuration accepts inbound calls in any language. Likely yes (modern voice transcription is language-agnostic) but document the dependency.

### Step 6 · Brief HTML rendering

Update wherever brief HTML is generated/rendered. The brief must include a "Language of communication" line in the lead identity section.

Format suggestion:

```html
<div class="brief-identity">
  <div class="brief-row"><strong>Name:</strong> {{contact.name}}</div>
  <div class="brief-row"><strong>Email:</strong> {{contact.email}}</div>
  <div class="brief-row"><strong>Phone:</strong> {{contact.phone}}</div>
  <div class="brief-row"><strong>Language of communication:</strong> {{intake_language_label}}</div>
</div>
```

Where `intake_language_label` maps the ISO code to a human-readable name:
- `en` → "English"
- `pt` → "Portuguese"
- `es` → "Spanish"
- `zh` → "Mandarin Chinese"
- `ar` → "Arabic"
- etc.

Create a utility `lib/intake-language-label.ts` with the mapping and a fallback to the ISO code itself if unknown.

### Step 7 · Triage portal display

Update `src/app/portal/[firmId]/triage/[leadId]/page.tsx` to display `intake_language` if it's set and not `en`. Render prominently near the top of the brief surface so the lawyer sees it before reading the brief.

Suggested copy:
- If `intake_language === 'en'`: do not render the language line (English is default; no need to surface)
- Otherwise: render a styled callout "🗣 Lead's language: Portuguese" (or equivalent) near the action bar

Note: brand book forbids emoji in client-facing copy, but the triage portal is operator-facing. Confirm emoji acceptable here; if not, use a different visual marker (badge, accent border).

Update the queue page (`src/app/portal/[firmId]/triage/page.tsx`) to show language as a small badge on each brief card. Helps the lawyer triage at-a-glance: "I have 3 leads, 2 English and 1 Portuguese."

### Step 8 · New-lead notification email

Update `lib/lead-notify-pure.ts` and `lib/lead-notify.ts` to include the lead's intake language in the notification email body sent to the lawyer when a new brief lands.

Format:
```
A new lead is in your triage queue.

Lead: {{contact.name}}
Language: {{intake_language_label}}
Band: {{band}}
Matter type: {{matter_type}}

Review the brief: {{triage_url}}
```

The lawyer knows before opening the brief whether they're walking into a non-English intake (and can prep accordingly: think about translator availability, mental-shift to a different cultural context, etc.).

### Step 9 · GHL webhook contract

Update `docs/ghl-webhook-contract.md` to add `intake_language` to the common envelope:

```
| `intake_language` | ISO 639-1 string | Two-letter code for the language used during intake. e.g. "en", "pt". Lawyer's brief is always English; this field surfaces the lead's preferred communication language for downstream workflow routing. |
```

Update `src/lib/ghl-webhook.ts` (or equivalent webhook payload builder) to include `intake_language` in the payload.

Note: GHL workflow routing on this field is OUT OF SCOPE for this build. The field arrives at GHL but the J-workflows don't act on it yet. v1.1 work.

### Step 10 · Engine sync verification

Run `bash scripts/check-engine-sync.sh`. Resolve any diffs. If the script doesn't exist or fails for other reasons, document the sync state in a comment.

### Step 11 · Tests

Write tests for the new behavior:

**Unit test · Prompt builder language instruction**

```typescript
// __tests__/screen-prompt.test.ts
it('instructs Gemini to detect and match user language', () => {
  const prompt = buildScreenPrompt(/* firm config */);
  expect(prompt).toContain('Detect the language');
  expect(prompt).toContain('Respond in that same language');
});

it('instructs Gemini to translate the brief to English', () => {
  const prompt = buildScreenPrompt(/* firm config */);
  expect(prompt).toContain('brief MUST be in English');
});

it('instructs Gemini to preserve raw transcript verbatim', () => {
  const prompt = buildScreenPrompt(/* firm config */);
  expect(prompt).toContain('Output the lead');
  expect(prompt).toContain('verbatim');
});
```

**Integration test · End-to-end Portuguese intake**

Use the screenshot's actual input: `quero abrir uma empresa no canada` ("I want to open a business in Canada"). Build a test fixture that simulates this through the engine:

```typescript
// __tests__/intake-v2-multilingual.test.ts
it('handles a Portuguese intake end-to-end', async () => {
  const response = await fetch('/api/intake-v2', {
    method: 'POST',
    body: JSON.stringify({
      // simulated screen engine output for the Portuguese intake
      brief_html: '<English-translated brief>',
      raw_transcript: 'quero abrir uma empresa no canada\n\nJust me\n\n...',
      intake_language: 'pt',
      // ... rest of fields
    }),
  });

  expect(response.status).toBe(200);

  const lead = await supabase.from('screened_leads').select().single();
  expect(lead.intake_language).toBe('pt');
  expect(lead.raw_transcript).toContain('quero abrir uma empresa');
  expect(lead.brief_html).toContain('Canada');  // English brief
  expect(lead.brief_html).not.toContain('quero abrir uma empresa');  // not raw Portuguese
});
```

**Integration test · End-to-end voice intake with Portuguese**

```typescript
// __tests__/voice-intake-multilingual.test.ts
it('handles a Portuguese voice intake end-to-end', async () => {
  const portugueseTranscript = `
    [00:00:01] Assistant: Hello, this is the intake assistant. How can I help?
    [00:00:04] Caller: Oi, eu quero abrir uma empresa no Canadá.
    [00:00:09] Assistant: ...
  `;

  const response = await fetch('/api/voice-intake', {
    method: 'POST',
    body: JSON.stringify({ transcript: portugueseTranscript, /* GHL Voice AI payload shape */ }),
  });

  expect(response.status).toBe(200);
  const lead = await supabase.from('screened_leads').select().eq('channel', 'voice').single();
  expect(lead.intake_language).toBe('pt');
  expect(lead.brief_html).toMatch(/English/);  // brief content is English
});
```

**Smoke test · Triage portal renders language**

Manual test (or Playwright if test infrastructure exists):
1. Insert a `screened_leads` row with `intake_language = 'pt'`
2. Navigate to `/portal/[firmId]/triage/[leadId]`
3. Assert the "Language of communication: Portuguese" line renders prominently
4. Repeat with `intake_language = 'en'` and assert the line is hidden (English is default)

### Step 12 · Documentation update

After the build is complete and tests pass:

1. Update `docs/ghl-webhook-contract.md` (already covered in Step 9, but verify the version bump in the doc front-matter)
2. Update `CLAUDE.md` § Language Position with the implementation status: "Multilingual screen engine: BUILT 2026-05-13"
3. Update `04_Playbooks/04_Screen/Playbooks/GHL_Quirks_and_Doctrine_FAQ_v1.md` with an entry on the multilingual screen behavior under the doctrine FAQ
4. Add a row to `Phase_B_Closure_Master_v1.md` Top-priority gaps reflecting that the multilingual screen is now built (was implicit gap; now closed)

---

## Test fixtures

Three real-world fixtures to verify against. Each should produce: conversation in lead's language, brief in English, intake_language correctly set, raw_transcript preserved.

### Fixture A · Portuguese (the screenshot case)

```
First message: "quero abrir uma empresa no canada"
Expected: conversation continues in Portuguese, asks about ownership structure
intake_language: 'pt'
Brief: English-translated, "I want to open a business in Canada" structure
```

### Fixture B · Spanish

```
First message: "Necesito ayuda con un caso de divorcio"
Expected: conversation continues in Spanish, asks family-law specifics
intake_language: 'es'
Brief: English-translated, family law inquiry
```

### Fixture C · Mandarin (simplified)

```
First message: "我需要在加拿大注册公司"
Expected: conversation continues in Mandarin, asks corporate structure
intake_language: 'zh'
Brief: English-translated, corporate registration matter
```

### Fixture D · Mixed (English-default fallback case)

```
First message: "hi"
Expected: conversation continues in English, asks for matter type
intake_language: 'en'
Brief: English (no translation needed)
```

---

## Edge cases to handle

1. **Language switching mid-conversation.** Lead starts in Portuguese, switches to English, then back to Portuguese. The engine should follow each turn. The final `intake_language` should reflect the DOMINANT language (count messages; if 5 PT + 2 EN, then `pt`).

2. **Code-switching within a single message.** "I want to open uma empresa in Canada." Pick the dominant language; note the code-switching in the brief's notes section.

3. **Unsupported languages.** Gemini supports 100+ languages but not all. If the lead writes in a language Gemini can't handle (rare), the conversation degrades to English with a polite acknowledgment. `intake_language` records the attempted language (use ISO code or "und" for undetermined).

4. **Right-to-left languages (Arabic, Hebrew).** The conversation rendering in the widget must support RTL text direction. Check the Vite SPA's CSS handles `dir="rtl"` for the conversation pane.

5. **Long names in non-Latin scripts.** Mandarin names like "王小明" should render correctly in the brief's English text without transliteration unless the lead explicitly provided a Latinized form. Test that the brief preserves the name as-is.

6. **Region variants.** Portuguese (Brazil vs Portugal), Spanish (Latin American vs Iberian), Chinese (Simplified vs Traditional). Don't try to disambiguate region in v1. Store the language code at the language level (`pt`, `es`, `zh`) and let the lawyer reach out in the appropriate variant based on the brief's content.

---

## Definition of done

- [ ] Schema migration applied, both columns present on `screened_leads`
- [ ] `src/lib/screen-prompt.ts` updated with language behavior instructions
- [ ] `src/lib/screen-engine/` mirror updated; sync script passes
- [ ] `/api/intake-v2` accepts and persists new fields
- [ ] `/api/voice-intake` accepts and persists new fields
- [ ] Brief HTML includes "Language of communication" row when non-English
- [ ] Triage portal renders language prominently when non-English
- [ ] Queue card shows language badge
- [ ] New-lead notification email includes language
- [ ] `docs/ghl-webhook-contract.md` updated with `intake_language` envelope field
- [ ] Webhook payload builder includes `intake_language`
- [ ] All 4 test fixtures pass end-to-end
- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm test` passes
- [ ] Updated CLAUDE.md (both master and app) with build status
- [ ] Updated `GHL_Quirks_and_Doctrine_FAQ_v1.md` with FAQ entry
- [ ] Updated `Phase_B_Closure_Master_v1.md` to mark gap closed
- [ ] Vite sandbox repo committed and pushed with same engine changes (operator handles repo coordination if not auto)

---

## Operator notes (Adriano)

- I'll be working overnight while you sleep
- Doctrine corrections (master CLAUDE.md, app CLAUDE.md) landed today. Read those first.
- The screenshot bug (`quero abrir uma empresa no canada`) is the canonical failure mode. The first test that should pass is fixture A.
- Workflows are out of scope. Do not touch J1-J12 or DECLINE. The downstream cadence translation is v1.1 work.
- The Vite sandbox repo lives separately. If you can't push there, leave a clear note in the commit message about the sync state and Adriano will propagate manually.
- If you hit a blocker that needs operator input, write to `MULTILINGUAL_BUILD_OPEN_QUESTIONS.md` in the docs folder and stop. Don't guess.
- Brand voice for the brief: keep tone professional and neutral. The brief is a legal-intake document, not customer-facing copy. LSO 4.2-1 still applies to anything the lawyer might quote out of the brief later.

---

## Cross-references

- `D:\00_Work\01_CaseLoad_Select\CLAUDE.md` § Language Position — the canonical doctrine
- `D:\00_Work\01_CaseLoad_Select\05_Product\caseload-select-app\CLAUDE.md` § Language Position — app-side implementation notes
- `docs/ghl-webhook-contract.md` — webhook payload contract
- `04_Playbooks/04_Screen/Playbooks/GHL_Quirks_and_Doctrine_FAQ_v1.md` — quirks doc to update post-build
- `04_Playbooks/04_Screen/Playbooks/Phase_B_Closure_Master_v1.md` — Phase B closure consolidation to update post-build
