import type { EngineState, LawyerReport, Band, ResolvedFact } from './types';
import { computeBand, bandLabel, scoreFourAxes, buildAxisReasoning } from './band';
import { selectNextSlot, getDecisionGap } from './selector';

// ─── Provenance helpers ───────────────────────────────────────────────────

function isConfirmed(state: EngineState, slotId: string): boolean {
  const meta = state.slot_meta[slotId];
  return !!meta && (meta.source === 'explicit' || meta.source === 'answered');
}

function slotVal(state: EngineState, id: string): string | null {
  return state.slots[id] ?? null;
}

// ─── Matter snapshot ──────────────────────────────────────────────────────

function buildMatterSnapshot(state: EngineState): string {
  switch (state.matter_type) {
    case 'business_setup_advisory': {
      const sub = state.advisory_subtrack;
      if (sub === 'buy_in_or_joining') return 'Corporate advisory — buying into or reviewing documents for an existing business.';
      if (sub === 'partner_setup') return 'Corporate advisory — new business setup with one or more co-founders.';
      if (sub === 'solo_setup') return 'Corporate advisory — sole-owner incorporation or structure guidance.';
      return 'Corporate advisory — business setup matter.';
    }
    case 'shareholder_dispute':
      return 'Corporate dispute — shareholder or co-owner conflict involving access to records, company control, or financial conduct.';
    case 'unpaid_invoice':
      return 'Commercial recovery — unpaid invoice or failure to pay for delivered work, goods, or services.';
    case 'contract_dispute':
      return 'Commercial dispute — breach or denial of a business agreement.';
    case 'vendor_supplier_dispute':
      return 'Commercial dispute — billing error, overcharge, or non-delivery dispute with a vendor or supplier.';
    case 'corporate_money_control':
      return 'Corporate financial irregularity — concern about unauthorized transactions, missing funds, or financial misconduct within a company.';
    case 'corporate_general':
      return 'Corporate/business matter — problem type not yet fully determined. Routing questions pending.';
    case 'commercial_real_estate':
      return 'Commercial real estate transaction — purchase, sale, or lease of office, retail, industrial, or investment property.';
    case 'residential_purchase_sale':
      return 'Residential real estate transaction — purchase or sale of a home, condo, or other dwelling.';
    case 'real_estate_litigation':
      return 'Real estate litigation — dispute over a transaction, deposit, title, boundary, or alleged misrepresentation.';
    case 'landlord_tenant':
      return 'Landlord-tenant matter — dispute over rent, possession, lease terms, or tenancy obligations.';
    case 'construction_lien':
      return 'Construction Act matter — unpaid contractor or subcontractor seeking lien preservation, perfection, or recovery.';
    case 'preconstruction_condo':
      return 'Pre-construction condo matter — issue with builder agreement, deposits, delayed closing, or assignment of a unit.';
    case 'mortgage_dispute':
      return 'Mortgage matter — power-of-sale, default, refinance, or discharge dispute.';
    case 'real_estate_general':
      return 'Real estate matter — problem type not yet fully determined. Routing questions pending.';
    case 'out_of_scope': {
      const areaLabels: Record<string, string> = {
        family: 'family law',
        immigration: 'immigration',
        employment: 'employment',
        criminal: 'criminal',
        personal_injury: 'personal injury',
        estates: 'wills and estates',
      };
      const area = areaLabels[state.practice_area] ?? 'an unsupported practice area';
      return `Lead detected as ${area}. Outside the corporate / real estate matter packs currently configured. Forwarded to the firm with the area flagged for manual triage.`;
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
        services.push('Commercial dispute — refund or chargeback strategy');
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
    case 'out_of_scope':
      return ['Manual triage by firm staff', 'Refer or accept based on firm scope of practice'];
    default:
      return ['Legal consultation'];
  }
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
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed — estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $4,000–$10,000+ (commercial dispute, meaningful amount).`;
      if (amount === '$5,000–$25,000') return `${prefix} $1,500–$4,000 (mid-range invoice recovery).`;
      return `${prefix} $500–$1,500 (lower-value claim).`;
    }
    case 'contract_dispute': {
      const amount = slotVal(state, 'amount_at_stake');
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed — estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $4,000–$10,000+`;
      return `${prefix} $1,500–$5,000 depending on complexity.`;
    }
    case 'vendor_supplier_dispute': {
      const amount = slotVal(state, 'amount_at_stake');
      if (!isConfirmed(state, 'amount_at_stake')) return `${prefix} Amount not confirmed — estimate not available.`;
      if (amount === 'Over $100,000' || amount === '$25,000–$100,000') return `${prefix} $3,000–$8,000+ (commercial vendor dispute).`;
      if (amount === '$5,000–$25,000') return `${prefix} $1,000–$3,000 (mid-range billing dispute).`;
      return `${prefix} $500–$1,500 (lower-value vendor dispute).`;
    }
    case 'corporate_money_control': {
      const amount = slotVal(state, 'irregularity_amount');
      if (!amount || amount === 'Unknown') return `${prefix} Amount unknown. Financial irregularity matters often involve $5,000–$50,000+ in legal fees depending on complexity and whether litigation is required.`;
      if (amount === 'Over $200,000') return `${prefix} $10,000–$30,000+ (major financial fraud matter with potential litigation).`;
      if (amount === '$50,000–$200,000') return `${prefix} $5,000–$15,000+ (significant irregularity requiring investigation and legal strategy).`;
      return `${prefix} $3,000–$8,000 (financial irregularity — scope depends on whether civil or criminal action follows).`;
    }
    case 'corporate_general':
      return `${prefix} Scope not yet determined. Depends on matter type once routing is complete.`;
    case 'commercial_real_estate': {
      const amt = slotVal(state, 'commercial_re_amount');
      if (!amt || amt === 'Not sure') return `${prefix} Value not confirmed — typical commercial closing $4,000–$15,000+ depending on transaction size.`;
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
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed — estimate not available.`;
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
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed — estimate not available.`;
      if (amt === 'Over $500,000') return `${prefix} $15,000–$50,000+ (large construction lien matter, possible reference proceeding).`;
      if (amt === '$100,000–$500,000') return `${prefix} $7,000–$20,000 (substantial lien matter).`;
      if (amt === '$25,000–$100,000') return `${prefix} $4,000–$10,000 (mid-range lien recovery).`;
      return `${prefix} $2,000–$5,000 (lower-value lien — assess whether process cost is justified).`;
    }
    case 'preconstruction_condo': {
      const amt = slotVal(state, 'precon_amount');
      const issue = slotVal(state, 'precon_issue');
      if (issue === 'Reviewing the contract before signing') return `${prefix} $750–$2,000 (pre-signing contract review).`;
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed — typical preconstruction dispute $3,000–$10,000+.`;
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
      if (!amt || amt === 'Not sure') return `${prefix} Amount not confirmed — typical mortgage dispute $3,000–$10,000+.`;
      if (amt === 'Over $5M') return `${prefix} $15,000–$50,000+ (major mortgage dispute).`;
      if (amt === '$1M–$5M') return `${prefix} $7,000–$20,000.`;
      return `${prefix} $3,000–$8,000 (standard mortgage dispute).`;
    }
    case 'real_estate_general':
      return `${prefix} Scope not yet determined. Depends on matter type once routing is complete.`;
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
        return 'Do you have any documentation of your ownership stake — a shareholder agreement, share certificates, or emails confirming it?';
      }
      if (!isConfirmed(state, 'corporate_records_available')) {
        return "Have you been able to access the company's financial records or bank accounts since this started?";
      }
      return 'What outcome would resolve this for you — a buyout, restored access, or recovery of funds?';
    }
    case 'unpaid_invoice': {
      if (!isConfirmed(state, 'amount_at_stake')) return 'How much is owed, and do you have an invoice or statement showing the amount?';
      if (!isConfirmed(state, 'proof_of_performance')) return 'Can you demonstrate that the work, goods, or services were actually delivered?';
      return 'Has the other side given any reason in writing for not paying?';
    }
    case 'contract_dispute': {
      if (!isConfirmed(state, 'written_terms') && !isConfirmed(state, 'contract_exists')) {
        return 'Do you have the agreement in writing — a signed contract, emails, or messages confirming the terms?';
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
      if (!isConfirmed(state, 'irregularity_type')) return 'Can you describe what financial irregularity you have observed — missing funds, unauthorized transfers, or something else?';
      if (!isConfirmed(state, 'evidence_of_irregularity')) return 'Do you have bank statements, transaction records, or other documents showing the irregularity?';
      return 'Has this been reported to any other directors, your accountant, or law enforcement?';
    }
    case 'corporate_general':
      return 'Can you describe the business problem in more detail — who is involved, what happened, and what you need resolved?';
    case 'commercial_real_estate': {
      if (!isConfirmed(state, 'commercial_re_amount')) return 'What is the approximate transaction or lease value, and what type of commercial property is involved?';
      if (!isConfirmed(state, 'commercial_re_stage')) return 'Where are you in the deal — exploring, in negotiations, or closing scheduled?';
      return 'What is the closing date, and what specific concern brings you to a lawyer now?';
    }
    case 'residential_purchase_sale': {
      if (!isConfirmed(state, 'residential_re_stage')) return 'Where are you in the process — offer made, conditions outstanding, or closing pending?';
      if (!isConfirmed(state, 'residential_re_amount')) return 'What is the approximate property value, and what is the closing date?';
      return 'What specifically do you need help with most — agreement review, closing, or an issue that has come up?';
    }
    case 'real_estate_litigation': {
      if (!isConfirmed(state, 'litigation_subject')) return 'Can you describe the dispute — failed closing, deposit, misrepresentation, or boundary?';
      if (!isConfirmed(state, 'litigation_documents')) return 'Do you have the agreement of purchase and sale or other written documentation?';
      return 'Has anything been filed in court yet, and what outcome are you hoping for?';
    }
    case 'landlord_tenant': {
      if (!isConfirmed(state, 'tenancy_type')) return 'Is this a residential or commercial tenancy?';
      if (!isConfirmed(state, 'tenancy_issue')) return 'What is the dispute about — unpaid rent, eviction, lease breach, or damage?';
      return 'Has notice been given or has an LTB or court application been started?';
    }
    case 'construction_lien': {
      if (!isConfirmed(state, 'lien_last_supply')) return 'When did you last supply work or materials? Lien preservation timing in Ontario is tight (60 days).';
      if (!isConfirmed(state, 'lien_amount')) return 'How much is owed, and do you have the contract and invoices?';
      return 'Has a lien been preserved (registered) yet?';
    }
    case 'preconstruction_condo': {
      if (!isConfirmed(state, 'precon_issue')) return 'What is the issue — delayed closing, deposit, assignment, or Tarion warranty?';
      if (!isConfirmed(state, 'precon_amount')) return 'How much is at stake, and do you have the builder agreement?';
      return 'How is the developer responding so far?';
    }
    case 'mortgage_dispute': {
      if (!isConfirmed(state, 'mortgage_status')) return 'What is happening right now — default notice, notice of sale, or power-of-sale process?';
      if (!isConfirmed(state, 'mortgage_amount')) return 'What is the mortgage balance and the lender type (bank, private, credit union)?';
      return 'What documents and notices have you received from the lender?';
    }
    case 'real_estate_general':
      return 'Can you describe the real estate matter in more detail — property type, role, and what needs to be resolved?';
    case 'out_of_scope':
      return 'Decide whether the firm accepts this area, refers it out, or holds for triage. The screen will not pursue qualification questions for this area until a matter pack is added.';
    default:
      return 'What outcome is the client looking for, and what is their timeline?';
  }
}

// ─── Resolved facts ───────────────────────────────────────────────────────

const SLOT_LABELS: Record<string, string> = {
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
    switch (meta.source) {
      case 'explicit': source = 'stated'; break;
      case 'answered': source = 'confirmed'; break;
      case 'inferred': source = 'inferred'; break;
      default: source = 'unknown';
    }
    out.push({ label, value: val, source });
  }
  // Order: stated first (most credible), then confirmed, then inferred
  const rank: Record<ResolvedFact['source'], number> = { stated: 0, confirmed: 1, inferred: 2, unknown: 3 };
  out.sort((a, b) => rank[a.source] - rank[b.source]);
  return out;
}

function buildBandReasoningBullets(state: EngineState): string[] {
  const bullets: string[] = [];
  const matter = state.matter_type;

  // Matter and routing facts (always relevant)
  bullets.push(`Matter routed to ${matterTypeLabel(matter)} based on lead's own description.`);

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
  if (confirmed > 0) parts.push(`${confirmed} confirmed in conversation`);
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
  // SMS (and any other budgeted channel) intentionally stops asking after
  // a small number of questions — completing a thin brief beats abandoning
  // a deep one. Surface the channel context honestly so the lawyer reads
  // remaining gaps as "still to confirm on the call", not as "the lead
  // didn't bother to answer."
  if (state.channel === 'sms') {
    return [
      'Short-form intake (SMS): full discovery should happen on the call.',
      'Confirm details below the headline before quoting.',
    ];
  }
  if (state.channel === 'gbp') {
    return [
      'Short-form intake (Google Business Profile): plain-text channel inside Maps / Search.',
      'Lead came from a local search; full discovery on the call.',
    ];
  }
  if (state.channel === 'voice') {
    return [
      'Voice intake: transcribed from a phone call, single-pass extraction.',
      'Confirm what the lead said on the call back. Audio recording may be linked in the GHL conversation thread.',
    ];
  }

  const questions: string[] = [];
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
    dispute_subtype: 'Problem type not yet determined — routing question pending.',
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
    if (slotVal(state, 'dividend_or_money_issue') === 'Yes') flags.push('Money misuse alleged — potential for urgent injunctive relief.');
    if (slotVal(state, 'corporate_records_available') === 'No') flags.push('Client locked out of records or accounts — access remedy may be needed.');
    if (!isConfirmed(state, 'proof_of_ownership') && !isConfirmed(state, 'shareholder_agreement')) flags.push('Ownership not documented — case viability depends on establishing standing.');
  }

  if (state.matter_type === 'unpaid_invoice') {
    const reason = slotVal(state, 'dispute_reason');
    if (reason === 'Says work was not done properly') flags.push('Quality dispute raised — delivery proof is essential before advancing.');
    if (!isConfirmed(state, 'proof_of_performance')) flags.push('Delivery proof not confirmed — case may be vulnerable without it.');
  }

  if (state.matter_type === 'contract_dispute') {
    if (!isConfirmed(state, 'written_terms') && !isConfirmed(state, 'contract_exists')) flags.push('No written terms confirmed — verbal contract claims face a higher bar.');
  }

  if (state.matter_type === 'vendor_supplier_dispute') {
    const reason = slotVal(state, 'billing_dispute_reason');
    if (reason === 'Unauthorized or unexpected charges') flags.push('Unauthorized charges alleged — may support urgent chargeback or injunction.');
    if (!isConfirmed(state, 'vendor_contract_exists')) flags.push('No vendor contract confirmed — dispute may rest on implied terms.');
  }

  if (state.matter_type === 'corporate_money_control') {
    const irregType = slotVal(state, 'irregularity_type');
    if (irregType === 'Fraudulent or inflated invoices' || irregType === 'Unauthorized payments or transfers') {
      flags.push('Serious financial misconduct alleged — potential criminal exposure alongside civil remedies.');
    }
    if (slotVal(state, 'reported_to_anyone') === 'No, not yet') {
      flags.push('Not yet reported — lawyer should advise on timing and obligations before reporting.');
    }
    if (!isConfirmed(state, 'evidence_of_irregularity')) flags.push('No documentary evidence confirmed — forensic review may be needed.');
  }

  if (state.matter_type === 'business_setup_advisory') {
    if (slotVal(state, 'signed_anything') === 'Yes') flags.push('Client has already signed — legal review of existing documents is a priority.');
    if (state.advisory_subtrack === 'buy_in_or_joining' && slotVal(state, 'documents_exist') === 'Yes') flags.push('Documents exist for review — timeline to signing matters.');
  }

  if (state.matter_type === 'corporate_general') {
    flags.push('Problem type not yet mapped to a specific corporate matter — routing question needed before assessment.');
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
    case 'out_of_scope':
      return [
        'Decide whether the firm accepts this area, refers it out, or holds for triage.',
      ];
    default:
      return [];
  }
}
