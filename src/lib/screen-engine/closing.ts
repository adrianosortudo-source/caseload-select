import type { EngineState, Channel } from './types';

// ─── Closing confirmation ────────────────────────────────────────────────
//
// Single-source-of-truth for the channel-aware acknowledgment the engine
// emits when an intake conversation reaches its natural end. The caller
// (channel-intake-processor on Meta channels; the SPA done page for web)
// decides whether and how to surface it.
//
// Channel matrix:
//
//   web                       empty — the SPA renders its own done page,
//                             no channel-side message is sent
//   voice                     empty — the call closes verbally on the line,
//                             no follow-up text
//   sms / gbp                 short, no name — plain-text channels where
//                             brevity is the brand and the recipient is on
//                             a phone they actively chose to be on
//   whatsapp / messenger / instagram
//                             1-2 sentences with the lead's first name
//                             when captured and a matter label when the
//                             engine has classified the conversation
//
// Lead-facing copy NEVER promises a specific response window. The rule
// applies to every channel CaseLoad Screen runs on. CaseLoad Select does
// not control when the firm actually replies; the lawyer chooses the
// response cadence on every matter. A time promise in the firm's voice
// creates a guarantee the platform cannot keep on the lawyer's behalf,
// and the lawyer wears the breach. For time-sensitive matters the closer
// adds a direct-call CTA so the lead can self-route, never a softer
// pseudo-promise ("soon", "as soon as possible"). The decision_deadline
// is still computed downstream of the engine for the LAWYER's queue (see
// intake-v2-derive.computeDecisionDeadline); that is firm-internal SLA,
// separate from the lead-facing copy.

export function buildClosingMessage(state: EngineState): string {
  const channel: Channel = state.channel ?? 'web';
  if (channel === 'web' || channel === 'voice') return '';

  const first = pickFirstName(state.slots['client_name']);

  if (channel === 'sms' || channel === 'gbp') {
    return `Thanks. A lawyer will be in touch using the contact details you shared.`;
  }

  // whatsapp / messenger / instagram
  const nameOrThere = first || 'there';

  if (state.matter_type === 'out_of_scope') {
    return `Thanks ${nameOrThere}. Your matter has been forwarded to the firm. A team member will review and respond using the contact details you shared.`;
  }

  const label = matterLabel(state.matter_type);
  if (label) {
    return `Thanks ${nameOrThere}, a lawyer is reviewing your ${label} matter and will be in touch using the contact details you shared. If your situation is time-sensitive, please call the firm directly.`;
  }
  return `Thanks ${nameOrThere}, a lawyer is reviewing your matter and will be in touch using the contact details you shared. If your situation is time-sensitive, please call the firm directly.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function pickFirstName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const first = trimmed.split(/\s+/)[0] ?? '';
  // Drop tokens that read as initials rather than names. WhatsApp's
  // profile.name field occasionally returns single letters or 2-letter
  // initial mashes ("A D"); using those as a greeting reads off. We
  // accept anything 2+ chars on the assumption that real first names
  // are at least that long. A two-letter "Ad" is preserved; a one-
  // letter "A" is not. Callers fall back to "there" when this returns
  // empty.
  if (first.length < 2) return '';
  return first;
}

function matterLabel(t: string): string {
  switch (t) {
    case 'shareholder_dispute': return 'partnership';
    case 'unpaid_invoice': return 'unpaid invoice';
    case 'contract_dispute': return 'contract';
    case 'vendor_supplier_dispute': return 'vendor billing';
    case 'corporate_money_control': return 'corporate financial';
    case 'business_setup_advisory': return 'business setup';
    case 'commercial_real_estate': return 'commercial real estate';
    case 'residential_purchase_sale': return 'residential property';
    case 'real_estate_litigation': return 'real estate';
    case 'landlord_tenant': return 'tenancy';
    case 'construction_lien': return 'construction lien';
    case 'preconstruction_condo': return 'pre-construction condo';
    case 'mortgage_dispute': return 'mortgage';
    default: return '';
  }
}
