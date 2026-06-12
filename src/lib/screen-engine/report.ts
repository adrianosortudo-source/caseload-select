import type { EngineState, LawyerReport, Band, ResolvedFact } from './types';
import { computeBand, bandLabel, scoreFourAxes, buildAxisReasoning } from './band';
import { selectNextSlot, getDecisionGap } from './selector';
import { isContactComplete } from './contact-doctrine';

// ─── Provenance helpers ───────────────────────────────────────────────────

function isConfirmed(state: EngineState, slotId: string): boolean {
  const meta = state.slot_meta[slotId];
  return !!meta && (meta.source === 'explicit' || meta.source === 'answered');
}

function slotVal(state: EngineState, id: string): string | null {
  return state.slots[id] ?? null;
}

/**
 * DR-069: true when the current matter classification rests on AI
 * inference the lead never confirmed. Two shapes count:
 *  - matter_type_provenance === 'llm_inferred' (the __matter_type
 *    promotion on a single-pass channel), or
 *  - the practice area's routing slot holds an llm_inferred value
 *    (the routing fact on the brief came from extraction, not the lead).
 * Both must surface on the brief as unconfirmed classification.
 */
const ROUTING_SLOT_IDS = [
  'corporate_problem_type',
  'real_estate_problem_type',
  'employment_problem_type',
  'estates_problem_type',
] as const;

function matterClassificationInferred(state: EngineState): boolean {
  if (state.matter_type_provenance === 'llm_inferred') return true;
  for (const slotId of ROUTING_SLOT_IDS) {
    const meta = state.slot_meta[slotId];
    if (state.slots[slotId] && meta?.source === 'llm_inferred') return true;
  }
  return false;
}

// ─── Matter snapshot ──────────────────────────────────────────────────────

function buildMatterSnapshot(state: EngineState): string {
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      if (sub === 'buy_in_or_joining') return 'Corporate advisory: buying into or reviewing documents for an existing business.';
      if (sub === 'partner_setup') return 'Corporate advisory: new business setup with one or more co-founders.';
      if (sub === 'solo_setup') return 'Corporate advisory: sole-owner incorporation or structure guidance.';
      return 'Corporate advisory: business setup matter.';
    }
    case 'shareholder_dispute':
      return 'Corporate dispute: shareholder or co-owner conflict involving access to records, company control, or financial conduct.';
    case 'unpaid_invoice':
      return 'Commercial recovery: unpaid invoice or failure to pay for delivered work, goods, or services.';
    case 'contract_dispute':
      return 'Commercial dispute: breach or denial of a business agreement.';
    case 'vendor_supplier_dispute':
      return 'Commercial dispute: billing error, overcharge, or non-delivery dispute with a vendor or supplier.';
    case 'corporate_money_control':
      return 'Corporate financial irregularity: concern about unauthorized transactions, missing funds, or financial misconduct within a company.';
    case 'corporate_general':
      return 'Corporate/business matter: problem type not yet fully determined. Routing questions pending.';
    case 'commercial_real_estate':
      return 'Commercial real estate transaction: purchase, sale, or lease of office, retail, industrial, or investment property.';
    case 'residential_purchase_sale':
      return 'Residential real estate transaction: purchase or sale of a home, condo, or other dwelling.';
    case 'real_estate_litigation':
      return 'Real estate litigation: dispute over a transaction, deposit, title, boundary, or alleged misrepresentation.';
    case 'landlord_tenant':
      return 'Landlord-tenant matter: dispute over rent, possession, lease terms, or tenancy obligations.';
    case 'construction_lien':
      return 'Construction Act matter: unpaid contractor or subcontractor seeking lien preservation, perfection, or recovery.';
    case 'preconstruction_condo':
      return 'Pre-construction condo matter: issue with builder agreement, deposits, delayed closing, or assignment of a unit.';
    case 'mortgage_dispute':
      return 'Mortgage matter: power-of-sale, default, refinance, or discharge dispute.';
    case 'real_estate_general':
      return 'Real estate matter: problem type not yet fully determined. Routing questions pending.';
    case 'wrongful_dismissal':
      return 'Employment: wrongful or constructive dismissal claim. Caller has been let go (or treated such that they had to resign) and is exploring notice, severance, or damages.';
    case 'severance_review':
      return 'Employment: severance package review and negotiation. Caller has been offered a severance package and wants legal review before signing.';
    case 'harassment_complaint':
      return 'Employment: workplace harassment or human-rights complaint. May involve HRTO filing, civil action, or both.';
    case 'wage_recovery':
      return 'Employment: unpaid wages, overtime, vacation pay, or other ESA-governed amounts owed by an employer.';
    case 'employment_contract_review':
      return 'Employment: contract review or negotiation (offer letter, restrictive covenant, NDA, or existing employment agreement).';
    case 'employment_general':
      return 'Employment matter: workplace dispute, termination, severance, harassment, wages owed, or contract review. Sub-type not yet fully determined; routing questions pending.';
    case 'will_drafting':
      return 'Estates: will drafting or update. Likely will-planning matter; scope may expand to include powers of attorney or trust planning depending on assets and family structure.';
    case 'power_of_attorney':
      return 'Estates: power of attorney drafting (property and/or personal care). Often bundled with a will.';
    case 'probate':
      return 'Estates: probate application and estate administration. Includes Certificate of Appointment of Estate Trustee, Estate Information Return, and asset distribution.';
    case 'estate_dispute':
      return 'Estates: dispute over a will, estate administration, or beneficiary entitlement. May involve will challenge, dependant support claim, pass-of-accounts, or beneficiary action against the executor.';
    case 'estates_general':
      return 'Wills, estates, or planning matter: drafting a will or power of attorney, applying for probate, or dealing with an estate dispute. Sub-type not yet fully determined; routing questions pending.';
    case 'out_of_scope': {
      const areaLabels: Record<string, string> = {
        family: 'family law',
        immigration: 'immigration',
        criminal: 'criminal',
        personal_injury: 'personal injury',
      };
      const area = areaLabels[state.practice_area] ?? 'an unsupported practice area';
      return `Lead detected as ${area}. Outside the matter packs currently configured for this firm. Forwarded to the firm with the area flagged for manual triage.`;
    }
    default:
      return 'Matter type not classified.';
  }
}

// ─── Likely legal services ────────────────────────────────────────────────

function buildLikelyServices(state: EngineState): string[] {
  const sub = state.advisory_subtrack;
  const concern = slotVal(state, 'advisory_concern');
  const signed = slotVal(state, 'signed_anything');
  const docsExist = slotVal(state, 'documents_exist');

  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const services: string[] = [];
      if (sub === 'buy_in_or_joining' || docsExist === 'Yes') services.push('Document review and advice before signing');
      if (sub === 'partner_setup' || concern === 'Avoiding problems with a partner later' || concern === 'Deciding who owns what') {
        services.push('Shareholder agreement drafting');
        services.push('Ownership and equity structuring advice');
      }
      if (signed === 'Yes') services.push('Review of signed documents for legal implications');
      services.push('Incorporation and corporate structure advice');
      return [...new Set(services)];
    }
    case 'shareholder_dispute': {
      const services = ['Shareholder rights and remedies advice'];
      if (slotVal(state, 'corporate_records_available') === 'No' || slotVal(state, 'management_exclusion') === 'Yes') {
        services.push('Court application for access to corporate records');
      }
      if (slotVal(state, 'dividend_or_money_issue') === 'Yes') services.push('Derivative action or oppression remedy');
      services.push('Negotiated buyout or exit strategy');
      return services;
    }
    case 'unpaid_invoice':
      return ['Demand letter', 'Civil claim or Small Claims Court', 'Negotiated payment settlement'];
    case 'contract_dispute':
      return ['Breach of contract claim', 'Demand letter', 'Negotiated resolution or mediation'];
    case 'vendor_supplier_dispute': {
      const services = ['Demand letter to vendor'];
      const reason = slotVal(state, 'billing_dispute_reason');
      if (reason === 'Unauthorized or unexpected charges' || reason === 'Charged for something we did not receive') {
        services.push('Commercial dispute: refund or chargeback strategy');
      }
      services.push('Contract review and advice on vendor terms');
      services.push('Civil claim or negotiated resolution');
      return services;
    }
    case 'corporate_money_control': {
      const services = ['Corporate fraud and financial irregularity advice'];
      if (slotVal(state, 'irregularity_type') === 'Fraudulent or inflated invoices') {
        services.push('Civil recovery for fraudulent payments');
      }
      services.push('Advice on reporting obligations (police, regulators)');
      services.push('Interim injunctions or asset preservation orders');
      return services;
    }
    case 'corporate_general':
      return ['Corporate legal consultation', 'Matter routing to appropriate legal service'];
    case 'commercial_real_estate':
      return [
        'Review and negotiation of agreement of purchase and sale or lease',
        'Title and zoning due diligence',
        'Closing representation and registration',
        'Mortgage and financing review',
      ];
    case 'residential_purchase_sale':
      return [
        'Review of agreement of purchase and sale',
        'Title search and title insurance',
        'Closing representation and document preparation',
        'Mortgage funds receipt and disbursement',
      ];
    case 'real_estate_litigation': {
      const services = ['Real estate litigation strategy advice'];
      const subj = slotVal(state, 'litigation_subject');
      if (subj === 'The other side did not close the deal') services.push('Court action to enforce the deal or recover damages');
      if (subj === 'Deposit was lost or is being kept') services.push('Deposit recovery action');
      if (subj === 'Seller hid problems or misrepresented the property') services.push('Misrepresentation or hidden-defect claim');
      if (subj === 'Title or boundary problem' || subj === 'Disagreement over use of land (easement)') services.push('Title or boundary application');
      services.push('Demand letter and negotiation');
      return services;
    }
    case 'landlord_tenant': {
      const tType = slotVal(state, 'tenancy_type');
      const issue = slotVal(state, 'tenancy_issue');
      if (tType === 'Commercial (office, retail, industrial)') {
        return [
          'Commercial lease enforcement or defence',
          'Distraint / re-entry advice',
          'Superior Court action on the lease',
          'Negotiated settlement',
        ];
      }
      const services = ['Landlord and Tenant Board representation'];
      if (issue === 'Eviction or possession') services.push('Eviction application (N4, N12, N13, L1, L2)');
      if (issue === 'Unpaid rent') services.push('Rent recovery and termination application');
      services.push('Lease review and advice');
      return services;
    }
    case 'construction_lien': {
      const services = ['Register and pursue a Construction Act lien claim'];
      const role = slotVal(state, 'lien_role');
      if (role === 'Property owner') services.push('Defend against lien claim and advise on holdback');
      else services.push('Recover the unpaid amount through the lien process');
      services.push('Lawyer\'s letter and negotiated resolution');
      return services;
    }
    case 'preconstruction_condo': {
      const services = ['Pre-construction agreement review'];
      const issue = slotVal(state, 'precon_issue');
      if (issue === 'Builder keeps delaying closing') services.push('Delayed-closing remedies and Tarion claim advice');
      if (issue === 'Worried about my deposit') services.push('Deposit-protection and recovery strategy');
      if (issue === 'Trouble selling my unit before closing') services.push('Assignment review and dispute resolution');
      services.push('Negotiated resolution with the builder');
      return services;
    }
    case 'mortgage_dispute': {
      const services = ['Mortgage rights and remedies advice'];
      const status = slotVal(state, 'mortgage_status');
      if (status === 'The lender has started the power-of-sale process' || status === 'I received a Notice of Sale') {
        services.push('Application to set aside or restrain power of sale');
        services.push('Refinancing or redemption strategy');
      }
      if (status === 'Issue with paying off or discharging the mortgage') services.push('Mortgage discharge dispute');
      services.push('Negotiation with lender');
      return services;
    }
    case 'real_estate_general':
      return ['Real estate legal consultation', 'Matter routing to appropriate legal service'];
    case 'wrongful_dismissal':
      return [
        'Wrongful dismissal claim assessment (Bardal-factor analysis)',
        'Common-law reasonable notice or pay-in-lieu negotiation',
        'Severance / termination pay review for ESA compliance',
        'Mitigation guidance and ongoing job-search obligations',
        'Settlement / release-letter drafting and negotiation',
      ];
    case 'severance_review':
      return [
        'Severance offer review against Bardal notice expectation',
        'Release language analysis (what claims are being waived)',
        'Negotiation strategy for an improved offer',
        'Tax-efficient structuring (retiring allowance, RRSP rollover)',
        'Drafting the lawyer-side acceptance or counter-offer letter',
      ];
    case 'harassment_complaint':
      return [
        'Workplace harassment or human-rights claim assessment',
        'HRTO application or civil action route analysis',
        'Internal-complaint advice and employer-response review',
        'Constructive dismissal claim if the harassment forced resignation',
        'Settlement or mediation representation',
      ];
    case 'wage_recovery':
      return [
        'ESA claim filing with the Ministry of Labour (free, capped recovery)',
        'Civil claim for unpaid wages / overtime / vacation pay',
        'Demand letter to the employer',
        'Class-action exploration if multiple employees are affected',
      ];
    case 'employment_contract_review':
      return [
        'Employment contract or offer-letter review',
        'Restrictive-covenant enforceability analysis (non-compete, non-solicit, NDA)',
        'Negotiation of terms before signing',
        'Advice on amendments to an existing contract',
      ];
    case 'employment_general': {
      const services: string[] = [];
      const t = lower(state.input);
      // Recognise sub-shapes from the transcript even before we have full sub-type packs.
      if (/(fired|terminated|let go|laid off|lost my job|dismissed)/.test(t)) {
        services.push('Wrongful or constructive dismissal claim assessment');
        services.push('Severance package review and negotiation');
      }
      if (/severance/.test(t)) {
        services.push('Severance package review and negotiation');
      }
      if (/(harassment|discriminat|human rights)/.test(t)) {
        services.push('Workplace harassment or human rights complaint advice');
      }
      if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
        services.push('Employment Standards Act claim or wage recovery');
      }
      if (/(contract|employment agreement|non-compete|nda)/.test(t)) {
        services.push('Employment contract review and advice');
      }
      services.push('Employment law consultation and matter routing');
      return [...new Set(services)];
    }
    case 'will_drafting':
      return [
        'Primary will drafting (including testamentary trusts if needed)',
        'Secondary will for business interests / personal assets (probate avoidance)',
        'Continuing power of attorney for property',
        'Power of attorney for personal care',
        'Estate-planning consultation on tax + succession structure',
      ];
    case 'power_of_attorney':
      return [
        'Continuing power of attorney for property drafting',
        'Power of attorney for personal care drafting',
        'Revocation of an existing power of attorney',
        'Capacity assessment coordination (if grantor capacity is in question)',
        'Bundled will + POA package consultation',
      ];
    case 'probate':
      return [
        'Application for Certificate of Appointment of Estate Trustee (probate)',
        'Estate Information Return filing (within 180 days of grant)',
        'Estate Administration Tax calculation and payment',
        'Asset distribution and beneficiary communications',
        'Final estate accounting and discharge',
      ];
    case 'estate_dispute':
      return [
        'Will challenge (capacity, undue influence, suspicious circumstances)',
        'Notice of objection filing',
        'Application to pass accounts',
        'Dependant support claim under the SLRA',
        'Mediation representation and settlement strategy',
      ];
    case 'estates_general': {
      const services: string[] = [];
      const t = lower(state.input);
      if (/(make a will|need a will|write a will|update.*will|new will)/.test(t)) {
        services.push('Will drafting or update');
        services.push('Power of attorney for property and personal care');
      }
      if (/(power of attorney|poa)/.test(t)) {
        services.push('Power of attorney drafting (property and personal care)');
      }
      if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
        services.push('Probate application and estate administration');
      }
      if (/(contest|challenge|dispute|fight over).*will/.test(t) || /(inheritance dispute|beneficiary dispute)/.test(t)) {
        services.push('Estate litigation: will challenge or beneficiary dispute');
      }
      if (/(passed away|died|deceased|when my (mother|father|parent))/.test(t)) {
        services.push('Estate administration and asset distribution');
      }
      services.push('Estate planning consultation and matter routing');
      return [...new Set(services)];
    }
    case 'out_of_scope':
      return ['Manual triage by firm staff', 'Refer or accept based on firm scope of practice'];
    default:
      return ['Legal consultation'];
  }
}

