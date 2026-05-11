import type { EngineState, Band, BandResult, FourAxisScores, AxisReasoning, AxisBreakdown } from './types';

// ─── Slot helpers ─────────────────────────────────────────────────────────

function slotValue(state: EngineState, slotId: string): string | null {
  return state.slots[slotId] ?? null;
}

function isAnswered(state: EngineState, slotId: string): boolean {
  const meta = state.slot_meta[slotId];
  return !!meta && (meta.source === 'explicit' || meta.source === 'answered');
}

const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));

// ─── VALUE axis (per matter type) ─────────────────────────────────────────

function scoreValue(state: EngineState): number {
  const t = state.matter_type;

  if (t === 'commercial_real_estate') {
    const a = slotValue(state, 'commercial_re_amount');
    if (a === 'Over $10M') return 10;
    if (a === '$2M–$10M') return 8;
    if (a === '$500,000–$2M') return 5;
    if (a === 'Under $500,000') return 4;
    return 4; // commercial classified but unknown amount: still meaningful
  }
  if (t === 'residential_purchase_sale') {
    // Residential is commodity work; value tops out lower
    const a = slotValue(state, 'residential_re_amount');
    const concern = slotValue(state, 'residential_re_concern');
    let base = 2;
    if (a === 'Over $2M') base = 5;
    else if (a === '$1M–$2M') base = 4;
    else if (a === '$500,000–$1M') base = 3;
    if (concern === 'Something has gone wrong at closing') base += 3; // litigation lane
    return clamp(base);
  }
  if (t === 'real_estate_litigation') {
    const a = slotValue(state, 'litigation_amount');
    let s = 3;
    if (a === 'Over $500,000') s = 10;
    else if (a === '$100,000–$500,000') s = 8;
    else if (a === '$25,000–$100,000') s = 5;
    else if (a === 'Under $25,000') s = 2;
    // Severity of the dispute lifts value
    const subj = slotValue(state, 'litigation_subject');
    if (subj === 'Real estate fraud' || subj === 'Seller hid problems or misrepresented the property') s += 3;
    else if (subj === 'The other side did not close the deal') s += 2;
    return clamp(s);
  }
  if (t === 'construction_lien') {
    const a = slotValue(state, 'lien_amount');
    if (a === 'Over $500,000') return 10;
    if (a === '$100,000–$500,000') return 8;
    if (a === '$25,000–$100,000') return 6;
    if (a === 'Under $25,000') return 3;
    return 4;
  }
  if (t === 'preconstruction_condo') {
    const a = slotValue(state, 'precon_amount');
    let s = 4;
    if (a === 'Over $200,000') s = 9;
    else if (a === '$50,000–$200,000') s = 7;
    else if (a === 'Under $50,000') s = 3;
    const issue = slotValue(state, 'precon_issue');
    if (issue === 'Builder hid problems or misrepresented the unit') s += 2;
    else if (issue === 'Builder keeps delaying closing' || issue === 'Worried about my deposit') s += 1;
    return clamp(s);
  }
  if (t === 'mortgage_dispute') {
    const a = slotValue(state, 'mortgage_amount');
    if (a === 'Over $5M') return 10;
    if (a === '$1M–$5M') return 8;
    if (a === '$250,000–$1M') return 6;
    if (a === 'Under $250,000') return 3;
    return 4;
  }
  if (t === 'landlord_tenant') {
    const tenancyType = slotValue(state, 'tenancy_type');
    const a = slotValue(state, 'tenancy_amount');
    if (tenancyType === 'Commercial (office, retail, industrial)') {
      if (a === 'Over $100,000') return 9;
      if (a === '$25,000–$100,000') return 8;
      if (a === '$5,000–$25,000') return 5;
      return 4;
    }
    // Residential tenancy: LTB jurisdiction, lower retainer-value ceiling
    if (a === 'Over $100,000' || a === '$25,000–$100,000') return 4;
    if (a === '$5,000–$25,000') return 3;
    return 2;
  }
  if (t === 'unpaid_invoice' || t === 'contract_dispute' || t === 'vendor_supplier_dispute') {
    const a = slotValue(state, 'amount_at_stake');
    if (a === 'Over $100,000') return 9;
    if (a === '$25,000–$100,000') return 7;
    if (a === '$5,000–$25,000') return 5;
    if (a === 'Under $5,000') return 2;
    return 3;
  }
  if (t === 'shareholder_dispute') {
    let s = 5; // base for shareholder dispute (always non-trivial; oppression remedy on the table)
    if (slotValue(state, 'dividend_or_money_issue') === 'Yes') s += 2;
    if (slotValue(state, 'company_profitable') === 'Yes') s += 1;
    if (slotValue(state, 'corporate_records_available') === 'No') s += 1; // access remedy
    if (slotValue(state, 'management_exclusion') === 'Yes') s += 1;
    if (isAnswered(state, 'proof_of_ownership') || isAnswered(state, 'shareholder_agreement')) s += 1;
    const ownership = slotValue(state, 'ownership_percentage');
    if (ownership === 'Majority' || ownership === '50/50' || ownership === 'Significant minority') s += 1;
    return clamp(s);
  }
  if (t === 'corporate_money_control') {
    const a = slotValue(state, 'irregularity_amount');
    if (a === 'Over $200,000') return 10;
    if (a === '$50,000–$200,000') return 8;
    if (a === '$10,000–$50,000') return 5;
    if (a === 'Under $10,000') return 2;
    return 4;
  }
  if (t === 'business_setup_advisory') {
    // No single "amount at stake"; use revenue + structural complexity proxies
    const sub = state.advisory_subtrack;
    const revenue = slotValue(state, 'revenue_expectation');
    let s = 3;
    if (revenue === 'Over $500,000 (early-stage business with momentum)') s = 7;
    else if (revenue === '$100,000–$500,000 (small team or busy practice)') s = 5;
    else if (revenue === '$30,000–$100,000 (full-time, sole operator)') s = 4;
    else if (revenue === 'Under $30,000 (small or part-time)') s = 2;
    if (sub === 'partner_setup') s += 2;
    if (sub === 'buy_in_or_joining') s += 2;
    return clamp(s);
  }
  if (t === 'corporate_general' || t === 'real_estate_general') return 3;
  return 0;
}

