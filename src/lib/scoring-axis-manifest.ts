/**
 * Axis-input manifest (H1): per matter type, which slots feed which scoring
 * axis (value / complexity / urgency / readiness).
 *
 * WHY THIS LIVES IN lib/ AND NOT screen-engine/ (deliberate spec refinement):
 * The H1 spec drafted this as an engine file byte-mirrored to the sandbox
 * (DR-033). On build we refined that: this manifest is GENERATED FROM the
 * engine scorers (band.ts) as the source of truth, but it is CONSUMED BY the
 * CRM scoring port (confidence / missing-fields / explanation), not executed
 * by the engine. The sandbox does not consume it. Housing it in lib/ keeps it
 * out of the DR-033 mirror set and the DR-058 engine-sync gate while still
 * giving H1 its real protection: the drift test re-derives this from band.ts
 * on every run (see __tests__/scoring-axis-manifest.test.ts). Precedent:
 * DR-060 (discovery-floor.ts) and DR-061 (pending-slot-reply.ts) put
 * engine-derived helpers in lib/ for the same reason.
 *
 * DO NOT hand-edit AXIS_INPUT_MANIFEST. Regenerate it from the scorers:
 *   GEN_AXIS_MANIFEST=1 npx vitest run src/lib/__tests__/scoring-axis-manifest.test.ts
 * The drift test fails until the committed manifest matches the live scorers.
 */
import { SLOT_REGISTRY } from '@/lib/screen-engine/slotRegistry';
import type { EngineState, MatterType } from '@/lib/screen-engine/types';

export type Axis = 'value' | 'complexity' | 'urgency' | 'readiness';

/** A slot reference; `label` (the slot's question) drives the missing-field message. */
export interface SlotRef {
  slotId: string;
  label: string;
}

export type MatterAxisInputs = Record<Axis, SlotRef[]>;

/** Keyed by in-scope matter type (out_of_scope / unknown carry no scoring slots). */
export type AxisInputManifest = Partial<Record<MatterType, MatterAxisInputs>>;

// ── consumers (the CRM scoring port reads these) ────────────────────────────

/** Contact slots apply to every matter type (contact-capture doctrine). */
export const UNIVERSAL_CONTACT_SLOT_IDS: readonly string[] = SLOT_REGISTRY.filter(
  (s) => s.tier === 'contact',
).map((s) => s.id);

function questionFor(slotId: string): string {
  return SLOT_REGISTRY.find((s) => s.id === slotId)?.question ?? slotId;
}

function contactRefs(): SlotRef[] {
  return UNIVERSAL_CONTACT_SLOT_IDS.map((slotId) => ({ slotId, label: questionFor(slotId) }));
}

/**
 * Every slot that feeds scoring for a matter type, deduped: the union of the
 * four axes plus the universal contact slots. This is the input set the
 * confidence / completeness port computes against (NOT the legacy flat
 * SCORABLE_FIELDS, which is the H1 bug).
 */
export function manifestSlotsForMatter(matterType: MatterType): SlotRef[] {
  const refs = new Map<string, SlotRef>();
  const add = (r: SlotRef) => { if (!refs.has(r.slotId)) refs.set(r.slotId, r); };
  const entry = AXIS_INPUT_MANIFEST[matterType];
  if (entry) {
    entry.value.forEach(add);
    entry.complexity.forEach(add);
    entry.urgency.forEach(add);
    entry.readiness.forEach(add);
  }
  contactRefs().forEach(add);
  return [...refs.values()];
}

/** The unanswered manifest slots for a lead, i.e. the missing-field list. */
export function missingSlotsForMatter(state: EngineState): SlotRef[] {
  return manifestSlotsForMatter(state.matter_type).filter((r) => {
    const v = state.slots[r.slotId];
    return v == null || v.trim() === '';
  });
}

// ── committed artifact (generated from band.ts; do not hand-edit) ───────────