// Local helper for matter-pack heuristics that need lowercase scanning of
// state.input. Mirrors the same shape used in extractor.ts.
function lower(s: string): string {
  return (s ?? '').toLowerCase();
}

// ─── Fee estimate ─────────────────────────────────────────────────────────

function buildFeeEstimate(state: EngineState): string {
  const sub = state.advisory_subtrack;
  const concern = slotVal(state, 'advisory_concern');
  const docsExist = slotVal(state, 'documents_exist');
  const coOwners = slotVal(state, 'co_owner_count');
  const prefix = 'Internal estimate based on likely scope, not a quote.';

  switch (state.matter_type) {
    case 'business_setup_advisory': {
      // Complexity-driven scope, not flat-rate per subtrack
      const revenue = slotVal(state, 'revenue_expectation');
      const employees = slotVal(state, 'employees_planned');
      const regulated = slotVal(state, 'regulated_industry');
      const crossBorder = slotVal(state, 'cross_border_work');
      const ip = slotVal(state, 'ip_planned');
      const signed = slotVal(state, 'signed_anything');

      // Base fee by subtrack
      let lo = 0;
      let hi = 0;
      const drivers: string[] = [];

      if (sub === 'solo_setup') {
        lo = 750; hi = 1500;
        drivers.push('solo incorporation base');
      } else if (sub === 'partner_setup') {
        lo = 2500; hi = 5500;
        drivers.push('multi-party setup with shareholders agreement base');
      } else if (sub === 'buy_in_or_joining') {
        if (docsExist === 'Yes') { lo = 1500; hi = 4000; drivers.push('document review for buy-in'); }
        else { lo = 1500; hi = 3500; drivers.push('buy-in advisory base'); }
      } else {
        lo = 1500; hi = 3500;
        drivers.push('setup advisory base');
      }

      // Complexity surcharges
      if (regulated && regulated.startsWith('Yes')) {
        lo += 1000; hi += 2500; drivers.push('regulated industry: licensing prep and sequencing');
      }
      if (crossBorder === 'Mostly US clients' || crossBorder === 'Mixed Canadian and foreign') {
        lo += 500; hi += 1500; drivers.push('US cross-border tax and treaty considerations');
      } else if (crossBorder === 'Mostly other international') {
        lo += 250; hi += 1000; drivers.push('international client setup');
      }
      if (ip === 'Yes, multiple types of IP') {
        lo += 1500; hi += 3500; drivers.push('multi-asset IP assignment and protection');
      } else if (ip === 'Yes, software, code, or formulas') {
        lo += 1000; hi += 2500; drivers.push('software or formula IP assignment');
      } else if (ip === 'Yes, a brand name or logo to protect') {
        lo += 750; hi += 1500; drivers.push('brand IP and trademark filings');
      }
      if (employees === 'Yes, three or more employees') {
        lo += 1000; hi += 2000; drivers.push('employment agreements and payroll setup');
      } else if (employees === 'Yes, one or two employees') {
        lo += 500; hi += 1500; drivers.push('first-employee employment agreement');
      } else if (employees === 'Maybe one or two contractors') {
        lo += 250; hi += 750; drivers.push('contractor agreements and IP assignment');
      }
      if (revenue === 'Over $500,000 (early-stage business with momentum)') {
        lo += 500; hi += 1500; drivers.push('established-revenue structuring');
      }
      if (concern === 'Avoiding problems with a partner later' || concern === 'Deciding who owns what') {
        if (sub !== 'solo_setup') { lo += 500; hi += 1500; drivers.push('detailed ownership and exit terms'); }
      }
      if (coOwners === 'Multiple partners' && sub === 'partner_setup') {
        lo += 1000; hi += 2000; drivers.push('multi-partner ownership terms');
      }
      if (signed === 'Yes') {
        lo += 500; hi += 1500; drivers.push('review of signed documents and remediation if needed');
      }

      const fmt = (n: number) => '$' + n.toLocaleString('en-CA');
      const driverText = drivers.length > 0 ? ` Drivers: ${drivers.join('; ')}.` : '';
      return `${prefix} ${fmt(lo)}–${fmt(hi)}.${driverText}`;
    }
    case 'shareholder_dispute': {
      const hasOwnership = isConfirmed(state, 'proof_of_ownership') || isConfirmed(state, 'shareholder_agreement');
      const hasAccess = isConfirmed(state, 'corporate_records_available') || isConfirmed(state, 'management_exclusion');
      const hasMoney = isConfirmed(state, 'dividend_or_money_issue');
      if (hasOwnership && (hasAccess || hasMoney)) return `${prefix} $3,000–$10,000+ depending on urgency and dispute complexity.`;
      return `${prefix} Fee opportunity not confirmed. Likely consult-first matter until ownership, value, and records are confirmed.`;
    }
    case 'unpaid_invoice': {
      const amount = slotVal(state, 'amount_at_stake');
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed: estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $4,000–$10,000+ (commercial dispute, meaningful amount).`;
      if (amount === '$5,000–$25,000') return `${prefix} $1,500–$4,000 (mid-range invoice recovery).`;
      return `${prefix} $500–$1,500 (lower-value claim).`;
    }
    case 'contract_dispute': {
      const amount = slotVal(state, 'amount_at_stake');
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed: estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $4,000–$10,000+`;
      return `${prefix} $1,500–$5,000 depending on complexity.`;
    }
    case 'vendor_supplier_dispute': {
      const amount = slotVal(state, 'amount_at_stake');
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed: estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $3,000–$8,000+ (commercial vendor dispute).`;
      if (amount === '$5,000–$25,000') return `${prefix} $1,000–$3,000 (mid-range billing dispute).`;
      return `${prefix} $500–$1,500 (lower-value vendor dispute).`;
    }
    case 'corporate_money_control': {
      const amount = slotVal(state, 'irregularity_amount');
      if (!amount || amount === 'Unknown') return `${prefix} Amount unknown. Financial irregularity matters often involve $5,000–$50,000+ in legal fees depending on complexity and whether litigation is required.`;
      if (amount === 'Over $200,000') return `${prefix} $10,000–$30,000+ (major financial fraud matter with potential litigation).`;
      if (amount === '$50,000–$200,000') return `${prefix} $5,000–$15,000+ (significant irregularity requiring investigation and legal strategy).`;
      return `${prefix} $3,000–$8,000 (financial irregularity: scope depends on whether civil or criminal action follows).`;
    }
    case 'corporate_general':
      return `${prefix} Scope not yet determined. Depends on matter type once routing is complete.`;
    case 'commercial_real_estate': {
      const amt = slotVal(state, 'commercial_re_amount');
      if (!amt || amt === 'Not sure') return `${prefix} Value not confirmed: typical commercial closing $4,000–$15,000+ depending on transaction size.`;
      if (amt === 'Over $10M') return `${prefix} $15,000–$50,000+ (large commercial transaction with full due diligence).`;
      if (amt === '$2M–$10M') return `${prefix} $8,000–$20,000 (mid-large commercial transaction).`;
      if (amt === '$500,000–$2M') return `${prefix} $4,000–$10,000 (commercial transaction with standard due diligence).`;
      return `${prefix} $2,500–$5,000 (small commercial transaction).`;
    }
    case 'residential_purchase_sale': {
      const amt = slotVal(state, 'residential_re_amount');
      const concern = slotVal(state, 'residential_re_concern');
      if (concern === 'Something has gone wrong at closing') return `${prefix} $1,500–$5,000+ (closing-day issue triage; may escalate to litigation).`;
      if (!amt || amt === 'Not sure') return `${prefix} Standard residential closing $1,200–$2,500. Higher with title or financing complications.`;
      if (amt === 'Over $2M') return `${prefix} $1,800–$3,500 (high-value residential closing).`;
      if (amt === '$1M–$2M') return `${prefix} $1,500–$2,500 (mid-high residential closing).`;
      return `${prefix} $1,200–$2,000 (standard residential closing).`;
    }
    case 'real_estate_litigation': {
      const amt = slotVal(state, 'litigation_amount');
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed: estimate not available.`;
      if (amt === 'Over $500,000') return `${prefix} $25,000–$75,000+ (high-value real estate litigation, full discovery and trial scope).`;
      if (amt === '$100,000–$500,000') return `${prefix} $10,000–$30,000+ (substantial real estate dispute).`;
      if (amt === '$25,000–$100,000') return `${prefix} $5,000–$12,000 (mid-range real estate dispute).`;
      return `${prefix} $2,000–$5,000 (lower-value real estate dispute, scope limited).`;
    }
    case 'landlord_tenant': {
      const tType = slotVal(state, 'tenancy_type');
      const amt = slotVal(state, 'tenancy_amount');
      if (tType === 'Commercial (office, retail, industrial)') {
        if (amt === 'Over $100,000' || amt === '$25,000–$100,000') return `${prefix} $5,000–$15,000+ (commercial lease enforcement or defence).`;
        return `${prefix} $2,500–$7,000 (commercial tenancy dispute).`;
      }
      return `${prefix} $1,000–$3,000 (residential LTB matter; many firms refer to paralegals).`;
    }
    case 'construction_lien': {
      const amt = slotVal(state, 'lien_amount');
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed: estimate not available.`;
      if (amt === 'Over $500,000') return `${prefix} $15,000–$50,000+ (large construction lien matter, possible reference proceeding).`;
      if (amt === '$100,000–$500,000') return `${prefix} $7,000–$20,000 (substantial lien matter).`;
      if (amt === '$25,000–$100,000') return `${prefix} $4,000–$10,000 (mid-range lien recovery).`;
      return `${prefix} $2,000–$5,000 (lower-value lien: assess whether process cost is justified).`;
    }
    case 'preconstruction_condo': {
      const amt = slotVal(state, 'precon_amount');
      const issue = slotVal(state, 'precon_issue');
      if (issue === 'Reviewing the contract before signing') return `${prefix} $750–$2,000 (pre-signing contract review).`;
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed: typical preconstruction dispute $3,000–$10,000+.`;
      if (amt === 'Over $200,000') return `${prefix} $8,000–$25,000+ (significant builder dispute).`;
      if (amt === '$50,000–$200,000') return `${prefix} $4,000–$12,000 (mid-range preconstruction dispute).`;
      return `${prefix} $2,000–$5,000 (lower-value preconstruction matter).`;
    }
    case 'mortgage_dispute': {
      const amt = slotVal(state, 'mortgage_amount');
      const status = slotVal(state, 'mortgage_status');
      if (status === 'The lender has started the power-of-sale process' || status === 'I received a Notice of Sale') {
        return `${prefix} $5,000–$25,000+ (urgent power-of-sale defence or restraint action).`;
      }
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed: typical mortgage dispute $3,000–$10,000+.`;
      if (amt === 'Over $5M') return `${prefix} $15,000–$50,000+ (major mortgage dispute).`;
      if (amt === '$1M–$5M') return `${prefix} $7,000–$20,000.`;
      return `${prefix} $3,000–$8,000 (standard mortgage dispute).`;
    }
    case 'real_estate_general':
      return `${prefix} Scope not yet determined. Depends on matter type once routing is complete.`;
    case 'wrongful_dismissal':
      return `${prefix} Initial assessment + demand letter $1,500–$4,000. Negotiated settlement (most common outcome) $3,000–$8,000+. If proceeding to litigation, $15,000–$50,000+ depending on whether discovery and trial are reached. Many plaintiff-side files include a contingency component on the back-end recovery.`;
    case 'severance_review':
      return `${prefix} Severance offer review + counter-offer drafting $1,500–$3,500. Active negotiation with the employer $3,000–$6,000+. If the matter escalates to litigation after a failed negotiation, $10,000+. Time-sensitive: most severance offers have a signing deadline.`;
    case 'harassment_complaint':
      return `${prefix} HRTO filing + initial pleadings $3,000–$7,000. Full case to mediation $7,000–$15,000. Hearing-stage prosecution $15,000–$40,000+. Many HRTO matters resolve at mediation. Civil action route is often higher cost; recommend a route analysis before committing.`;
    case 'wage_recovery':
      return `${prefix} ESA claim filing $500–$1,500 (operator note: the lead can file directly with the Ministry of Labour at no cost: confirm whether they need representation or just guidance). Civil claim for amounts over the ESA cap $2,000–$5,000.`;
    case 'employment_contract_review':
      return `${prefix} Contract review (offer letter or existing agreement) $500–$1,500. Negotiation of terms before signing $1,500–$4,000. Drafting a fully custom contract (employer-side) $2,000–$5,000.`;
    case 'employment_general': {
      const t = lower(state.input);
      if (/severance/.test(t) || /(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
        return `${prefix} Termination or severance review typically $1,500–$5,000 for assessment + negotiation. Contingency on the back end of any settlement is common for plaintiff-side work. If litigation is required, $10,000–$40,000+ depending on complexity.`;
      }
      if (/(harassment|discriminat|human rights)/.test(t)) {
        return `${prefix} Human rights or harassment claims often $5,000–$25,000 for initial filing and negotiation. Contingency at HRTO is common.`;
      }
      if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
        return `${prefix} ESA wage recovery $1,000–$3,000 for filing. Many leads pursue this through the Ministry of Labour directly at no cost; confirm before quoting.`;
      }
      if (/(contract|employment agreement|non-compete|nda)/.test(t)) {
        return `${prefix} Contract review $500–$2,000. Negotiation $1,500–$5,000.`;
      }
      return `${prefix} Scope depends on matter type once routing is complete. Common ranges: $1,500–$5,000 for assessment, $10,000–$40,000+ if litigation is needed.`;
    }
    case 'will_drafting':
      return `${prefix} Basic will + POA package $750–$2,000. Standalone will only $500–$1,500. With testamentary trust planning $1,500–$3,500. Secondary will for business interests + probate avoidance structuring adds $1,000–$2,500.`;
    case 'power_of_attorney':
      return `${prefix} Continuing POA for property + POA for personal care as a pair $300–$800. Often bundled with a will (see will_drafting fee range). Revocation + replacement $500–$1,200.`;
    case 'probate':
      return `${prefix} Probate application $3,000–$8,000+ depending on estate complexity (single asset class vs business + multiple properties + foreign assets). Estate Administration Tax is separate (~1.5% of estate value above $50,000) and paid by the estate, not as legal fees. Estate Information Return preparation included.`;
    case 'estate_dispute':
      return `${prefix} Initial assessment + notice of objection $3,000–$7,000. Through to mediation $10,000–$25,000. Full discovery + trial $25,000–$75,000+. Many estate disputes resolve at mediation. Dependant support claims often run on a partial-contingency basis.`;
    case 'estates_general': {
      const t = lower(state.input);
      if (/(make a will|need a will|write a will|new will)/.test(t) && !/(update|change|revise)/.test(t)) {
        return `${prefix} Basic will and POA package $750–$2,000 depending on complexity (assets, blended family, business interests). Add roughly $500–$1,500 for testamentary trust planning.`;
      }
      if (/(update.*will|revise.*will|change.*will)/.test(t)) {
        return `${prefix} Will update or codicil $500–$1,500. A new will may be cleaner if multiple changes are needed.`;
      }
      if (/(power of attorney|poa)/.test(t)) {
        return `${prefix} Continuing POA for property + POA for personal care $300–$800 as a pair, often bundled with a will.`;
      }
      if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
        return `${prefix} Probate application $3,000–$8,000+ depending on estate complexity. Estate Administration Tax is a separate cost (roughly 1.5% of estate value above $50,000).`;
      }
      if (/(contest|challenge|dispute|fight over).*will/.test(t) || /(inheritance dispute|beneficiary dispute|estate dispute)/.test(t)) {
        return `${prefix} Estate litigation $10,000–$50,000+ depending on whether discovery and trial are reached. Many estate disputes resolve at mediation before that.`;
      }
      return `${prefix} Scope depends on matter type once routing is complete. Common ranges: $750–$2,000 for a will and POA package, $3,000–$8,000+ for probate, $10,000–$50,000+ for estate litigation.`;
    }
    case 'out_of_scope':
      return `${prefix} Out-of-scope lead. No fee estimate generated by the screen.`;
    default:
      return `${prefix} Scope not yet determined.`;
  }
}

// ─── Why it matters ───────────────────────────────────────────────────────

function buildWhyItMatters(state: EngineState, band: Band): string {
  if (state.matter_type === 'out_of_scope') {
    return 'Lead routed for manual triage. The screen does not yet have a matter pack for this area, so no banding or scoping has been applied. Firm staff to assign or refer.';
  }
  if (band === 'A') return 'Multiple high-value facts have been confirmed in the lead\'s own words. Strong indication of a matter worth prioritising on the callback list. Useful to review the brief before the first call.';
  if (band === 'B') return 'Lead is meaningful but some facts still need to be confirmed. A short callback will determine where this fits in the queue.';
  return 'Lead has lower-priority signals so far. Standard follow-up cadence is appropriate. The brief below captures what the lead has shared in case follow-up develops the matter.';
}

// ─── Best next lawyer question ────────────────────────────────────────────

function buildBestNextQuestion(state: EngineState): string {
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      if (sub === 'buy_in_or_joining') {
        const docsExist = slotVal(state, 'documents_exist');
        if (docsExist === 'Yes') return 'What documents have been sent to you, and what is the deadline for signing?';
        return 'Have you been given any documents to review, and what is the timeline for the transaction?';
      }
      return 'What outcome are you hoping to achieve, and have you taken any steps so far?';
    }
    case 'shareholder_dispute': {
      if (!isConfirmed(state, 'proof_of_ownership') && !isConfirmed(state, 'shareholder_agreement')) {
        return 'Do you have any documentation of your ownership stake: a shareholder agreement, share certificates, or emails confirming it?';
      }
      if (!isConfirmed(state, 'corporate_records_available')) {
        return "Have you been able to access the company's financial records or bank accounts since this started?";
      }
      return 'What outcome would resolve this for you: a buyout, restored access, or recovery of funds?';
    }
    case 'unpaid_invoice': {
      if (!isConfirmed(state, 'amount_at_stake')) return 'How much is owed, and do you have an invoice or statement showing the amount?';
      if (!isConfirmed(state, 'proof_of_performance')) return 'Can you demonstrate that the work, goods, or services were actually delivered?';
      return 'Has the other side given any reason in writing for not paying?';
    }
    case 'contract_dispute': {
      if (!isConfirmed(state, 'written_terms') && !isConfirmed(state, 'contract_exists')) {
        return 'Do you have the agreement in writing: a signed contract, emails, or messages confirming the terms?';
      }
      if (!isConfirmed(state, 'amount_at_stake')) return 'What is the value of what was agreed and what has been lost?';
      return 'Has the other side put their denial or position in writing?';
    }
    case 'vendor_supplier_dispute': {
      if (!isConfirmed(state, 'amount_at_stake')) return 'How much is being disputed, and do you have the invoice showing the incorrect charge?';
      if (!isConfirmed(state, 'vendor_contract_exists')) return 'Do you have a contract, terms of service, or purchase order with this vendor?';
      return 'Has the vendor responded to your dispute in writing?';
    }
    case 'corporate_money_control': {
      if (!isConfirmed(state, 'irregularity_type')) return 'Can you describe what financial irregularity you have observed: missing funds, unauthorized transfers, or something else?';
      if (!isConfirmed(state, 'evidence_of_irregularity')) return 'Do you have bank statements, transaction records, or other documents showing the irregularity?';
      return 'Has this been reported to any other directors, your accountant, or law enforcement?';
    }
    case 'corporate_general':
      return 'Can you describe the business problem in more detail: who is involved, what happened, and what you need resolved?';
    case 'commercial_real_estate': {
      if (!isConfirmed(state, 'commercial_re_amount')) return 'What is the approximate transaction or lease value, and what type of commercial property is involved?';
      if (!isConfirmed(state, 'commercial_re_stage')) return 'Where are you in the deal: exploring, in negotiations, or closing scheduled?';
      return 'What is the closing date, and what specific concern brings you to a lawyer now?';
    }
    case 'residential_purchase_sale': {
      if (!isConfirmed(state, 'residential_re_stage')) return 'Where are you in the process: offer made, conditions outstanding, or closing pending?';
      if (!isConfirmed(state, 'residential_re_amount')) return 'What is the approximate property value, and what is the closing date?';
      return 'What specifically do you need help with most: agreement review, closing, or an issue that has come up?';
    }
    case 'real_estate_litigation': {
      if (!isConfirmed(state, 'litigation_subject')) return 'Can you describe the dispute: failed closing, deposit, misrepresentation, or boundary?';
      if (!isConfirmed(state, 'litigation_documents')) return 'Do you have the agreement of purchase and sale or other written documentation?';
      return 'Has anything been filed in court yet, and what outcome are you hoping for?';
    }
    case 'landlord_tenant': {
      if (!isConfirmed(state, 'tenancy_type')) return 'Is this a residential or commercial tenancy?';
      if (!isConfirmed(state, 'tenancy_issue')) return 'What is the dispute about: unpaid rent, eviction, lease breach, or damage?';
      return 'Has notice been given or has an LTB or court application been started?';
    }
    case 'construction_lien': {
      if (!isConfirmed(state, 'lien_last_supply')) return 'When did you last supply work or materials? Lien preservation timing in Ontario is tight (60 days).';
      if (!isConfirmed(state, 'lien_amount')) return 'How much is owed, and do you have the contract and invoices?';
      return 'Has a lien been preserved (registered) yet?';
    }
    case 'preconstruction_condo': {
      if (!isConfirmed(state, 'precon_issue')) return 'What is the issue: delayed closing, deposit, assignment, or Tarion warranty?';
      if (!isConfirmed(state, 'precon_amount')) return 'How much is at stake, and do you have the builder agreement?';
      return 'How is the developer responding so far?';
    }
    case 'mortgage_dispute': {
      if (!isConfirmed(state, 'mortgage_status')) return 'What is happening right now: default notice, notice of sale, or power-of-sale process?';
      if (!isConfirmed(state, 'mortgage_amount')) return 'What is the mortgage balance and the lender type (bank, private, credit union)?';
      return 'What documents and notices have you received from the lender?';
    }
    case 'real_estate_general':
      return 'Can you describe the real estate matter in more detail: property type, role, and what needs to be resolved?';
    case 'wrongful_dismissal':
      return 'When did the termination happen, how long had you been employed, and what (if anything) has the employer offered so far?';
    case 'severance_review':
      return 'When does the offer expire, what is the headline number, and have you signed anything yet?';
    case 'harassment_complaint':
      return 'Are you still employed there, what has the employer done in response so far, and do you have documentation of the conduct?';
    case 'wage_recovery':
      return 'How much is owed and over what pay period: and have you filed anything with the Ministry of Labour yet?';
    case 'employment_contract_review':
      return 'When do you need to sign by, and what specifically concerns you about the contract?';
    case 'employment_general':
      return 'What specifically happened, and what outcome are you hoping for: a settlement, reinstatement, or wages owed?';
    case 'will_drafting':
      return 'Tell me about your family situation: spouse, children, dependants, blended family: and what you own (home, business, registered accounts).';
    case 'power_of_attorney':
      return 'Does the grantor still have decision-making capacity, and do they have any existing POAs that need to be revoked?';
    case 'probate':
      return 'When did the deceased pass, did they have a will, and roughly what is in the estate?';
    case 'estate_dispute':
      return 'What is the basis of the dispute (capacity, undue influence, interpretation, dependant support), and has a grant of probate already been issued?';
    case 'estates_general':
      return 'Is this about planning ahead (will, power of attorney), administering an estate after someone has passed, or a dispute over an existing will or estate?';
    case 'out_of_scope':
      return 'Decide whether the firm accepts this area, refers it out, or holds for triage. The screen will not pursue qualification questions for this area until a matter pack is added.';
    default:
      return 'What outcome is the client looking for, and what is their timeline?';
  }
}

// ─── Resolved facts ───────────────────────────────────────────────────────

// Exported for the slot-labels completeness gate (#176): every slot in
// SLOT_REGISTRY must have an entry here, or the lawyer brief leaks the raw
// snake_case id via the `SLOT_LABELS[id] ?? id` fallback.
export const SLOT_LABELS: Record<string, string> = {
  advisory_path: 'Business path',
  co_owner_count: 'Co-owner count',
  advisory_concern: 'Primary concern',
  advisory_specific_task: 'Specific task',
  advisory_timing: 'Timing',
  advisory_actionability: 'Readiness',
  signed_anything: 'Signed anything',
  documents_exist: 'Documents exist',
  business_stage: 'Business stage',
  setup_needs: 'Setup needs',
  business_activity_type: 'Business type',
  business_location: 'Location',
  ownership_split_discussed: 'Ownership discussed',
  client_role: 'Client role',
  counterparty_type: 'Counterparty',
  ownership_percentage: 'Ownership %',
  proof_of_ownership: 'Ownership proof',
  shareholder_agreement: 'Shareholder agreement',
  corporate_records_available: 'Records access',
  management_exclusion: 'Management exclusion',
  dividend_or_money_issue: 'Money misuse',
  company_profitable: 'Company value',
  deadlock_status: 'Deadlock',
  desired_outcome_shareholder_dispute: 'Desired outcome',
  amount_at_stake: 'Amount at stake',
  invoice_exists: 'Invoice exists',
  payment_status: 'Payment status',
  proof_of_performance: 'Delivery proof',
  dispute_reason: 'Dispute reason',
  desired_outcome_unpaid_invoice: 'Desired outcome',
  written_terms: 'Written terms',
  contract_exists: 'Contract exists',
  desired_outcome_contract: 'Desired outcome',
  vendor_type: 'Vendor type',
  billing_dispute_reason: 'Billing dispute reason',
  vendor_contract_exists: 'Vendor contract',
  vendor_services_received: 'Services received',
  desired_outcome_vendor: 'Desired outcome',
  reporter_role_money: 'Reporter role',
  irregularity_type: 'Irregularity type',
  irregularity_amount: 'Amount involved',
  evidence_of_irregularity: 'Evidence exists',
  reported_to_anyone: 'Reported to',
  desired_outcome_money_control: 'Desired outcome',
  corporate_problem_type: 'Problem type',
  company_involvement: 'Company involvement',
  client_name: 'Name',
  client_phone: 'Phone',
  client_email: 'Email',
  client_postal_code: 'Postal code',
  // Setup-advisory extras (#176, 2026-06-09): every registry slot needs a
  // display label. The fallback `SLOT_LABELS[id] ?? id` leaks raw snake_case
  // ids onto the lawyer brief; field-detected when a WhatsApp brief rendered
  // cross_border_work / regulated_industry / revenue_expectation /
  // employees_planned verbatim in Resolved Facts. Full-registry audit added
  // the 89 missing entries below (real estate, employment, estates, universal
  // readiness, setup extras).
  revenue_expectation: 'Revenue expectation',
  employees_planned: 'Hiring plans',
  regulated_industry: 'Regulated industry',
  cross_border_work: 'Cross-border work',
  ip_planned: 'IP to protect',
  communications_exist: 'Written communications',
  // Universal readiness
  hiring_timeline: 'Lawyer timeline',
  other_counsel: 'Other counsel',
  decision_authority: 'Decision authority',
  // Real estate
  real_estate_problem_type: 'Problem type',
  commercial_re_role: 'Client role',
  commercial_property_type: 'Property type',
  commercial_re_amount: 'Amount involved',
  commercial_re_stage: 'Deal stage',
  commercial_re_concerns: 'Main concern',
  residential_role: 'Client role',
  residential_property_type: 'Property type',
  residential_re_amount: 'Property value',
  residential_re_stage: 'Deal stage',
  residential_re_concern: 'Main concern',
  residential_closing_timeline: 'Closing timeline',
  residential_mortgage_situation: 'Mortgage situation',
  residential_representation: 'Agent involved',
  litigation_subject: 'Dispute subject',
  litigation_role: 'Client role',
  litigation_amount: 'Amount at stake',
  litigation_documents: 'Documents available',
  litigation_stage: 'Dispute stage',
  litigation_when_event: 'When it happened',
  litigation_settlement_attempted: 'Settlement attempted',
  tenancy_party: 'Landlord or tenant',
  tenancy_type: 'Tenancy type',
  tenancy_issue: 'Tenancy issue',
  tenancy_amount: 'Amount involved',
  tenancy_lease_exists: 'Lease exists',
  tenancy_notice_status: 'Notice status',
  lien_role: 'Client role',
  lien_amount: 'Amount owed',
  lien_last_supply: 'Last work or supply',
  lien_preserved: 'Lien preserved',
  lien_documents: 'Documents available',
  precon_role: 'Client role',
  precon_issue: 'Issue type',
  precon_developer_status: 'Developer status',
  precon_amount: 'Amount involved',
  precon_documents: 'Documents available',
  mortgage_role: 'Client role',
  mortgage_status: 'Mortgage status',
  mortgage_amount: 'Amount involved',
  mortgage_lender_type: 'Lender type',
  mortgage_documents: 'Documents available',
  // Employment
  employment_problem_type: 'Problem type',
  tenure_band: 'Tenure',
  salary_band: 'Salary band',
  dismissal_reason_given: 'Reason given',
  severance_offered: 'Severance offered',
  signed_release: 'Signed release',
  desired_outcome_wrongful_dismissal: 'Desired outcome',
  severance_offer_amount: 'Offer amount',
  severance_deadline: 'Offer deadline',
  desired_outcome_severance_review: 'Desired outcome',
  harassment_type: 'Harassment type',
  harassment_employment_status: 'Employment status',
  reported_to_hr: 'Reported to HR',
  desired_outcome_harassment: 'Desired outcome',
  wages_owed_band: 'Wages owed',
  wages_type: 'Pay type',
  desired_outcome_wage_recovery: 'Desired outcome',
  contract_review_type: 'Contract type',
  contract_review_timeline: 'Review timeline',
  contract_review_concerns: 'Main concern',
  desired_outcome_contract_review: 'Desired outcome',
  // Estates
  estates_problem_type: 'Problem type',
  marital_status: 'Marital status',
  children_count: 'Children or dependants',
  estate_complexity: 'Estate complexity',
  existing_will_status: 'Existing will',
  desired_outcome_will_drafting: 'Desired outcome',
  poa_type: 'POA type',
  poa_urgency: 'POA urgency',
  poa_existing_documents: 'Existing documents',
  relationship_to_deceased: 'Relationship to deceased',
  will_status_probate: 'Will status',
  estate_value_band: 'Estate value',
  executor_role: 'Executor role',
  estate_dispute_type: 'Dispute type',
  estate_dispute_role: 'Client role',
  estate_court_status: 'Court status',
  desired_outcome_estate_dispute: 'Desired outcome',
};

function buildResolvedFacts(state: EngineState): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const [id, val] of Object.entries(state.slots)) {
    if (!val) continue;
    if (!isConfirmed(state, id)) continue;
    const label = SLOT_LABELS[id] ?? id;
    facts[label] = val;
  }
  return facts;
}

function buildResolvedFactsV2(state: EngineState): ResolvedFact[] {
  const out: ResolvedFact[] = [];
  for (const [id, val] of Object.entries(state.slots)) {
    if (!val) continue;
    const meta = state.slot_meta[id];
    if (!meta) continue;
    const label = SLOT_LABELS[id] ?? id;
    let source: ResolvedFact['source'];
    // Honest BASE provenance from the engine's SlotMetaSource (#139, 2026-06-02).
    // This is the floor. The transcript-aware promotion to the stronger
    // ranks (confirmed_by_caller_after_readback / spelled_by_caller) happens
    // in the app wiring layer via promoteContactProvenance(), which calls the
    // readback detector. The engine deliberately does NOT claim confirmation:
    //   - 'answered' was previously mapped to 'confirmed' -> "Confirmed by
    //     caller", an OVERCLAIM (channel pre-fill and caller-answered-a-
    //     question are not readback-confirmed). It now floors at
    //     explicit_from_caller ("Stated during call").
    switch (meta.source) {
      case 'explicit': source = 'explicit_from_caller'; break;
      case 'answered': source = 'explicit_from_caller'; break;
      case 'inferred': source = 'inferred_from_transcript'; break;
      case 'system_metadata': source = 'system_metadata'; break;
      // 2026-06-08 provenance honesty (#169): profile-derived name
      // pre-fill (WhatsApp/Messenger/IG profile name, voice caller_name)
      // is recorded as profile_metadata. The brief renderer must surface
      // honest provenance, not "Provided in thread" (which would imply
      // the lead typed the name). screen-brief-html.ts maps this to
      // channel-aware "From {channel} profile" phrasing.
      case 'profile_metadata': source = 'profile_metadata'; break;
      // DR-069 (2026-06-11): llm_inferred previously collapsed into the
      // default 'unknown', so the brief could say a fact was shaky but
      // not WHY. The renderer carries a dedicated chip for this value.
      case 'llm_inferred': source = 'llm_inferred'; break;
      default: source = 'unknown';
    }
    out.push({ label, value: val, source });
  }
  // Order: most credible provenance first.
  // Updated 2026-06-02 for the 6-value FactSource taxonomy (#137).
  // Per locked taxonomy: confirmed_by_caller_after_readback > spelled_by_caller
  // > system_metadata > explicit_from_caller > inferred_from_transcript > unknown.
  // Legacy values mapped to nearest canonical rank for backward compat with
  // existing screened_leads rows.
  const rank: Record<ResolvedFact['source'], number> = {
    confirmed_by_caller_after_readback: 0,
    spelled_by_caller: 1,
    system_metadata: 2,
    // profile_metadata ranks below system_metadata and explicit_from_caller:
    // it is reachability/identity from the profile system, weaker than
    // carrier-verified phone (system_metadata) and weaker than the lead
    // stating something in the thread (explicit_from_caller). Above
    // inferred_from_transcript because the profile system did report it,
    // even if the lead did not confirm it.
    profile_metadata: 3,
    explicit_from_caller: 4,
    inferred_from_transcript: 5,
    // llm_inferred (DR-069): AI extraction, same display rank as
    // transcript inference, above only 'unknown'.
    llm_inferred: 5,
    unknown: 6,
    // Legacy values - present in older DB rows
    confirmed: 0,
    stated: 4,
    inferred: 5,
  };
  out.sort((a, b) => rank[a.source] - rank[b.source]);
  return out;
}

function buildBandReasoningBullets(state: EngineState): string[] {
  const bullets: string[] = [];
  const matter = state.matter_type;

  // Matter and routing facts (always relevant). DR-069: the copy must not
  // overclaim. "Based on lead's own description" was asserted even when an
  // AI promotion picked the lane; the bullet now tracks provenance.
  const provenance = state.matter_type_provenance ?? 'unknown';
  if (provenance === 'user_routing_answer') {
    bullets.push(`Matter routed to ${matterTypeLabel(matter)} from the lead's own routing answer.`);
  } else if (provenance === 'llm_inferred') {
    bullets.push(`Matter routed to ${matterTypeLabel(matter)} by AI inference from the description. The lead has not confirmed this classification.`);
  } else {
    bullets.push(`Matter routed to ${matterTypeLabel(matter)} based on lead's own description.`);
  }

  // Matter-specific drivers
  if (matter === 'business_setup_advisory') {
    const sub = state.advisory_subtrack;
    const subLabels: Record<string, string> = {
      solo_setup: 'sole-owner setup',
      partner_setup: 'multi-party setup',
      buy_in_or_joining: 'buy-in or joining an existing business',
    };
    if (sub && subLabels[sub]) bullets.push(`Subtrack identified as ${subLabels[sub]}.`);
    const signed = slotVal(state, 'signed_anything');
    if (signed === 'Yes') bullets.push('Lead has already signed something. Review window may be tight.');
    const stage = slotVal(state, 'business_stage');
    if (stage === 'Already operating' || stage === 'Need to incorporate before launching') {
      bullets.push('Business is already active or imminent. Time-sensitive.');
    }
    const revenue = slotVal(state, 'revenue_expectation');
    if (revenue === 'Over $500,000 (early-stage business with momentum)') bullets.push('Revenue trajectory indicates an established or scaling business.');
    if (revenue === 'Under $30,000 (small or part-time)') bullets.push('Low revenue band: scope likely small.');
    const regulated = slotVal(state, 'regulated_industry');
    if (regulated && regulated.startsWith('Yes')) bullets.push('Regulated sector flagged. Adds licensing and compliance scope.');
    const crossBorder = slotVal(state, 'cross_border_work');
    if (crossBorder && crossBorder !== 'No, Canada only' && crossBorder !== 'Not sure yet') bullets.push('Cross-border work expected. Adds tax and structuring complexity.');
  }

  if (matter === 'shareholder_dispute') {
    if (slotVal(state, 'corporate_records_available') === 'No') bullets.push('Lead is locked out of records or accounts.');
    if (slotVal(state, 'management_exclusion') === 'Yes') bullets.push('Lead reports being excluded from management.');
    if (slotVal(state, 'dividend_or_money_issue') === 'Yes') bullets.push('Money misuse alleged.');
    if (isConfirmed(state, 'proof_of_ownership') || isConfirmed(state, 'shareholder_agreement')) bullets.push('Ownership documentation confirmed.');
    else bullets.push('Ownership documentation not yet confirmed.');
  }

  if (matter === 'unpaid_invoice') {
    const amount = slotVal(state, 'amount_at_stake');
    if (amount && amount !== 'Not sure') bullets.push(`Amount at stake: ${amount}.`);
    if (isConfirmed(state, 'invoice_exists')) bullets.push('Invoice documented.');
    if (isConfirmed(state, 'proof_of_performance')) bullets.push('Delivery proof in hand.');
  }

  if (matter === 'real_estate_litigation') {
    const subj = slotVal(state, 'litigation_subject');
    if (subj) bullets.push(`Dispute subject: ${subj}.`);
    const when = slotVal(state, 'litigation_when_event');
    if (when === 'Over 2 years ago') bullets.push('Limitation period concern flagged (over two years).');
    if (when === 'In the last 30 days') bullets.push('Recent event. Limitation period not yet a concern.');
    const stage = slotVal(state, 'litigation_stage');
    if (stage === 'Already in court (we were served)') bullets.push('Lead has been served. Defence-side clock is running.');
  }

  if (matter === 'construction_lien') {
    const supply = slotVal(state, 'lien_last_supply');
    if (supply === 'Within the last 60 days') bullets.push('Within 60-day lien preservation window.');
    if (supply === 'More than 90 days ago') bullets.push('Lien preservation window may be lost.');
    const preserved = slotVal(state, 'lien_preserved');
    if (preserved === 'Yes, a claim was registered' || preserved === 'Yes, registered and a court action started') {
      bullets.push('Lien already preserved.');
    }
  }

  if (matter === 'mortgage_dispute') {
    const status = slotVal(state, 'mortgage_status');
    if (status === 'The lender has started the power-of-sale process') bullets.push('Power-of-sale process active. Time-critical.');
    if (status === 'I received a Notice of Sale') bullets.push('Notice of Sale received. 35-day clock under Mortgages Act.');
  }

  if (matter === 'preconstruction_condo') {
    const issue = slotVal(state, 'precon_issue');
    if (issue) bullets.push(`Issue type: ${issue}.`);
    if (slotVal(state, 'precon_developer_status') === 'Refusing or stalling') bullets.push('Developer is non-responsive or refusing.');
  }

  if (matter === 'residential_purchase_sale') {
    const closing = slotVal(state, 'residential_closing_timeline');
    if (closing === 'Less than 30 days away' || closing === 'This week') bullets.push('Tight closing window.');
    if (closing === 'Already passed (closing was missed)') bullets.push('Closing was missed. Litigation lane.');
    const concern = slotVal(state, 'residential_re_concern');
    if (concern === 'Something has gone wrong at closing') bullets.push('Closing-day issue reported.');
  }

  if (matter === 'commercial_real_estate') {
    const stage = slotVal(state, 'commercial_re_stage');
    if (stage === 'Closing date set') bullets.push('Closing date set. Active deal.');
    const amount = slotVal(state, 'commercial_re_amount');
    if (amount === 'Over $10M' || amount === '$2M–$10M') bullets.push('Substantial transaction value.');
  }

  if (matter === 'landlord_tenant') {
    const tType = slotVal(state, 'tenancy_type');
    if (tType) bullets.push(`Tenancy type: ${tType}.`);
    const issue = slotVal(state, 'tenancy_issue');
    if (issue) bullets.push(`Dispute: ${issue}.`);
  }

  if (matter === 'corporate_money_control') {
    const role = slotVal(state, 'reporter_role_money');
    if (role === 'Director or officer' || role === 'Owner or shareholder') {
      bullets.push(`Reporter has standing (${role.toLowerCase()}). Director-level duties to investigate may apply.`);
    } else if (role === 'Internal accountant or bookkeeper') {
      bullets.push('Reporter is internal finance staff. Likely first-hand visibility but may need owner sign-off to act.');
    }
    const irregType = slotVal(state, 'irregularity_type');
    if (irregType && irregType !== 'Other' && irregType !== 'Not sure') {
      bullets.push(`Type of irregularity named: ${irregType.toLowerCase()}.`);
    }
    if (irregType === 'Fraudulent or inflated invoices' || irregType === 'Unauthorized payments or transfers') {
      bullets.push('Type alleged is among the most serious; civil and possible criminal exposure.');
    }
    const amount = slotVal(state, 'irregularity_amount');
    if (amount && amount !== 'Not sure') {
      bullets.push(`Amount range stated: ${amount}.`);
    }
    if (slotVal(state, 'evidence_of_irregularity') === 'Yes') bullets.push('Lead reports documented evidence in hand.');
    else if (slotVal(state, 'evidence_of_irregularity') === 'Some, but not enough') bullets.push('Partial evidence in hand. Investigation step likely needed.');
    else if (slotVal(state, 'evidence_of_irregularity') === 'Not sure') bullets.push('Evidence status unclear. Confirm what is preserved before any escalation.');
    if (slotVal(state, 'reported_to_anyone') === 'No, not yet') {
      bullets.push('Not yet reported to other directors, accountant, or authorities. Early-intervention window open.');
    }
  }

  if (matter === 'wrongful_dismissal') {
    bullets.push('Wrongful or constructive dismissal lane. Most matters settle pre-claim via demand-letter → counter → settlement.');
  }
  if (matter === 'severance_review') {
    bullets.push('Severance review lane. Compare offer against Bardal expectation; release language usually the bigger issue than the headline number.');
  }
  if (matter === 'harassment_complaint') {
    bullets.push('Harassment / human-rights lane. Forum choice (HRTO vs civil) is the strategic decision.');
  }
  if (matter === 'wage_recovery') {
    bullets.push('Wage recovery lane. ESA filing vs civil claim driven by amount and limitation period.');
  }
  if (matter === 'employment_contract_review') {
    bullets.push('Employment contract review. Termination clause is the load-bearing point.');
  }
  if (matter === 'will_drafting') {
    bullets.push('Will-drafting matter. Family situation + asset map drive scope.');
  }
  if (matter === 'power_of_attorney') {
    bullets.push('POA drafting. Capacity at signing is the critical gate.');
  }
  if (matter === 'probate') {
    bullets.push('Probate matter. Estate complexity + EAT bill drive scope.');
  }
  if (matter === 'estate_dispute') {
    bullets.push('Estate litigation. Capacity / undue influence / interpretation drive strategy.');
  }
  if (matter === 'employment_general') {
    const t = lower(state.input);
    bullets.push('Employment matter: in-scope for firms with employment law in their LSO practice areas.');
    if (/(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
      bullets.push('Termination signal detected. Wrongful or constructive dismissal lane likely.');
    }
    if (/severance/.test(t)) {
      bullets.push('Severance discussion mentioned. Common money trigger; assess whether the offer is reasonable.');
    }
    if (/(harassment|discriminat|human rights)/.test(t)) {
      bullets.push('Harassment or discrimination signal. Human rights or HRTO path may apply.');
    }
    if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
      bullets.push('Wage or ESA claim signal. Confirm whether to file with the Ministry of Labour or pursue civil claim.');
    }
    if (/(non-compete|nda|restrictive covenant)/.test(t)) {
      bullets.push('Restrictive covenant signal. Enforceability is fact-specific and often a strong defendant-side argument.');
    }
  }

  if (matter === 'estates_general') {
    const t = lower(state.input);
    bullets.push('Wills and estates matter: in-scope for firms with wills / estates / trusts in their LSO practice areas.');
    if (/(make a will|need a will|write a will|new will)/.test(t)) {
      bullets.push('Will drafting signal. Standard planning matter; family situation and asset complexity drive scope.');
    }
    if (/(power of attorney|poa)/.test(t)) {
      bullets.push('Power of attorney signal. Often bundled with will drafting.');
    }
    if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
      bullets.push('Probate signal. Estate Administration Tax and asset complexity drive scope.');
    }
    if (/(contest|challenge|dispute|fight over).*will/.test(t) || /(inheritance dispute|beneficiary dispute|estate dispute)/.test(t)) {
      bullets.push('Estate dispute signal. Capacity, undue influence, or interpretation issues drive strategy.');
    }
    if (/(passed away|died|deceased|when my (mother|father|parent))/.test(t)) {
      bullets.push('Bereavement context. Sensitivity in the callback approach matters.');
    }
  }

  if (matter === 'out_of_scope') {
    bullets.push('Outside the matter packs currently configured.');
    bullets.push('Forwarded to the firm for manual triage.');
  }

  if (state.raw.mentions_urgency) bullets.push('Lead\'s description signals urgency.');

  // Coverage tail: how confident the engine is in the data
  const filled = Object.keys(state.slots).filter(k => state.slots[k]).length;
  const inferredCount = Object.values(state.slot_meta).filter(m => m && m.source === 'inferred').length;
  if (filled > 0) {
    bullets.push(`${filled} facts captured (${inferredCount} inferred from text, ${filled - inferredCount} confirmed).`);
  }

  return bullets;
}