// ─── COMPLEXITY axis (per matter type) ────────────────────────────────────

function scoreComplexity(state: EngineState): number {
  const t = state.matter_type;
  let s = 0;

  if (t === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    if (sub === 'partner_setup') s += 2;
    if (sub === 'buy_in_or_joining') s += 3;
    const regulated = slotValue(state, 'regulated_industry');
    if (regulated && regulated.startsWith('Yes')) s += 2;
    const cb = slotValue(state, 'cross_border_work');
    if (cb === 'Mostly US clients' || cb === 'Mixed Canadian and foreign') s += 2;
    else if (cb === 'Mostly other international') s += 1;
    const ip = slotValue(state, 'ip_planned');
    if (ip === 'Yes, multiple types of IP') s += 2;
    else if (ip === 'Yes, software, code, or formulas') s += 1;
    const employees = slotValue(state, 'employees_planned');
    if (employees === 'Yes, three or more employees') s += 1;
    if (slotValue(state, 'signed_anything') === 'Yes') s += 1;
    return clamp(s);
  }
  if (t === 'commercial_real_estate') {
    const propType = slotValue(state, 'commercial_property_type');
    if (propType === 'Land / development site') s += 3;
    if (propType === 'Multi-residential / apartment building') s += 2;
    if (propType === 'Mixed-use') s += 2;
    if (propType === 'Industrial / warehouse') s += 1;
    if (slotValue(state, 'commercial_re_concerns') === 'Environmental concern') s += 3;
    if (slotValue(state, 'commercial_re_concerns') === 'Title or zoning concern') s += 2;
    return clamp(s);
  }
  if (t === 'residential_purchase_sale') {
    if (slotValue(state, 'residential_re_concern') === 'Something has gone wrong at closing') s += 4;
    if (slotValue(state, 'residential_mortgage_situation') === 'Private or alternative lender') s += 1;
    return clamp(s);
  }
  if (t === 'real_estate_litigation') {
    const subj = slotValue(state, 'litigation_subject');
    if (subj === 'Real estate fraud' || subj === 'Title or boundary problem') s += 3;
    if (subj === 'Disagreement over use of land (easement)') s += 2;
    if (slotValue(state, 'litigation_documents') !== 'Yes') s += 2;
    if (slotValue(state, 'litigation_settlement_attempted') === 'Mediation attempted, did not resolve') s += 1;
    if (slotValue(state, 'litigation_stage') === 'Already in court (we filed)' ||
        slotValue(state, 'litigation_stage') === 'Already in court (we were served)') s += 2;
    return clamp(s);
  }
  if (t === 'construction_lien') {
    const role = slotValue(state, 'lien_role');
    if (role === 'Subcontractor or trade' || role === 'Supplier of materials') s += 1;
    if (slotValue(state, 'lien_documents') === 'It was a verbal agreement') s += 3;
    if (slotValue(state, 'lien_documents') === 'Some paperwork, not all') s += 1;
    return clamp(s);
  }
  if (t === 'preconstruction_condo') {
    if (slotValue(state, 'precon_role') === 'I am taking over a unit from someone else' ||
        slotValue(state, 'precon_role') === 'I am selling my unit before closing') s += 2;
    if (slotValue(state, 'precon_documents') !== 'Yes') s += 2;
    return clamp(s);
  }
  if (t === 'mortgage_dispute') {
    if (slotValue(state, 'mortgage_lender_type') === 'A private lender') s += 1;
    if (slotValue(state, 'mortgage_documents') !== 'Yes') s += 2;
    return clamp(s);
  }
  if (t === 'landlord_tenant') {
    if (slotValue(state, 'tenancy_type') === 'Commercial (office, retail, industrial)') s += 1;
    if (slotValue(state, 'tenancy_lease_exists') === 'Verbal only') s += 2;
    return clamp(s);
  }
  if (t === 'unpaid_invoice' || t === 'contract_dispute') {
    if (slotValue(state, 'dispute_reason') === 'Says work was not done properly') s += 2;
    if (!isAnswered(state, 'written_terms') && !isAnswered(state, 'contract_exists')) s += 2;
    return clamp(s);
  }
  if (t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'vendor_contract_exists') === 'No formal agreement') s += 2;
    return clamp(s);
  }
  if (t === 'shareholder_dispute') {
    if (slotValue(state, 'corporate_records_available') === 'No' ||
        slotValue(state, 'management_exclusion') === 'Yes') s += 1;
    if (!isAnswered(state, 'proof_of_ownership') && !isAnswered(state, 'shareholder_agreement')) s += 2;
    return clamp(s);
  }
  if (t === 'corporate_money_control') {
    const irreg = slotValue(state, 'irregularity_type');
    if (irreg === 'Fraudulent or inflated invoices' ||
        irreg === 'Unauthorized payments or transfers') s += 2;
    if (slotValue(state, 'evidence_of_irregularity') === 'Not sure' ||
        slotValue(state, 'evidence_of_irregularity') === 'No') s += 2;
    return clamp(s);
  }
  return 0;
}

