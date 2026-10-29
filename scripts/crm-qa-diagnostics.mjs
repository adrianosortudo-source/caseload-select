const PHASES = new Set(['guard', 'browser', 'oidc_request', 'oidc_response', 'session_exchange', 'render_crm', 'render_followup', 'render_api', 'read_deals', 'read_reminders', 'read_followup', 'read_report', 'read_prospects', 'read_opt_in', 'read_conversation', 'renew_wait', 'close']);

export function createDiagnostic() {
  let phase = 'guard';
  let status;
  let round = 'initial';
  return {
    round(value) { round = value === 'renewal' ? 'renewal' : 'initial'; },
    phase(value) { phase = PHASES.has(value) ? value : 'guard'; status = undefined; },
    status(value) { status = Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined; },
    renderFailure(value) {
      if (Number.isInteger(value) && value >= 400 && value <= 599) { phase = 'render_api'; status = value; }
    },
    failure() { return `CRM_QA_FAIL_ROUND=${round} PHASE=${phase}${status === undefined ? '' : ` STATUS=${status}`}`; },
  };
}
