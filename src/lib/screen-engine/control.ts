import type { EngineState, NextStep, Band, LeadSummary } from './types';
import { getI18n } from './i18n/loader';
import type { I18nBundle } from './i18n/loader';
import { selectNextSlot, computeCoreCompleteness, getDecisionGap, isWeakName } from './selector';
import { computeBand } from './band';
import { SLOT_REGISTRY } from './slotRegistry';
import {
  updateAdvisorySubtrack,
  rerouteFromCorporateGeneral,
  rerouteFromRealEstateGeneral,
  rerouteFromEmploymentGeneral,
  rerouteFromEstatesGeneral,
} from './extractor';
import { deriveAdvisorySpecificTask } from './slotEvidence';
import { buildClosingMessage } from './closing';

const INSIGHT_THRESHOLD_COMPLETENESS = 75;
const BAND_A_COMPLETENESS = 65;

// ─── Channel-aware question budgets ────────────────────────────────────
//
// SMS imposes hard real-world constraints on flow length: each user reply
// can take 5 to 60 minutes, and 52% of leads abandon any flow that runs
// longer than 3 minutes total. The research consensus says cap SMS at
// 3-question depth, then bail to insight + contact capture.
//
// Other channels stay full-depth. Clicks (web) and pill taps (WA, IG, FB)
// are cheap, so the lead happily answers more. GBP messaging sits closer
// to a soft cap: plain text like SMS but lower latency (lead is in Maps
// right now) so 5 questions before bailing instead of 3.
//
// Voice: DR-033 (single-pass, post-call webhook) used budget=3 because
// there was no second turn. DR-048 (Voice v2, engine-owns-turns) raises
// this to 8 to allow multi-turn discovery in realtime. The DR-033
// /api/voice-intake route never calls getNextStep so the increase is
// safe: it only affects the Voice v2 realtime turn loop.
//
// "questionHistory.length" counts every slot the lead has answered after
// the initial regex / LLM pass on the kickoff message. Slots filled
// implicitly by extraction don't count.
const QUESTION_BUDGET_BY_CHANNEL: Partial<Record<NonNullable<EngineState['channel']>, number>> = {
  sms: 3,
  gbp: 5,
  voice: 8,
};

function questionsAnswered(state: EngineState): number {
  return state.questionHistory.length;
}

function overChannelBudget(state: EngineState): boolean {
  const channel = state.channel ?? 'web';
  const budget = QUESTION_BUDGET_BY_CHANNEL[channel];
  if (budget === undefined) return false;
  return questionsAnswered(state) >= budget;
}

// ─── Bridge messages ───────────────────────────────────────────────────────

function getBridgeText(state: EngineState): string {
  return state.language === 'en'
    ? getBridgeTextEn(state)
    : getBridgeTextI18n(state, getI18n(state.language));
}

function getBridgeTextEn(state: EngineState): string {
  if (state.matter_type === 'out_of_scope') {
    const areaLabels: Record<string, string> = {
      family: 'family law',
      immigration: 'immigration',
      employment: 'employment',
      criminal: 'criminal',
      personal_injury: 'personal injury',
      estates: 'wills and estates',
    };
    const area = areaLabels[state.practice_area] ?? 'this area';
    return `Thank you. Your information has been sent to the firm. Your matter looks like it sits in ${area}, which the firm will review and respond on directly.`;
  }
  switch (state.matter_type) {
    case 'shareholder_dispute':
      return 'Thank you. The firm will receive a brief on your situation along with the next-step questions a lawyer would normally ask, so the team can decide how to follow up.';
    case 'unpaid_invoice':
      return 'Thank you. The firm will receive a brief on the payment matter, along with notes on documents and amounts a lawyer would typically review next.';
    case 'contract_dispute':
      return 'Thank you. The firm will receive a brief on the contract matter, along with the open questions a lawyer would normally clarify before advising.';
    case 'vendor_supplier_dispute':
      return 'Thank you. The firm will receive a brief on the billing dispute and the documents a lawyer would normally request next.';
    case 'corporate_money_control':
      return 'Thank you. The firm will receive a brief on the financial concern with the next-step questions a lawyer would normally ask. Given the nature of the matter, the firm may follow up promptly.';
    case 'business_setup_advisory':
      return 'Thank you. The firm will receive a brief on what you are setting up so the team can prepare for a productive first call.';
    case 'corporate_general':
      return 'Thank you. The firm will receive a brief on what you described so the team can route the matter and follow up.';
    case 'commercial_real_estate':
      return 'Thank you. The firm will receive a brief on the commercial transaction with the documents and timing a lawyer would normally review.';
    case 'residential_purchase_sale':
      return 'Thank you. The firm will receive a brief on the residential transaction so the team can prepare for the next step.';
    case 'real_estate_litigation':
      return 'Thank you. The firm will receive a brief on the real estate dispute and the documents a lawyer would normally request next.';
    case 'landlord_tenant':
      return 'Thank you. The firm will receive a brief on the tenancy matter so the team can decide how best to follow up.';
    case 'construction_lien':
      return 'Thank you. The firm will receive a brief on the unpaid construction work, including the timing details that matter under the Construction Act. The firm may follow up promptly given how time-sensitive lien matters can be.';
    case 'preconstruction_condo':
      return 'Thank you. The firm will receive a brief on the builder matter so the team can decide how to follow up.';
    case 'mortgage_dispute':
      return 'Thank you. The firm will receive a brief on the mortgage matter. Given the nature of these matters, the firm may follow up promptly.';
    case 'real_estate_general':
      return 'Thank you. The firm will receive a brief on what you described so the team can follow up.';
    default:
      return 'Thank you. Your information has been sent to the firm.';
  }
}

export function getBridgeTextI18n(state: EngineState, i18n: I18nBundle): string {
  const bt = i18n.bridge_text ?? {};
  if (state.matter_type === 'out_of_scope') {
    const prefix = bt['out_of_scope_prefix']
      || 'Thank you. Your information has been sent to the firm. Your matter looks like it sits in ';
    const suffix = bt['out_of_scope_suffix'] || ', which the firm will review and respond on directly.';
    const areaKey = `out_of_scope_area_${state.practice_area}`;
    const area = bt[areaKey] || bt['out_of_scope_area_default'] || 'this area';
    return `${prefix}${area}${suffix}`;
  }
  return bt[state.matter_type] || bt['default'] || 'Thank you. Your information has been sent to the firm.';
}

// ─── Lead-facing summary ──────────────────────────────────────────────────
// Plain-language recap of what we understood, shown at the bridge moment so
// the lead can confirm we got it right or volunteer to add more details.

function slot(state: EngineState, id: string): string | null {
  return state.slots[id] ?? null;
}

/**
 * Builds the lead-facing summary for the bridge screen.
 *
 * i18n is a required argument — compile-time enforcement ensures every caller
 * provides the correct bundle. English callers pass getI18n('en'); the fast
 * path then skips all bundle lookups entirely, preserving zero overhead on
 * the English flow.
 */
export function buildLeadSummary(state: EngineState, i18n: I18nBundle): LeadSummary {
  return state.language === 'en'
    ? buildLeadSummaryEn(state)
    : buildLeadSummaryI18n(state, i18n);
}