// ─── URGENCY axis ─────────────────────────────────────────────────────────

function scoreUrgency(state: EngineState): number {
  let s = 0;
  if (state.raw.mentions_urgency) s += 3;

  // Matter-specific deadline signals
  const t = state.matter_type;

  if (t === 'business_setup_advisory') {
    if (slotValue(state, 'signed_anything') === 'Yes') s += 3;
    const stage = slotValue(state, 'business_stage');
    if (stage === 'Already operating') s += 4; // operating without structure = exposure accumulating now
    if (stage === 'Need to incorporate before launching') s += 3;
    const timing = slotValue(state, 'advisory_timing');
    if (timing === 'Urgent') s += 4;
    if (timing === 'This week') s += 3;
  }

  if (t === 'residential_purchase_sale') {
    const closing = slotValue(state, 'residential_closing_timeline');
    if (closing === 'This week') s += 7;
    if (closing === 'Less than 30 days away') s += 5;
    if (closing === '30 to 60 days away') s += 3;
    if (closing === 'Already passed (closing was missed)') s += 8;
    if (slotValue(state, 'residential_re_concern') === 'Something has gone wrong at closing') s += 7;
  }

  if (t === 'commercial_real_estate') {
    const stage = slotValue(state, 'commercial_re_stage');
    if (stage === 'Closing date set') s += 4;
    if (stage === 'Conditions still to clear') s += 3;
    if (stage === 'Signed an offer or letter of intent') s += 2;
  }

  if (t === 'construction_lien') {
    const supply = slotValue(state, 'lien_last_supply');
    if (supply === 'Within the last 60 days') s += 5; // preservation window open and closing
    if (supply === '60–90 days ago') s += 4;
    if (supply === 'More than 90 days ago' &&
        slotValue(state, 'lien_preserved') !== 'Yes, a claim was registered' &&
        slotValue(state, 'lien_preserved') !== 'Yes, registered and a court action started') {
      // window probably lost; less urgent because the lien remedy is gone
      s -= 1;
    }
  }

  if (t === 'mortgage_dispute') {
    const status = slotValue(state, 'mortgage_status');
    if (status === 'The lender has started the power-of-sale process') s += 7;
    if (status === 'I received a Notice of Sale') s += 6;
    if (status === 'Lender is threatening to call the mortgage') s += 3;
  }

  if (t === 'real_estate_litigation') {
    const when = slotValue(state, 'litigation_when_event');
    if (when === 'Over 2 years ago') s += 4; // limitation pressure
    if (when === '6 months to 2 years ago') s += 2;
    const stage = slotValue(state, 'litigation_stage');
    if (stage === 'Already in court (we were served)') s += 6; // 20-day defence clock
    if (stage === 'Already in court (we filed)') s += 2;
  }

  if (t === 'preconstruction_condo') {
    if (slotValue(state, 'precon_developer_status') === 'Refusing or stalling' ||
        slotValue(state, 'precon_developer_status') === 'No response') s += 2;
    if (slotValue(state, 'precon_issue') === 'Builder keeps delaying closing') s += 2;
  }

  if (t === 'landlord_tenant') {
    if (slotValue(state, 'tenancy_notice_status') === 'Court action started (commercial)') s += 4;
    if (slotValue(state, 'tenancy_notice_status') === 'Application filed at the Landlord and Tenant Board') s += 3;
  }

  if (t === 'corporate_money_control') {
    if (slotValue(state, 'reported_to_anyone') === 'No, not yet') s += 1; // early-intervention window
  }

  if (t === 'shareholder_dispute') {
    if (slotValue(state, 'corporate_records_available') === 'No') s += 2;
    if (slotValue(state, 'management_exclusion') === 'Yes') s += 2;
    if (slotValue(state, 'dividend_or_money_issue') === 'Yes') s += 2;
    if (state.raw.mentions_money) s += 2; // money mentions in the lead's words
    if (state.raw.mentions_access) s += 1; // access mentions reinforce records-denial signal
  }

  if (t === 'unpaid_invoice' || t === 'contract_dispute' || t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'payment_status') === 'Nothing paid') s += 1;
  }

  if (t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'vendor_services_received') === 'Not delivered') s += 3;
    if (slotValue(state, 'billing_dispute_reason') === 'Unauthorized or unexpected charges') s += 2;
  }

  return clamp(s);
}