function buildConfidenceCalibration(state: EngineState): string {
  const meta = state.slot_meta;
  let stated = 0;
  let confirmed = 0;
  let inferred = 0;
  for (const id of Object.keys(state.slots)) {
    if (!state.slots[id]) continue;
    const m = meta[id];
    if (!m) continue;
    if (m.source === 'explicit') stated++;
    else if (m.source === 'answered') confirmed++;
    else if (m.source === 'inferred') inferred++;
  }
  const total = stated + confirmed + inferred;
  if (total === 0) return 'No facts captured yet.';
  const parts: string[] = [];
  if (stated > 0) parts.push(`${stated} stated in description`);
  if (confirmed > 0) parts.push(`${confirmed} captured in follow-ups`);
  if (inferred > 0) parts.push(`${inferred} inferred from context`);
  return `Brief built from ${total} facts: ${parts.join(', ')}.`;
}

function matterTypeLabel(mt: string): string {
  const labels: Record<string, string> = {
    business_setup_advisory: 'Business Setup Advisory',
    shareholder_dispute: 'Shareholder Dispute',
    unpaid_invoice: 'Unpaid Invoice',
    contract_dispute: 'Contract Dispute',
    vendor_supplier_dispute: 'Vendor or Supplier Dispute',
    corporate_money_control: 'Corporate Financial Concern',
    corporate_general: 'Corporate (routing)',
    commercial_real_estate: 'Commercial Real Estate',
    residential_purchase_sale: 'Residential Purchase or Sale',
    real_estate_litigation: 'Real Estate Litigation',
    landlord_tenant: 'Landlord and Tenant',
    construction_lien: 'Construction Lien',
    preconstruction_condo: 'Pre-Construction Condo',
    mortgage_dispute: 'Mortgage or Power of Sale',
    real_estate_general: 'Real Estate (routing)',
    wrongful_dismissal: 'Wrongful Dismissal',
    severance_review: 'Severance Review',
    harassment_complaint: 'Workplace Harassment',
    wage_recovery: 'Wage Recovery',
    employment_contract_review: 'Employment Contract Review',
    employment_general: 'Employment (routing)',
    will_drafting: 'Will Drafting',
    power_of_attorney: 'Power of Attorney',
    probate: 'Probate',
    estate_dispute: 'Estate Dispute',
    estates_general: 'Wills and Estates (routing)',
    out_of_scope: 'Out of scope',
  };
  return labels[mt] ?? mt;
}