// ─── English fast path (state.language === 'en') ──────────────────────────
// Original hardcoded logic, completely unchanged. No bundle lookups.

function buildLeadSummaryEn(state: EngineState): LeadSummary {
  const t = state.matter_type;
  const points: string[] = [];

  if (t === 'out_of_scope') {
    const areaLabels: Record<string, string> = {
      family: 'family law',
      immigration: 'immigration',
      employment: 'employment',
      criminal: 'criminal',
      personal_injury: 'personal injury',
      estates: 'wills and estates',
    };
    const area = areaLabels[state.practice_area] ?? 'this area';
    return {
      intro: `From what you described, this looks like a ${area} matter.`,
      points: [],
      closing: 'A team member will review and respond directly. The firm does not yet handle this area on its own, but they will tell you whether they can help or refer you to someone who can.',
    };
  }

  if (t === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    let intro = 'You are looking at setting up a business and want a lawyer to help you do it the right way.';
    if (sub === 'partner_setup') intro = 'You are starting a business with one or more partners and want a lawyer to help you set it up correctly.';
    else if (sub === 'solo_setup') intro = 'You are starting a business on your own and want a lawyer to help you set it up correctly.';
    else if (sub === 'buy_in_or_joining') intro = 'You are buying into or joining an existing business and want a lawyer to review the documents and protect your position.';

    const activity = slot(state, 'business_activity_type');
    if (activity) points.push(`What you do: ${activity.toLowerCase()}.`);
    const stage = slot(state, 'business_stage');
    if (stage) points.push(`Where you are: ${stage.toLowerCase()}.`);
    const location = slot(state, 'business_location');
    if (location) points.push(`Where the business will be based: ${location}.`);
    const revenue = slot(state, 'revenue_expectation');
    if (revenue) points.push(`Revenue you expect in year one: ${revenue.toLowerCase()}.`);
    const employees = slot(state, 'employees_planned');
    if (employees && employees !== 'No, just me') points.push(`Hiring plans: ${employees.toLowerCase()}.`);
    const regulated = slot(state, 'regulated_industry');
    if (regulated && regulated.startsWith('Yes')) points.push(`Regulated area: ${regulated.replace(/^Yes,\s*/i, '')}.`);
    const crossBorder = slot(state, 'cross_border_work');
    if (crossBorder && crossBorder !== 'No, Canada only' && crossBorder !== 'Not sure yet') points.push(`Clients outside Canada: ${crossBorder.toLowerCase()}.`);
    const ip = slot(state, 'ip_planned');
    if (ip && ip !== 'No, services only' && ip !== 'Not sure') points.push(`Brand or intellectual property to protect: ${ip.replace(/^Yes,\s*/i, '')}.`);

    return {
      intro,
      points,
      closing: 'A lawyer can help you choose the right structure, document ownership clearly, and put the agreements in place that prevent avoidable problems later.',
    };
  }

  if (t === 'shareholder_dispute') {
    const intro = 'You are in a dispute with a business partner or fellow shareholder, and you want a lawyer to help you protect your position.';
    if (slot(state, 'corporate_records_available') === 'No') points.push('You cannot access the company records or accounts.');
    if (slot(state, 'management_exclusion') === 'Yes') points.push('You are being kept out of decisions that affect the business.');
    if (slot(state, 'dividend_or_money_issue') === 'Yes') points.push('You are concerned about money being taken from the company.');
    const proof = slot(state, 'proof_of_ownership') ?? slot(state, 'shareholder_agreement');
    if (proof === 'Yes') points.push('You have documentation of your ownership.');
    return {
      intro,
      points,
      closing: 'A lawyer can review your situation, demand access to the records you are entitled to, and pursue a remedy under shareholder protection laws.',
    };
  }

  if (t === 'unpaid_invoice') {
    const intro = 'You are owed money for work, goods, or services and you are not getting paid.';
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(`Amount owed: ${amount}.`);
    if (slot(state, 'invoice_exists') === 'Yes') points.push('You have an invoice or written record of the amount.');
    if (slot(state, 'proof_of_performance') === 'Yes') points.push('You can show the work or goods were delivered.');
    if (slot(state, 'dispute_reason')) points.push(`The other side is: ${slot(state, 'dispute_reason')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can send a demand, file a claim, or negotiate a settlement to recover what you are owed.',
    };
  }

  if (t === 'contract_dispute') {
    const intro = 'You have a dispute over an agreement that has not been honoured.';
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(`Value of the dispute: ${amount}.`);
    if (slot(state, 'written_terms') === 'Yes' || slot(state, 'contract_exists') === 'Yes') points.push('You have the agreement in writing.');
    if (slot(state, 'dispute_reason')) points.push(`The dispute is: ${slot(state, 'dispute_reason')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the agreement, assess your position, and pursue resolution by negotiation or court action.',
    };
  }

  if (t === 'vendor_supplier_dispute') {
    const intro = 'You are in a billing dispute with a vendor or supplier.';
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(`Amount in dispute: ${amount}.`);
    if (slot(state, 'billing_dispute_reason')) points.push(`What happened: ${slot(state, 'billing_dispute_reason')!.toLowerCase()}.`);
    if (slot(state, 'vendor_contract_exists')) points.push(`Agreement: ${slot(state, 'vendor_contract_exists')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the terms, assess the overcharge or non-delivery, and advise on recovery.',
    };
  }

  if (t === 'corporate_money_control') {
    const intro = 'You have concerns about financial irregularities inside a company.';
    if (slot(state, 'reporter_role_money')) points.push(`Your role: ${slot(state, 'reporter_role_money')!.toLowerCase()}.`);
    if (slot(state, 'irregularity_type')) points.push(`What you have observed: ${slot(state, 'irregularity_type')!.toLowerCase()}.`);
    if (slot(state, 'irregularity_amount')) points.push(`Amount involved: ${slot(state, 'irregularity_amount')}.`);
    if (slot(state, 'evidence_of_irregularity') === 'Yes') points.push('You have documented evidence.');
    else if (slot(state, 'evidence_of_irregularity') === 'Some, but not enough') points.push('You have some evidence but not the full picture.');
    if (slot(state, 'reported_to_anyone') === 'No, not yet') points.push('You have not reported this to anyone yet.');
    return {
      intro,
      points,
      closing: 'A lawyer can help you understand your duties, protect the company, and advise on civil or criminal action where appropriate.',
    };
  }

  if (t === 'commercial_real_estate') {
    const intro = 'You are involved in a commercial real estate transaction and want a lawyer to protect your position.';
    if (slot(state, 'commercial_re_role')) points.push(`Your role: ${slot(state, 'commercial_re_role')!.toLowerCase()}.`);
    if (slot(state, 'commercial_property_type')) points.push(`Property: ${slot(state, 'commercial_property_type')!.toLowerCase()}.`);
    if (slot(state, 'commercial_re_amount')) points.push(`Approximate value: ${slot(state, 'commercial_re_amount')}.`);
    if (slot(state, 'commercial_re_stage')) points.push(`Where you are: ${slot(state, 'commercial_re_stage')!.toLowerCase()}.`);
    if (slot(state, 'commercial_re_concerns') && slot(state, 'commercial_re_concerns') !== 'Not sure yet') points.push(`Main concern: ${slot(state, 'commercial_re_concerns')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the agreement, surface title or zoning risks, and protect your position before closing.',
    };
  }

  if (t === 'residential_purchase_sale') {
    const role = slot(state, 'residential_role');
    let intro = 'You are involved in a residential property transaction and want a lawyer to handle it properly.';
    if (role === 'Buying') intro = 'You are buying a home and want a lawyer to handle the closing properly.';
    else if (role === 'Selling') intro = 'You are selling a home and want a lawyer to handle the closing properly.';
    else if (role === 'Both (buying and selling)') intro = 'You are both buying and selling a home and want a lawyer to handle both closings.';
    if (slot(state, 'residential_property_type')) points.push(`Property type: ${slot(state, 'residential_property_type')!.toLowerCase()}.`);
    if (slot(state, 'residential_re_amount')) points.push(`Approximate price: ${slot(state, 'residential_re_amount')}.`);
    if (slot(state, 'residential_re_stage')) points.push(`Where you are: ${slot(state, 'residential_re_stage')!.toLowerCase()}.`);
    if (slot(state, 'residential_closing_timeline')) points.push(`Closing timing: ${slot(state, 'residential_closing_timeline')!.toLowerCase()}.`);
    if (slot(state, 'residential_re_concern')) points.push(`Main need: ${slot(state, 'residential_re_concern')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the agreement, handle the closing, and resolve issues that come up before keys change hands.',
    };
  }

  if (t === 'real_estate_litigation') {
    const intro = 'You are in a real estate dispute and want a lawyer to help you assess your options.';
    if (slot(state, 'litigation_subject')) points.push(`The dispute is about: ${slot(state, 'litigation_subject')!.toLowerCase()}.`);
    if (slot(state, 'litigation_role')) points.push(`Your role: ${slot(state, 'litigation_role')!.toLowerCase()}.`);
    if (slot(state, 'litigation_amount')) points.push(`Roughly at stake: ${slot(state, 'litigation_amount')}.`);
    if (slot(state, 'litigation_documents')) points.push(`Written agreement: ${slot(state, 'litigation_documents')!.toLowerCase()}.`);
    if (slot(state, 'litigation_stage')) points.push(`Court status: ${slot(state, 'litigation_stage')!.toLowerCase()}.`);
    if (slot(state, 'litigation_when_event')) points.push(`When this happened: ${slot(state, 'litigation_when_event')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the contract and history, assess your position, and advise on recovery of the deposit, the deal, or damages.',
    };
  }

  if (t === 'landlord_tenant') {
    const party = slot(state, 'tenancy_party');
    let intro = 'You have a tenancy dispute and want a lawyer to help you resolve it.';
    if (party === 'Landlord') intro = 'You are a landlord with a tenancy dispute.';
    else if (party === 'Tenant') intro = 'You are a tenant with a dispute against your landlord.';
    if (slot(state, 'tenancy_type')) points.push(`Tenancy type: ${slot(state, 'tenancy_type')!.toLowerCase()}.`);
    if (slot(state, 'tenancy_issue')) points.push(`The issue: ${slot(state, 'tenancy_issue')!.toLowerCase()}.`);
    if (slot(state, 'tenancy_amount')) points.push(`Amount involved: ${slot(state, 'tenancy_amount')}.`);
    if (slot(state, 'tenancy_lease_exists')) points.push(`Lease: ${slot(state, 'tenancy_lease_exists')!.toLowerCase()}.`);
    if (slot(state, 'tenancy_notice_status')) points.push(`Notices or applications: ${slot(state, 'tenancy_notice_status')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the lease, advise on the dispute, and represent you at the LTB or in court depending on the tenancy.',
    };
  }

  if (t === 'construction_lien') {
    const intro = 'You have done construction or renovation work and you are owed money for it.';
    if (slot(state, 'lien_role')) points.push(`Your role: ${slot(state, 'lien_role')!.toLowerCase()}.`);
    if (slot(state, 'lien_amount')) points.push(`Amount owed: ${slot(state, 'lien_amount')}.`);
    if (slot(state, 'lien_last_supply')) points.push(`Last work or materials supplied: ${slot(state, 'lien_last_supply')!.toLowerCase()}.`);
    if (slot(state, 'lien_preserved')) points.push(`Lien status: ${slot(state, 'lien_preserved')!.toLowerCase()}.`);
    if (slot(state, 'lien_documents')) points.push(`Paperwork: ${slot(state, 'lien_documents')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'Construction Act timelines are tight, so a lawyer can act quickly to register a claim against the property and pursue what you are owed.',
    };
  }

  if (t === 'preconstruction_condo') {
    const intro = 'You have a pre-construction condo matter and want a lawyer to help you protect your position.';
    if (slot(state, 'precon_role')) points.push(`Your role: ${slot(state, 'precon_role')!.toLowerCase()}.`);
    if (slot(state, 'precon_issue')) points.push(`The issue: ${slot(state, 'precon_issue')!.toLowerCase()}.`);
    if (slot(state, 'precon_amount')) points.push(`Amount at stake: ${slot(state, 'precon_amount')}.`);
    if (slot(state, 'precon_developer_status')) points.push(`How the developer is responding: ${slot(state, 'precon_developer_status')!.toLowerCase()}.`);
    if (slot(state, 'precon_documents')) points.push(`Builder agreement: ${slot(state, 'precon_documents')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the builder agreement, assess Tarion remedies, and advise on deposits, delayed closing, or assignments.',
    };
  }

  if (t === 'mortgage_dispute') {
    const intro = 'You have a mortgage matter and want a lawyer to help you understand your rights and options.';
    if (slot(state, 'mortgage_role')) points.push(`Your role: ${slot(state, 'mortgage_role')!.toLowerCase()}.`);
    if (slot(state, 'mortgage_status')) points.push(`Where things stand: ${slot(state, 'mortgage_status')!.toLowerCase()}.`);
    if (slot(state, 'mortgage_amount')) points.push(`Approximate balance or amount in dispute: ${slot(state, 'mortgage_amount')}.`);
    if (slot(state, 'mortgage_lender_type')) points.push(`Lender: ${slot(state, 'mortgage_lender_type')!.toLowerCase()}.`);
    if (slot(state, 'mortgage_documents')) points.push(`Documents in hand: ${slot(state, 'mortgage_documents')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the lender notices, advise on your rights, and intervene to protect the property where possible.',
    };
  }

  if (t === 'corporate_general' || t === 'real_estate_general') {
    return {
      intro: 'From what you described, this looks like a corporate or real estate matter, but we need a bit more to know exactly which kind.',
      points: [],
      closing: 'The firm will review the description and follow up to confirm what you need.',
    };
  }

  // ─── EMPLOYMENT — sub-types (Phase A/B) ────────────────────────────
  // Added 2026-06-05: when the engine classifies an employment matter, the
  // public widget recap was falling through to the generic "Thank you. Here
  // is what we understood from your description." fallback because no case
  // existed. Half of DRG's incoming traffic is employment.

  if (t === 'wrongful_dismissal') {
    // Recap composition (2026-06-07): match the matter-aware question order
    // so every answered slot shows up. Order here mirrors MATTER_SPECIFIC_SLOT_ORDER
    // in selector.ts: signed_release, tenure_band, dismissal_reason_given,
    // severance_offered, salary_band, desired_outcome.
    const intro = 'You were let go from a job, and you want a lawyer to look at whether the termination and what was offered are fair.';
    if (slot(state, 'signed_release')) {
      const v = slot(state, 'signed_release')!.toLowerCase();
      if (v.includes('have not signed')) points.push('You have not signed anything yet.');
      else if (v.includes('yes, i signed')) points.push('You already signed something.');
      else points.push(`Whether you signed: ${v}.`);
    }
    if (slot(state, 'tenure_band')) points.push(`How long you worked there: ${slot(state, 'tenure_band')!.toLowerCase()}.`);
    if (slot(state, 'dismissal_reason_given')) points.push(`Reason given for dismissal: ${slot(state, 'dismissal_reason_given')!.toLowerCase()}.`);
    if (slot(state, 'severance_offered')) points.push(`Severance offered: ${slot(state, 'severance_offered')!.toLowerCase()}.`);
    if (slot(state, 'salary_band')) points.push(`Your annual compensation: ${slot(state, 'salary_band')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_wrongful_dismissal')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_wrongful_dismissal')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can assess your common-law entitlement, push back on a low offer, and pursue a better settlement before the deadline runs.',
    };
  }

  if (t === 'severance_review') {
    const intro = 'You received a severance offer and want a lawyer to review it before you sign.';
    if (slot(state, 'signed_release')) {
      const v = slot(state, 'signed_release')!.toLowerCase();
      if (v.includes('have not signed')) points.push('You have not signed anything yet.');
      else if (v.includes('yes, i signed')) points.push('You already signed something.');
      else points.push(`Whether you signed: ${v}.`);
    }
    if (slot(state, 'severance_deadline')) points.push(`Deadline to respond: ${slot(state, 'severance_deadline')!.toLowerCase()}.`);
    if (slot(state, 'severance_offer_amount')) points.push(`Amount offered: ${slot(state, 'severance_offer_amount')!.toLowerCase()}.`);
    if (slot(state, 'tenure_band')) points.push(`How long you worked there: ${slot(state, 'tenure_band')!.toLowerCase()}.`);
    if (slot(state, 'salary_band')) points.push(`Your annual compensation: ${slot(state, 'salary_band')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_severance_review')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_severance_review')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can compare what you have been offered to your common-law entitlement and negotiate for the right number.',
    };
  }

  if (t === 'harassment_complaint') {
    const intro = 'You have a workplace harassment matter and want a lawyer to advise you on your options.';
    if (slot(state, 'harassment_employment_status')) points.push(`Your employment status: ${slot(state, 'harassment_employment_status')!.toLowerCase()}.`);
    if (slot(state, 'harassment_type')) points.push(`The kind of harassment: ${slot(state, 'harassment_type')!.toLowerCase()}.`);
    if (slot(state, 'reported_to_hr')) points.push(`Whether you reported it: ${slot(state, 'reported_to_hr')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_harassment')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_harassment')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can guide you on internal complaints, human rights filings, and any related claims.',
    };
  }

  if (t === 'wage_recovery') {
    const intro = 'You are owed wages, overtime, or other pay and want a lawyer to help you recover them.';
    if (slot(state, 'wages_type')) points.push(`Type of pay owed: ${slot(state, 'wages_type')!.toLowerCase()}.`);
    if (slot(state, 'wages_owed_band')) points.push(`Amount owed: ${slot(state, 'wages_owed_band')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_wage_recovery')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_wage_recovery')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can pursue payment through Employment Standards or court, depending on the amount and the path that fits.',
    };
  }

  if (t === 'employment_contract_review') {
    const intro = 'You have an employment contract you want a lawyer to review before you commit.';
    if (slot(state, 'contract_review_type')) points.push(`Type of contract: ${slot(state, 'contract_review_type')!.toLowerCase()}.`);
    if (slot(state, 'contract_review_timeline')) points.push(`How soon you need it reviewed: ${slot(state, 'contract_review_timeline')!.toLowerCase()}.`);
    if (slot(state, 'contract_review_concerns')) points.push(`Specific concern: ${slot(state, 'contract_review_concerns')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_contract_review')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_contract_review')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can flag enforceability issues with termination clauses, non-competes, and bonus or commission terms.',
    };
  }

  // ─── ESTATES — sub-types (Phase A/B) ───────────────────────────────

  if (t === 'will_drafting') {
    // Recap composition (2026-06-07): match the matter-aware question order.
    // Order mirrors MATTER_SPECIFIC_SLOT_ORDER: existing_will_status,
    // marital_status, children_count, estate_complexity, desired_outcome.
    const intro = 'You want a lawyer to help you put a will in place.';
    const existingWill = slot(state, 'existing_will_status');
    if (existingWill) {
      const v = existingWill.toLowerCase();
      if (v.includes('never had')) points.push('This appears to be your first will.');
      else if (v.includes('outdated')) points.push('You already have a will, and it needs to be updated.');
      else if (v.includes('just needs an update')) points.push('You have a will and want to update it.');
      else points.push(`Existing will status: ${v}.`);
    }
    if (slot(state, 'marital_status')) points.push(`Marital status: ${slot(state, 'marital_status')!.toLowerCase()}.`);
    if (slot(state, 'children_count')) {
      const v = slot(state, 'children_count')!.toLowerCase();
      points.push(v === 'none' ? 'No children or dependants to provide for.' : `Children or dependants: ${v}.`);
    }
    if (slot(state, 'estate_complexity')) points.push(`Estate complexity: ${slot(state, 'estate_complexity')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_will_drafting')) points.push(`What you want in place: ${slot(state, 'desired_outcome_will_drafting')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can draft a will that reflects your wishes and meets the formal requirements that keep it from being challenged.',
    };
  }

  if (t === 'power_of_attorney') {
    const intro = 'You want a lawyer to help you put a power of attorney in place.';
    if (slot(state, 'poa_type')) points.push(`Type of power of attorney: ${slot(state, 'poa_type')!.toLowerCase()}.`);
    if (slot(state, 'poa_existing_documents')) points.push(`Existing documents: ${slot(state, 'poa_existing_documents')!.toLowerCase()}.`);
    if (slot(state, 'poa_urgency')) points.push(`What prompted this now: ${slot(state, 'poa_urgency')!.toLowerCase()}.`);
    if (slot(state, 'marital_status')) points.push(`Marital status: ${slot(state, 'marital_status')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can prepare a power of attorney that fits your situation and runs cleanly when it is needed.',
    };
  }

  if (t === 'probate') {
    const intro = 'You are dealing with an estate that may need to go through probate, and you want a lawyer to guide the process.';
    if (slot(state, 'will_status_probate')) points.push(`Will status: ${slot(state, 'will_status_probate')!.toLowerCase()}.`);
    if (slot(state, 'relationship_to_deceased')) points.push(`Your relationship to the person who passed: ${slot(state, 'relationship_to_deceased')!.toLowerCase()}.`);
    if (slot(state, 'executor_role')) points.push(`Your role in the estate: ${slot(state, 'executor_role')!.toLowerCase()}.`);
    if (slot(state, 'estate_value_band')) points.push(`Approximate estate value: ${slot(state, 'estate_value_band')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can prepare the application, work with the court, and help you administer the estate without missteps.',
    };
  }

  if (t === 'estate_dispute') {
    const intro = 'You are in a dispute over an estate or a will, and you want a lawyer to assess your position.';
    if (slot(state, 'estate_dispute_role')) points.push(`Your role in the dispute: ${slot(state, 'estate_dispute_role')!.toLowerCase()}.`);
    if (slot(state, 'estate_dispute_type')) points.push(`The dispute is about: ${slot(state, 'estate_dispute_type')!.toLowerCase()}.`);
    if (slot(state, 'estate_court_status')) points.push(`Court status: ${slot(state, 'estate_court_status')!.toLowerCase()}.`);
    if (slot(state, 'estate_value_band')) points.push(`Approximate estate value: ${slot(state, 'estate_value_band')!.toLowerCase()}.`);
    if (slot(state, 'desired_outcome_estate_dispute')) points.push(`What you hope to achieve: ${slot(state, 'desired_outcome_estate_dispute')!.toLowerCase()}.`);
    return {
      intro,
      points,
      closing: 'A lawyer can review the will, the estate, and the issue, and advise on the strongest way to protect what you are owed.',
    };
  }

  // ─── Combined catch-all for employment_general + estates_general ───

  if (t === 'employment_general' || t === 'estates_general') {
    const family = t === 'employment_general' ? 'employment' : 'wills or estates';
    return {
      intro: `From what you described, this looks like ${t === 'employment_general' ? 'an' : 'a'} ${family} matter, but we need a bit more to know exactly which kind.`,
      points: [],
      closing: 'The firm will review the description and follow up to confirm what you need.',
    };
  }

  return {
    intro: 'Thank you. Here is what we understood from your description.',
    points: [],
    closing: 'A team member will review and follow up.',
  };
}

// ─── i18n path (state.language !== 'en') ─────────────────────────────────
// Bundle lookups for intro, closing, Pattern C strings, and Pattern A/B
// labels. Values (canonical slot content) remain in English throughout.
// Falls back to hardcoded English strings when a bundle key is absent.

function buildLeadSummaryI18n(state: EngineState, i18n: I18nBundle): LeadSummary {
  const t = state.matter_type;
  const points: string[] = [];
  const sm: Record<string, string> = (i18n.summary ?? {})[t] ?? {};
  const sl: Record<string, string> = i18n.summary_labels ?? {};

  // ss: summary string. i18n.summary[matterType][key] with English fallback.
  const ss = (key: string, fallback: string): string => sm[key] || fallback;
  // lb: label. i18n.summary_labels[key] with English fallback.
  const lb = (key: string, fallback: string): string => sl[key] || fallback;
  // pt: Pattern A/B labeled point. Translated label, canonical value, trailing period.
  const pt = (labelKey: string, labelEn: string, value: string): string =>
    `${lb(labelKey, labelEn)}: ${value}.`;
  // tv: translate a slot's English value via i18n.slot_options for recap
  // rendering (DRG WhatsApp PT smoke test follow-up, 2026-06-08). The
  // canonical stored value stays English in state.slots; this only
  // affects the display in the recap card. Falls back to the English
  // value when no translation exists, so out-of-scope matter types
  // continue to render today's English values.
  const tv = (slotId: string, englishValue: string): string =>
    i18n.slot_options?.[slotId]?.[englishValue] || englishValue;

  if (t === 'out_of_scope') {
    const areaLabels: Record<string, string> = {
      family: 'family law',
      immigration: 'immigration',
      employment: 'employment',
      criminal: 'criminal',
      personal_injury: 'personal injury',
      estates: 'wills and estates',
    };
    const area = areaLabels[state.practice_area] ?? 'this area';
    const prefix = ss('intro_prefix', 'From what you described, this looks like a');
    const suffix = ss('intro_suffix', 'matter.');
    return {
      intro: `${prefix} ${area} ${suffix}`,
      points: [],
      closing: ss('closing', 'A team member will review and respond directly. The firm does not yet handle this area on its own, but they will tell you whether they can help or refer you to someone who can.'),
    };
  }

  if (t === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    let intro = ss('intro_default', 'You are looking at setting up a business and want a lawyer to help you do it the right way.');
    if (sub === 'partner_setup') intro = ss('intro_partner_setup', 'You are starting a business with one or more partners and want a lawyer to help you set it up correctly.');
    else if (sub === 'solo_setup') intro = ss('intro_solo_setup', 'You are starting a business on your own and want a lawyer to help you set it up correctly.');
    else if (sub === 'buy_in_or_joining') intro = ss('intro_buy_in', 'You are buying into or joining an existing business and want a lawyer to review the documents and protect your position.');

    const activity = slot(state, 'business_activity_type');
    if (activity) points.push(pt('what_you_do', 'What you do', tv('business_activity_type', activity).toLowerCase()));
    const stage = slot(state, 'business_stage');
    if (stage) points.push(pt('where_you_are', 'Where you are', tv('business_stage', stage).toLowerCase()));
    const location = slot(state, 'business_location');
    if (location) points.push(pt('business_location', 'Where the business will be based', location));
    const revenue = slot(state, 'revenue_expectation');
    if (revenue) points.push(pt('revenue_expectation', 'Revenue you expect in year one', tv('revenue_expectation', revenue).toLowerCase()));
    const employees = slot(state, 'employees_planned');
    if (employees && employees !== 'No, just me') points.push(pt('hiring_plans', 'Hiring plans', tv('employees_planned', employees).toLowerCase()));
    const regulated = slot(state, 'regulated_industry');
    if (regulated && regulated.startsWith('Yes')) points.push(pt('regulated_area', 'Regulated area', tv('regulated_industry', regulated).replace(/^Yes,\s*/i, '').replace(/^Sim,\s*/i, '')));
    const crossBorder = slot(state, 'cross_border_work');
    if (crossBorder && crossBorder !== 'No, Canada only' && crossBorder !== 'Not sure yet') points.push(pt('clients_outside_canada', 'Clients outside Canada', tv('cross_border_work', crossBorder).toLowerCase()));
    const ip = slot(state, 'ip_planned');
    if (ip && ip !== 'No, services only' && ip !== 'Not sure') points.push(pt('ip_protection', 'Brand or intellectual property to protect', tv('ip_planned', ip).replace(/^Yes,\s*/i, '').replace(/^Sim,\s*/i, '')));

    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can help you choose the right structure, document ownership clearly, and put the agreements in place that prevent avoidable problems later.'),
    };
  }

  if (t === 'shareholder_dispute') {
    // Pattern C ×4: full strings translated from bundle
    const intro = ss('intro', 'You are in a dispute with a business partner or fellow shareholder, and you want a lawyer to help you protect your position.');
    if (slot(state, 'corporate_records_available') === 'No') points.push(ss('no_records_access', 'You cannot access the company records or accounts.'));
    if (slot(state, 'management_exclusion') === 'Yes') points.push(ss('management_excluded', 'You are being kept out of decisions that affect the business.'));
    if (slot(state, 'dividend_or_money_issue') === 'Yes') points.push(ss('money_concern', 'You are concerned about money being taken from the company.'));
    const proof = slot(state, 'proof_of_ownership') ?? slot(state, 'shareholder_agreement');
    if (proof === 'Yes') points.push(ss('has_ownership_docs', 'You have documentation of your ownership.'));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review your situation, demand access to the records you are entitled to, and pursue a remedy under shareholder protection laws.'),
    };
  }

  if (t === 'unpaid_invoice') {
    const intro = ss('intro', 'You are owed money for work, goods, or services and you are not getting paid.');
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(pt('amount_owed', 'Amount owed', amount));
    // Pattern C ×2
    if (slot(state, 'invoice_exists') === 'Yes') points.push(ss('has_invoice', 'You have an invoice or written record of the amount.'));
    if (slot(state, 'proof_of_performance') === 'Yes') points.push(ss('has_proof_of_performance', 'You can show the work or goods were delivered.'));
    if (slot(state, 'dispute_reason')) points.push(pt('the_other_side_is', 'The other side is', slot(state, 'dispute_reason')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can send a demand, file a claim, or negotiate a settlement to recover what you are owed.'),
    };
  }

  if (t === 'contract_dispute') {
    const intro = ss('intro', 'You have a dispute over an agreement that has not been honoured.');
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(pt('value_of_dispute', 'Value of the dispute', amount));
    // Pattern C ×1
    if (slot(state, 'written_terms') === 'Yes' || slot(state, 'contract_exists') === 'Yes') points.push(ss('has_written_agreement', 'You have the agreement in writing.'));
    if (slot(state, 'dispute_reason')) points.push(pt('the_dispute_is', 'The dispute is', slot(state, 'dispute_reason')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the agreement, assess your position, and pursue resolution by negotiation or court action.'),
    };
  }

  if (t === 'vendor_supplier_dispute') {
    const intro = ss('intro', 'You are in a billing dispute with a vendor or supplier.');
    const amount = slot(state, 'amount_at_stake');
    if (amount) points.push(pt('amount_in_dispute', 'Amount in dispute', amount));
    if (slot(state, 'billing_dispute_reason')) points.push(pt('what_happened', 'What happened', slot(state, 'billing_dispute_reason')!.toLowerCase()));
    if (slot(state, 'vendor_contract_exists')) points.push(pt('agreement', 'Agreement', slot(state, 'vendor_contract_exists')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the terms, assess the overcharge or non-delivery, and advise on recovery.'),
    };
  }

  if (t === 'corporate_money_control') {
    const intro = ss('intro', 'You have concerns about financial irregularities inside a company.');
    if (slot(state, 'reporter_role_money')) points.push(pt('your_role', 'Your role', slot(state, 'reporter_role_money')!.toLowerCase()));
    if (slot(state, 'irregularity_type')) points.push(pt('what_observed', 'What you have observed', slot(state, 'irregularity_type')!.toLowerCase()));
    if (slot(state, 'irregularity_amount')) points.push(pt('amount_involved', 'Amount involved', slot(state, 'irregularity_amount')!));
    // Pattern C ×3
    if (slot(state, 'evidence_of_irregularity') === 'Yes') points.push(ss('has_full_evidence', 'You have documented evidence.'));
    else if (slot(state, 'evidence_of_irregularity') === 'Some, but not enough') points.push(ss('has_partial_evidence', 'You have some evidence but not the full picture.'));
    if (slot(state, 'reported_to_anyone') === 'No, not yet') points.push(ss('not_reported', 'You have not reported this to anyone yet.'));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can help you understand your duties, protect the company, and advise on civil or criminal action where appropriate.'),
    };
  }

  if (t === 'commercial_real_estate') {
    const intro = ss('intro', 'You are involved in a commercial real estate transaction and want a lawyer to protect your position.');
    if (slot(state, 'commercial_re_role')) points.push(pt('your_role', 'Your role', slot(state, 'commercial_re_role')!.toLowerCase()));
    if (slot(state, 'commercial_property_type')) points.push(pt('property', 'Property', slot(state, 'commercial_property_type')!.toLowerCase()));
    if (slot(state, 'commercial_re_amount')) points.push(pt('approximate_value', 'Approximate value', slot(state, 'commercial_re_amount')!));
    if (slot(state, 'commercial_re_stage')) points.push(pt('where_you_are', 'Where you are', slot(state, 'commercial_re_stage')!.toLowerCase()));
    if (slot(state, 'commercial_re_concerns') && slot(state, 'commercial_re_concerns') !== 'Not sure yet') points.push(pt('main_concern', 'Main concern', slot(state, 'commercial_re_concerns')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the agreement, surface title or zoning risks, and protect your position before closing.'),
    };
  }

  if (t === 'residential_purchase_sale') {
    const role = slot(state, 'residential_role');
    let intro = ss('intro_default', 'You are involved in a residential property transaction and want a lawyer to handle it properly.');
    if (role === 'Buying') intro = ss('intro_buying', 'You are buying a home and want a lawyer to handle the closing properly.');
    else if (role === 'Selling') intro = ss('intro_selling', 'You are selling a home and want a lawyer to handle the closing properly.');
    else if (role === 'Both (buying and selling)') intro = ss('intro_both', 'You are both buying and selling a home and want a lawyer to handle both closings.');
    if (slot(state, 'residential_property_type')) points.push(pt('property_type', 'Property type', slot(state, 'residential_property_type')!.toLowerCase()));
    if (slot(state, 'residential_re_amount')) points.push(pt('approximate_price', 'Approximate price', slot(state, 'residential_re_amount')!));
    if (slot(state, 'residential_re_stage')) points.push(pt('where_you_are', 'Where you are', slot(state, 'residential_re_stage')!.toLowerCase()));
    if (slot(state, 'residential_closing_timeline')) points.push(pt('closing_timing', 'Closing timing', slot(state, 'residential_closing_timeline')!.toLowerCase()));
    if (slot(state, 'residential_re_concern')) points.push(pt('main_need', 'Main need', slot(state, 'residential_re_concern')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the agreement, handle the closing, and resolve issues that come up before keys change hands.'),
    };
  }

  if (t === 'real_estate_litigation') {
    const intro = ss('intro', 'You are in a real estate dispute and want a lawyer to help you assess your options.');
    if (slot(state, 'litigation_subject')) points.push(pt('dispute_about', 'The dispute is about', slot(state, 'litigation_subject')!.toLowerCase()));
    if (slot(state, 'litigation_role')) points.push(pt('your_role', 'Your role', slot(state, 'litigation_role')!.toLowerCase()));
    if (slot(state, 'litigation_amount')) points.push(pt('roughly_at_stake', 'Roughly at stake', slot(state, 'litigation_amount')!));
    if (slot(state, 'litigation_documents')) points.push(pt('written_agreement', 'Written agreement', slot(state, 'litigation_documents')!.toLowerCase()));
    if (slot(state, 'litigation_stage')) points.push(pt('court_status', 'Court status', slot(state, 'litigation_stage')!.toLowerCase()));
    if (slot(state, 'litigation_when_event')) points.push(pt('when_this_happened', 'When this happened', slot(state, 'litigation_when_event')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the contract and history, assess your position, and advise on recovery of the deposit, the deal, or damages.'),
    };
  }

  if (t === 'landlord_tenant') {
    const party = slot(state, 'tenancy_party');
    let intro = ss('intro_default', 'You have a tenancy dispute and want a lawyer to help you resolve it.');
    if (party === 'Landlord') intro = ss('intro_landlord', 'You are a landlord with a tenancy dispute.');
    else if (party === 'Tenant') intro = ss('intro_tenant', 'You are a tenant with a dispute against your landlord.');
    if (slot(state, 'tenancy_type')) points.push(pt('tenancy_type', 'Tenancy type', slot(state, 'tenancy_type')!.toLowerCase()));
    if (slot(state, 'tenancy_issue')) points.push(pt('the_issue', 'The issue', slot(state, 'tenancy_issue')!.toLowerCase()));
    if (slot(state, 'tenancy_amount')) points.push(pt('amount_involved', 'Amount involved', slot(state, 'tenancy_amount')!));
    if (slot(state, 'tenancy_lease_exists')) points.push(pt('lease', 'Lease', slot(state, 'tenancy_lease_exists')!.toLowerCase()));
    if (slot(state, 'tenancy_notice_status')) points.push(pt('notices_or_applications', 'Notices or applications', slot(state, 'tenancy_notice_status')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the lease, advise on the dispute, and represent you at the LTB or in court depending on the tenancy.'),
    };
  }

  if (t === 'construction_lien') {
    const intro = ss('intro', 'You have done construction or renovation work and you are owed money for it.');
    if (slot(state, 'lien_role')) points.push(pt('your_role', 'Your role', slot(state, 'lien_role')!.toLowerCase()));
    if (slot(state, 'lien_amount')) points.push(pt('amount_owed', 'Amount owed', slot(state, 'lien_amount')!));
    if (slot(state, 'lien_last_supply')) points.push(pt('last_work_supplied', 'Last work or materials supplied', slot(state, 'lien_last_supply')!.toLowerCase()));
    if (slot(state, 'lien_preserved')) points.push(pt('lien_status', 'Lien status', slot(state, 'lien_preserved')!.toLowerCase()));
    if (slot(state, 'lien_documents')) points.push(pt('paperwork', 'Paperwork', slot(state, 'lien_documents')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'Construction Act timelines are tight, so a lawyer can act quickly to register a claim against the property and pursue what you are owed.'),
    };
  }

  if (t === 'preconstruction_condo') {
    const intro = ss('intro', 'You have a pre-construction condo matter and want a lawyer to help you protect your position.');
    if (slot(state, 'precon_role')) points.push(pt('your_role', 'Your role', slot(state, 'precon_role')!.toLowerCase()));
    if (slot(state, 'precon_issue')) points.push(pt('the_issue', 'The issue', slot(state, 'precon_issue')!.toLowerCase()));
    if (slot(state, 'precon_amount')) points.push(pt('amount_at_stake', 'Amount at stake', slot(state, 'precon_amount')!));
    if (slot(state, 'precon_developer_status')) points.push(pt('how_developer_responding', 'How the developer is responding', slot(state, 'precon_developer_status')!.toLowerCase()));
    if (slot(state, 'precon_documents')) points.push(pt('builder_agreement', 'Builder agreement', slot(state, 'precon_documents')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the builder agreement, assess Tarion remedies, and advise on deposits, delayed closing, or assignments.'),
    };
  }

  if (t === 'mortgage_dispute') {
    const intro = ss('intro', 'You have a mortgage matter and want a lawyer to help you understand your rights and options.');
    if (slot(state, 'mortgage_role')) points.push(pt('your_role', 'Your role', slot(state, 'mortgage_role')!.toLowerCase()));
    if (slot(state, 'mortgage_status')) points.push(pt('where_things_stand', 'Where things stand', slot(state, 'mortgage_status')!.toLowerCase()));
    if (slot(state, 'mortgage_amount')) points.push(pt('approximate_balance', 'Approximate balance or amount in dispute', slot(state, 'mortgage_amount')!));
    if (slot(state, 'mortgage_lender_type')) points.push(pt('lender', 'Lender', slot(state, 'mortgage_lender_type')!.toLowerCase()));
    if (slot(state, 'mortgage_documents')) points.push(pt('documents_in_hand', 'Documents in hand', slot(state, 'mortgage_documents')!.toLowerCase()));
    return {
      intro,
      points,
      closing: ss('closing', 'A lawyer can review the lender notices, advise on your rights, and intervene to protect the property where possible.'),
    };
  }

  if (t === 'corporate_general' || t === 'real_estate_general') {
    const cgSm: Record<string, string> = (i18n.summary ?? {})['corporate_general'] ?? {};
    return {
      intro: cgSm['intro'] || 'From what you described, this looks like a corporate or real estate matter, but we need a bit more to know exactly which kind.',
      points: [],
      closing: cgSm['closing'] || 'The firm will review the description and follow up to confirm what you need.',
    };
  }

  const defSm: Record<string, string> = (i18n.summary ?? {})['default'] ?? {};
  return {
    intro: defSm['intro'] || 'Thank you. Here is what we understood from your description.',
    points: [],
    closing: defSm['closing'] || 'A team member will review and follow up.',
  };
}

// ─── Stop conditions ───────────────────────────────────────────────────────

function readyToStop(state: EngineState, band: Band, completeness: number): boolean {
  // Channel-aware fast path: SMS (and any other budgeted channel) bails
  // to "ready" once the question budget is hit AND insight has been
  // presented. Brief depth degrades, completion rate goes way up.
  if (overChannelBudget(state) && state.insightShown) return true;
  if (band === 'A' && completeness >= BAND_A_COMPLETENESS && state.insightShown) return true;
  const gap = getDecisionGap(state);
  if (gap === 'none' && completeness >= INSIGHT_THRESHOLD_COMPLETENESS && state.insightShown) return true;
  return false;
}

// ─── Insight trigger ──────────────────────────────────────────────────────

function shouldPresentInsight(
  state: EngineState,
  band: Band,
  completeness: number,
  gap: string,
): boolean {
  if (state.contactCaptureStarted) return false;
  // Channel-aware fast path: SMS (and any other budgeted channel) presents
  // insight once the question budget is hit, regardless of completeness.
  // Completing a thin brief beats abandoning a deep one.
  if (overChannelBudget(state)) return true;
  // Default: bridge only fires when the gap chain is fully resolved AND the
  // brief is deep enough to justify a callback.
  if (gap === 'none' && completeness >= INSIGHT_THRESHOLD_COMPLETENESS) return true;
  if (band === 'A' && gap === 'none' && completeness >= BAND_A_COMPLETENESS) return true;
  return false;
}

// ─── Main control ─────────────────────────────────────────────────────────

export function getNextStep(state: EngineState): NextStep {
  const bandResult = computeBand(state);
  const completeness = computeCoreCompleteness(state);
  const gap = getDecisionGap(state);
  const channel = state.channel ?? 'web';

  // Out-of-scope: stop immediately with a polite message; lead still goes to the firm
  if (state.matter_type === 'out_of_scope') {
    return {
      type: 'stop',
      message: 'Lead captured. Forwarded to the firm.',
      bridgeText: getBridgeText(state),
      closingMessage: buildClosingMessage(state),
    };
  }

  if (state.contactCaptureStarted) {
    // Contact-doctrine gate (DR-038): a complete lead is name + (email OR
    // phone). The branch below mirrors that contract instead of demanding
    // all three contact slots. The pre-2026-06-08 version of this block
    // returned capture_contact whenever ANY of {name, phone, email} was
    // empty, which collapsed every non-web channel that pre-fills a
    // subset of contact (WhatsApp: name+phone, Messenger/IG: name only,
    // voice: phone only). On resume turns those channels were dropping
    // into capture_contact, which the channel processor's Phase C does
    // not treat as ask-another, so the engine fell through to finalize
    // after a single discovery question. evaluateContactGate is the
    // doctrine; this branch must agree with it.
    //
    // Weak-name treatment (2026-06-08): a profile-metadata-derived name
    // (WhatsApp profile, Messenger first+last, IG display name, voice
    // caller_name) counts as identity only when the captured value
    // passes the isWeakName heuristic. A weak profile name like "A D"
    // or "User 1234" triggers a name-capture step so the lead types a
    // real name in the thread instead of the brief overclaiming
    // identity. Phone seeded the same way stays answered because
    // phone is reachability, not identity (the carrier verified the
    // number; the profile system did not verify the display name).
    const nameValue = state.slots['client_name'];
    const nameMeta = state.slot_meta['client_name'];
    const weakProfileName =
      nameMeta?.source === 'profile_metadata' &&
      isWeakName(typeof nameValue === 'string' ? nameValue : null);
    const hasName = !!nameValue && !weakProfileName;
    const hasReachable = !!state.slots['client_phone'] || !!state.slots['client_email'];
    if (!hasName) {
      const realSlot = SLOT_REGISTRY.find(s => s.id === 'client_name');
      if (realSlot) return { type: 'capture_contact', slot: realSlot };
    }
    if (!hasReachable) {
      const realSlot = SLOT_REGISTRY.find(s => s.id === 'client_email');
      if (realSlot) return { type: 'capture_contact', slot: realSlot };
    }
    // Name + reachable both satisfied.
    //
    // Web: the SPA's contact form was the terminal step; return stop so
    // the done page renders next.
    //
    // Non-web channels (WhatsApp, Messenger, Instagram, GBP, SMS): contact
    // pre-fill from sender metadata (DR-023) can satisfy this block on
    // turn 1 before any discovery slot is asked. Fall through so the
    // regular flow can keep offering high-priority slots while the
    // channel budget allows.
    if (channel === 'web') {
      return {
        type: 'stop',
        message: 'All details captured. Report is ready.',
        closingMessage: buildClosingMessage(state),
      };
    }
    // Fall through.
  }

  if (readyToStop(state, bandResult.band, completeness)) {
    return {
      type: 'stop',
      message: 'Qualification complete.',
      bridgeText: getBridgeText(state),
      closingMessage: buildClosingMessage(state),
    };
  }

  if (!state.insightShown && shouldPresentInsight(state, bandResult.band, completeness, gap)) {
    return { type: 'present_insight', bridgeText: getBridgeText(state) };
  }

  if (state.insightShown) {
    const next = selectNextSlot(state);
    if (!next || gap === 'none') {
      return {
        type: 'stop',
        message: 'Qualification complete.',
        bridgeText: getBridgeText(state),
        closingMessage: buildClosingMessage(state),
      };
    }
    if (bandResult.band === 'A' && next.tier === 'strategic') return { type: 'deepen', slot: next };
    return { type: 'continue', slot: next };
  }

  if (state.matter_type === 'unknown') {
    return {
      type: 'clarify',
      message: "To route this correctly, could you tell me a bit more about what's happening? A few examples of the buckets we handle: starting a business, partner dispute, contract issue, money owed, real estate matter.",
    };
  }

  const next = selectNextSlot(state);
  if (!next) {
    return { type: 'present_insight', bridgeText: getBridgeText(state) };
  }

  if (bandResult.band === 'A' && next.tier === 'proof' && !state.insightShown) return { type: 'recover', slot: next };

  return { type: 'continue', slot: next };
}

// ─── State mutation helpers ───────────────────────────────────────────────

export function applyAnswer(state: EngineState, slotId: string, value: string): EngineState {
  let updated: EngineState = {
    ...state,
    slots: { ...state.slots, [slotId]: value },
    slot_meta: {
      ...state.slot_meta,
      [slotId]: { source: 'answered', confidence: 1.0 },
    },
    questionHistory: [...state.questionHistory, slotId],
  };

  const slot = SLOT_REGISTRY.find(s => s.id === slotId);
  if (slot && !updated.answeredQuestionGroups.includes(slot.question_group)) {
    updated = { ...updated, answeredQuestionGroups: [...updated.answeredQuestionGroups, slot.question_group] };
  }

  // Re-derive advisory subtrack. decision_authority added 2026-06-07 as a
  // tertiary trigger so files that never get co_owner_count asked (e.g.
  // budget-constrained channels, or LLM extraction paths that skip it)
  // still pick up partner / solo signal from the universal-readiness slot.
  if (
    state.matter_type === 'business_setup_advisory' &&
    (slotId === 'advisory_path' ||
      slotId === 'co_owner_count' ||
      slotId === 'decision_authority')
  ) {
    updated = { ...updated, advisory_subtrack: updateAdvisorySubtrack(updated) };
  }

  // Auto-populate advisory_specific_task from advisory_concern
  if (slotId === 'advisory_concern') {
    updated = deriveAdvisorySpecificTask(updated);
  }

  // Reroute corporate_general when problem type is answered
  if (slotId === 'corporate_problem_type') {
    updated = rerouteFromCorporateGeneral(updated, value);
  }

  // Reroute real_estate_general when problem type is answered
  if (slotId === 'real_estate_problem_type') {
    updated = rerouteFromRealEstateGeneral(updated, value);
  }

  // Reroute employment_general when problem type is answered (DR-069
  // parity, 2026-06-11: these two lanes previously had NO deterministic
  // reroute, so a chip answer to the routing question never routed)
  if (slotId === 'employment_problem_type') {
    updated = rerouteFromEmploymentGeneral(updated, value);
  }

  // Reroute estates_general when problem type is answered
  if (slotId === 'estates_problem_type') {
    updated = rerouteFromEstatesGeneral(updated, value);
  }

  // Recompute completeness, band, gap
  updated = { ...updated, coreCompleteness: computeCoreCompleteness(updated) };
  const bandResult = computeBand(updated);
  updated = {
    ...updated,
    band: bandResult.band,
    confidence: bandResult.confidence,
    currentGap: getDecisionGap(updated),
  };

  return updated;
}

export function markInsightShown(state: EngineState): EngineState {
  return { ...state, insightShown: true };
}

export function startContactCapture(state: EngineState): EngineState {
  return { ...state, contactCaptureStarted: true };
}