// ─── READINESS axis (universal across every matter type) ─────────────────

function scoreReadiness(state: EngineState): number {
  let s = 0;
  const timeline = slotValue(state, 'hiring_timeline');
  if (timeline === 'Now (this week)') s += 5;
  else if (timeline === 'Within the next 30 days') s += 4;
  else if (timeline === 'Within the next few months') s += 2;
  else if (timeline === 'Just exploring, no timeline yet') s += 0;
  else if (timeline === 'Not sure') s += 1;

  const counsel = slotValue(state, 'other_counsel');
  if (counsel === 'No, you are the first') s += 3;
  else if (counsel === 'Yes, switching from a previous lawyer') s += 2;
  else if (counsel === 'Yes, I am comparing options') s += 1;
  else if (counsel === 'Not sure') s += 1;

  const auth = slotValue(state, 'decision_authority');
  if (auth === 'Just me') s += 2;
  else if (auth === 'Me with a partner or family member') s += 1;
  else if (auth === 'Multiple owners or directors') s += 0;
  else if (auth === 'Someone else decides') s -= 1; // proxy lead: harder to convert
  else if (auth === 'Not sure') s += 0;

  return clamp(s);
}

function readinessAnswered(state: EngineState): boolean {
  return !!(slotValue(state, 'hiring_timeline') ||
            slotValue(state, 'other_counsel') ||
            slotValue(state, 'decision_authority'));
}

// ─── Band derivation from four axes ───────────────────────────────────────

export function scoreFourAxes(state: EngineState): FourAxisScores {
  return {
    value: scoreValue(state),
    complexity: scoreComplexity(state),
    urgency: scoreUrgency(state),
    readiness: scoreReadiness(state),
    readinessAnswered: readinessAnswered(state),
  };
}

function bandFromAxes(scores: FourAxisScores): { band: Band; confidence: number; reasoning: string } {
  const { value, complexity, urgency, readiness, readinessAnswered } = scores;

  // Weights reflect the stated priority order: value first, complexity drag, then urgency, then readiness.
  const valueWeight = value * 2.0;        // max 20
  const urgencyWeight = urgency * 1.5;    // max 15
  const readinessWeight = readinessAnswered ? readiness * 0.8 : 0;  // max 8
  const drag = complexity * 0.4;          // max 4 of drag

  const liftMax = readinessAnswered ? 43 : 35;
  const score = valueWeight + urgencyWeight + readinessWeight - drag;
  const ratio = score / liftMax;

  const summary = `Value ${value}/10 · Simplicity ${10 - complexity}/10 · Urgency ${urgency}/10 · ` +
                  `Readiness ${readiness}/10${readinessAnswered ? '' : ' (pending)'} · ` +
                  `Weighted ${score.toFixed(1)}/${liftMax} (${Math.round(ratio * 100)}%).`;

  // Value-first override: very high value alone is enough for Band A unless complexity is extreme
  if (value >= 8 && complexity <= 5) {
    return {
      band: 'A',
      confidence: Math.min(95, 75 + value),
      reasoning: summary + ' High value alone justifies Band A.',
    };
  }

  // Crisis override: time-sensitive matters trump everything else
  if (urgency >= 7) {
    return {
      band: 'A',
      confidence: Math.max(80, Math.round(70 + ratio * 25)),
      reasoning: summary + ' Crisis-level urgency. Band A regardless of other axes.',
    };
  }

  // Strong combined lift
  if (ratio >= 0.45) {
    return {
      band: 'A',
      confidence: Math.min(95, Math.round(65 + ratio * 30)),
      reasoning: summary + ' Strong combined lift. Band A.',
    };
  }

  // Meaningful but not Band A
  if (ratio >= 0.16) {
    return {
      band: 'B',
      confidence: Math.round(40 + ratio * 35),
      reasoning: summary + ' Meaningful signal. Band B.',
    };
  }

  return {
    band: 'C',
    confidence: Math.max(20, Math.round(20 + ratio * 30)),
    reasoning: summary + ' Weak signal. Standard follow-up cadence.',
  };
}

// ─── Special-case bands (out of scope, routing) ──────────────────────────

function bandOutOfScope(state: EngineState): BandResult {
  const areaLabels: Record<string, string> = {
    family: 'family law',
    immigration: 'immigration',
    employment: 'employment',
    criminal: 'criminal',
    personal_injury: 'personal injury',
    estates: 'wills and estates',
  };
  const area = areaLabels[state.practice_area] ?? 'this practice area';
  return {
    band: 'C',
    confidence: 30,
    reasoning: `Lead detected as ${area}. Outside the matter packs currently configured. Forward to the firm with the area flagged so triage staff can route it manually.`,
    coreCompleteness: 0,
  };
}

function bandRoutingLane(label: string, state: EngineState, hasRouted: boolean): BandResult {
  if (!hasRouted) {
    return {
      band: 'B',
      confidence: 30,
      reasoning: `${label} matter detected. Subtype not yet determined. Routing question pending.`,
      coreCompleteness: state.coreCompleteness,
    };
  }
  return {
    band: 'B',
    confidence: 40,
    reasoning: `${label} subtype identified. Awaiting re-routing to specific matter type.`,
    coreCompleteness: state.coreCompleteness,
  };
}

