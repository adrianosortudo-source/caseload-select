// Persistence client for CaseLoad Screen 2.0.
//
// At the moment a screening session reaches its terminal "stop" step, this
// module captures the rendered brief HTML and POSTs the full payload to the
// caseload-select-app's /api/intake-v2 endpoint. The lawyer portal reads from
// the resulting Supabase row.
//
// firmId resolution is via the `?firmId=...` query param on the screen URL,
// matching the existing /widget/[firmId] precedent in caseload-select-app.
// White-label custom domains will eventually shift this to subdomain
// resolution; until then, embedders pass the firm identifier explicitly.
//
// Demo / no-firmId mode: the endpoint short-circuits with
// `{ persisted: false, mode: 'demo' }` so the demo URL keeps working without
// polluting the production table.

import type { EngineState } from './types';
import { buildReport } from './report';

// Set in Vercel project env. Falls back to the production app URL for any
// build that forgets to set it; the endpoint itself handles demo flow safely.
const ENDPOINT =
  ((import.meta as { env?: { VITE_INTAKE_ENDPOINT?: string } }).env?.VITE_INTAKE_ENDPOINT as string | undefined) ??
  'https://app.caseloadselect.ca/api/intake-v2';

const REQUEST_TIMEOUT_MS = 10_000;

export interface PersistResult {
  ok: boolean;
  persisted: boolean;
  mode?: string;
  reason?: string;
  id?: string;
  status?: string;
  decision_deadline?: string;
  whale_nurture?: boolean;
  http_status?: number;
}

/**
 * Read the firmId from the current URL query string. Returns null when
 * absent or in non-browser environments (tests, SSR).
 */
export function getFirmIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const v = (params.get('firmId') ?? '').trim();
  return v.length > 0 ? v : null;
}

export interface WebAttribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
}

/**
 * Read passive web-attribution from the widget URL + document.referrer.
 * Used by /api/intake-v2 to populate the screened_leads enrichment columns
 * so the lawyer sees an "Inbound context" line on the brief.
 *
 * For iframe embeds, UTM only flows when the firm passes the parent page's
 * UTM params through to the iframe src (caseload-screen-v2.vercel.app/
 * ?firmId=...&utm_source=...). The embedding script on the firm's site is
 * responsible for that pass-through; this function just reads what arrived.
 *
 * document.referrer behaviour in iframes depends on Referrer-Policy. Best
 * effort — null when unavailable.
 */
export function getWebAttribution(): WebAttribution {
  if (typeof window === 'undefined') {
    return {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_term: null,
      utm_content: null,
      referrer: null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const trim = (raw: string | null): string | null => {
    if (raw === null) return null;
    const t = raw.trim();
    return t.length > 0 ? t : null;
  };
  const docReferrer =
    typeof document !== 'undefined' && typeof document.referrer === 'string'
      ? document.referrer
      : null;
  return {
    utm_source: trim(params.get('utm_source')),
    utm_medium: trim(params.get('utm_medium')),
    utm_campaign: trim(params.get('utm_campaign')),
    utm_term: trim(params.get('utm_term')),
    utm_content: trim(params.get('utm_content')),
    referrer: trim(docReferrer),
  };
}

/**
 * POST the screened lead to the persistence endpoint. The function is
 * tolerant: any failure (network, HTTP, timeout, missing firmId) resolves
 * with ok=false rather than throwing, so the screen can always show the
 * "Sent to firm" success state without depending on persistence working.
 *
 * The brief is built fresh from state via buildReport() so the persisted
 * JSON is exactly the canonical artifact, not whatever happens to be in the
 * DOM. The HTML snapshot is what the lead saw, captured separately.
 */
export async function persistScreenedLead(
  state: EngineState,
  briefHtml: string,
  firmId: string | null,
): Promise<PersistResult> {
  const report = buildReport(state);

  // Contact-capture doctrine (2026-05-15). A brief without name AND
  // (email OR phone) is NOT a lead. Refuse to POST and let the caller
  // know — the engine's capture_contact step should drive the
  // conversation back into contact-capture mode.
  if (!report.contact_complete) {
    return {
      ok: false,
      persisted: false,
      reason: 'contact_incomplete',
    };
  }

  const attribution = getWebAttribution();

  // intake_language is the ISO 639-1 code of the language the lead used to
  // converse with the screen. Defaults to 'en' if franc never ran for any
  // reason. The endpoint uses this to set screened_leads.intake_language
  // (DR-036: language-agnostic at intake, English at the lawyer surface).
  const intakeLanguage = state.language ?? 'en';

  // raw_transcript: the lead's original natural-language description as
  // they first typed it (state.input is set once by initialiseState and is
  // not overwritten during the slot-driven follow-up turns). We only
  // persist it when intake was NOT English — for English intakes there is
  // nothing to preserve that the English brief does not already contain,
  // and storing it would duplicate PII. For non-English intakes the
  // lawyer's brief is translated to English but compliance / appeals
  // occasionally need the raw original text. (CLAUDE.md: "For web leads:
  // the initial description when non-English.")
  const rawTranscript = intakeLanguage === 'en'
    ? null
    : (typeof state.input === 'string' && state.input.length > 0 ? state.input : null);

  const payload = {
    lead_id: report.lead_id,
    submitted_at: report.submitted_at,
    matter_type: state.matter_type,
    practice_area: state.practice_area,
    band: report.band,
    axes: report.four_axis,
    brief_json: report,
    brief_html: briefHtml,
    intake_language: intakeLanguage,
    raw_transcript: rawTranscript,
    slot_answers: {
      slots: state.slots,
      slot_meta: state.slot_meta,
      slot_evidence: state.slot_evidence,
      raw: state.raw,
      intent_family: state.intent_family,
      dispute_family: state.dispute_family,
      advisory_subtrack: state.advisory_subtrack,
      questionHistory: state.questionHistory,
    },
    contact: {
      name: state.slots['client_name'] ?? undefined,
      email: state.slots['client_email'] ?? undefined,
      phone: state.slots['client_phone'] ?? undefined,
    },
    // Lead enrichment Module 1 — passive web-attribution signals.
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_term: attribution.utm_term,
    utm_content: attribution.utm_content,
    referrer: attribution.referrer,
  };

  // firmId rides on the query string so the endpoint can short-circuit demo
  // mode before parsing the body.
  const url = firmId
    ? `${ENDPOINT}?firmId=${encodeURIComponent(firmId)}`
    : ENDPOINT;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // 409 means duplicate lead_id — still a non-fatal outcome
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok || res.status === 409,
      persisted: !!data.persisted,
      mode: data.mode,
      reason: data.reason,
      id: data.id,
      status: data.status,
      decision_deadline: data.decision_deadline,
      whale_nurture: data.whale_nurture,
      http_status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      persisted: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
