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
// Lead-facing copy intentionally avoids promising a specific response
// window. The decision_deadline is computed downstream of the engine
// (see intake-v2-derive.computeDecisionDeadline) and the firm-side SLA
// varies per matter urgency. The phrase "shortly" matches the brand
// commitment in the hero copy ("Most replies within hours") without
// over-committing. Urgent matter classes whose bridgeText already says
// "promptly" use "promptly" here for consistency.

export function buildClosingMessage(state: EngineState): string {
  const channel: Channel = state.channel ?? 'web';
  if (channel === 'web' || channel === 'voice') return '';

  const first = pickFirstName(state.slots['client_name']);
  const window = urgentMatter(state) ? 'promptly' : 'shortly';

  if (channel === 'sms' || channel === 'gbp') {
    return `Thanks. A lawyer will reach out ${window}.`;
  }

  // whatsapp / messenger / instagram
  const nameOrThere = first || 'there';

  if (state.matter_type === 'out_of_scope') {
    return `Thanks ${nameOrThere}. Your matter has been forwarded to the firm. A team member will review and respond directly.`;
  }

  const label = matterLabel(state.matter_type);
  if (label) {
    return `Thanks ${nameOrThere}, a lawyer is reviewing your ${label} matter and will reach out ${window}.`;
  }
  return `Thanks ${nameOrThere}, a lawyer is reviewing your matter and will reach out ${window}.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function urgentMatter(state: EngineState): boolean {
  // Keep in lockstep with the bridgeText "promptly" set in control.ts:
  // matter classes where the firm wants the lead to know the response
  // window is faster than default. Construction Act timelines and
  // power-of-sale notices are time-critical by nature; corporate money
  // control is flagged urgent because financial-irregularity matters
  // tend to move fast once disclosed.
  return state.matter_type === 'corporate_money_control'
    || state.matter_type === 'construction_lien'
    || state.matter_type === 'mortgage_dispute';
}

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