// ─── Main band computation ────────────────────────────────────────────────

export function computeBand(state: EngineState): BandResult {
  if (state.matter_type === 'unknown') {
    return { band: 'C', confidence: 0, reasoning: 'Matter type not classified.', coreCompleteness: 0 };
  }
  if (state.matter_type === 'out_of_scope') {
    return bandOutOfScope(state);
  }
  if (state.matter_type === 'corporate_general') {
    const problem = slotValue(state, 'corporate_problem_type');
    if (problem === 'Something else') {
      return { band: 'C', confidence: 25, reasoning: 'Problem type could not be mapped to a supported corporate matter.', coreCompleteness: state.coreCompleteness };
    }
    return bandRoutingLane('Corporate', state, !!problem);
  }
  if (state.matter_type === 'real_estate_general') {
    const problem = slotValue(state, 'real_estate_problem_type');
    if (problem === 'Something else') {
      return { band: 'C', confidence: 25, reasoning: 'Problem type could not be mapped to a supported real estate matter.', coreCompleteness: state.coreCompleteness };
    }
    return bandRoutingLane('Real estate', state, !!problem);
  }

  const scores = scoreFourAxes(state);
  const result = bandFromAxes(scores);

  // Matter-specific override: residential closing is commodity work.
  // It stays Band C unless something concrete justifies promoting it.
  if (state.matter_type === 'residential_purchase_sale' && result.band === 'B') {
    const amount = slotValue(state, 'residential_re_amount');
    const concern = slotValue(state, 'residential_re_concern');
    const closing = slotValue(state, 'residential_closing_timeline');
    const isUrgent = closing === 'This week' ||
                     closing === 'Less than 30 days away' ||
                     closing === 'Already passed (closing was missed)';
    const isProblem = concern === 'Something has gone wrong at closing';
    const isHighValueResidential = amount === 'Over $2M' || amount === '$1M–$2M';
    if (!isUrgent && !isProblem && !isHighValueResidential) {
      return {
        band: 'C',
        confidence: 35,
        reasoning: result.reasoning + ' Residential commodity matter; staying at Band C unless concern, urgency, or high value lifts it.',
        coreCompleteness: state.coreCompleteness,
      };
    }
  }

  return {
    band: result.band,
    confidence: result.confidence,
    reasoning: result.reasoning,
    coreCompleteness: state.coreCompleteness,
  };
}

export function bandLabel(band: Band): string {
  const labels: Record<Band, string> = {
    A: 'High Priority · Call first',
    B: 'Mid Priority · Standard callback',
    C: 'Low Priority · Standard follow-up cadence',
  };
  return labels[band];
}

// ─── Per-axis reasoning generators ────────────────────────────────────────
// These walk the same logic as the scorers but emit human-readable strings
// rather than numeric weights. Used by the brief to explain each axis score.

function valueReasons(state: EngineState): string[] {
  const out: string[] = [];
  const t = state.matter_type;

  if (t === 'commercial_real_estate') {
    const a = slotValue(state, 'commercial_re_amount');
    if (a && a !== 'Not sure') out.push(`Transaction or lease value stated: ${a}.`);
    else out.push('Commercial real estate matter; transaction value not yet confirmed.');
  } else if (t === 'residential_purchase_sale') {
    const a = slotValue(state, 'residential_re_amount');
    const concern = slotValue(state, 'residential_re_concern');
    if (a && a !== 'Not sure') out.push(`Property value stated: ${a}.`);
    if (concern === 'Something has gone wrong at closing') out.push('Closing-day issue lifts value into litigation territory.');
  } else if (t === 'real_estate_litigation') {
    const a = slotValue(state, 'litigation_amount');
    const subj = slotValue(state, 'litigation_subject');
    if (a && a !== 'Not sure') out.push(`Amount at stake: ${a}.`);
    if (subj === 'Real estate fraud' || subj === 'Seller hid problems or misrepresented the property') {
      out.push('Subject is a serious claim type (fraud or misrepresentation), adding severity.');
    } else if (subj === 'The other side did not close the deal') {
      out.push('Failed-closing claim adds severity weight.');
    }
  } else if (t === 'construction_lien') {
    const a = slotValue(state, 'lien_amount');
    if (a && a !== 'Not sure') out.push(`Amount owed: ${a}.`);
  } else if (t === 'preconstruction_condo') {
    const a = slotValue(state, 'precon_amount');
    const issue = slotValue(state, 'precon_issue');
    if (a && a !== 'Not sure') out.push(`Amount at stake: ${a}.`);
    if (issue === 'Builder hid problems or misrepresented the unit') out.push('Misrepresentation by builder lifts severity.');
    else if (issue === 'Builder keeps delaying closing' || issue === 'Worried about my deposit') out.push('Builder issue adds severity weight.');
  } else if (t === 'mortgage_dispute') {
    const a = slotValue(state, 'mortgage_amount');
    if (a && a !== 'Not sure') out.push(`Mortgage balance or amount in dispute: ${a}.`);
  } else if (t === 'landlord_tenant') {
    const tType = slotValue(state, 'tenancy_type');
    const a = slotValue(state, 'tenancy_amount');
    if (tType) out.push(`Tenancy type: ${tType}.`);
    if (a && a !== 'Not sure') out.push(`Rent or damages range: ${a}.`);
    if (tType === 'Residential (house, condo, apartment)') out.push('Residential tenancy is LTB jurisdiction; retainer-value ceiling is lower than commercial.');
  } else if (t === 'unpaid_invoice' || t === 'contract_dispute' || t === 'vendor_supplier_dispute') {
    const a = slotValue(state, 'amount_at_stake');
    if (a && a !== 'Not sure') out.push(`Amount at stake: ${a}.`);
    else out.push('Amount at stake not yet confirmed.');
  } else if (t === 'shareholder_dispute') {
    out.push('Shareholder dispute; oppression remedy generally available, base value is non-trivial.');
    if (slotValue(state, 'dividend_or_money_issue') === 'Yes') out.push('Money misuse alleged.');
    if (slotValue(state, 'corporate_records_available') === 'No') out.push('Records access denied (raises remedy stakes).');
    if (slotValue(state, 'management_exclusion') === 'Yes') out.push('Lead reports being excluded from management.');
    if (isAnswered(state, 'proof_of_ownership') || isAnswered(state, 'shareholder_agreement')) out.push('Ownership documented.');
  } else if (t === 'corporate_money_control') {
    const a = slotValue(state, 'irregularity_amount');
    if (a && a !== 'Not sure') out.push(`Amount of irregularity: ${a}.`);
    else out.push('Amount of irregularity not yet confirmed.');
  } else if (t === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    const revenue = slotValue(state, 'revenue_expectation');
    if (revenue) out.push(`Revenue expectation: ${revenue}.`);
    if (sub === 'partner_setup') out.push('Multi-party setup adds value (shareholders agreement scope).');
    if (sub === 'buy_in_or_joining') out.push('Buy-in or joining adds value (due diligence on existing entity).');
  }

  if (out.length === 0) out.push('Value drivers not yet captured.');
  return out;
}