function buildInferredSignals(state: EngineState): string[] {
  const signals: string[] = [];
  for (const [id, val] of Object.entries(state.slots)) {
    if (!val) continue;
    const meta = state.slot_meta[id];
    if (!meta || meta.source !== 'inferred') continue;
    const label = SLOT_LABELS[id] ?? id;
    signals.push(`${label} appears to be: ${val}`);
  }
  return signals;
}

function buildOpenQuestions(state: EngineState): string[] {
  // DR-069: when the matter classification rests on AI inference, the
  // confirm-it question leads every channel's list, including the early-
  // return channels below (they bypass the gap logic entirely, so an
  // append-at-the-end would never reach them).
  const routingConfirm = matterClassificationInferred(state)
    ? ['Confirm the matter classification: the engine inferred it from the description and the lead has not confirmed it.']
    : [];

  // SMS (and any other budgeted channel) intentionally stops asking after
  // a small number of questions: completing a thin brief beats abandoning
  // a deep one. Surface the channel context honestly so the lawyer reads
  // remaining gaps as "still to confirm on the call", not as "the lead
  // didn't bother to answer."
  if (state.channel === 'sms') {
    return [
      ...routingConfirm,
      'Short-form intake (SMS): full discovery should happen on the call.',
      'Confirm details below the headline before quoting.',
    ];
  }
  if (state.channel === 'gbp') {
    return [
      ...routingConfirm,
      'Short-form intake (Google Business Profile): plain-text channel inside Maps / Search.',
      'Lead came from a local search; full discovery on the call.',
    ];
  }
  if (state.channel === 'voice') {
    return [
      ...routingConfirm,
      'Voice intake: transcribed from a phone call, single-pass extraction.',
      'Confirm what the lead said on the call back. Audio recording may be linked in the GHL conversation thread.',
    ];
  }

  const questions: string[] = [...routingConfirm];
  const next = selectNextSlot(state);
  if (next) questions.push(next.question);

  const gap = getDecisionGap(state);
  const gapQuestions: Partial<Record<string, string>> = {
    ownership_proof: 'Ownership documentation not confirmed.',
    access: 'Access to records or accounts not confirmed.',
    money_misuse: 'Money misuse not confirmed.',
    value: 'Amount or value at stake not confirmed.',
    delivery_proof: 'Delivery or performance proof not confirmed.',
    agreement_proof: 'Written terms or agreement not confirmed.',
    risk: 'Counterparty position not confirmed.',
    dispute_subtype: 'Problem type not yet determined: routing question pending.',
    real_estate_subtype: 'Problem type not yet determined: routing question pending.',
    financial_irregularity: 'Nature of financial concern not yet described.',
    irregularity_evidence: 'Documentary evidence of irregularity not confirmed.',
    vendor_billing: 'Nature of billing dispute not yet described.',
    company_role: 'Reporter\'s role in the company not confirmed.',
  };
  if (gap && gap !== 'none' && gapQuestions[gap]) {
    questions.push(gapQuestions[gap] as string);
  }

  return [...new Set(questions)];
}

