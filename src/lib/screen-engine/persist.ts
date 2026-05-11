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

  const payload = {
    lead_id: report.lead_id,
    submitted_at: report.submitted_at,
    matter_type: state.matter_type,
    practice_area: state.practice_area,
    band: report.band,
    axes: report.four_axis,
    brief_json: report,
    brief_html: briefHtml,
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