function complexityReasons(state: EngineState): string[] {
  const out: string[] = [];
  const t = state.matter_type;

  if (t === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    if (sub === 'partner_setup') out.push('Multi-party setup is a complicating factor.');
    if (sub === 'buy_in_or_joining') out.push('Buy-in or joining requires diligence on existing entity.');
    const regulated = slotValue(state, 'regulated_industry');
    if (regulated && regulated.startsWith('Yes')) out.push(`Regulated industry: ${regulated}.`);
    const cb = slotValue(state, 'cross_border_work');
    if (cb && cb !== 'No, Canada only' && cb !== 'Not sure yet') out.push(`Cross-border work: ${cb}.`);
    const ip = slotValue(state, 'ip_planned');
    if (ip && ip !== 'No, services only' && ip !== 'Not sure') out.push(`Intellectual property in scope: ${ip}.`);
    const employees = slotValue(state, 'employees_planned');
    if (employees === 'Yes, three or more employees') out.push('Three or more employees planned.');
    if (slotValue(state, 'signed_anything') === 'Yes') out.push('Lead has already signed something; retroactive review needed.');
  }
  if (t === 'commercial_real_estate') {
    const propType = slotValue(state, 'commercial_property_type');
    if (propType === 'Land / development site') out.push('Development site (zoning, environmental, servicing).');
    else if (propType === 'Multi-residential / apartment building') out.push('Multi-residential (RTA assumptions, tenant estoppels).');
    else if (propType === 'Mixed-use') out.push('Mixed-use property.');
    const concerns = slotValue(state, 'commercial_re_concerns');
    if (concerns === 'Environmental concern') out.push('Environmental concern flagged (Phase I/II ESA).');
    else if (concerns === 'Title or zoning concern') out.push('Title or zoning concern flagged.');
  }
  if (t === 'residential_purchase_sale') {
    if (slotValue(state, 'residential_re_concern') === 'Something has gone wrong at closing') out.push('Closing-day issue (litigation lane).');
    if (slotValue(state, 'residential_mortgage_situation') === 'Private or alternative lender') out.push('Private or alternative lender involved.');
  }
  if (t === 'real_estate_litigation') {
    const subj = slotValue(state, 'litigation_subject');
    if (subj === 'Real estate fraud' || subj === 'Title or boundary problem') out.push('Subject involves title or fraud (heavy diligence).');
    else if (subj === 'Disagreement over use of land (easement)') out.push('Easement dispute requires title work.');
    if (slotValue(state, 'litigation_documents') !== 'Yes') out.push('Agreement of purchase and sale not confirmed in hand.');
    if (slotValue(state, 'litigation_settlement_attempted') === 'Mediation attempted, did not resolve') out.push('Mediation already failed.');
    const stage = slotValue(state, 'litigation_stage');
    if (stage === 'Already in court (we filed)' || stage === 'Already in court (we were served)') out.push('Already in court (active proceedings).');
  }
  if (t === 'construction_lien') {
    const role = slotValue(state, 'lien_role');
    if (role === 'Subcontractor or trade' || role === 'Supplier of materials') out.push('Subcontractor or supplier role (more diligence on the chain).');
    if (slotValue(state, 'lien_documents') === 'It was a verbal agreement') out.push('Verbal agreement only; proof challenge.');
    else if (slotValue(state, 'lien_documents') === 'Some paperwork, not all') out.push('Partial documentation only.');
  }
  if (t === 'preconstruction_condo') {
    const role = slotValue(state, 'precon_role');
    if (role === 'I am taking over a unit from someone else' || role === 'I am selling my unit before closing') out.push('Assignment context is a complicating factor.');
    if (slotValue(state, 'precon_documents') !== 'Yes') out.push('Builder agreement not yet confirmed in hand.');
  }
  if (t === 'mortgage_dispute') {
    if (slotValue(state, 'mortgage_lender_type') === 'A private lender') out.push('Private lender; less flexibility, harder workout.');
    if (slotValue(state, 'mortgage_documents') !== 'Yes') out.push('Mortgage documents not yet confirmed in hand.');
  }
  if (t === 'landlord_tenant') {
    if (slotValue(state, 'tenancy_type') === 'Commercial (office, retail, industrial)') out.push('Commercial tenancy (Commercial Tenancies Act).');
    if (slotValue(state, 'tenancy_lease_exists') === 'Verbal only') out.push('Verbal lease only; proof challenge.');
  }
  if (t === 'unpaid_invoice' || t === 'contract_dispute') {
    if (slotValue(state, 'dispute_reason') === 'Says work was not done properly') out.push('Quality dispute raised; counterclaim risk.');
    if (!isAnswered(state, 'written_terms') && !isAnswered(state, 'contract_exists')) out.push('Written terms not yet confirmed.');
  }
  if (t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'vendor_contract_exists') === 'No formal agreement') out.push('No formal agreement; rests on implied terms.');
  }
  if (t === 'shareholder_dispute') {
    if (slotValue(state, 'corporate_records_available') === 'No' || slotValue(state, 'management_exclusion') === 'Yes') out.push('Access denied; remedy strategy needs court application.');
    if (!isAnswered(state, 'proof_of_ownership') && !isAnswered(state, 'shareholder_agreement')) out.push('Ownership not yet documented.');
  }
  if (t === 'corporate_money_control') {
    const irreg = slotValue(state, 'irregularity_type');
    if (irreg === 'Fraudulent or inflated invoices' || irreg === 'Unauthorized payments or transfers') out.push('Serious irregularity type (civil + possible criminal).');
    if (slotValue(state, 'evidence_of_irregularity') === 'Not sure' || slotValue(state, 'evidence_of_irregularity') === 'No') out.push('Evidence in hand not yet confirmed.');
  }

  if (out.length === 0) out.push('No complicating factors; matter is straightforward.');
  return out;
}