function buildRiskFlags(state: EngineState): string[] {
  const flags: string[] = [];

  if (state.matter_type === 'shareholder_dispute') {
    if (slotVal(state, 'dividend_or_money_issue') === 'Yes') flags.push('Money misuse alleged: potential for urgent injunctive relief.');
    if (slotVal(state, 'corporate_records_available') === 'No') flags.push('Client locked out of records or accounts: access remedy may be needed.');
    if (!isConfirmed(state, 'proof_of_ownership') && !isConfirmed(state, 'shareholder_agreement')) flags.push('Ownership not documented: case viability depends on establishing standing.');
  }

  if (state.matter_type === 'unpaid_invoice') {
    const reason = slotVal(state, 'dispute_reason');
    if (reason === 'Says work was not done properly') flags.push('Quality dispute raised: delivery proof is essential before advancing.');
    if (!isConfirmed(state, 'proof_of_performance')) flags.push('Delivery proof not confirmed: case may be vulnerable without it.');
  }

  if (state.matter_type === 'contract_dispute') {
    if (!isConfirmed(state, 'written_terms') && !isConfirmed(state, 'contract_exists')) flags.push('No written terms confirmed: verbal contract claims face a higher bar.');
  }

  if (state.matter_type === 'vendor_supplier_dispute') {
    const reason = slotVal(state, 'billing_dispute_reason');
    if (reason === 'Unauthorized or unexpected charges') flags.push('Unauthorized charges alleged: may support urgent chargeback or injunction.');
    if (!isConfirmed(state, 'vendor_contract_exists')) flags.push('No vendor contract confirmed: dispute may rest on implied terms.');
  }

  if (state.matter_type === 'corporate_money_control') {
    const irregType = slotVal(state, 'irregularity_type');
    if (irregType === 'Fraudulent or inflated invoices' || irregType === 'Unauthorized payments or transfers') {
      flags.push('Serious financial misconduct alleged: potential criminal exposure alongside civil remedies.');
    }
    if (slotVal(state, 'reported_to_anyone') === 'No, not yet') {
      flags.push('Not yet reported: lawyer should advise on timing and obligations before reporting.');
    }
    if (!isConfirmed(state, 'evidence_of_irregularity')) flags.push('No documentary evidence confirmed: forensic review may be needed.');
  }

  if (state.matter_type === 'business_setup_advisory') {
    if (slotVal(state, 'signed_anything') === 'Yes') flags.push('Client has already signed: legal review of existing documents is a priority.');
    if (state.advisory_subtrack === 'buy_in_or_joining' && slotVal(state, 'documents_exist') === 'Yes') flags.push('Documents exist for review: timeline to signing matters.');
  }

  if (state.matter_type === 'corporate_general') {
    flags.push('Problem type not yet mapped to a specific corporate matter: routing question needed before assessment.');
  }

  if (state.matter_type === 'wrongful_dismissal') {
    flags.push('2-year limitation for wrongful dismissal claims under the Limitations Act, 2002. Confirm termination date before turning down.');
    flags.push('Mitigation duty: if the lead is not actively looking for work, the value of the claim degrades. Set expectations.');
  }
  if (state.matter_type === 'severance_review') {
    flags.push('Time-sensitive: severance offers have signing deadlines. Confirm the date on the first call.');
    flags.push('Release language often waives MORE than the dismissal claim (human-rights, WSIB, unpaid wages, bonus, equity). Review the full document, not just the headline number.');
  }
  if (state.matter_type === 'harassment_complaint') {
    flags.push('HRTO has a 1-year limitation from the last incident. Confirm the most recent incident date before assessing the route.');
    flags.push('If harassment forced resignation, this is also a constructive-dismissal matter: different limitation, different forum, additional remedies.');
  }
  if (state.matter_type === 'wage_recovery') {
    flags.push('ESA filing has a 6-month-back limit on recovery. If the matter is older, civil claim is the only real route.');
    flags.push('Verify the lead is correctly classified as an employee: many "independent contractors" are employees at law.');
  }
  if (state.matter_type === 'employment_contract_review') {
    flags.push('Most pre-2020 termination clauses are unenforceable post-Waksdale. Flag this as a key review point.');
  }
  if (state.matter_type === 'will_drafting') {
    flags.push('Capacity at signing: if the testator\'s capacity is in question, get a capacity assessment before drafting. A will signed by an incapable testator is void.');
    flags.push('Spousal claims: in second-marriage scenarios the surviving spouse may have a Family Law Act election. Address this in planning.');
  }
  if (state.matter_type === 'power_of_attorney') {
    flags.push('Capacity at signing: a POA signed by an incapable grantor is void.');
  }
  if (state.matter_type === 'probate') {
    flags.push('Estate Information Return deadline: 180 days from grant of probate. Late filing penalty applies.');
    flags.push('Executor personal liability for premature distribution before debts and taxes are paid.');
  }
  if (state.matter_type === 'estate_dispute') {
    flags.push('Notice of Objection must be filed BEFORE the Certificate of Appointment is issued. After issuance the burden flips.');
    flags.push('Dependant support claim: 6-month limitation from grant of probate.');
  }
  if (state.matter_type === 'employment_general') {
    const t = lower(state.input);
    flags.push('Employment matter: sub-type pack not yet wired (Phase B). Confirm routing on the call.');
    if (/(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
      flags.push('Limitation periods are tight for employment claims (2 years for wrongful dismissal in Ontario). Confirm event date before turning down.');
    }
    if (/severance/.test(t) && /(deadline|signed|sign by|signed already)/.test(t)) {
      flags.push('Severance offer with a signing window. Review before signing: releases waive future claims.');
    }
    if (/(harassment|discriminat|human rights)/.test(t)) {
      flags.push('HRTO has a 1-year limitation from the last incident. Time-sensitive if recent.');
    }
  }

  if (state.matter_type === 'estates_general') {
    const t = lower(state.input);
    flags.push('Estates matter: sub-type pack not yet wired (Phase B). Confirm routing on the call.');
    if (/(contest|challenge|dispute|fight over).*will/.test(t)) {
      flags.push('Estate litigation flagged. Limitation periods under the Estates Act are short; confirm dates of grant of probate before turning down.');
    }
    if (/(power of attorney|poa)/.test(t) && /(refused|denied|misused|stealing|theft)/.test(t)) {
      flags.push('POA misuse alleged: potential urgent application to revoke or pass accounts.');
    }
    if (/(passed away|died|deceased)/.test(t) && /(no will|without a will|intestate)/.test(t)) {
      flags.push('Intestacy signal. Succession Law Reform Act default distribution applies; confirm family tree.');
    }
  }

  // DR-069, matter-type-agnostic: the *_general routing-pending flags above
  // only fire while the matter is still in a catch-all lane. When an AI
  // promotion routed the matter (single-pass channels), the specific-matter
  // blocks assert confidence the lead never gave; this flag restores the
  // honest framing on the rerouted matter type.
  if (matterClassificationInferred(state)) {
    flags.push('Matter classification is AI-inferred, not confirmed by the lead. Verify the matter type early in the call.');
  }

  if (state.raw.mentions_urgency) flags.push('Urgency signals detected in client input.');

  return flags;
}

// ─── Truth validation ─────────────────────────────────────────────────────

export function validateReportFacts(state: EngineState): string[] {
  const warnings: string[] = [];

  if (slotVal(state, 'documents_exist') === 'Yes' && !isConfirmed(state, 'signed_anything')) {
    warnings.push('The lead mentioned documents exist but did not confirm whether they have signed anything. The brief does not assert that no documents have been signed.');
  }
  if (!isConfirmed(state, 'amount_at_stake') && slotVal(state, 'amount_at_stake')) {
    warnings.push('Amount at stake is shown but the lead has not confirmed it. Treat as preliminary.');
  }
  if (!isConfirmed(state, 'company_profitable') && slotVal(state, 'company_profitable')) {
    warnings.push('Company profitability is shown but the lead has not confirmed it. Treat as preliminary.');
  }
  if (!isConfirmed(state, 'proof_of_ownership') && slotVal(state, 'proof_of_ownership')) {
    warnings.push('Ownership proof status is shown but the lead has not confirmed it. Treat as preliminary.');
  }
  if (slotVal(state, 'signed_anything') === 'No' && !isConfirmed(state, 'signed_anything')) {
    warnings.push('The brief does not assert that the lead has not signed anything. The lead has not directly confirmed this.');
  }
  if (!isConfirmed(state, 'irregularity_amount') && slotVal(state, 'irregularity_amount')) {
    warnings.push('Amount of the financial irregularity is shown but the lead has not confirmed it. Treat as preliminary.');
  }

  // DR-069: inference-only classification gets the same honesty treatment
  // as the per-slot disclaimers above. This renders in the high-prominence
  // "what this brief deliberately does not assert" panel.
  if (matterClassificationInferred(state)) {
    warnings.push('The matter classification at the top of this brief was inferred by the engine from the description, not confirmed by the lead.');
  }

  const timing = slotVal(state, 'advisory_timing');
  const actionability = slotVal(state, 'advisory_actionability');
  if ((timing === 'Urgent' || timing === 'This week') && (actionability === 'Just exploring' || actionability === 'Planning soon')) {
    warnings.push('The lead\'s answers contain mixed signals: urgent timing alongside an exploratory stance. Worth clarifying on the call.');
  }

  return warnings;
}

// ─── Main report builder ──────────────────────────────────────────────────

export function buildReport(state: EngineState): LawyerReport {
  const bandResult = computeBand(state);
  const truthWarnings = validateReportFacts(state);

  return {
    lead_id: state.lead_id,
    submitted_at: state.submitted_at,
    matter_snapshot: buildMatterSnapshot(state),
    lawyer_time_priority: bandLabel(bandResult.band),
    band: bandResult.band,
    band_reasoning_bullets: buildBandReasoningBullets(state),
    confidence_calibration: buildConfidenceCalibration(state),
    four_axis: scoreFourAxes(state),
    axis_reasoning: buildAxisReasoning(state),
    truth_warnings: truthWarnings,
    likely_legal_services: buildLikelyServices(state),
    fee_estimate: buildFeeEstimate(state),
    why_it_matters: buildWhyItMatters(state, bandResult.band),
    cross_sell_opportunities: buildCrossSell(state),
    strategic_considerations: buildStrategicConsiderations(state),
    what_to_confirm: buildWhatToConfirm(state),
    call_openers: buildCallOpeners(state),
    best_next_question: buildBestNextQuestion(state),
    resolved_facts_v2: buildResolvedFactsV2(state),
    resolved_facts: buildResolvedFacts(state),
    inferred_signals: buildInferredSignals(state),
    open_questions: buildOpenQuestions(state),
    risk_flags: buildRiskFlags(state),
    contact_complete: isContactComplete({
      client_name: state.slots['client_name'],
      client_email: state.slots['client_email'],
      client_phone: state.slots['client_phone'],
    }),
    // Persist advisory_subtrack into the brief so retrospective queries,
    // admin reclassify, and band-recompute paths can see it without
    // re-running the classifier (added 2026-06-07).
    advisory_subtrack: state.advisory_subtrack,
    // Persist matter-type provenance (DR-069, 2026-06-11): how the matter
    // classification was determined. 'unknown' covers states serialized
    // before the field existed. Same DR-054 rationale as advisory_subtrack.
    matter_type_provenance: state.matter_type_provenance ?? 'unknown',
  };
}

// ─── Strategic considerations ─────────────────────────────────────────────

function buildStrategicConsiderations(state: EngineState): string[] {
  const out: string[] = [];
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      const revenue = slotVal(state, 'revenue_expectation');
      const employees = slotVal(state, 'employees_planned');
      const regulated = slotVal(state, 'regulated_industry');
      const crossBorder = slotVal(state, 'cross_border_work');
      const ip = slotVal(state, 'ip_planned');
      const activity = slotVal(state, 'business_activity_type');
      const stage = slotVal(state, 'business_stage');
      const location = slotVal(state, 'business_location');
      const setupNeeds = slotVal(state, 'setup_needs');

      if (sub === 'solo_setup') {
        out.push('Sole-owner incorporation. No shareholders agreement needed today, but flag for revisit if a partner conversation comes up later.');
      }
      if (sub === 'partner_setup') {
        out.push('Multi-party setup. Shareholders agreement with vesting, drag-along, and exit terms is the load-bearing document. Prioritise it over incorporation cosmetics.');
      }
      if (sub === 'buy_in_or_joining') {
        out.push('Buying into an existing business. Due diligence on the existing entity (debts, contracts, IP, tax position) matters more than the buy-in mechanics.');
      }
      if (revenue === 'Over $500,000 (early-stage business with momentum)') {
        out.push('Revenue trajectory suggests this is past the side-project stage. Federal incorporation worth a look if cross-border or multi-province operation is on the horizon.');
      }
      if (revenue === '$100,000–$500,000 (small team or busy practice)') {
        out.push('Mid-revenue range. Provincial incorporation is usually fine; federal only if name protection or cross-border is a real concern.');
      }
      if (employees === 'Yes, three or more employees') {
        out.push('Hiring in year one. Employment agreements, ESA-compliant payroll, and WSIB registration are scope items beyond pure incorporation.');
      }
      if (employees === 'Yes, one or two employees' || employees === 'Maybe one or two contractors') {
        out.push('Small headcount planned. Recommend addressing contractor-vs-employee classification (CRA risk) and IP assignment in any contractor agreements.');
      }
      if (regulated && regulated !== 'No, general services or products' && regulated !== 'Not sure') {
        out.push(`Regulated sector flagged (${regulated.replace(/^Yes,\s*/i, '')}). Incorporation alone does not satisfy regulator licensing; confirm sequencing with the regulator before activating.`);
      }
      if (crossBorder === 'Mostly US clients' || crossBorder === 'Mixed Canadian and foreign') {
        out.push('US client exposure. Discuss US tax filings (1099/1042-S withholding), nexus risk, and whether a Canadian corp invoicing US clients is the cleanest structure.');
      }
      if (crossBorder === 'Mostly other international') {
        out.push('Non-US international clients. HST/GST on exports often zero-rated; confirm with accountant. Banking and FX may be the bigger pain point than legal.');
      }
      if (ip === 'Yes, software, code, or formulas' || ip === 'Yes, multiple types of IP') {
        out.push('Material IP at stake. IP assignment from founder(s) to the new corp at incorporation is critical; without it, IP can stay personally owned.');
      }
      if (ip === 'Yes, a brand name or logo to protect') {
        out.push('Brand IP. Consider trademark strategy (CIPO and USPTO if cross-border). Often deferred but cheap to file early.');
      }
      if (activity === 'Professional services' && location && location.toLowerCase().includes('toronto')) {
        out.push('Toronto-based professional services. HST registration mandatory above $30k/year of taxable supplies; recommend registering from day one to avoid retroactive collection issues.');
      }
      if (stage === 'Already operating') {
        out.push('Business is already operating. Address pre-incorporation liability and whether to roll existing assets and contracts into the new corp via a Section 85 rollover.');
      }
      if (setupNeeds === 'Incorporating the company' && (revenue === 'Under $30,000 (small or part-time)' || revenue === 'Not sure yet')) {
        out.push('Low or unknown revenue. Sole-prop may be more cost-effective short term. Worth raising as an option before defaulting to incorporation.');
      }
      break;
    }

    case 'shareholder_dispute': {
      const access = slotVal(state, 'corporate_records_available');
      const exclusion = slotVal(state, 'management_exclusion');
      const money = slotVal(state, 'dividend_or_money_issue');
      const proof = slotVal(state, 'proof_of_ownership') ?? slotVal(state, 'shareholder_agreement');
      out.push('Standard tools: oppression remedy under section 248 OBCA (or equivalent), application for access to records under section 145, derivative action under section 246.');
      if (access === 'No' || exclusion === 'Yes') {
        out.push('Access has been denied. Demand letter for records under section 140 OBCA is a fast first step before escalating to court application.');
      }
      if (money === 'Yes') {
        out.push('Money misuse alleged. Consider interim injunction to preserve assets and forensic accounting before discovery if amounts are material.');
      }
      if (!proof || proof === 'No') {
        out.push('Ownership not yet documented. Confirm shareholder status before any filings; oppression remedy requires standing.');
      }
      break;
    }

    case 'unpaid_invoice': {
      const amount = slotVal(state, 'amount_at_stake');
      const dispute = slotVal(state, 'dispute_reason');
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') {
        out.push('Above Small Claims threshold. Superior Court action with proper pleadings; consider summary judgment if defence is thin.');
      } else {
        out.push('Within Small Claims jurisdiction (under $35k). Faster, cheaper, but no full discovery. Often the right venue when documents are tight.');
      }
      if (dispute === 'Says work was not done properly') {
        out.push('Quality dispute raised. Set off / counterclaim risk. Confirm proof of performance early; without it, recovery prospects degrade.');
      }
      break;
    }

    case 'real_estate_litigation': {
      const subject = slotVal(state, 'litigation_subject');
      const when = slotVal(state, 'litigation_when_event');
      const settlement = slotVal(state, 'litigation_settlement_attempted');
      const stage = slotVal(state, 'litigation_stage');

      if (subject === 'The other side did not close the deal') {
        out.push('Failed closing. Two paths: damages (price differential plus carrying costs) or specific performance (if property is still available). Specific performance harder to win post-Semelhago for residential.');
      }
      if (subject === 'Deposit was lost or is being kept') {
        out.push('Deposit dispute. Review APS deposit clauses; trust conditions on the brokerage matter. Consider mutual release leverage if both sides stand to lose.');
      }
      if (subject === 'Seller hid problems or misrepresented the property') {
        out.push('Misrepresentation claim. Patent vs latent defect distinction matters. Caveat emptor still applies to patent defects; latent defects affecting habitability or fraud are actionable.');
      }
      if (when === 'Over 2 years ago') {
        out.push('Limitation period concern. Two-year basic limitation under the Limitations Act, 2002 likely engaged. Confirm discoverability date before turning down.');
      }
      if (when === '6 months to 2 years ago') {
        out.push('Limitation period running. Confirm exact discoverability date and act before two years from that date.');
      }
      if (settlement === 'Mediation attempted, did not resolve') {
        out.push('Mediation failed. Useful for credibility on costs later; document the offers exchanged.');
      }
      if (settlement === 'Settlement offer on the table') {
        out.push('Live settlement offer. Time-limited acceptance windows are common; advise on response framing before legal advice could trigger a deemed rejection.');
      }
      if (stage === 'Already in court (we were served)') {
        out.push('Defendant posture. Statement of defence deadline (20 days in Ontario for Superior Court) is the critical clock.');
      }
      break;
    }

    case 'construction_lien': {
      const lastSupply = slotVal(state, 'lien_last_supply');
      const preserved = slotVal(state, 'lien_preserved');
      const role = slotVal(state, 'lien_role');
      out.push('Construction Act timelines are strict and unforgiving. Lien rights expire 60 days after last supply for contracts after July 1, 2018 (90 days for older contracts).');
      if (lastSupply === 'Within the last 60 days') {
        out.push('Within preservation window. Register lien promptly via Land Registry; perfecting requires court action within 90 days of preservation.');
      }
      if (lastSupply === 'More than 90 days ago' && (preserved === 'No, nothing registered yet' || !preserved)) {
        out.push('Preservation window likely closed. Lien remedy may be lost; suit on the contract still possible. Confirm exact last-supply date before turning down.');
      }
      if (role === 'Property owner') {
        out.push('Defending a lien claim. Holdback obligations under section 22 may already be satisfied; review project records.');
      }
      break;
    }

    case 'mortgage_dispute': {
      const status = slotVal(state, 'mortgage_status');
      const lender = slotVal(state, 'mortgage_lender_type');
      if (status === 'The lender has started the power-of-sale process') {
        out.push('Active power of sale. Redemption rights run on a strict clock; refinancing or sale before final notice is the typical defensive play.');
      }
      if (status === 'I received a Notice of Sale') {
        out.push('Notice of Sale received. 35-day redemption period under the Mortgages Act before sale can proceed. Time to act is now.');
      }
      if (lender === 'A private lender') {
        out.push('Private lender. Often less flexible than banks; refinancing through institutional lender to take out the private mortgage is the common route.');
      }
      break;
    }

    case 'preconstruction_condo': {
      const issue = slotVal(state, 'precon_issue');
      const developer = slotVal(state, 'precon_developer_status');
      if (issue === 'Builder keeps delaying closing') {
        out.push('Tarion delayed-closing compensation may be available (up to $7,500 in standard cases). Check the disclosure statement for outside-occupancy date.');
      }
      if (issue === 'Worried about my deposit') {
        out.push('Deposits up to $20,000 protected under Tarion (residential condos) for builder insolvency. Confirm whether the builder is registered.');
      }
      if (developer === 'Refusing or stalling' || developer === 'No response') {
        out.push('Non-responsive developer. Tarion complaint and HCRA enforcement are levers beyond civil litigation. Often more effective than court for individual buyers.');
      }
      break;
    }

    case 'commercial_real_estate': {
      const stage = slotVal(state, 'commercial_re_stage');
      const propertyType = slotVal(state, 'commercial_property_type');
      const concerns = slotVal(state, 'commercial_re_concerns');
      if (stage === 'Closing date set') {
        out.push('Live closing. Title search, requisition letter, and final due diligence are the tactical priorities. Build a closing checklist on day one.');
      }
      if (propertyType === 'Land / development site') {
        out.push('Development site. Zoning, environmental (Phase I/II ESA), heritage, and municipal servicing are the standard diligence streams.');
      }
      if (propertyType === 'Multi-residential / apartment building') {
        out.push('Multi-residential. RTA tenancy assumptions transfer; rent control and AGI history matter for valuation. Estoppel certificates from tenants on closing.');
      }
      if (concerns === 'Environmental concern') {
        out.push('Environmental issue flagged. Phase I ESA at minimum; Phase II if Phase I shows red flags. Indemnity and escrow holdback often used to manage risk.');
      }
      break;
    }

    case 'residential_purchase_sale': {
      const closing = slotVal(state, 'residential_closing_timeline');
      const mortgage = slotVal(state, 'residential_mortgage_situation');
      const concern = slotVal(state, 'residential_re_concern');
      if (closing === 'Less than 30 days away' || closing === 'This week') {
        out.push('Tight closing. Title search, mortgage instructions, and trust ledger setup compress into a short window. Critical-path closing.');
      }
      if (closing === 'Already passed (closing was missed)') {
        out.push('Closing missed. Treat as failed-closing matter (litigation lane), not transactional. Damages or specific performance analysis required.');
      }
      if (mortgage === 'Application submitted, no answer yet' || mortgage === 'Approved with conditions still open') {
        out.push('Financing not locked. Watch the financing condition deadline; failure-to-fund is the most common reason for residential closings to collapse.');
      }
      if (mortgage === 'Private or alternative lender') {
        out.push('Alternative lender. Higher rates and stricter conditions; trust conditions and lender requisitions often diverge from institutional norms.');
      }
      if (concern === 'Something has gone wrong at closing') {
        out.push('Closing-day issue. Could be title, financing, or the other side. Reframe scope: this is no longer a standard closing fee.');
      }
      break;
    }

    case 'landlord_tenant': {
      const type = slotVal(state, 'tenancy_type');
      const issue = slotVal(state, 'tenancy_issue');
      if (type === 'Residential (house, condo, apartment)') {
        out.push('Residential LTB jurisdiction. Statutory remedies under the RTA. Consider whether paralegal-led representation is more cost-effective than counsel.');
      }
      if (type === 'Commercial (office, retail, industrial)') {
        out.push('Commercial tenancy. Common law and the Commercial Tenancies Act govern. Distress, re-entry, and forfeiture remedies are landlord-side levers.');
      }
      if (issue === 'Unpaid rent') {
        out.push('Rent arrears. For residential, N4 plus L1 path. For commercial, distrain or terminate plus sue for arrears.');
      }
      break;
    }

    case 'corporate_money_control': {
      const evidence = slotVal(state, 'evidence_of_irregularity');
      const irregType = slotVal(state, 'irregularity_type');
      out.push('Director duties under section 122 OBCA require investigating and stopping the misconduct. Failure to act creates personal liability exposure.');
      if (evidence === 'Yes') {
        out.push('Documented evidence in hand. Mareva or Norwich orders may be available depending on amount and movement risk.');
      }
      if (irregType === 'Fraudulent or inflated invoices') {
        out.push('Invoice fraud pattern. Civil recovery often sequential with criminal complaint; timing of each affects evidence preservation.');
      }
      break;
    }

    case 'vendor_supplier_dispute': {
      const reason = slotVal(state, 'billing_dispute_reason');
      if (reason === 'Unauthorized or unexpected charges') {
        out.push('Unauthorized charges. Review terms of service for unilateral price-change clauses; if absent, demand chargeback or refund as first step.');
      }
      if (reason === 'Overcharged for services or goods received') {
        out.push('Overcharge dispute. Reconcile invoices against contract or PO; quantify the delta clearly before any demand.');
      }
      break;
    }

    case 'contract_dispute': {
      const written = slotVal(state, 'written_terms') ?? slotVal(state, 'contract_exists');
      if (written !== 'Yes') {
        out.push('No written terms confirmed. Email and message trail can establish contract; gather it early. Verbal agreements are enforceable but proof-heavy.');
      }
      break;
    }
    case 'wrongful_dismissal':
      out.push('Standard tools: common-law reasonable notice (Bardal factors: age, length of service, character of employment, availability of similar work) sets the upper bound. ESA minimums are the floor.');
      out.push('Termination clause review is the first move. A valid ESA-compliant clause caps notice at the statutory minimum. Most clauses fail one of three tests: vagueness, failure-to-meet-ESA, or post-Waksdale unenforceability.');
      out.push('Mitigation duty: the lead has to look for comparable work. Document the job search early: bad mitigation evidence becomes the employer\'s defence.');
      out.push('Most files settle pre-claim. Demand letter → counter → settlement is the typical arc. Litigation only when the employer refuses to engage.');
      break;
    case 'severance_review':
      out.push('Never sign at the table. Releases waive ALL claims including human-rights, WSIB, unpaid wages, bonus, and equity entitlements: not just the dismissal claim.');
      out.push('The signing deadline is rarely as firm as the employer says. A polite "I\'m getting legal advice on this" extends most offers without prejudice.');
      out.push('Compare the offer against Bardal expectation: is this 70% of likely common-law notice, or 30%? That ratio drives whether to negotiate or accept.');
      out.push('Tax structuring matters: retiring allowance up to a cap can roll into RRSP without immediate tax. Coordinate with the lead\'s accountant.');
      break;
    case 'harassment_complaint':
      out.push('HRTO vs civil court: HRTO is faster, cheaper, and has narrower remedies. Civil court has wider remedies (incl. punitive damages) but slower and more expensive. Forum choice is a strategic decision, not a default.');
      out.push('HRTO has a 1-year limitation from the last incident. Civil action has 2 years. Confirm date of the most recent incident before any forum advice.');
      out.push('Constructive dismissal is the bridge: if harassment forced resignation, the matter becomes a wrongful-dismissal claim alongside (or instead of) the human-rights claim.');
      out.push('Internal-complaint history matters: did the lead report? What did the employer do? Failure to address known harassment is its own ground.');
      break;
    case 'wage_recovery':
      out.push('Ministry of Labour route is free but capped (currently $10,000 recovery cap, 6-month-back limit). For larger amounts the civil claim is the only real option.');
      out.push('Civil claim path: Small Claims if under $35k; Superior Court above. Wage-recovery cases under Small Claims are often paralegal-tier work.');
      out.push('Independent contractor vs employee misclassification is a frequent finding: many "contractors" are employees at law. CRA misclassification has tax consequences for both sides.');
      out.push('Vacation pay and overtime are the most-commonly-owed and easiest-to-prove categories. Final pay (failure to pay on termination) triggers ESA penalties.');
      break;
    case 'employment_contract_review':
      out.push('Termination clause is the single most important review point: it caps the lead\'s notice entitlement on exit. Waksdale (2020 ONCA) struck down many standard termination clauses; most pre-2020 templates are now unenforceable.');
      out.push('Restrictive covenants (non-compete, non-solicit, NDA) are presumptively unenforceable in Ontario without proper consideration and reasonableness. Defendant-side often has strong arguments.');
      out.push('Bonus and commission entitlement clauses determine what happens to those amounts on dismissal. Often poorly drafted; advise the lead what to push for.');
      out.push('Probation periods: ESA still applies after 3 months. A "6-month probation" clause is often unenforceable.');
      break;
    case 'employment_general': {
      const t = lower(state.input);
      if (/(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
        out.push('Wrongful dismissal standard tools: common-law reasonable notice (Bardal factors), ESA minimums as the floor, mitigation duty on the employee. Most matters settle pre-claim.');
        out.push('Confirm the employment contract carefully: a valid termination clause that meets ESA can cap notice at the statutory minimum.');
      }
      if (/severance/.test(t)) {
        out.push('Severance offers: never sign at the table. Review the release language for what claims are being waived (human rights, WSIB, bonus, equity) before signing.');
      }
      if (/(harassment|discriminat|human rights)/.test(t)) {
        out.push('Human rights claims: HRTO is the primary forum; civil courts have concurrent jurisdiction but procedure is different. Choice of forum drives strategy.');
      }
      if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
        out.push('Wage recovery: Ministry of Labour ESA claim is free but caps recovery (currently $10k after 6 months back). Civil claim has higher ceiling but costs more.');
      }
      if (/(non-compete|nda|restrictive covenant)/.test(t)) {
        out.push('Restrictive covenants: presumptively unenforceable in Ontario without proper consideration and reasonableness. Defendant-side often has strong arguments.');
      }
      out.push('Employer side vs employee side determines tone. Confirm which seat the client sits in before any external communication.');
      break;
    }
    case 'will_drafting':
      out.push('Standard package: primary will + continuing POA for property + POA for personal care. Add secondary will when there are business shares or personal-effects bequests that benefit from probate avoidance.');
      out.push('Blended families, dependants, or beneficiaries with capacity issues materially change the scope and risk profile. Trust planning becomes a serious consideration.');
      out.push('Asset map drives the work: registered accounts (RRSP, TFSA, RRIF) with beneficiary designations pass outside the estate; joint-held assets pass by right of survivorship. Confirm what is actually IN the estate before quoting probate-avoidance work.');
      out.push('Spousal claims: a surviving spouse can elect equalization under the Family Law Act if the estate distribution is less favourable than divorce. Plan around this in second-marriage scenarios.');
      break;
    case 'power_of_attorney':
      out.push('Two documents, two purposes: Continuing POA for property (financial decisions) and POA for personal care (health + living decisions). Drafted separately or in one document.');
      out.push('Springing vs immediate: property POA can take effect immediately on signing OR only on a triggering event (e.g. medical certificate of incapacity). Confirm the grantor\'s preference.');
      out.push('Multiple attorneys: jointly (all must agree) vs jointly-and-severally (any one can act). Severally is more practical for day-to-day; jointly forces consensus on big decisions.');
      out.push('Capacity at time of signing is critical. If the grantor\'s capacity is in question, get a capacity assessment before drafting: a POA signed by an incapable grantor is void.');
      break;
    case 'probate':
      out.push('Estate Information Return (EIR) is due 180 days from issuance of the Certificate of Appointment. Late filing carries penalties.');
      out.push('Assets passing OUTSIDE the estate (joint accounts, designated registered accounts, life-insurance beneficiaries) don\'t require probate and don\'t count for EAT. Verify what\'s actually in the estate before estimating scope.');
      out.push('Estate Administration Tax: 1.5% on estate value above $50,000 (in Ontario). On a $1M estate that\'s ~$14,250, paid by the estate at the time of application.');
      out.push('Multiple wills strategy (primary + secondary) can probate only the assets that require it (typically real estate + bank accounts), leaving business shares + personal effects on the unprobated secondary will. Saves substantial EAT.');
      out.push('Distribution sequence: pay debts and taxes first, then specific bequests, then residue. Premature distribution exposes the executor personally if creditors later surface.');
      break;
    case 'estate_dispute':
      out.push('Three grounds for will challenge: lack of testamentary capacity (medical at time of signing), undue influence (someone pressured the testator), suspicious circumstances (procurement by a beneficiary, lawyer with conflict, etc.). Each requires different evidence.');
      out.push('Notice of Objection blocks the probate application. File BEFORE the Certificate is issued; after issuance the burden flips to attacking the issued certificate.');
      out.push('Dependant support claim under SLRA s. 58: spouse, children, dependant parents can claim if the will didn\'t provide adequate support. 6-month limitation from grant of probate.');
      out.push('Pass-of-accounts: a beneficiary can require the executor to formally account. Used both as a sword (force disclosure) and a shield (protect the executor with court approval of accounts).');
      out.push('Most estate disputes settle at mediation. Estimated trial cost rarely justifies pursuing to judgment unless the estate is large or there\'s a fundamental fact dispute.');
      break;
    case 'estates_general': {
      const t = lower(state.input);
      if (/(make a will|need a will|write a will|new will)/.test(t)) {
        out.push('Standard will package usually includes: primary will, secondary will (if business interests warrant probate avoidance), continuing POA for property, POA for personal care. Sequence the conversation around family and asset map.');
        out.push('Blended families, dependants, or beneficiaries with capacity issues materially change the scope and risk profile.');
      }
      if (/(power of attorney|poa)/.test(t) && !/(misused|stealing|theft|refused|denied)/.test(t)) {
        out.push('POA drafting: continuing POA for property + POA for personal care, separately or in one document. Confirm whether the client wants the property POA to be effective on signing or on triggering events.');
      }
      if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
        out.push('Probate application (Certificate of Appointment of Estate Trustee) requires Estate Information Return within 180 days of issuance. Estate Administration Tax is 1.5% above $50k.');
        out.push('If assets pass outside probate (joint accounts, designations), confirm what is actually in the estate before quoting; this drives both EAT and complexity.');
      }
      if (/(contest|challenge|dispute|fight over).*will/.test(t) || /(inheritance dispute|beneficiary dispute|estate dispute)/.test(t)) {
        out.push('Estate litigation tools: notice of objection, application to pass accounts, will challenge on capacity / undue influence / suspicious circumstances. Discovery and mediation are common steps before trial.');
        out.push('Limitation periods are matter-specific (notice of objection: before certificate issued; dependant support claim: 6 months from grant). Confirm timing early.');
      }
      if (/(passed away|died|deceased|when my (mother|father|parent))/.test(t)) {
        out.push('Sensitivity matters: bereavement context calls for warmth in the callback. Confirm location and timing of any service before pushing into procedure.');
      }
      break;
    }
  }
  return out;
}