export const AXIS_INPUT_MANIFEST: AxisInputManifest = {
  "business_setup_advisory": {
    "value": [
      {
        "slotId": "revenue_expectation",
        "label": "What kind of revenue do you expect in the first year?"
      }
    ],
    "complexity": [
      {
        "slotId": "cross_border_work",
        "label": "Will you sell to or work with clients outside Canada?"
      },
      {
        "slotId": "employees_planned",
        "label": "Are you planning to hire anyone in the first year?"
      },
      {
        "slotId": "ip_planned",
        "label": "Do you have brand, software, or other intellectual property to protect?"
      },
      {
        "slotId": "regulated_industry",
        "label": "Is your industry regulated?"
      },
      {
        "slotId": "signed_anything",
        "label": "Have you already signed or agreed to anything?"
      }
    ],
    "urgency": [
      {
        "slotId": "advisory_timing",
        "label": "When do you need help?"
      },
      {
        "slotId": "business_stage",
        "label": "How far along is the business?"
      },
      {
        "slotId": "employees_planned",
        "label": "Are you planning to hire anyone in the first year?"
      },
      {
        "slotId": "revenue_expectation",
        "label": "What kind of revenue do you expect in the first year?"
      },
      {
        "slotId": "signed_anything",
        "label": "Have you already signed or agreed to anything?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "shareholder_dispute": {
    "value": [
      {
        "slotId": "company_profitable",
        "label": "Is the company profitable or holding meaningful assets?"
      },
      {
        "slotId": "corporate_records_available",
        "label": "Do you have access to the company's financial records or bank accounts?"
      },
      {
        "slotId": "dividend_or_money_issue",
        "label": "Is company money being taken or used in a way you don't agree with?"
      },
      {
        "slotId": "management_exclusion",
        "label": "Has your partner restricted your access to company decisions, records, or accounts?"
      },
      {
        "slotId": "ownership_percentage",
        "label": "What percentage of the company do you own, if you know?"
      },
      {
        "slotId": "proof_of_ownership",
        "label": "Do you have any documents, emails, or messages showing your ownership or decision-making role in the company?"
      },
      {
        "slotId": "shareholder_agreement",
        "label": "Do you have a shareholder agreement or any ownership documents?"
      }
    ],
    "complexity": [
      {
        "slotId": "corporate_records_available",
        "label": "Do you have access to the company's financial records or bank accounts?"
      },
      {
        "slotId": "management_exclusion",
        "label": "Has your partner restricted your access to company decisions, records, or accounts?"
      },
      {
        "slotId": "proof_of_ownership",
        "label": "Do you have any documents, emails, or messages showing your ownership or decision-making role in the company?"
      },
      {
        "slotId": "shareholder_agreement",
        "label": "Do you have a shareholder agreement or any ownership documents?"
      }
    ],
    "urgency": [
      {
        "slotId": "corporate_records_available",
        "label": "Do you have access to the company's financial records or bank accounts?"
      },
      {
        "slotId": "dividend_or_money_issue",
        "label": "Is company money being taken or used in a way you don't agree with?"
      },
      {
        "slotId": "management_exclusion",
        "label": "Has your partner restricted your access to company decisions, records, or accounts?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "unpaid_invoice": {
    "value": [
      {
        "slotId": "amount_at_stake",
        "label": "About how much money is involved?"
      }
    ],
    "complexity": [
      {
        "slotId": "contract_exists",
        "label": "Is there a signed contract or written agreement?"
      },
      {
        "slotId": "dispute_reason",
        "label": "What is the other side saying about why they are not paying?"
      },
      {
        "slotId": "written_terms",
        "label": "Do you have anything in writing that shows what was agreed, like emails or messages?"
      }
    ],
    "urgency": [
      {
        "slotId": "payment_status",
        "label": "Has any of the amount been paid?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "contract_dispute": {
    "value": [
      {
        "slotId": "amount_at_stake",
        "label": "About how much money is involved?"
      }
    ],
    "complexity": [
      {
        "slotId": "contract_exists",
        "label": "Is there a signed contract or written agreement?"
      },
      {
        "slotId": "dispute_reason",
        "label": "What is the other side saying about why they are not paying?"
      },
      {
        "slotId": "written_terms",
        "label": "Do you have anything in writing that shows what was agreed, like emails or messages?"
      }
    ],
    "urgency": [
      {
        "slotId": "payment_status",
        "label": "Has any of the amount been paid?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "vendor_supplier_dispute": {
    "value": [
      {
        "slotId": "amount_at_stake",
        "label": "About how much money is involved?"
      }
    ],
    "complexity": [
      {
        "slotId": "vendor_contract_exists",
        "label": "Do you have a contract, agreement, or terms of service with this vendor?"
      }
    ],
    "urgency": [
      {
        "slotId": "billing_dispute_reason",
        "label": "What is the billing dispute about?"
      },
      {
        "slotId": "payment_status",
        "label": "Has any of the amount been paid?"
      },
      {
        "slotId": "vendor_services_received",
        "label": "Were the goods or services you are disputing actually delivered or performed?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "corporate_money_control": {
    "value": [
      {
        "slotId": "irregularity_amount",
        "label": "Do you have an estimate of how much money may be involved?"
      }
    ],
    "complexity": [
      {
        "slotId": "evidence_of_irregularity",
        "label": "Do you have any records, statements, or documents showing the irregularity?"
      },
      {
        "slotId": "irregularity_type",
        "label": "What type of financial concern do you have?"
      }
    ],
    "urgency": [
      {
        "slotId": "reported_to_anyone",
        "label": "Has this been reported to anyone (police, accountant, other directors, or your board)?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "corporate_general": {
    "value": [],
    "complexity": [
      {
        "slotId": "company_involvement",
        "label": "What is your relationship to the company involved?"
      },
      {
        "slotId": "corporate_problem_type",
        "label": "What best describes the problem you are facing?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "general_counsel_advisory": {
    "value": [
      {
        "slotId": "gca_business_size",
        "label": "Roughly how big is the business?"
      },
      {
        "slotId": "gca_engagement_shape",
        "label": "What kind of legal help do you need?"
      }
    ],
    "complexity": [
      {
        "slotId": "gca_engagement_shape",
        "label": "What kind of legal help do you need?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "notary_services": {
    "value": [
      {
        "slotId": "notary_document_type",
        "label": "What kind of document do you need notarized?"
      }
    ],
    "complexity": [
      {
        "slotId": "notary_document_type",
        "label": "What kind of document do you need notarized?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "commercial_real_estate": {
    "value": [
      {
        "slotId": "commercial_re_amount",
        "label": "What is the approximate transaction or lease value?"
      }
    ],
    "complexity": [
      {
        "slotId": "commercial_property_type",
        "label": "What type of commercial property is involved?"
      },
      {
        "slotId": "commercial_re_concerns",
        "label": "What concern brought you to a lawyer?"
      }
    ],
    "urgency": [
      {
        "slotId": "commercial_re_stage",
        "label": "Where are you in the deal?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "residential_purchase_sale": {
    "value": [
      {
        "slotId": "residential_re_amount",
        "label": "What is the approximate property value?"
      },
      {
        "slotId": "residential_re_concern",
        "label": "What do you need help with most?"
      }
    ],
    "complexity": [
      {
        "slotId": "residential_mortgage_situation",
        "label": "Where are you with financing?"
      },
      {
        "slotId": "residential_re_concern",
        "label": "What do you need help with most?"
      }
    ],
    "urgency": [
      {
        "slotId": "residential_closing_timeline",
        "label": "When is the closing?"
      },
      {
        "slotId": "residential_re_concern",
        "label": "What do you need help with most?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "real_estate_litigation": {
    "value": [
      {
        "slotId": "litigation_amount",
        "label": "What is roughly at stake?"
      },
      {
        "slotId": "litigation_subject",
        "label": "What is the dispute about?"
      }
    ],
    "complexity": [
      {
        "slotId": "litigation_documents",
        "label": "Do you have the agreement of purchase and sale or other written contract?"
      },
      {
        "slotId": "litigation_settlement_attempted",
        "label": "Has there been any attempt to settle so far?"
      },
      {
        "slotId": "litigation_stage",
        "label": "Has anything been filed in court yet?"
      },
      {
        "slotId": "litigation_subject",
        "label": "What is the dispute about?"
      }
    ],
    "urgency": [
      {
        "slotId": "litigation_stage",
        "label": "Has anything been filed in court yet?"
      },
      {
        "slotId": "litigation_when_event",
        "label": "When did the issue happen or come to light?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "landlord_tenant": {
    "value": [
      {
        "slotId": "tenancy_amount",
        "label": "How much rent or damages are involved?"
      },
      {
        "slotId": "tenancy_type",
        "label": "Is this a residential or commercial tenancy?"
      }
    ],
    "complexity": [
      {
        "slotId": "tenancy_lease_exists",
        "label": "Is there a written lease?"
      },
      {
        "slotId": "tenancy_type",
        "label": "Is this a residential or commercial tenancy?"
      }
    ],
    "urgency": [
      {
        "slotId": "tenancy_notice_status",
        "label": "Has formal notice been given or any application started?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "construction_lien": {
    "value": [
      {
        "slotId": "lien_amount",
        "label": "How much is owed?"
      }
    ],
    "complexity": [
      {
        "slotId": "lien_documents",
        "label": "Do you have the contract, invoices, and proof of work?"
      },
      {
        "slotId": "lien_role",
        "label": "What is your role on the project?"
      }
    ],
    "urgency": [
      {
        "slotId": "lien_last_supply",
        "label": "When did you last supply work or materials to the project?"
      },
      {
        "slotId": "lien_preserved",
        "label": "Has a claim against the property been registered yet?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "preconstruction_condo": {
    "value": [
      {
        "slotId": "precon_amount",
        "label": "How much is at stake?"
      },
      {
        "slotId": "precon_issue",
        "label": "What is the issue?"
      }
    ],
    "complexity": [
      {
        "slotId": "precon_documents",
        "label": "Do you have the agreement of purchase and sale with the builder?"
      },
      {
        "slotId": "precon_role",
        "label": "What is your role?"
      }
    ],
    "urgency": [
      {
        "slotId": "precon_developer_status",
        "label": "How is the developer responding?"
      },
      {
        "slotId": "precon_issue",
        "label": "What is the issue?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "mortgage_dispute": {
    "value": [
      {
        "slotId": "mortgage_amount",
        "label": "What is the approximate mortgage balance or amount in dispute?"
      }
    ],
    "complexity": [
      {
        "slotId": "mortgage_documents",
        "label": "Do you have the mortgage documents and any notices received?"
      },
      {
        "slotId": "mortgage_lender_type",
        "label": "What kind of lender?"
      }
    ],
    "urgency": [
      {
        "slotId": "mortgage_status",
        "label": "What is happening right now?"
      }
    ],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "real_estate_general": {
    "value": [],
    "complexity": [
      {
        "slotId": "real_estate_problem_type",
        "label": "What best describes what you need help with?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "wrongful_dismissal": {
    "value": [
      {
        "slotId": "desired_outcome_wrongful_dismissal",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "dismissal_reason_given",
        "label": "What reason did your employer give for the dismissal?"
      },
      {
        "slotId": "salary_band",
        "label": "What was your approximate annual compensation?"
      },
      {
        "slotId": "severance_offered",
        "label": "Has the employer offered any severance?"
      },
      {
        "slotId": "signed_release",
        "label": "Have you signed anything yet (a release, settlement, or final paperwork)?"
      },
      {
        "slotId": "tenure_band",
        "label": "How long were you with the employer?"
      }
    ],
    "complexity": [
      {
        "slotId": "desired_outcome_wrongful_dismissal",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "dismissal_reason_given",
        "label": "What reason did your employer give for the dismissal?"
      },
      {
        "slotId": "salary_band",
        "label": "What was your approximate annual compensation?"
      },
      {
        "slotId": "severance_offered",
        "label": "Has the employer offered any severance?"
      },
      {
        "slotId": "signed_release",
        "label": "Have you signed anything yet (a release, settlement, or final paperwork)?"
      },
      {
        "slotId": "tenure_band",
        "label": "How long were you with the employer?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "severance_review": {
    "value": [
      {
        "slotId": "desired_outcome_severance_review",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "salary_band",
        "label": "What was your approximate annual compensation?"
      },
      {
        "slotId": "severance_deadline",
        "label": "Is there a deadline to respond?"
      },
      {
        "slotId": "severance_offer_amount",
        "label": "How does the severance offer compare to your tenure?"
      },
      {
        "slotId": "signed_release",
        "label": "Have you signed anything yet (a release, settlement, or final paperwork)?"
      },
      {
        "slotId": "tenure_band",
        "label": "How long were you with the employer?"
      }
    ],
    "complexity": [
      {
        "slotId": "desired_outcome_severance_review",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "salary_band",
        "label": "What was your approximate annual compensation?"
      },
      {
        "slotId": "severance_deadline",
        "label": "Is there a deadline to respond?"
      },
      {
        "slotId": "severance_offer_amount",
        "label": "How does the severance offer compare to your tenure?"
      },
      {
        "slotId": "signed_release",
        "label": "Have you signed anything yet (a release, settlement, or final paperwork)?"
      },
      {
        "slotId": "tenure_band",
        "label": "How long were you with the employer?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "harassment_complaint": {
    "value": [
      {
        "slotId": "desired_outcome_harassment",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "harassment_employment_status",
        "label": "Are you still employed there?"
      },
      {
        "slotId": "harassment_type",
        "label": "What type of behaviour is at issue?"
      },
      {
        "slotId": "reported_to_hr",
        "label": "Have you reported this to HR or anyone in the company?"
      }
    ],
    "complexity": [
      {
        "slotId": "desired_outcome_harassment",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "harassment_employment_status",
        "label": "Are you still employed there?"
      },
      {
        "slotId": "harassment_type",
        "label": "What type of behaviour is at issue?"
      },
      {
        "slotId": "reported_to_hr",
        "label": "Have you reported this to HR or anyone in the company?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "wage_recovery": {
    "value": [
      {
        "slotId": "desired_outcome_wage_recovery",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "wages_owed_band",
        "label": "Roughly how much is owed?"
      },
      {
        "slotId": "wages_type",
        "label": "What kind of pay is owed?"
      }
    ],
    "complexity": [
      {
        "slotId": "desired_outcome_wage_recovery",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "wages_owed_band",
        "label": "Roughly how much is owed?"
      },
      {
        "slotId": "wages_type",
        "label": "What kind of pay is owed?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "employment_contract_review": {
    "value": [
      {
        "slotId": "contract_review_concerns",
        "label": "Is there a specific clause that concerns you?"
      },
      {
        "slotId": "contract_review_timeline",
        "label": "How soon do you need it reviewed?"
      },
      {
        "slotId": "contract_review_type",
        "label": "What kind of contract is it?"
      },
      {
        "slotId": "desired_outcome_contract_review",
        "label": "What outcome are you hoping for?"
      }
    ],
    "complexity": [
      {
        "slotId": "contract_review_concerns",
        "label": "Is there a specific clause that concerns you?"
      },
      {
        "slotId": "contract_review_timeline",
        "label": "How soon do you need it reviewed?"
      },
      {
        "slotId": "contract_review_type",
        "label": "What kind of contract is it?"
      },
      {
        "slotId": "desired_outcome_contract_review",
        "label": "What outcome are you hoping for?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "employment_general": {
    "value": [
      {
        "slotId": "employment_problem_type",
        "label": "What best describes the situation?"
      }
    ],
    "complexity": [
      {
        "slotId": "employment_problem_type",
        "label": "What best describes the situation?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "will_drafting": {
    "value": [
      {
        "slotId": "desired_outcome_will_drafting",
        "label": "What are you hoping to put in place?"
      },
      {
        "slotId": "estate_complexity",
        "label": "How would you describe your estate?"
      }
    ],
    "complexity": [
      {
        "slotId": "children_count",
        "label": "Do you have children or dependants to provide for?"
      },
      {
        "slotId": "estate_complexity",
        "label": "How would you describe your estate?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "existing_will_status",
        "label": "Do you currently have a will?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "power_of_attorney": {
    "value": [
      {
        "slotId": "marital_status",
        "label": "What is your marital status?"
      },
      {
        "slotId": "poa_existing_documents",
        "label": "Are there existing documents in place?"
      },
      {
        "slotId": "poa_type",
        "label": "What kind of power of attorney do you need?"
      },
      {
        "slotId": "poa_urgency",
        "label": "What is prompting this now?"
      }
    ],
    "complexity": [
      {
        "slotId": "marital_status",
        "label": "What is your marital status?"
      },
      {
        "slotId": "poa_existing_documents",
        "label": "Are there existing documents in place?"
      },
      {
        "slotId": "poa_type",
        "label": "What kind of power of attorney do you need?"
      },
      {
        "slotId": "poa_urgency",
        "label": "What is prompting this now?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "probate": {
    "value": [
      {
        "slotId": "estate_value_band",
        "label": "Roughly what is the estate worth?"
      },
      {
        "slotId": "executor_role",
        "label": "What is your role in the estate?"
      },
      {
        "slotId": "relationship_to_deceased",
        "label": "What was your relationship to the person who passed?"
      },
      {
        "slotId": "will_status_probate",
        "label": "Is there a will?"
      }
    ],
    "complexity": [
      {
        "slotId": "estate_value_band",
        "label": "Roughly what is the estate worth?"
      },
      {
        "slotId": "executor_role",
        "label": "What is your role in the estate?"
      },
      {
        "slotId": "relationship_to_deceased",
        "label": "What was your relationship to the person who passed?"
      },
      {
        "slotId": "will_status_probate",
        "label": "Is there a will?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "estate_dispute": {
    "value": [
      {
        "slotId": "desired_outcome_estate_dispute",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "estate_court_status",
        "label": "Has anything been filed in court yet?"
      },
      {
        "slotId": "estate_dispute_role",
        "label": "What is your role in the dispute?"
      },
      {
        "slotId": "estate_dispute_type",
        "label": "What kind of dispute is this?"
      },
      {
        "slotId": "estate_value_band",
        "label": "Roughly what is the estate worth?"
      }
    ],
    "complexity": [
      {
        "slotId": "desired_outcome_estate_dispute",
        "label": "What outcome are you hoping for?"
      },
      {
        "slotId": "estate_court_status",
        "label": "Has anything been filed in court yet?"
      },
      {
        "slotId": "estate_dispute_role",
        "label": "What is your role in the dispute?"
      },
      {
        "slotId": "estate_dispute_type",
        "label": "What kind of dispute is this?"
      },
      {
        "slotId": "estate_value_band",
        "label": "Roughly what is the estate worth?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  },
  "estates_general": {
    "value": [
      {
        "slotId": "estates_problem_type",
        "label": "What best describes the situation?"
      }
    ],
    "complexity": [
      {
        "slotId": "estates_problem_type",
        "label": "What best describes the situation?"
      }
    ],
    "urgency": [],
    "readiness": [
      {
        "slotId": "decision_authority",
        "label": "Who decides whether to hire a lawyer for this?"
      },
      {
        "slotId": "hiring_timeline",
        "label": "When are you hoping to have a lawyer working on this?"
      },
      {
        "slotId": "other_counsel",
        "label": "Have you spoken to another lawyer about this matter?"
      }
    ]
  }
};