function urgencyReasons(state: EngineState): string[] {
  const out: string[] = [];
  if (state.raw.mentions_urgency) out.push('Lead\'s description signals urgency.');

  const t = state.matter_type;

  if (t === 'business_setup_advisory') {
    if (slotValue(state, 'signed_anything') === 'Yes') out.push('Lead has already signed something; review window may be tight.');
    const stage = slotValue(state, 'business_stage');
    if (stage === 'Already operating') out.push('Business is already operating without formal structure; tax and liability exposure is accumulating now.');
    if (stage === 'Need to incorporate before launching') out.push('Incorporation needed before launch.');
    const timing = slotValue(state, 'advisory_timing');
    if (timing === 'Urgent') out.push('Lead self-reports urgent timing.');
    if (timing === 'This week') out.push('Lead self-reports a this-week timeline.');
  }
  if (t === 'residential_purchase_sale') {
    const closing = slotValue(state, 'residential_closing_timeline');
    if (closing === 'This week') out.push('Closing this week.');
    if (closing === 'Less than 30 days away') out.push('Closing in under 30 days.');
    if (closing === '30 to 60 days away') out.push('Closing in 30 to 60 days.');
    if (closing === 'Already passed (closing was missed)') out.push('Closing has already been missed.');
    if (slotValue(state, 'residential_re_concern') === 'Something has gone wrong at closing') out.push('Closing-day issue reported.');
  }
  if (t === 'commercial_real_estate') {
    const stage = slotValue(state, 'commercial_re_stage');
    if (stage === 'Closing date set') out.push('Closing date set.');
    if (stage === 'Conditions still to clear') out.push('Conditions still to clear.');
    if (stage === 'Signed an offer or letter of intent') out.push('Offer or LOI signed.');
  }
  if (t === 'construction_lien') {
    const supply = slotValue(state, 'lien_last_supply');
    if (supply === 'Within the last 60 days') out.push('Within Construction Act lien preservation window (60 days).');
    if (supply === '60–90 days ago') out.push('Lien preservation window narrowing.');
    if (supply === 'More than 90 days ago' &&
        slotValue(state, 'lien_preserved') !== 'Yes, a claim was registered' &&
        slotValue(state, 'lien_preserved') !== 'Yes, registered and a court action started') {
      out.push('Lien preservation window likely lost; remedy may be limited to suit on contract.');
    }
  }
  if (t === 'mortgage_dispute') {
    const status = slotValue(state, 'mortgage_status');
    if (status === 'The lender has started the power-of-sale process') out.push('Power-of-sale process active.');
    if (status === 'I received a Notice of Sale') out.push('Notice of Sale received (35-day clock).');
    if (status === 'Lender is threatening to call the mortgage') out.push('Lender threatening default.');
  }
  if (t === 'real_estate_litigation') {
    const when = slotValue(state, 'litigation_when_event');
    if (when === 'Over 2 years ago') out.push('Limitation period concern (over two years).');
    if (when === '6 months to 2 years ago') out.push('Limitation period running.');
    const stage = slotValue(state, 'litigation_stage');
    if (stage === 'Already in court (we were served)') out.push('Lead has been served; defence deadline running.');
    if (stage === 'Already in court (we filed)') out.push('Lead is the plaintiff; case management clock running.');
  }
  if (t === 'preconstruction_condo') {
    if (slotValue(state, 'precon_developer_status') === 'Refusing or stalling' ||
        slotValue(state, 'precon_developer_status') === 'No response') out.push('Developer is non-responsive or refusing.');
    if (slotValue(state, 'precon_issue') === 'Builder keeps delaying closing') out.push('Builder is delaying closing.');
  }
  if (t === 'landlord_tenant') {
    if (slotValue(state, 'tenancy_notice_status') === 'Court action started (commercial)') out.push('Commercial court action started.');
    if (slotValue(state, 'tenancy_notice_status') === 'Application filed at the Landlord and Tenant Board') out.push('LTB application filed.');
  }
  if (t === 'corporate_money_control') {
    if (slotValue(state, 'reported_to_anyone') === 'No, not yet') out.push('Not yet reported to other directors or authorities; early-intervention window open.');
  }
  if (t === 'shareholder_dispute') {
    if (slotValue(state, 'corporate_records_available') === 'No') out.push('Records access denied.');
    if (slotValue(state, 'management_exclusion') === 'Yes') out.push('Lead is excluded from management.');
    if (slotValue(state, 'dividend_or_money_issue') === 'Yes') out.push('Money misuse alleged.');
    if (state.raw.mentions_money) out.push('Lead\'s description mentions money or accounts.');
    if (state.raw.mentions_access) out.push('Lead\'s description mentions access denial.');
  }
  if (t === 'unpaid_invoice' || t === 'contract_dispute' || t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'payment_status') === 'Nothing paid') out.push('Nothing paid yet on the disputed amount.');
  }
  if (t === 'vendor_supplier_dispute') {
    if (slotValue(state, 'vendor_services_received') === 'Not delivered') out.push('Goods or services not delivered.');
    if (slotValue(state, 'billing_dispute_reason') === 'Unauthorized or unexpected charges') out.push('Unauthorized charges alleged.');
  }

  if (out.length === 0) out.push('No urgency signals captured yet.');
  return out;
}