// ─── What to confirm before quoting ───────────────────────────────────────

function buildWhatToConfirm(state: EngineState): string[] {
  const out: string[] = [];
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      const regulated = slotVal(state, 'regulated_industry');
      const crossBorder = slotVal(state, 'cross_border_work');
      out.push('Whether they want federal or provincial incorporation (driven by name protection and operating provinces).');
      out.push('Whether HST registration is needed at incorporation (anticipated revenue above $30k or professional services exporting).');
      if (sub === 'partner_setup') {
        out.push('Vesting schedule and what happens if a founder leaves in year one.');
        out.push('Whether any of the founders are already incorporated, which affects rollover planning.');
      }
      if (regulated && regulated !== 'No, general services or products' && regulated !== 'Not sure') {
        out.push('Regulatory licensing sequence (some regulators require corp to exist before licensing; others the reverse).');
      }
      if (crossBorder && crossBorder !== 'No, Canada only' && crossBorder !== 'Not sure yet') {
        out.push('Whether US-source income is expected; if so, treaty status and W-8BEN-E filing.');
      }
      out.push('Proposed share structure (single class vs multi-class with different voting and dividend rights).');
      break;
    }
    case 'shareholder_dispute':
      out.push('Documentation of the client\'s share ownership (certificates, USA, corporate ledger).');
      out.push('Whether there is a unanimous shareholders agreement and what its dispute-resolution clauses say.');
      out.push('Whether any shares have been issued or transferred without proper resolutions, which can be challenged.');
      break;
    case 'unpaid_invoice':
      out.push('Whether the contract has interest, costs, or arbitration clauses that change recovery economics.');
      out.push('The defendant\'s solvency. A judgment is only useful if collectable.');
      out.push('Limitation period status (two years from when payment came due in Ontario).');
      break;
    case 'real_estate_litigation':
      out.push('The exact discoverability date of the issue, for limitation analysis.');
      out.push('Whether there is a buyer\'s or seller\'s remorse element vs a real legal cause.');
      out.push('Insurance coverage on either side (title insurance, errors and omissions on agents).');
      break;
    case 'construction_lien':
      out.push('Last day of supply, written down with supporting invoices or daily logs.');
      out.push('Whether the project is a public-sector job (different lien regime) or private.');
      out.push('Whether holdback was paid out and to whom.');
      break;
    case 'preconstruction_condo':
      out.push('Whether the builder is Tarion-registered and the unit is enrolled.');
      out.push('Whether the agreement allows the builder to extend closing and on what terms.');
      out.push('Status of the buyer\'s mortgage commitment (lapsed approvals are common in delayed closings).');
      break;
    case 'mortgage_dispute':
      out.push('Whether there are subsequent encumbrances (other charges) that would survive sale.');
      out.push('The borrower\'s equity position (forced sale at fire-sale price vs market sale economics).');
      out.push('Whether the borrower has refinancing options at the current rate environment.');
      break;
    case 'commercial_real_estate':
      out.push('Whether the property is HST-bearing (most commercial is) and whether the buyer is HST-registered (self-assessment relief).');
      out.push('Existing leases, estoppel status, and any options to renew or purchase that survive closing.');
      out.push('Title insurance vs full off-title search depending on transaction value and risk profile.');
      break;
    case 'residential_purchase_sale':
      out.push('Whether the buyer is a first-time buyer (LTT rebate eligibility, RRSP HBP).');
      out.push('Whether the property is in Toronto (additional municipal LTT) or elsewhere in Ontario.');
      out.push('Whether the buyer is a non-resident (NRST applies).');
      break;
    case 'landlord_tenant': {
      const type = slotVal(state, 'tenancy_type');
      if (type === 'Residential (house, condo, apartment)') {
        out.push('Whether any prior LTB orders exist between the parties (affects strategy).');
        out.push('Whether the unit is rent-controlled (built before 2018 vs after).');
      }
      out.push('Status of the lease (term, renewal status, signed copy).');
      break;
    }
    case 'corporate_money_control':
      out.push('Whether the client has authority to act (director, officer, majority shareholder).');
      out.push('What evidence has been preserved (originals, emails, bank statements) and whether the suspected party still has access.');
      out.push('Whether other directors are aware; coordinated action vs unilateral changes the strategy.');
      break;
    case 'wrongful_dismissal':
      out.push('Termination date, length of service (start date), age, role, total compensation (base + bonus + benefits).');
      out.push('Whether there is a written employment contract and what the termination clause says.');
      out.push('What the employer has offered so far, IN WRITING.');
      out.push('Job-search activity since the termination (mitigation evidence).');
      out.push('Whether the lead has accepted any other role or is in active interviews.');
      break;
    case 'severance_review':
      out.push('Signing deadline on the offer.');
      out.push('Full text of the release language (not just the headline number).');
      out.push('Length of service, role, total compensation: for the Bardal comparison.');
      out.push('Whether any consideration has already been paid (some employers pay a small amount up front; this becomes the "fresh consideration" argument).');
      break;
    case 'harassment_complaint':
      out.push('Date of the most recent incident (for HRTO 1-year limitation).');
      out.push('Whether the lead is still employed there.');
      out.push('Documentation of the conduct: dates, witnesses, written communications, voice notes.');
      out.push('Whether an internal complaint was made and what the employer\'s response was.');
      out.push('Whether the conduct is tied to a protected ground (sex, race, age, disability, etc.): required for HRTO jurisdiction.');
      break;
    case 'wage_recovery':
      out.push('Exact unpaid amount and the pay period it covers.');
      out.push('Pay-period evidence: pay stubs, timesheets, employment letter showing rate.');
      out.push('Whether the lead has filed an ESA claim with the Ministry of Labour.');
      out.push('Employer\'s position in writing (if any).');
      out.push('Whether the lead is classified as employee or independent contractor (misclassification is a frequent recovery angle).');
      break;
    case 'employment_contract_review':
      out.push('Signing deadline (most contract reviews are time-pressured).');
      out.push('Full text of the contract (or all amendments to an existing one).');
      out.push('Whether the lead has any leverage (multiple offers, scarce skills) for negotiation.');
      out.push('Current role + comp if this is a new-employer contract; helps frame what to push for.');
      break;
    case 'employment_general': {
      const t = lower(state.input);
      out.push('Which side of the matter the client sits on (employee or employer).');
      if (/(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
        out.push('Termination date, written notice or termination letter, and what the employer has paid out so far.');
        out.push('Length of service, age, role, and salary: Bardal factors that drive reasonable notice.');
        out.push('Whether the employment contract has a termination clause and whether it complies with ESA minimums.');
      }
      if (/severance/.test(t)) {
        out.push('Whether a severance offer is on the table, the signing deadline, and the full release language.');
      }
      if (/(harassment|discriminat|human rights)/.test(t)) {
        out.push('Whether the client has filed an internal complaint and what the employer\'s response has been.');
        out.push('Documentation of the conduct (dates, witnesses, written communications).');
      }
      if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
        out.push('Exact unpaid amount, pay period covered, and whether ESA standards were ever in writing.');
      }
      out.push('Whether the client has spoken to another lawyer about this matter.');
      break;
    }
    case 'will_drafting':
      out.push('Family situation (spouse, children, dependants, blended family: especially second marriage).');
      out.push('Asset map: home, registered accounts, business interests, properties elsewhere, foreign assets.');
      out.push('Existing wills or POAs being replaced (and whether they were drafted in another jurisdiction).');
      out.push('Whether the lead wants the firm to be named executor or to act as solicitor for an external executor.');
      out.push('Guardianship plans if there are minor children.');
      break;
    case 'power_of_attorney':
      out.push('Whether the grantor still has decision-making capacity (critical: a POA signed by an incapable grantor is void).');
      out.push('Whether existing POAs need to be revoked.');
      out.push('Springing vs immediate effect on the property POA.');
      out.push('Single attorney vs joint vs jointly-and-severally.');
      break;
    case 'probate':
      out.push('Whether the deceased had a will (testate vs intestate).');
      out.push('Approximate estate value and breakdown by asset type (real estate, investments, business, cash).');
      out.push('Which assets pass OUTSIDE probate (joint, designated beneficiaries).');
      out.push('Whether any beneficiaries are disputing or threatening to dispute.');
      out.push('Whether the named executor is willing and able to act.');
      break;
    case 'estate_dispute':
      out.push('Date of death and date of grant of probate (if issued).');
      out.push('Basis of the challenge: capacity, undue influence, suspicious circumstances, interpretation, dependant support.');
      out.push('Whether a notice of objection has been filed.');
      out.push('The standing of the person disputing (beneficiary, dependant, prior-will beneficiary, creditor).');
      out.push('What outcome the client realistically wants (re-distribution, removal of executor, accounting only).');
      break;
    case 'estates_general': {
      const t = lower(state.input);
      if (/(make a will|need a will|write a will|update.*will|new will)/.test(t)) {
        out.push('Family situation (spouse, children, dependants, blended family).');
        out.push('Asset map (home, registered accounts, business interests, beneficiary designations).');
        out.push('Whether there is an existing will or POA being replaced.');
      }
      if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
        out.push('Whether the deceased had a will (testate vs intestate).');
        out.push('Approximate estate value and whether assets pass outside the estate (joint, designated).');
        out.push('Whether there are any disputes among beneficiaries or with the executor.');
      }
      if (/(contest|challenge|dispute|fight over).*will/.test(t) || /(inheritance dispute|beneficiary dispute|estate dispute)/.test(t)) {
        out.push('Date of death, date of grant of probate (if issued), and what claim is being made.');
        out.push('Whether a notice of objection has been filed or any application is pending.');
        out.push('The standing of the person disputing (beneficiary, dependant, creditor).');
      }
      if (/(power of attorney|poa)/.test(t)) {
        out.push('Whether the grantor still has decision-making capacity.');
        out.push('Whether existing POAs need to be revoked and replaced.');
      }
      out.push('Whether the client wants probate avoidance considered (secondary wills, joint ownership, designated beneficiaries).');
      break;
    }
  }
  return out;
}