function readinessReasons(state: EngineState): string[] {
  const out: string[] = [];
  const timeline = slotValue(state, 'hiring_timeline');
  if (timeline === 'Now (this week)') out.push('Lead wants to retain this week.');
  else if (timeline === 'Within the next 30 days') out.push('Lead\'s hiring timeline is within 30 days.');
  else if (timeline === 'Within the next few months') out.push('Lead\'s hiring timeline is within a few months.');
  else if (timeline === 'Just exploring, no timeline yet') out.push('Lead is just exploring, no timeline.');
  else if (timeline === 'Not sure') out.push('Lead unsure of hiring timeline.');

  const counsel = slotValue(state, 'other_counsel');
  if (counsel === 'No, you are the first') out.push('Firm is the first lawyer the lead has contacted.');
  else if (counsel === 'Yes, switching from a previous lawyer') out.push('Lead switching from a previous lawyer; active need.');
  else if (counsel === 'Yes, I am comparing options') out.push('Lead comparing options across lawyers.');
  else if (counsel === 'Not sure') out.push('Lead unsure whether other counsel has been contacted.');

  const auth = slotValue(state, 'decision_authority');
  if (auth === 'Just me') out.push('Lead is the sole decision-maker (faster decision).');
  else if (auth === 'Me with a partner or family member') out.push('Decision shared with a partner or family member.');
  else if (auth === 'Multiple owners or directors') out.push('Multi-party decision (slower).');
  else if (auth === 'Someone else decides') out.push('Lead is a proxy; decision sits with someone else.');
  else if (auth === 'Not sure') out.push('Decision authority unclear.');

  if (out.length === 0) out.push('Readiness questions have not been asked yet.');
  return out;
}

export function buildAxisReasoning(state: EngineState): AxisReasoning {
  const buildAxis = (score: number, reasons: string[]): AxisBreakdown => ({ score, reasons });
  return {
    value: buildAxis(scoreValue(state), valueReasons(state)),
    complexity: buildAxis(scoreComplexity(state), complexityReasons(state)),
    urgency: buildAxis(scoreUrgency(state), urgencyReasons(state)),
    readiness: buildAxis(scoreReadiness(state), readinessReasons(state)),
    readinessAnswered: readinessAnswered(state),
  };
}