// ─── Cross-sell or follow-up opportunities ────────────────────────────────

function buildCrossSell(state: EngineState): string[] {
  const out: string[] = [];
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const employees = slotVal(state, 'employees_planned');
      const ip = slotVal(state, 'ip_planned');
      const crossBorder = slotVal(state, 'cross_border_work');
      out.push('Annual corporate maintenance retainer (minute book, annual filings).');
      if (employees && employees !== 'No, just me') {
        out.push('Employment agreements and contractor agreements as headcount grows.');
      }
      if (ip && ip !== 'No, services only') {
        out.push('Trademark filings (CIPO and possibly USPTO).');
        out.push('IP assignment agreements at incorporation and from contractors.');
      }
      if (crossBorder && crossBorder !== 'No, Canada only') {
        out.push('Cross-border tax structuring referral if not in scope.');
      }
      out.push('Shareholders agreement update at first hire or first investor conversation.');
      break;
    }
    case 'shareholder_dispute':
      out.push('If the matter resolves to a buyout: corporate cleanup, share transfer documentation, and tax planning on the buyout proceeds.');
      out.push('Updated unanimous shareholders agreement to prevent recurrence with remaining shareholders.');
      break;
    case 'real_estate_litigation':
      out.push('If a closing eventually proceeds: handle the closing.');
      out.push('Title insurance review and any defects exposed by the dispute.');
      break;
    case 'residential_purchase_sale':
      out.push('Will and POA review at closing (life event triggers).');
      out.push('Estate planning if the property is significant.');
      break;
    case 'commercial_real_estate':
      out.push('Lease drafting or review for tenant or third-party leases on the property.');
      out.push('Corporate structure for the holding entity if not already optimised.');
      break;
    case 'preconstruction_condo':
      out.push('Closing the unit when occupancy completes (or assignment if buyer wants to exit).');
      out.push('Will and POA at closing.');
      break;
    case 'construction_lien':
      out.push('Standard form contracts and lien-protection clauses for future projects.');
      out.push('Collections retainer for ongoing AR if pattern of slow payment.');
      break;
    case 'corporate_money_control':
      out.push('Internal controls review and director and officer training.');
      out.push('Updated bylaws and signing authorities.');
      break;
    case 'wrongful_dismissal':
    case 'severance_review':
      out.push('Will and POA update on settlement (life-event trigger).');
      out.push('Tax structuring of settlement amounts (retiring allowance, RRSP rollover).');
      out.push('Employment contract review for the next role to avoid the same exposure.');
      break;
    case 'harassment_complaint':
      out.push('Tort claim against individual harasser may run alongside HRTO claim.');
      out.push('Constructive dismissal claim if the harassment forced resignation.');
      break;
    case 'wage_recovery':
      out.push('Independent-contractor vs employee misclassification review (tax + CPP/EI implications).');
      out.push('Employment contract review for the next role.');
      break;
    case 'employment_contract_review':
      out.push('Restrictive-covenant defence if the lead is leaving a current employer.');
      out.push('Will and POA package given new employment situation.');
      break;
    case 'employment_general': {
      const t = lower(state.input);
      if (/(fired|terminated|let go|laid off|dismissed|lost my job|severance)/.test(t)) {
        out.push('Will and POA update on settlement (life-event trigger).');
        out.push('Tax structuring on settlement amounts (retiring allowance, RRSP rollover).');
        out.push('Employment contract review for the next role to avoid the same exposure.');
      }
      if (/(harassment|discriminat|human rights)/.test(t)) {
        out.push('Tort claim against individual harasser may run alongside HRTO claim.');
      }
      out.push('Estate planning if the client has children or a spouse and no current will.');
      break;
    }
    case 'will_drafting':
      out.push('Real estate transactions: confirm whether title is held in a way that supports the estate plan (joint vs tenants-in-common).');
      out.push('Corporate matter: if the client owns a business, secondary will + shareholder-direction docs avoid probate on the shares.');
      out.push('Family law: marriage contract or cohabitation agreement may affect what the will can do.');
      break;
    case 'power_of_attorney':
      out.push('Will drafting (POA usually bundled with a will in the same engagement).');
      out.push('Capacity-assessment coordination if there are concerns about the grantor.');
      break;
    case 'probate':
      out.push('Sale of real estate held by the estate (transactional matter, separate engagement).');
      out.push('Tax filings for the deceased (terminal return) and the estate (T3): refer to accountant.');
      out.push('Beneficiary planning for the receiving beneficiaries (their own wills + tax planning on inheritance).');
      break;
    case 'estate_dispute':
      out.push('Mediation services (often the resolution path; many estate matters mediate before trial).');
      out.push('Will-drafting engagement for the remaining family members to prevent recurrence.');
      break;
    case 'estates_general': {
      const t = lower(state.input);
      if (/(make a will|need a will|write a will|new will|update.*will)/.test(t)) {
        out.push('Real estate transactions: confirm whether title is held in a way that supports the estate plan.');
        out.push('Corporate matter: if the client owns a business, secondary will and shareholder-direction docs avoid probate on the shares.');
        out.push('Family law: marriage contract or cohabitation agreement may affect what the will can do.');
      }
      if (/(probate|estate administration)/.test(t)) {
        out.push('Sale of real estate held by the estate (transactional matter).');
        out.push('Tax filings for the deceased and the estate (refer to accountant or in-house).');
      }
      if (/(contest|challenge|dispute|fight over).*will/.test(t)) {
        out.push('Mediation services if estate litigation is opened: most disputes resolve before trial.');
      }
      break;
    }
  }
  return out;
}

// ─── Call openers (3-5 ranked questions) ──────────────────────────────────

function buildCallOpeners(state: EngineState): string[] {
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      const out = [
        'Confirm what the business actually does and who the customers are. Drives every other piece of advice.',
        'Confirm timeline. Are we incorporating this week, this month, or thinking about it for later?',
        'Confirm budget expectations. Anchor the conversation in scope vs cost from the first call.',
      ];
      if (sub === 'partner_setup') {
        out.push('Ask each founder to describe what they expect to contribute and what they expect in return. Misalignments here predict every future shareholder dispute.');
      }
      if (sub === 'buy_in_or_joining') {
        out.push('Confirm what documents have been shared and who else is reviewing them on the seller side.');
      }
      out.push('Confirm whether the client has spoken to an accountant. If yes, coordinate; if no, recommend one before structure decisions are locked.');
      return out;
    }
    case 'shareholder_dispute':
      return [
        'Confirm exactly what triggered the call now. The new event tells you what relief is most urgent.',
        'Confirm documentation: shares, USA, financials. Without standing and proof, options narrow.',
        'Confirm what outcome the client actually wants: stay and fix, exit on best terms, or sue for damages.',
        'Confirm the other shareholders\' posture. Coordinated minority vs solo dispute changes the strategy.',
      ];
    case 'unpaid_invoice':
      return [
        'Confirm exact amount, dates, and what was delivered.',
        'Confirm whether the debtor has acknowledged the debt in writing (changes limitation analysis).',
        'Confirm the debtor\'s solvency and whether assets are at risk of dissipation.',
        'Confirm whether there is a prior business relationship to preserve, which affects whether to lead with demand or settlement.',
      ];
    case 'real_estate_litigation':
      return [
        'Confirm the exact date of the alleged breach or discovery, for limitation purposes.',
        'Confirm what documents exist (APS, amendments, emails between counsel or agents).',
        'Confirm whether the client has spoken to insurance (title or other) before legal escalation.',
        'Confirm the client\'s realistic outcome: damages, specific performance, deposit recovery, or walk away.',
      ];
    case 'construction_lien':
      return [
        'Confirm exact date of last supply with supporting documents.',
        'Confirm the contract chain (owner, GC, sub) and the client\'s position in it.',
        'Confirm whether holdback was withheld and is still owing.',
        'Confirm the project address and PIN for lien registration prep.',
      ];
    case 'preconstruction_condo':
      return [
        'Confirm builder name and Tarion registration status.',
        'Confirm the dates: original closing date, current expected date, and any amendments to the APS.',
        'Confirm deposit amount and how it is held.',
        'Confirm what communications the client has had with the builder in writing.',
      ];
    case 'mortgage_dispute':
      return [
        'Confirm the exact stage: notice received, sale advertised, or sale completed.',
        'Confirm equity position and any other charges on title.',
        'Confirm whether the client has explored refinancing or sale by them.',
        'Confirm urgency: redemption windows in mortgage law are strict and short.',
      ];
    case 'commercial_real_estate':
      return [
        'Confirm the deal type: purchase, sale, or lease, and on which side the client sits.',
        'Confirm closing or signing date.',
        'Confirm financing status and whether HST treatment has been confirmed.',
        'Confirm any environmental, zoning, or tenancy concerns the client is already aware of.',
      ];
    case 'residential_purchase_sale':
      return [
        'Confirm closing date and whether financing is locked.',
        'Confirm property address and whether it is in Toronto (LTT impact).',
        'Confirm whether the client is a first-time buyer or non-resident (rebate or NRST impact).',
        'Confirm if anything has come up that worries them (closing-day issues are far more expensive than standard closings).',
      ];
    case 'landlord_tenant':
      return [
        'Confirm residential vs commercial.',
        'Confirm the dispute: rent, possession, lease terms, or damage.',
        'Confirm what notices or applications have been started.',
        'Confirm timeline urgency (sheriff dates, hearing dates, court dates).',
      ];
    case 'corporate_money_control':
      return [
        'Confirm the client\'s authority to act on behalf of the company.',
        'Confirm what evidence is in hand and what the suspected party still has access to.',
        'Confirm whether other directors or officers are aware and aligned.',
        'Confirm whether the client wants civil recovery, criminal complaint, or both.',
      ];
    case 'vendor_supplier_dispute':
      return [
        'Confirm exact disputed amount and the vendor\'s response so far.',
        'Confirm what contract or terms govern (signed, click-through, or none).',
        'Confirm whether the relationship is ongoing or terminated.',
      ];
    case 'contract_dispute':
      return [
        'Confirm what was agreed and where it is documented.',
        'Confirm what specifically went wrong and when.',
        'Confirm the client\'s preferred outcome.',
      ];
    case 'wrongful_dismissal':
      return [
        'Confirm termination date, length of service, role, age, and total compensation.',
        'Confirm whether there is a written employment contract and what its termination clause says (Waksdale-style review).',
        'Confirm what the employer has offered in writing so far.',
        'Confirm job-search activity since termination (mitigation evidence).',
      ];
    case 'severance_review':
      return [
        'Confirm signing deadline on the offer.',
        'Confirm the full release language: what is being waived beyond the dismissal claim.',
        'Confirm length of service + comp for the Bardal comparison.',
        'Confirm whether any consideration has already been paid for the release.',
      ];
    case 'harassment_complaint':
      return [
        'Confirm date of the most recent incident (1-year HRTO limitation).',
        'Confirm whether the client is still employed there.',
        'Confirm what documentation exists (dates, witnesses, written communications).',
        'Confirm what the employer\'s response has been to any internal complaint.',
      ];
    case 'wage_recovery':
      return [
        'Confirm the exact amount owed and the pay period.',
        'Confirm whether the lead has pay stubs / timesheets / employment letter.',
        'Confirm whether an ESA claim has been filed with the Ministry of Labour.',
        'Confirm whether the lead is classified as employee or contractor (misclassification angle).',
      ];
    case 'employment_contract_review':
      return [
        'Confirm signing deadline.',
        'Confirm the full text of the contract.',
        'Confirm whether the lead has alternative offers (negotiation leverage).',
        'Confirm what specifically worries the lead about the document.',
      ];
    case 'employment_general': {
      const t = lower(state.input);
      const out: string[] = [];
      out.push('Confirm which side the client is on (employee or employer) and what specifically happened.');
      if (/(fired|terminated|let go|laid off|dismissed|lost my job)/.test(t)) {
        out.push('Confirm termination date, length of service, role, age, and salary. These drive any notice analysis.');
        out.push('Confirm whether there is a written employment contract and whether the termination clause is in it.');
        out.push('Confirm what the employer has offered so far, in writing.');
      } else if (/severance/.test(t)) {
        out.push('Confirm whether the client has received a severance offer in writing.');
        out.push('Confirm the signing deadline and whether any consideration has been paid.');
        out.push('Confirm what the client understands they are giving up by signing.');
      } else if (/(harassment|discriminat|human rights)/.test(t)) {
        out.push('Confirm whether the client has filed an internal complaint and what the employer\'s response has been.');
        out.push('Confirm dates and documentation of the incidents.');
        out.push('Confirm whether the client is still employed there.');
      } else if (/(unpaid wages|overtime|wages owed|esa)/.test(t)) {
        out.push('Confirm exact unpaid amount and the pay period it covers.');
        out.push('Confirm whether the client has filed an ESA claim with the Ministry of Labour.');
      } else {
        out.push('Confirm what specifically the client needs help with: termination, severance, harassment, wages, contract, or something else.');
        out.push('Confirm timeline: is anything imminent (sign by date, hearing date, last day of work)?');
      }
      out.push('Confirm whether the client has spoken to another lawyer about this matter.');
      return out;
    }
    case 'will_drafting':
      return [
        'Confirm family situation (spouse, children, dependants, blended family).',
        'Confirm asset map (home, registered accounts, business interests, foreign assets).',
        'Confirm whether the client wants the firm to be the named executor or to act as solicitor for an external executor.',
        'Confirm guardianship plans for any minor children.',
      ];
    case 'power_of_attorney':
      return [
        'Confirm the grantor still has decision-making capacity.',
        'Confirm whether any existing POAs need to be revoked.',
        'Confirm springing vs immediate effect for the property POA.',
        'Confirm single attorney vs joint vs jointly-and-severally.',
      ];
    case 'probate':
      return [
        'Confirm whether the deceased had a will (testate vs intestate).',
        'Confirm approximate estate value + what assets pass outside probate.',
        'Confirm date of death and whether any application has been started.',
        'Confirm whether the named executor is willing and able to act.',
      ];
    case 'estate_dispute':
      return [
        'Confirm the basis of the challenge: capacity, undue influence, suspicious circumstances, interpretation, or dependant support.',
        'Confirm date of death, date of grant (if issued), and what relief the client is seeking.',
        'Confirm the client\'s standing (beneficiary, dependant, prior-will beneficiary, creditor).',
        'Confirm what realistic outcome the client wants (re-distribution, executor removal, accounting only).',
      ];
    case 'estates_general': {
      const t = lower(state.input);
      const out: string[] = [];
      out.push('Confirm what specifically the client needs: planning (will and POA), administering an estate, or disputing one.');
      if (/(make a will|need a will|write a will|new will|update.*will)/.test(t)) {
        out.push('Confirm family situation: spouse, children, dependants, blended family.');
        out.push('Confirm asset map: home, registered accounts, business interests, real estate elsewhere.');
        out.push('Confirm whether the client wants the firm to be the named executor or to act as solicitor for an external executor.');
      } else if (/(probate|estate trustee|executor|apply for probate)/.test(t)) {
        out.push('Confirm whether the deceased had a will (testate vs intestate).');
        out.push('Confirm approximate estate value and what assets are involved.');
        out.push('Confirm date of death and whether any application has been started.');
      } else if (/(contest|challenge|dispute|fight over).*will/.test(t)) {
        out.push('Confirm the basis of the challenge: capacity, undue influence, suspicious circumstances, or interpretation.');
        out.push('Confirm date of death, date of grant (if issued), and what relief the client is seeking.');
        out.push('Confirm the client\'s standing (beneficiary, dependant, prior beneficiary in earlier will, creditor).');
      } else if (/(power of attorney|poa)/.test(t)) {
        out.push('Confirm whether the grantor still has decision-making capacity.');
        out.push('Confirm whether existing POAs need to be revoked.');
      } else {
        out.push('Confirm whether the matter is planning ahead, administration, or a dispute.');
      }
      out.push('Confirm whether the client has prior wills or estate documents that need review.');
      return out;
    }
    case 'out_of_scope':
      return [
        'Decide whether the firm accepts this area, refers it out, or holds for triage.',
      ];
    default:
      return [];
  }
}
