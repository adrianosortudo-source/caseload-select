/**
 * Slot Schema Layer — S10.1
 *
 * Defines priority weights and extraction hints for every question across all
 * 35 practice area modules. This is the intelligence layer: questions are no
 * longer static UI cards but structured slots that GPT fills from free text.
 *
 * Priority scale:
 *   5 = Critical — determines band placement, always ask if not extracted
 *   4 = High     — significant CPI impact, ask in first question batch
 *   3 = Moderate — refines accuracy, ask in second batch (Band B/C only)
 *   2 = Low      — nice to have, skip for Band A/D/E
 *   1 = Minimal  — documentation / admin, only needed pre-finalize
 *
 * extraction_hints: keywords and phrases that indicate this slot is answerable
 * from the user's free text. GPT checks these when building filled_slots.
 *
 * requires: prerequisite slot IDs. Question not served until all prerequisites
 * are filled. Enforces conditional branching server-side.
 */

export interface SlotMeta {
  priority: number;
  extraction_hints: string[];
  requires?: string[];
}

/** Full slot schema: practice_area_id → question_id → SlotMeta */
export const SLOT_SCHEMA: Record<string, Record<string, SlotMeta>> = {

  // ── Personal Injury ─────────────────────────────────────────────────────────
  pi: {
    pi_q1:  { priority: 5, extraction_hints: ["driving", "driver", "my car", "behind the wheel", "passenger", "passenger seat", "pedestrian", "walking", "crosswalk", "cyclist", "cycling", "bike", "bicycle", "on foot"] },
    pi_q2:  { priority: 4, extraction_hints: ["insured", "insurance", "policy", "have insurance", "no insurance", "uninsured"] },
    pi_q16: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "this week", "just happened", "an hour ago", "this morning", "last month", "months ago", "years ago", "a year ago", "two years ago"] },
    pi_q17: { priority: 4, extraction_hints: ["hospital", "emergency", "ER", "doctor", "treatment", "medical", "ambulance", "x-ray", "scan", "MRI", "physio", "no treatment", "haven't seen a doctor", "not yet treated"] },
    pi_q31: { priority: 5, extraction_hints: ["rear-ended", "hit from behind", "side impact", "t-boned", "intersection", "ran a red", "red light", "head-on", "pedestrian struck", "cyclist struck", "ran into me"] },
    pi_q32: { priority: 4, extraction_hints: ["witness", "witnesses", "bystander", "saw it happen", "saw the accident", "no witnesses", "nobody saw", "someone saw"] },
    pi_q46: { priority: 3, extraction_hints: ["two cars", "three cars", "multiple vehicles", "pileup", "multi-car", "one other car", "several cars"] },
    pi_q47: { priority: 3, extraction_hints: ["police", "police report", "filed a report", "officer", "OPP", "Toronto Police", "no report", "didn't call police"] },
  },

  // ── Employment Law ───────────────────────────────────────────────────────────
  emp: {
    emp_q1:  { priority: 4, extraction_hints: ["employee", "employed", "worked there", "on payroll", "staff", "contractor", "freelancer", "self-employed", "gig worker"] },
    emp_q2:  { priority: 5, extraction_hints: ["fired", "terminated", "let go", "dismissed", "laid off", "without cause", "no reason", "no explanation", "they didn't say why", "wrongful dismissal"] },
    emp_q16: { priority: 5, extraction_hints: ["fired today", "fired yesterday", "fired last week", "fired this week", "fired last month", "months ago", "a year ago", "recently fired", "just got fired", "just got let go"] },
    emp_q17: { priority: 4, extraction_hints: ["notice period", "no notice", "immediate", "effective immediately", "working notice", "paid in lieu", "no working notice", "walked out the same day"] },
    emp_q31: { priority: 5, extraction_hints: ["no reason", "without cause", "performance", "misconduct", "restructuring", "downsizing", "position eliminated", "just cause", "discrimination", "harassment"] },
    emp_q32: { priority: 4, extraction_hints: ["valid reason", "legitimate reason", "deserved it", "my fault", "didn't deserve it", "wrongful", "no grounds"] },
    emp_q46: { priority: 3, extraction_hints: ["manager", "director", "VP", "executive", "C-suite", "CEO", "CFO", "entry level", "junior", "senior", "specialist"] },
    emp_q47: { priority: 5, extraction_hints: ["years", "year", "months", "12 years", "5 years", "long time", "short time", "recently started", "been there for", "worked there for"] },
  },

  // ── Family Law ───────────────────────────────────────────────────────────────
  fam: {
    fam_q1:  { priority: 5, extraction_hints: ["married", "legal marriage", "not married", "common-law", "common law partner", "not legally married"] },
    fam_q2:  { priority: 4, extraction_hints: ["Ontario", "lived in Ontario", "moved to Ontario", "years in Ontario", "based in Ontario"] },
    fam_q29: { priority: 4, extraction_hints: ["separated", "separation", "separated for", "been apart for", "living apart", "moved out", "left home", "months separated", "years separated"] },
    fam_q30: { priority: 4, extraction_hints: ["deadline", "urgent", "pension", "remarriage", "time limit", "court date", "order expires"] },
    fam_q55: { priority: 5, extraction_hints: ["one year separation", "adultery", "cheating", "affair", "cruelty", "abuse", "physical abuse", "mental cruelty"] },
    fam_q56: { priority: 3, extraction_hints: ["agreed on separation date", "dispute separation date", "disagree when we separated", "both agree"] },
    fam_q82: { priority: 3, extraction_hints: ["children", "kids", "child", "no children", "no kids", "daughter", "son", "minor children", "young children"] },
    fam_q83: { priority: 3, extraction_hints: ["house", "home", "property", "cottage", "condo", "real estate", "no property", "rent", "renting"] },
  },

  // ── Criminal Defence ─────────────────────────────────────────────────────────
  crim: {
    crim_q1:  { priority: 5, extraction_hints: ["driving", "was driving", "drove", "behind the wheel", "DUI", "impaired driving"] },
    crim_q2:  { priority: 4, extraction_hints: ["in the car", "in the vehicle", "care and control", "sitting in the car", "keys in the ignition", "asleep in the car"] },
    crim_q19: { priority: 5, extraction_hints: ["last night", "last week", "yesterday", "this weekend", "last month", "a few months ago", "a year ago", "recently charged"] },
    crim_q20: { priority: 4, extraction_hints: ["arrested", "charged", "police charged me", "got a court date", "received charges", "summons"] },
    crim_q34: { priority: 5, extraction_hints: ["impaired driving", "over 80", "over 80mg", "breathalyzer", "refused breathalyzer", "drug impairment", "drug recognition", "DRE"] },
    crim_q35: { priority: 5, extraction_hints: ["blew", "breath sample", "blood sample", "breathalyzer", "refused to blow", "refused breath test", "provided sample"] },
    crim_q52: { priority: 4, extraction_hints: ["accident", "collision", "crash", "property damage", "hit something", "no accident", "no damage", "fender bender"] },
    crim_q53: { priority: 4, extraction_hints: ["injured", "hurt", "someone got hurt", "injuries", "nobody hurt", "no injuries", "pedestrian", "passenger injured"] },
  },

  // ── Immigration ──────────────────────────────────────────────────────────────
  imm: {
    imm_q1:  { priority: 5, extraction_hints: ["permanent residence", "PR", "immigration", "immigrate", "come to Canada", "move to Canada", "live in Canada"] },
    imm_q2:  { priority: 4, extraction_hints: ["passport", "travel document", "valid passport", "expired passport", "no passport"] },
    imm_q25: { priority: 4, extraction_hints: ["Express Entry", "express entry profile", "CRS", "created profile", "EE profile"] },
    imm_q26: { priority: 4, extraction_hints: ["CRS score", "points", "CRS", "comprehensive ranking", "score of", "my score is"] },
    imm_q55: { priority: 5, extraction_hints: ["language test", "IELTS", "CELPIP", "CLB", "language requirements", "English test", "French test", "language score"] },
    imm_q56: { priority: 4, extraction_hints: ["degree", "diploma", "education", "WES", "credential assessment", "university", "college", "bachelor", "master"] },
    imm_q85: { priority: 2, extraction_hints: ["multiple countries", "lived in", "country of origin", "different countries", "third country"] },
    imm_q86: { priority: 3, extraction_hints: ["employment gap", "gaps", "unemployed for", "didn't work", "time off work", "out of work for"] },
  },

  // ── Real Estate ──────────────────────────────────────────────────────────────
  real: {
    real_q1:  { priority: 5, extraction_hints: ["buying", "selling", "purchased", "sale", "purchase", "buyer", "seller", "buying a house", "selling a house", "both buying and selling"] },
    real_q2:  { priority: 4, extraction_hints: ["house", "condo", "apartment", "commercial", "multi-unit", "townhouse", "semi-detached", "detached"] },
    real_q13: { priority: 4, extraction_hints: ["signed the agreement", "agreement of purchase", "APS", "offer accepted", "conditional offer", "firm offer", "not signed yet"] },
    real_q14: { priority: 5, extraction_hints: ["closing date", "closes in", "closing in", "close next month", "closing next week", "completion date"] },
    real_q25: { priority: 3, extraction_hints: ["price", "purchase price", "sale price", "$", "million", "hundred thousand", "asking price", "selling for"] },
    real_q26: { priority: 2, extraction_hints: ["address", "legal description", "property address", "located at"] },
    real_q37: { priority: 3, extraction_hints: ["condo fees", "maintenance fees", "special assessment", "status certificate", "condo corporation"] },
    real_q38: { priority: 3, extraction_hints: ["co-owner", "joint ownership", "shared ownership", "multiple owners", "with my spouse", "with my partner", "partner on title"] },
  },

  // ── Wills & Estates ──────────────────────────────────────────────────────────
  est: {
    est_q1:  { priority: 5, extraction_hints: ["will", "create a will", "update my will", "new will", "no will", "estate planning"] },
    est_q2:  { priority: 4, extraction_hints: ["full mental capacity", "sound mind", "mental clarity", "cognitive", "dementia", "not for myself"] },
    est_q13: { priority: 4, extraction_hints: ["urgent", "health issue", "sick", "travelling", "surgery", "time sensitive", "imminent", "soon"] },
    est_q14: { priority: 4, extraction_hints: ["health concern", "diagnosis", "illness", "cancer", "hospital", "medical", "health"] },
    est_q24: { priority: 3, extraction_hints: ["home", "property", "investments", "RRSP", "TFSA", "savings", "business", "assets"] },
    est_q25: { priority: 3, extraction_hints: ["children", "dependents", "minor children", "kids", "beneficiaries", "no children"] },
    est_q36: { priority: 3, extraction_hints: ["business", "corporation", "professional practice", "firm", "company"] },
    est_q37: { priority: 2, extraction_hints: ["tax", "estate tax", "capital gains", "income splitting", "tax planning"] },
  },

  // ── Landlord-Tenant ──────────────────────────────────────────────────────────
  llt: {
    llt_q1:  { priority: 5, extraction_hints: ["landlord", "property owner", "I own", "my property", "my unit", "property manager", "registered owner"] },
    llt_q2:  { priority: 4, extraction_hints: ["lease", "rental agreement", "written lease", "verbal agreement", "month-to-month", "no lease"] },
    llt_q18: { priority: 5, extraction_hints: ["months behind", "arrears", "hasn't paid", "not paying rent", "missed payments", "behind on rent", "owes rent"] },
    llt_q19: { priority: 4, extraction_hints: ["served notice", "N4", "N5", "notice to terminate", "eviction notice", "filed notice", "haven't served"] },
    llt_q36: { priority: 4, extraction_hints: ["documented", "arrears documented", "receipts", "bank records", "disputed amount", "tenant disputes"] },
    llt_q37: { priority: 3, extraction_hints: ["partial payment", "paid some", "voided cheques", "partial rent"] },
    llt_q56: { priority: 4, extraction_hints: ["maintenance", "repairs needed", "repair issue", "counterclaim", "section 82", "s.82", "repair and maintenance"] },
    llt_q57: { priority: 4, extraction_hints: ["section 82", "s.82 defense", "counterclaim", "filed against me", "cross-application"] },
  },

  // ── Civil Litigation ─────────────────────────────────────────────────────────
  civ: {
    civ_q1:  { priority: 5, extraction_hints: ["party to the contract", "I signed", "we signed", "agreement between us", "contract with", "I was assigned"] },
    civ_q2:  { priority: 4, extraction_hints: ["enforce", "damages", "breach of contract", "they breached", "didn't pay", "didn't deliver", "specific performance"] },
    civ_q21: { priority: 4, extraction_hints: ["signed", "agreed", "date of contract", "contract dated", "last year", "two years ago"] },
    civ_q22: { priority: 4, extraction_hints: ["due date", "deadline", "overdue", "past due", "should have been completed", "performance date"] },
    civ_q46: { priority: 5, extraction_hints: ["written contract", "signed contract", "formal agreement", "verbal agreement", "no written contract", "email agreement"] },
    civ_q47: { priority: 3, extraction_hints: ["value", "contract value", "how much", "$", "thousand", "million", "amount owed"] },
    civ_q70: { priority: 2, extraction_hints: ["standard terms", "limitation clause", "warranty disclaimer", "exclusion clause", "liability limit"] },
    civ_q71: { priority: 2, extraction_hints: ["arbitration", "mediation clause", "arbitration clause", "dispute resolution clause"] },
  },

  // ── Intellectual Property ────────────────────────────────────────────────────
  ip: {
    ip_q1:  { priority: 5, extraction_hints: ["trademark owner", "registered mark", "my trademark", "licensed to use", "exclusive licensee"] },
    ip_q2:  { priority: 5, extraction_hints: ["confusingly similar", "using my mark", "copying my brand", "same name", "similar logo", "trademark infringement"] },
    ip_q17: { priority: 4, extraction_hints: ["first used", "registered", "years ago", "established mark", "long-standing brand"] },
    ip_q18: { priority: 4, extraction_hints: ["infringement started", "recently discovered", "just found out", "months ago", "years ago"] },
    ip_q36: { priority: 5, extraction_hints: ["CIPO", "registered at CIPO", "trademark registration", "TMA", "not registered", "using in commerce"] },
    ip_q37: { priority: 3, extraction_hints: ["goods", "services", "class", "NICE class", "products", "type of business"] },
    ip_q56: { priority: 3, extraction_hints: ["well-known", "famous mark", "nationally recognized", "widely recognized"] },
    ip_q57: { priority: 2, extraction_hints: ["multiple competitors", "several others", "many similar marks", "wide infringement"] },
  },

  // ── Tax Law ──────────────────────────────────────────────────────────────────
  tax: {
    tax_q1:  { priority: 5, extraction_hints: ["CRA", "reassessment", "audit", "tax audit", "audit notice", "received a letter from CRA", "CRA assessed"] },
    tax_q2:  { priority: 4, extraction_hints: ["my tax year", "business tax", "corporate tax", "personal taxes", "covers my return"] },
    tax_q17: { priority: 5, extraction_hints: ["received the notice", "got the letter", "when CRA sent", "last month", "recently", "90 days ago"] },
    tax_q18: { priority: 5, extraction_hints: ["deadline", "objection deadline", "days left", "90 days", "time to object", "filing an objection"] },
    tax_q36: { priority: 4, extraction_hints: ["income", "deductions", "credits", "transfer pricing", "offshore", "unreported income", "disallowed expenses"] },
    tax_q37: { priority: 4, extraction_hints: ["documentation", "records", "receipts", "proof", "no records", "incomplete records"] },
    tax_q56: { priority: 3, extraction_hints: ["complex transactions", "restructuring", "offshore", "related party", "transfer pricing"] },
    tax_q57: { priority: 2, extraction_hints: ["cross-border", "international", "foreign income", "foreign assets"] },
  },

  // ── Administrative / Regulatory ──────────────────────────────────────────────
  admin: {
    admin_q1:  { priority: 5, extraction_hints: ["doctor", "physician", "lawyer", "accountant", "engineer", "licensed professional", "regulated professional", "CPSO", "LSUC", "CPA"] },
    admin_q2:  { priority: 5, extraction_hints: ["complaint filed", "complaint against me", "my regulator", "regulatory complaint", "someone complained"] },
    admin_q17: { priority: 4, extraction_hints: ["when filed", "complaint date", "filed last month", "filed recently", "filed a year ago"] },
    admin_q18: { priority: 5, extraction_hints: ["ICRC notice", "notice from CPSO", "notice from regulator", "received notice", "deadline to respond"] },
    admin_q37: { priority: 5, extraction_hints: ["misconduct", "incompetence", "ethics violation", "conflict of interest", "sexual abuse", "boundary violation", "fraud"] },
    admin_q38: { priority: 4, extraction_hints: ["breached standards", "violated code", "below standard", "professional conduct"] },
    admin_q57: { priority: 4, extraction_hints: ["patient harm", "client harm", "someone was hurt", "injury caused", "harm resulted"] },
    admin_q58: { priority: 3, extraction_hints: ["criminal", "police", "charged", "criminal investigation", "criminal matter", "ethical violation only"] },
  },

  // ── Insurance (AB/SABS) ──────────────────────────────────────────────────────
  ins: {
    ins_q1:  { priority: 5, extraction_hints: ["car accident", "auto accident", "motor vehicle", "MVA", "injured in a collision", "accident in Ontario"] },
    ins_q2:  { priority: 4, extraction_hints: ["insured", "car insurance", "auto insurance", "insurance policy", "no insurance"] },
    ins_q17: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "this week", "recently", "months ago", "years ago", "last year", "just happened"] },
    ins_q18: { priority: 4, extraction_hints: ["reported to insurer", "filed a claim", "called insurance", "claim submitted", "haven't reported yet"] },
    ins_q35: { priority: 5, extraction_hints: ["soft tissue", "whiplash", "fracture", "broken bone", "head injury", "concussion", "brain injury", "spinal", "neck injury", "back injury", "PTSD", "psychological"] },
    ins_q36: { priority: 4, extraction_hints: ["catastrophic", "catastrophic impairment", "CAT", "threshold", "serious injuries"] },
    ins_q55: { priority: 4, extraction_hints: ["insurer disputing", "insurer denying", "insurer rejected", "disputes CAT", "IME"] },
    ins_q56: { priority: 3, extraction_hints: ["multiple injuries", "various injuries", "several conditions", "ongoing treatment"] },
  },

  // ── Construction Lien ────────────────────────────────────────────────────────
  const: {
    const_q1:  { priority: 5, extraction_hints: ["contractor", "subcontractor", "general contractor", "GC", "sub", "supplier", "material supplier", "worker", "tradesperson", "construction"] },
    const_q2:  { priority: 5, extraction_hints: ["performed work", "supplied materials", "did work on", "worked on a project", "construction project", "Ontario project"] },
    const_q17: { priority: 5, extraction_hints: ["last worked", "last supplied", "last on site", "finished work", "last delivery", "most recent work"] },
    const_q18: { priority: 5, extraction_hints: ["days ago", "weeks ago", "last week", "10 days", "30 days", "30-day window", "lien deadline"] },
    const_q39: { priority: 4, extraction_hints: ["claim amount", "owed", "unpaid", "$", "total claim", "invoice", "outstanding"] },
    const_q40: { priority: 4, extraction_hints: ["payment withheld", "haven't paid", "refusing to pay", "payment denied", "no payment received"] },
    const_q81: { priority: 3, extraction_hints: ["written contract", "signed contract", "no contract", "verbal agreement", "purchase order"] },
    const_q82: { priority: 3, extraction_hints: ["invoices", "receipts", "delivery slips", "timesheets", "records", "documentation"] },
  },

  // ── Bankruptcy & Insolvency ──────────────────────────────────────────────────
  bank: {
    bank_q1:  { priority: 5, extraction_hints: ["individual", "personal bankruptcy", "consumer", "not a company", "personal debts", "sole proprietor"] },
    bank_q2:  { priority: 5, extraction_hints: ["insolvent", "can't pay debts", "more debt than assets", "$250,000", "consumer proposal", "bankruptcy"] },
    bank_q13: { priority: 4, extraction_hints: ["financial difficulties", "when trouble started", "job loss", "divorce", "pandemic", "recently", "years ago"] },
    bank_q14: { priority: 5, extraction_hints: ["garnishment", "wage garnishment", "bank seizure", "court order", "enforcement", "collection action", "sheriff"] },
    bank_q30: { priority: 4, extraction_hints: ["total debt", "how much owe", "debt amount", "$", "credit card debt", "line of credit", "loans"] },
    bank_q31: { priority: 4, extraction_hints: ["income vs expenses", "monthly income", "monthly expenses", "surplus", "deficit", "can't cover expenses"] },
    bank_q67: { priority: 2, extraction_hints: ["financial statement", "income statement", "budget", "records prepared"] },
    bank_q68: { priority: 2, extraction_hints: ["pay stubs", "tax returns", "T4", "income documentation", "proof of income"] },
  },

  // ── Privacy / Data Protection ────────────────────────────────────────────────
  priv: {
    priv_q1:  { priority: 5, extraction_hints: ["personal information", "my data", "data breach", "privacy violation", "mishandled my information", "disclosed my data"] },
    priv_q2:  { priority: 4, extraction_hints: ["private company", "organization", "PIPEDA", "private sector", "business", "not a government body"] },
    priv_q11: { priority: 5, extraction_hints: ["discovered", "found out", "learned about", "noticed", "when I found out", "recently discovered"] },
    priv_q12: { priority: 4, extraction_hints: ["happened", "occurred", "when it happened", "how long ago", "months ago", "years ago"] },
    priv_q23: { priority: 5, extraction_hints: ["unauthorized collection", "disclosed without consent", "shared my data", "inaccurate information", "data breach", "hacked", "security breach"] },
    priv_q24: { priority: 4, extraction_hints: ["health information", "medical data", "financial information", "SIN", "social insurance", "identity documents", "biometric"] },
    priv_q52: { priority: 2, extraction_hints: ["OPC complaint", "filed with OPC", "complaint ready", "complaint drafted"] },
    priv_q53: { priority: 2, extraction_hints: ["privacy policy", "consent form", "documentation", "terms of service"] },
  },

  // ── Franchise Law ────────────────────────────────────────────────────────────
  fran: {
    fran_q1:  { priority: 5, extraction_hints: ["franchise", "purchased a franchise", "bought a franchise", "franchisee", "Ontario franchise"] },
    fran_q2:  { priority: 4, extraction_hints: ["sold", "transferred", "within two years", "new owner", "still operating"] },
    fran_q10: { priority: 5, extraction_hints: ["signed the agreement", "when I signed", "agreement signed", "executed agreement", "60 days", "2 years ago"] },
    fran_q11: { priority: 5, extraction_hints: ["disclosure document", "14 days", "received before signing", "after signing", "never received", "disclosure"] },
    fran_q22: { priority: 5, extraction_hints: ["received disclosure", "no disclosure given", "disclosure provided", "missing disclosure"] },
    fran_q23: { priority: 4, extraction_hints: ["misleading", "deficient disclosure", "inaccurate financials", "false projections", "material deficiency"] },
    fran_q49: { priority: 2, extraction_hints: ["have the disclosure document", "copy of disclosure", "no copy", "can't find it"] },
    fran_q50: { priority: 2, extraction_hints: ["signed agreement", "copy of franchise agreement", "have the contract"] },
  },

  // ── Environmental Law ────────────────────────────────────────────────────────
  env: {
    env_q1:  { priority: 5, extraction_hints: ["EPA order", "environmental order", "Ministry order", "Director's order", "Environmental Protection Act"] },
    env_q2:  { priority: 5, extraction_hints: ["preventive order", "remedial order", "Ministry issued", "order against me", "compliance order"] },
    env_q13: { priority: 4, extraction_hints: ["order issued", "when issued", "received the order", "last month", "recently received"] },
    env_q14: { priority: 5, extraction_hints: ["compliance deadline", "deadline", "30 days", "90 days", "must comply by", "by when"] },
    env_q29: { priority: 4, extraction_hints: ["contamination", "soil contamination", "groundwater", "air emissions", "odour", "waste", "spill", "chemical"] },
    env_q30: { priority: 4, extraction_hints: ["remediation", "clean up", "assessment required", "containment", "monitoring", "full remediation"] },
    env_q67: { priority: 2, extraction_hints: ["have the order", "copy of order", "order document", "terms of order"] },
    env_q68: { priority: 2, extraction_hints: ["ESA", "environmental site assessment", "Phase 1", "Phase 2", "contamination report"] },
  },

  // ── Provincial Offences (HTA) ────────────────────────────────────────────────
  prov: {
    prov_q1:  { priority: 5, extraction_hints: ["speeding ticket", "HTA", "highway traffic", "careless driving", "stunt driving", "traffic ticket", "traffic offence"] },
    prov_q2:  { priority: 4, extraction_hints: ["Ontario", "public road", "highway", "in Ontario", "on the 400", "on the 401"] },
    prov_q16: { priority: 5, extraction_hints: ["happened last month", "happened last week", "offence date", "when it happened", "date of the offence"] },
    prov_q17: { priority: 4, extraction_hints: ["ticket issued", "court date", "trial date", "received the ticket", "got a ticket", "charged"] },
    prov_q33: { priority: 5, extraction_hints: ["speeding", "stunt driving", "careless driving", "50 over", "50 km over", "30 over", "ring of fire", "street racing"] },
    prov_q34: { priority: 4, extraction_hints: ["how fast", "km over", "kilometers over", "speed", "alleged speed", "clocked at"] },
    prov_q74: { priority: 2, extraction_hints: ["have the ticket", "ticket in hand", "copy of ticket", "ticket number"] },
    prov_q75: { priority: 2, extraction_hints: ["police notes", "officer notes", "incident report", "accident report"] },
  },

  // ── Condominium Law ──────────────────────────────────────────────────────────
  condo: {
    condo_q1:  { priority: 5, extraction_hints: ["unit owner", "own a condo", "condo owner", "registered owner", "mortgagee"] },
    condo_q2:  { priority: 4, extraction_hints: ["directly affected", "my unit", "my parking", "my locker", "service charge against me", "rule applies to me"] },
    condo_q3:  { priority: 4, extraction_hints: ["corporation", "board", "condo board", "board member personally", "property manager", "condominium corporation"] },
    condo_q4:  { priority: 4, extraction_hints: ["board refused", "board denied", "conditions imposed", "restrictions placed", "board decision"] },
    condo_q17: { priority: 4, extraction_hints: ["violation reported", "when discovered", "recently", "months ago", "years ago", "recently noticed"] },
    condo_q18: { priority: 4, extraction_hints: ["ongoing for", "been happening for", "months", "years", "long time", "how long going on"] },
    condo_q21: { priority: 2, extraction_hints: ["declaration", "bylaws", "rules", "condo documents", "have the bylaws"] },
    condo_q22: { priority: 2, extraction_hints: ["board decision", "minutes", "enforcement notice", "written decision", "meeting minutes"] },
  },

  // ── Human Rights ────────────────────────────────────────────────────────────
  hr: {
    hr_q1:  { priority: 5, extraction_hints: ["employee", "job applicant", "former employee", "applied for a job", "denied employment", "was employed"] },
    hr_q2:  { priority: 5, extraction_hints: ["disability", "race", "gender", "sexual orientation", "age", "religion", "creed", "discrimination", "protected ground", "family status"] },
    hr_q3:  { priority: 4, extraction_hints: ["employer knew", "visible disability", "disclosed to employer", "told HR", "employer was aware", "perceived"] },
    hr_q4:  { priority: 4, extraction_hints: ["housing", "rental", "landlord", "denied housing", "tenant discrimination", "refused to rent"] },
    hr_q5:  { priority: 4, extraction_hints: ["race", "disability", "family status", "public assistance", "social assistance", "Ontario Works", "housing ground"] },
    hr_q6:  { priority: 4, extraction_hints: ["landlord knew", "visible to landlord", "disclosed to landlord", "landlord aware"] },
    hr_q26: { priority: 3, extraction_hints: ["emails", "texts", "written proof", "communications", "evidence", "screenshots"] },
    hr_q27: { priority: 3, extraction_hints: ["witnesses", "coworkers saw", "other employees", "supervisor witnessed", "witness statement"] },
  },

  // ── Education Law ────────────────────────────────────────────────────────────
  edu: {
    edu_q1: { priority: 5, extraction_hints: ["school board", "Ontario school", "public school", "Catholic school", "school within board"] },
    edu_q2: { priority: 5, extraction_hints: ["identified", "exceptionality", "special education", "IPRC", "IEP", "learning disability", "autism", "ASD"] },
    edu_q3: { priority: 4, extraction_hints: ["grade", "age", "kindergarten", "elementary", "secondary", "high school", "transition age"] },
    edu_q4: { priority: 4, extraction_hints: ["learning disability", "LD", "dyslexia", "autism", "ASD", "intellectual disability", "physical disability", "communication"] },
    edu_q5: { priority: 4, extraction_hints: ["IPRC", "IPRC hearing", "formally identified", "identification hearing", "exceptionality determination"] },
    edu_q6: { priority: 3, extraction_hints: ["diagnostic tools", "board assessment", "assessment methodology", "psychoeducational assessment"] },
    edu_q7: { priority: 2, extraction_hints: ["notice given", "notified before", "informed before assessment"] },
    edu_q8: { priority: 2, extraction_hints: ["independent assessment", "private assessment", "own psychologist", "own assessment"] },
  },

  // ── Healthcare & Medical Regulatory ─────────────────────────────────────────
  health: {
    health_q1: { priority: 5, extraction_hints: ["patient", "was a patient", "under his care", "under her care", "my doctor", "the physician"] },
    health_q2: { priority: 4, extraction_hints: ["direct knowledge", "I was there", "I experienced it", "happened to me", "I witnessed"] },
    health_q3: { priority: 4, extraction_hints: ["my experience", "I experienced", "third party", "family member", "someone told me", "on behalf of"] },
    health_q4: { priority: 5, extraction_hints: ["CPSO", "RHPA", "professional misconduct", "College of Physicians", "regulated health professional"] },
    health_q5: { priority: 5, extraction_hints: ["wrong diagnosis", "misdiagnosis", "inadequate treatment", "wrong treatment", "standard of care", "below standard"] },
    health_q6: { priority: 5, extraction_hints: ["sexual abuse", "sexual contact", "inappropriate touching", "boundary violation", "sexual assault by doctor"] },
    health_q7: { priority: 4, extraction_hints: ["conflict of interest", "dual relationship", "boundary violation", "inappropriate relationship"] },
    health_q8: { priority: 4, extraction_hints: ["impaired", "under influence", "drunk", "substance abuse", "impairment", "unsafe practice"] },
  },

  // ── Debt Collection ──────────────────────────────────────────────────────────
  debt: {
    debt_q1: { priority: 5, extraction_hints: ["consumer", "individual", "personal debt", "not a business", "consumer debt", "collection agency"] },
    debt_q2: { priority: 4, extraction_hints: ["original debtor", "guarantor", "dispute the debt", "don't owe this", "already paid", "not my debt"] },
    debt_q3: { priority: 4, extraction_hints: ["credit card", "loan", "retail purchase", "utility bill", "telecom", "consumer purchase"] },
    debt_q4: { priority: 4, extraction_hints: ["individual", "person", "not a corporation", "sole proprietor", "business entity"] },
    debt_q5: { priority: 5, extraction_hints: ["identified themselves", "didn't identify", "false name", "misleading", "identified improperly"] },
    debt_q6: { priority: 4, extraction_hints: ["notice", "required notice", "debt notice", "amount owed notice", "creditor notice"] },
    debt_q21: { priority: 3, extraction_hints: ["recordings", "screenshots", "messages", "written messages", "calls recorded", "evidence"] },
    debt_q22: { priority: 3, extraction_hints: ["witnesses", "someone heard", "family member heard", "coworker heard"] },
  },

  // ── NFP / Charity ────────────────────────────────────────────────────────────
  nfp: {
    nfp_q1: { priority: 5, extraction_hints: ["Ontario not-for-profit", "ONCA", "incorporated not-for-profit", "nonprofit corporation", "not-for-profit organization"] },
    nfp_q2: { priority: 4, extraction_hints: ["federal corporation", "CNCA", "Canada not-for-profit", "federal NFP"] },
    nfp_q3: { priority: 4, extraction_hints: ["charitable status", "registered charity", "CRA charity number", "charitable organization"] },
    nfp_q4: { priority: 3, extraction_hints: ["incorporated", "how long established", "years ago", "recently incorporated", "old organization"] },
    nfp_q5: { priority: 3, extraction_hints: ["bylaws on file", "filed bylaws", "registered bylaws", "corporate records"] },
    nfp_q6: { priority: 3, extraction_hints: ["bylaws amended", "member approval", "bylaw amendment", "changed bylaws"] },
    nfp_q7: { priority: 2, extraction_hints: ["statutory requirements", "comply with ONCA", "legal requirements"] },
    nfp_q8: { priority: 2, extraction_hints: ["consistently applied", "documented application", "bylaws enforced"] },
  },

  // ── Defamation ───────────────────────────────────────────────────────────────
  defam: {
    defam_q1:   { priority: 5, extraction_hints: ["private individual", "public figure", "company", "politician", "business owner", "professional"] },
    defam_q2:   { priority: 4, extraction_hints: ["profession", "lawyer", "doctor", "business owner", "no public profile", "private person"] },
    defam_q3:   { priority: 4, extraction_hints: ["reputation", "good reputation", "well-known", "respected", "local community", "professional reputation"] },
    defam_q4:   { priority: 3, extraction_hints: ["prior allegations", "previous complaints", "defamed before", "clean record", "prior defamation"] },
    defam_q5:   { priority: 5, extraction_hints: ["criminal conduct", "dishonest", "incompetent", "sexual impropriety", "insulted", "called me a", "accused of", "said I was"] },
    defam_q6:   { priority: 4, extraction_hints: ["stated as fact", "presented as fact", "opinion", "could be opinion", "implied", "read as"] },
    defam_q140: { priority: 3, extraction_hints: ["screenshots", "photos", "messages saved", "captured", "evidence saved"] },
    defam_q141: { priority: 3, extraction_hints: ["timestamps", "pattern", "platform records", "history", "repeated posts"] },
  },

  // ── Social Benefits ──────────────────────────────────────────────────────────
  socben: {
    socben_q1: { priority: 5, extraction_hints: ["ODSP", "Ontario Disability Support", "disability support", "receiving ODSP", "denied ODSP", "applied for ODSP"] },
    socben_q2: { priority: 5, extraction_hints: ["Ontario Works", "OW", "receiving Ontario Works", "denied Ontario Works", "welfare", "income support"] },
    socben_q3: { priority: 4, extraction_hints: ["unemployed", "not working", "no income", "part-time", "full-time employed", "self-employed"] },
    socben_q4: { priority: 4, extraction_hints: ["citizen", "permanent resident", "protected person", "refugee", "PR", "Canadian citizen"] },
    socben_q5: { priority: 5, extraction_hints: ["disability determination", "found disabled", "denied disability", "severe disability", "prolonged disability"] },
    socben_q6: { priority: 4, extraction_hints: ["medical documentation", "doctor's letter", "physician report", "disability certificate", "no documentation"] },
    socben_q7: { priority: 3, extraction_hints: ["functional assessment", "Ministry assessed", "assessment completed", "assessment disputed"] },
    socben_q8: { priority: 3, extraction_hints: ["disputed severity", "dispute permanence", "ongoing dispute", "not accepted"] },
  },

  // ── Gig Economy ──────────────────────────────────────────────────────────────
  gig: {
    gig_q1:  { priority: 5, extraction_hints: ["Uber", "DoorDash", "Lyft", "Instacart", "Fiverr", "Upwork", "TaskRabbit", "gig worker", "platform worker", "delivery driver", "ride-share"] },
    gig_q2:  { priority: 4, extraction_hints: ["platform records", "earnings history", "account history", "how long on platform", "tenure on platform"] },
    gig_q3:  { priority: 3, extraction_hints: ["account history", "work history", "assignments", "jobs completed", "trip history"] },
    gig_q4:  { priority: 4, extraction_hints: ["primary income", "main income", "rely on it", "only income", "majority of income", "full-time gig"] },
    gig_q21: { priority: 5, extraction_hints: ["deactivated", "removed", "account suspended", "removed last month", "removed recently", "months ago", "just happened"] },
    gig_q22: { priority: 4, extraction_hints: ["still deactivated", "account restored", "back on platform", "income restored", "still blocked"] },
    gig_q24: { priority: 2, extraction_hints: ["screenshots", "earnings data", "account export", "payment records", "earnings statements"] },
    gig_q25: { priority: 2, extraction_hints: ["emails from platform", "messages from app", "removal notice", "deactivation email"] },
  },

  // ── Securities Law ───────────────────────────────────────────────────────────
  sec: {
    sec_q1: { priority: 5, extraction_hints: ["director", "officer", "C-suite", "CEO", "CFO", "employee with access", "insider", "significant shareholder", "10 percent"] },
    sec_q2: { priority: 5, extraction_hints: ["fiduciary duty", "statutory insider", "OSC rules", "insider trading rules", "reporting issuer"] },
  },

  // ── Elder Law ────────────────────────────────────────────────────────────────
  elder: {
    elder_q1: { priority: 5, extraction_hints: ["elderly parent", "aging parent", "my mother", "my father", "loved one", "capacity concern", "cognitive decline", "dementia"] },
    elder_q2: { priority: 5, extraction_hints: ["power of attorney", "POA", "attorney for property", "attorney for personal care", "substitute decision-maker"] },
    elder_q3: { priority: 4, extraction_hints: ["best interests", "acting in their interest", "protecting them", "their welfare"] },
    elder_q4: { priority: 4, extraction_hints: ["no conflict of interest", "financially stable", "not financially motivated", "conflict"] },
    elder_q5: { priority: 5, extraction_hints: ["grantor", "gave power of attorney", "authorized attorney", "beneficiary under POA", "acting as attorney"] },
    elder_q6: { priority: 4, extraction_hints: ["heir", "beneficiary", "named in will", "estate beneficiary", "challenging the estate"] },
  },

  // ── Short-Term Rental ────────────────────────────────────────────────────────
  str: {
    str_q1: { priority: 5, extraction_hints: ["Airbnb", "VRBO", "short-term rental", "STR", "vacation rental", "owner-occupied", "renting out", "hosting"] },
    str_q2: { priority: 5, extraction_hints: ["municipal bylaw", "STR bylaw", "city bylaw", "STR restrictions", "prohibited", "zoning", "permit denied"] },
  },

  // ── Cryptocurrency ───────────────────────────────────────────────────────────
  crypto: {
    crypto_q1: { priority: 5, extraction_hints: ["cryptocurrency", "Bitcoin", "Ethereum", "crypto", "exchange", "wallet", "NFT", "blockchain", "tokens"] },
    crypto_q2: { priority: 5, extraction_hints: ["fraud", "scam", "misrepresentation", "rug pull", "lost crypto", "hacked", "exchange collapsed", "FTX", "exchange froze funds"] },
  },

  // ── E-Commerce ───────────────────────────────────────────────────────────────
  ecom: {
    ecom_q1: { priority: 5, extraction_hints: ["online seller", "Shopify", "Amazon seller", "eBay", "WooCommerce", "e-commerce", "online store", "ecommerce business"] },
    ecom_q2: { priority: 5, extraction_hints: ["chargeback", "dispute", "buyer dispute", "PayPal dispute", "credit card dispute", "reversal", "fraud claim"] },
    ecom_q5: { priority: 5, extraction_hints: ["fraud", "item not received", "not as described", "chargeback code", "unauthorized transaction", "reason for chargeback"] },
  },

  // ── Animal Law ───────────────────────────────────────────────────────────────
  animal: {
    animal_q1: { priority: 5, extraction_hints: ["dog bite", "animal attack", "my dog bit someone", "my pet injured", "dog attacked", "animal incident"] },
    animal_q2: { priority: 5, extraction_hints: ["first incident", "never happened before", "prior bite", "history of biting", "known dangerous"] },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PERSONAL INJURY SUB-TYPE SLOT SCHEMAS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── PI — Motor Vehicle Accident ───────────────────────────────────────────────
  pi_mva: {
    pi_mva_q1:  { priority: 5, extraction_hints: ["I was driving", "my car", "behind the wheel", "passenger", "passenger seat", "pedestrian", "walking", "crosswalk", "cyclist", "cycling", "bike"] },
    pi_mva_q2:  { priority: 4, extraction_hints: ["insured", "insurance", "policy", "have insurance", "no insurance", "uninsured"] },
    pi_mva_q16: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "this week", "just happened", "an hour ago", "this morning", "last month", "months ago", "years ago", "a year ago"] },
    pi_mva_q17: { priority: 4, extraction_hints: ["hospital", "emergency", "ER", "doctor", "treatment", "medical", "ambulance", "x-ray", "scan", "MRI", "physio", "no treatment", "haven't seen a doctor"] },
    pi_mva_q31: { priority: 5, extraction_hints: ["rear-ended", "hit from behind", "side impact", "t-boned", "intersection", "ran a red", "red light", "head-on", "pedestrian struck", "cyclist struck", "ran into me"] },
    pi_mva_q32: { priority: 4, extraction_hints: ["witness", "witnesses", "bystander", "saw it happen", "saw the accident", "no witnesses", "nobody saw"] },
    pi_mva_q46: { priority: 3, extraction_hints: ["two cars", "three cars", "multiple vehicles", "pileup", "multi-car", "one other car"] },
    pi_mva_q47: { priority: 3, extraction_hints: ["police", "police report", "filed a report", "officer", "OPP", "Toronto Police", "no report", "didn't call police"] },
  },

  // ── PI — Slip and Fall ────────────────────────────────────────────────────────
  pi_slip_fall: {
    pi_sf_q1:  { priority: 5, extraction_hints: ["Walmart", "grocery", "mall", "store", "restaurant", "sidewalk", "public property", "park", "TTC", "subway", "workplace", "private home", "rental property"] },
    pi_sf_q2:  { priority: 5, extraction_hints: ["reported the fall", "incident report", "reported to manager", "told the staff", "no report filed", "didn't report"] },
    pi_sf_q16: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "this week", "just happened", "a few days ago", "last month", "months ago", "years ago"] },
    pi_sf_q17: { priority: 4, extraction_hints: ["hospital", "emergency", "ER", "doctor", "treatment", "medical", "ambulance", "physio", "no treatment", "haven't seen a doctor"] },
    pi_sf_q31: { priority: 5, extraction_hints: ["wet floor", "spill", "mopping", "slippery", "no wet floor sign", "ice", "icy", "snow", "uneven", "pothole", "cracked pavement", "object on floor", "poor lighting", "broken handrail", "broken step", "defective stairs"] },
    pi_sf_q32: { priority: 4, extraction_hints: ["took photos", "photographs", "pictures at the scene", "no photos", "didn't take photos", "photos of the floor"] },
    pi_sf_q46: { priority: 4, extraction_hints: ["witnesses", "someone saw", "people around", "staff saw", "no witnesses", "nobody saw", "bystanders"] },
    pi_sf_q47: { priority: 5, extraction_hints: ["10-day notice", "written notice", "notified the owner", "sent notice", "occupiers liability notice", "10 days", "no notice sent"] },
  },

  // ── PI — Dog Bite ─────────────────────────────────────────────────────────────
  pi_dog_bite: {
    pi_db_q1:  { priority: 5, extraction_hints: ["know the owner", "owner's name", "owner's address", "don't know who owns", "stranger's dog", "neighbour's dog"] },
    pi_db_q2:  { priority: 5, extraction_hints: ["bitten before", "prior bite", "history of biting", "first time", "never attacked before", "known dangerous dog"] },
    pi_db_q16: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "this morning", "just happened", "last month", "months ago"] },
    pi_db_q17: { priority: 4, extraction_hints: ["hospital", "ER", "emergency room", "doctor", "stitches", "rabies shot", "treatment", "no treatment needed"] },
    pi_db_q31: { priority: 5, extraction_hints: ["surgery", "hospitalized", "scarring", "disfigured", "serious wound", "minor bite", "puncture wound", "laceration"] },
    pi_db_q32: { priority: 4, extraction_hints: ["home insurance", "homeowner insurance", "liability insurance", "insured", "no insurance"] },
    pi_db_q46: { priority: 4, extraction_hints: ["public park", "on the street", "sidewalk", "owner's property", "my property", "invited over"] },
    pi_db_q47: { priority: 3, extraction_hints: ["witnesses", "someone saw", "no witnesses", "people nearby", "bystanders"] },
  },

  // ── PI — Medical Malpractice ──────────────────────────────────────────────────
  pi_med_mal: {
    pi_mm_q1:  { priority: 5, extraction_hints: ["physician", "family doctor", "GP", "surgeon", "specialist", "hospital", "clinic", "dentist", "nurse"] },
    pi_mm_q2:  { priority: 4, extraction_hints: ["I am the patient", "on behalf of my", "my mother", "my father", "my spouse", "estate claim", "they passed"] },
    pi_mm_q16: { priority: 5, extraction_hints: ["within the last year", "last year", "two years ago", "recently", "months ago", "years ago", "when I found out", "discovered"] },
    pi_mm_q17: { priority: 5, extraction_hints: ["misdiagnosis", "wrong diagnosis", "failed to diagnose", "surgical error", "wrong-site", "wrong medication", "wrong dosage", "failure to refer"] },
    pi_mm_q31: { priority: 5, extraction_hints: ["permanent disability", "disabled", "hospitalized", "death", "died", "passed away", "surgery required", "disfigured", "pain and suffering", "recovered"] },
    pi_mm_q32: { priority: 4, extraction_hints: ["second opinion", "another doctor confirmed", "expert confirmed", "independent doctor", "no second opinion yet"] },
    pi_mm_q46: { priority: 3, extraction_hints: ["medical records", "have my records", "obtaining records", "missing records", "records destroyed"] },
    pi_mm_q47: { priority: 3, extraction_hints: ["consent form", "informed consent", "risk disclosed", "risk not disclosed", "signed consent", "wasn't told about the risk"] },
  },

  // ── PI — Product Liability ────────────────────────────────────────────────────
  pi_product: {
    pi_prod_q1:  { priority: 5, extraction_hints: ["appliance", "electronics", "vehicle part", "children's toy", "medical device", "health product", "food contamination", "consumer product"] },
    pi_prod_q2:  { priority: 4, extraction_hints: ["manufacturer", "brand", "product name", "I know who made it", "retailer", "don't know who made it"] },
    pi_prod_q16: { priority: 5, extraction_hints: ["today", "last week", "last month", "months ago", "recently", "years ago"] },
    pi_prod_q17: { priority: 4, extraction_hints: ["ER", "hospital", "surgery", "hospitalized", "ongoing care", "physio", "minor", "fully recovered", "no treatment"] },
    pi_prod_q31: { priority: 5, extraction_hints: ["manufacturing defect", "design defect", "failure to warn", "product failed", "the product broke", "not sure what failed"] },
    pi_prod_q32: { priority: 4, extraction_hints: ["still have the product", "preserved", "discarded", "threw it out", "returned it", "product was disposed"] },
    pi_prod_q46: { priority: 3, extraction_hints: ["recall", "Health Canada recall", "product recall", "safety alert", "no recall that I know of"] },
    pi_prod_q47: { priority: 3, extraction_hints: ["receipt", "proof of purchase", "order confirmation", "credit card record", "no receipt", "no proof of purchase"] },
  },

  // ── PI — Workplace Injury ─────────────────────────────────────────────────────
  pi_workplace: {
    pi_wp_q1:  { priority: 5, extraction_hints: ["construction site", "renovation site", "industrial", "manufacturing", "warehouse", "distribution centre", "office", "retail"] },
    pi_wp_q2:  { priority: 5, extraction_hints: ["WSIB claim", "filed with WSIB", "WSIB accepted", "WSIB pending", "no WSIB claim", "no WSIB coverage", "employer not registered with WSIB"] },
    pi_wp_q16: { priority: 5, extraction_hints: ["today", "yesterday", "last week", "last month", "months ago", "years ago", "recently"] },
    pi_wp_q17: { priority: 4, extraction_hints: ["ER", "hospital", "surgery", "physio", "ongoing treatment", "serious injuries", "minor injury", "no treatment"] },
    pi_wp_q31: { priority: 5, extraction_hints: ["fall from height", "scaffold", "ladder", "struck by object", "falling object", "machinery", "entrapment", "slip on floor", "chemical exposure", "overexertion"] },
    pi_wp_q32: { priority: 5, extraction_hints: ["third party", "subcontractor", "general contractor", "equipment manufacturer", "property owner", "only my employer involved"] },
    pi_wp_q46: { priority: 3, extraction_hints: ["coworkers saw", "supervisor witnessed", "witnesses", "no witnesses", "was alone"] },
    pi_wp_q47: { priority: 4, extraction_hints: ["safety violation", "OHSA", "occupational health", "no safety equipment", "guardrail missing", "no PPE", "employer was compliant"] },
  },

  // ── PI — Civil Assault ────────────────────────────────────────────────────────
  pi_assault_ci: {
    pi_ac_q1:  { priority: 5, extraction_hints: ["know who attacked me", "know the attacker", "stranger", "don't know who it was", "attacker's name", "I can identify them"] },
    pi_ac_q2:  { priority: 4, extraction_hints: ["police charges", "charges laid", "criminal charges", "police report filed", "no charges", "no report"] },
    pi_ac_q16: { priority: 5, extraction_hints: ["today", "last week", "last month", "months ago", "recently", "years ago"] },
    pi_ac_q17: { priority: 5, extraction_hints: ["fracture", "broken", "surgery", "hospitalized", "PTSD", "psychological trauma", "ongoing therapy", "bruising", "minor", "no lasting effects"] },
    pi_ac_q31: { priority: 4, extraction_hints: ["they have assets", "they have a job", "insurance", "can't pay", "no assets", "not sure of their finances"] },
    pi_ac_q32: { priority: 4, extraction_hints: ["witnesses", "someone saw", "security cameras", "cameras nearby", "no witnesses"] },
    pi_ac_q46: { priority: 3, extraction_hints: ["ER", "hospital", "doctor", "stitches", "surgery", "ongoing care", "no treatment"] },
    pi_ac_q47: { priority: 3, extraction_hints: ["bar", "restaurant", "nightclub", "event venue", "street", "park", "transit", "private property"] },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // EMPLOYMENT SUB-TYPE SLOT SCHEMAS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Employment — Wrongful Dismissal ──────────────────────────────────────────
  emp_dismissal: {
    emp_dis_q1:  { priority: 5, extraction_hints: ["employee", "on payroll", "was employed", "full-time", "part-time", "contractor", "freelancer", "not sure of my status"] },
    emp_dis_q2:  { priority: 4, extraction_hints: ["employment contract", "signed a contract", "no written contract", "offer letter", "terms of employment", "employment agreement"] },
    emp_dis_q16: { priority: 5, extraction_hints: ["fired today", "fired yesterday", "fired last week", "fired this week", "fired last month", "fired months ago", "terminated", "let go", "just got fired", "recently terminated"] },
    emp_dis_q17: { priority: 5, extraction_hints: ["no notice", "immediate termination", "walked out same day", "severance pay", "pay in lieu", "working notice", "continued to work after notice", "no severance", "no payment"] },
    emp_dis_q31: { priority: 5, extraction_hints: ["no reason given", "without cause", "restructuring", "position eliminated", "performance", "just cause", "misconduct", "fired for cause", "they didn't say why"] },
    emp_dis_q32: { priority: 5, extraction_hints: ["haven't signed", "nothing signed", "given papers to sign", "signed release", "signed severance agreement", "full and final release", "not yet signed"] },
    emp_dis_q46: { priority: 4, extraction_hints: ["director", "VP", "vice president", "C-suite", "CEO", "CFO", "COO", "manager", "supervisor", "team lead", "specialist", "entry-level", "junior"] },
    emp_dis_q47: { priority: 5, extraction_hints: ["years with the company", "worked there for", "been there for", "12 years", "5 years", "20 years", "tenure", "long time", "just started", "short tenure"] },
  },

  // ── Employment — Harassment ───────────────────────────────────────────────────
  emp_harassment: {
    emp_har_q1:  { priority: 5, extraction_hints: ["harassment", "bullying", "hostile work environment", "sexual harassment", "discriminatory harassment", "being targeted", "intimidated at work"] },
    emp_har_q2:  { priority: 5, extraction_hints: ["my supervisor", "my manager", "my boss", "a coworker", "senior management", "a client", "external party", "who is harassing me"] },
    emp_har_q16: { priority: 4, extraction_hints: ["just started", "recent", "months", "been going on for", "how long", "started last year", "started years ago"] },
    emp_har_q17: { priority: 5, extraction_hints: ["still employed", "still working there", "still at the company", "I resigned", "I quit because of it", "I was fired", "constructive dismissal"] },
    emp_har_q31: { priority: 5, extraction_hints: ["HR complaint", "filed a complaint", "went to HR", "told HR", "no complaint made", "reported to management", "employer didn't act", "retaliated after complaint"] },
    emp_har_q32: { priority: 5, extraction_hints: ["emails", "texts", "messages", "screenshots", "written evidence", "performance review retaliation", "witnesses", "no documentation"] },
    emp_har_q46: { priority: 4, extraction_hints: ["medical leave", "stress leave", "mental health leave", "seen a doctor", "therapist", "psychologist", "sick leave because of work", "no impact on health"] },
    emp_har_q47: { priority: 3, extraction_hints: ["witnesses", "coworkers saw", "coworkers heard", "someone heard", "no witnesses", "happened in private"] },
  },

  // ── Employment — Discrimination ───────────────────────────────────────────────
  emp_disc: {
    emp_dsc_q1:  { priority: 5, extraction_hints: ["race", "colour", "ethnic origin", "disability", "physical disability", "mental health", "gender", "pregnancy", "maternity", "age", "religion", "sexual orientation", "family status", "Human Rights Code", "protected ground"] },
    emp_dsc_q2:  { priority: 5, extraction_hints: ["fired", "terminated", "demoted", "denied promotion", "pay cut", "hostile environment", "differential treatment", "refused accommodation", "accommodation denied", "no accommodation"] },
    emp_dsc_q16: { priority: 5, extraction_hints: ["when it happened", "recently", "last month", "months ago", "last year", "over a year ago", "just happened", "date of the incident"] },
    emp_dsc_q17: { priority: 4, extraction_hints: ["employer knew", "told my employer", "disclosed my disability", "disclosed my pregnancy", "they could see", "visible", "obvious to them", "employer was aware"] },
    emp_dsc_q31: { priority: 5, extraction_hints: ["comparator", "another employee", "similar role", "treated differently", "coworker was treated better", "other employees", "same position", "different treatment"] },
    emp_dsc_q32: { priority: 5, extraction_hints: ["emails", "written evidence", "witnesses", "heard discriminatory comments", "circumstantial", "no evidence yet", "pattern of conduct", "documentation"] },
    emp_dsc_q46: { priority: 4, extraction_hints: ["accommodation request", "asked for accommodation", "disability accommodation", "religious accommodation", "they refused", "inadequate accommodation", "no accommodation provided", "didn't request one"] },
    emp_dsc_q47: { priority: 3, extraction_hints: ["HRTO", "human rights tribunal", "filed with HRTO", "considering HRTO application", "civil claim", "which route to take"] },
  },

  // ── Employment — Wage Claim ───────────────────────────────────────────────────
  emp_wage: {
    emp_wag_q1:  { priority: 5, extraction_hints: ["unpaid wages", "not paid", "wages owed", "overtime not paid", "vacation pay", "commission not paid", "final paycheck", "termination pay not received", "money owed by employer"] },
    emp_wag_q2:  { priority: 4, extraction_hints: ["still working there", "still employed", "no longer work there", "former employee", "still at the company"] },
    emp_wag_q16: { priority: 5, extraction_hints: ["started happening", "when it began", "months ago", "last month", "recently", "over a year ago"] },
    emp_wag_q17: { priority: 5, extraction_hints: ["amount owed", "how much", "$", "dollars", "thousands", "over $50,000", "under $5,000", "few thousand", "significant amount"] },
    emp_wag_q31: { priority: 5, extraction_hints: ["employment contract", "offer letter", "pay policy", "written proof of entitlement", "verbal agreement", "no written documentation"] },
    emp_wag_q32: { priority: 4, extraction_hints: ["raised with employer", "told employer", "employer acknowledged", "employer disputes", "employer ignored", "hasn't responded"] },
    emp_wag_q46: { priority: 4, extraction_hints: ["payslips", "pay stubs", "pay records", "records show shortfall", "partial records", "no payslips available"] },
    emp_wag_q47: { priority: 3, extraction_hints: ["other employees affected", "coworkers owed wages", "multiple workers", "just me", "class action", "colleagues affected"] },
  },

  // ── Employment — Constructive Dismissal ───────────────────────────────────────
  emp_constructive: {
    emp_con_q1:  { priority: 5, extraction_hints: ["pay cut", "salary reduced", "compensation reduced", "job duties changed", "role changed", "demoted", "relocated", "forced to move", "hours changed", "schedule changed", "reporting changed"] },
    emp_con_q2:  { priority: 5, extraction_hints: ["still working there", "still employed deciding", "I resigned", "I quit", "I haven't resigned yet", "resigned last month"] },
    emp_con_q16: { priority: 5, extraction_hints: ["when they changed", "when it happened", "last month", "months ago", "recently", "last year", "just changed"] },
    emp_con_q17: { priority: 5, extraction_hints: ["objected in writing", "wrote to employer", "sent an email objecting", "objected verbally", "didn't object", "continued working", "no formal objection"] },
    emp_con_q31: { priority: 5, extraction_hints: ["20 percent cut", "15 percent", "10 percent", "major pay reduction", "significant cut", "no pay cut but role changed", "lost bonus", "restructured compensation"] },
    emp_con_q32: { priority: 4, extraction_hints: ["no explanation", "no reason given", "business reason", "performance reason", "vague explanation", "reorganization", "cost cutting"] },
    emp_con_q46: { priority: 5, extraction_hints: ["years with the company", "worked there for", "tenure", "12 years", "5 years", "20 years", "long time", "short time"] },
    emp_con_q47: { priority: 4, extraction_hints: ["director", "VP", "manager", "specialist", "executive", "entry-level", "senior", "job title"] },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // FAMILY LAW SUB-TYPE SLOT SCHEMAS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Family — Divorce ──────────────────────────────────────────────────────────
  fam_divorce: {
    fam_div_q1:  { priority: 5, extraction_hints: ["legally married", "we got married", "husband", "wife", "marriage certificate", "common-law", "common law only", "not legally married"] },
    fam_div_q2:  { priority: 5, extraction_hints: ["separation date", "agreed on when we separated", "dispute the date", "date of separation", "both agree", "different dates"] },
    fam_div_q16: { priority: 5, extraction_hints: ["separated last year", "separated years ago", "separated recently", "how long ago", "when we separated", "apart for", "living apart"] },
    fam_div_q17: { priority: 4, extraction_hints: ["remarriage", "getting remarried", "pension deadline", "estate issue", "beneficiary designation", "tax reason", "no deadline"] },
    fam_div_q31: { priority: 5, extraction_hints: ["one year separation", "adultery", "cruelty", "grounds for divorce", "physical cruelty", "mental cruelty", "no fault divorce"] },
    fam_div_q32: { priority: 5, extraction_hints: ["separation agreement", "signed agreement", "nothing signed", "draft agreement", "negotiating", "no agreement yet", "full and final"] },
    fam_div_q46: { priority: 4, extraction_hints: ["children", "kids", "no children", "one child", "two children", "three children", "under 18", "minor children"] },
    fam_div_q47: { priority: 4, extraction_hints: ["pension", "RRSP", "registered accounts", "business interest", "professional corporation", "no pension", "defined benefit", "investment accounts"] },
  },

  // ── Family — Custody ─────────────────────────────────────────────────────────
  fam_custody: {
    fam_cus_q1:  { priority: 5, extraction_hints: ["my child", "children aged", "toddler", "infant", "school-age", "teenager", "teen", "12 years old", "multiple children", "two kids", "three kids"] },
    fam_cus_q2:  { priority: 5, extraction_hints: ["court order", "custody order", "existing order", "parenting agreement", "signed agreement", "informal arrangement", "nothing in place", "no agreement"] },
    fam_cus_q16: { priority: 4, extraction_hints: ["just separated", "separated last month", "current arrangement for months", "arrangement in place for years", "long-standing arrangement"] },
    fam_cus_q17: { priority: 5, extraction_hints: ["immediate danger", "safety concern", "domestic violence", "abuse history", "fear for children", "children at risk", "no safety concern", "ongoing concern"] },
    fam_cus_q31: { priority: 5, extraction_hints: ["we agree", "agreed on custody", "disagree", "other parent won't cooperate", "can't agree", "shared custody agreed", "equal time agreed"] },
    fam_cus_q32: { priority: 5, extraction_hints: ["threatening to move", "already moved", "relocation", "moved to another city", "moved to another province", "moved abroad", "no relocation issue"] },
    fam_cus_q46: { priority: 4, extraction_hints: ["CAS", "child protection", "Children's Aid", "open investigation", "child welfare", "CFS involvement", "no CAS involvement"] },
    fam_cus_q47: { priority: 3, extraction_hints: ["both in Ontario", "other parent moved", "out of province", "another province", "outside Canada", "other parent in another country", "international"] },
  },

  // ── Family — Support ─────────────────────────────────────────────────────────
  fam_support: {
    fam_sup_q1:  { priority: 5, extraction_hints: ["child support", "spousal support", "alimony", "maintenance", "support arrears", "both child and spousal", "not paying support"] },
    fam_sup_q2:  { priority: 5, extraction_hints: ["court order for support", "support order in place", "he's not paying", "she's not paying", "no order yet", "separation agreement for support", "vary the support order"] },
    fam_sup_q16: { priority: 5, extraction_hints: ["just separated", "stopped paying recently", "arrears building up", "need to vary", "changed circumstances", "income changed", "recent change"] },
    fam_sup_q17: { priority: 4, extraction_hints: ["earns", "income", "salary", "makes per year", "annual income", "self-employed income", "their income", "not sure of income"] },
    fam_sup_q31: { priority: 5, extraction_hints: ["T4", "NOA", "notice of assessment", "clear income", "self-employed", "variable income", "hiding income", "under-reporting", "imputed income"] },
    fam_sup_q32: { priority: 5, extraction_hints: ["arrears", "money owed", "hasn't paid", "missed payments", "owes support", "no arrears", "initial support amount", "unpaid"] },
    fam_sup_q46: { priority: 4, extraction_hints: ["child age", "under 12", "teenager", "18 and in school", "multiple children", "no children", "adult student"] },
    fam_sup_q47: { priority: 4, extraction_hints: ["married for years", "together for years", "long marriage", "short marriage", "5 years", "10 years", "20 years", "length of relationship"] },
  },

  // ── Family — Property Division ────────────────────────────────────────────────
  fam_property: {
    fam_pro_q1:  { priority: 5, extraction_hints: ["financial disclosure", "net family property", "statement of assets", "both disclosed", "hasn't disclosed", "exchange of financials", "no disclosure yet"] },
    fam_pro_q2:  { priority: 5, extraction_hints: ["matrimonial home", "family home", "house already sold", "still in the house", "one of us lives there", "vacant home", "we rented", "no home to divide"] },
    fam_pro_q16: { priority: 5, extraction_hints: ["separated months ago", "separated years ago", "recently separated", "separation date", "how long separated", "just separated", "years since separation"] },
    fam_pro_q17: { priority: 5, extraction_hints: ["business", "professional corporation", "law firm", "medical practice", "investment portfolio", "real estate portfolio", "no business", "simple assets only"] },
    fam_pro_q31: { priority: 5, extraction_hints: ["pre-marriage property", "gift", "inheritance", "excluded asset", "deduction", "asset brought into the marriage", "documentation of exclusion", "no excluded property"] },
    fam_pro_q32: { priority: 4, extraction_hints: ["debts", "liabilities", "negative NFP", "owes money", "mortgage", "credit card debt", "hidden debts", "no significant debts"] },
    fam_pro_q46: { priority: 4, extraction_hints: ["pension", "defined benefit", "defined contribution", "group RRSP", "pension division", "RRSP only", "no pension", "government pension", "union pension"] },
    fam_pro_q47: { priority: 3, extraction_hints: ["total assets", "value of assets", "estate worth", "combined assets", "what are we dividing", "under 200k", "over a million", "millions", "home value"] },
  },

  // ── Family — Protection Orders ────────────────────────────────────────────────
  fam_protection: {
    fam_prt_q1:  { priority: 5, extraction_hints: ["in immediate danger", "not safe", "scared", "he hit me", "she hit me", "currently safe", "left the home", "still living with", "volatile situation"] },
    fam_prt_q2:  { priority: 5, extraction_hints: ["physical violence", "he hit me", "assault", "threats", "emotional abuse", "psychological abuse", "controlling behavior", "sexual abuse", "financial abuse", "coercion"] },
    fam_prt_q16: { priority: 5, extraction_hints: ["called police", "police report", "charges laid", "arrested", "no police involvement", "afraid to call police", "immigration concerns"] },
    fam_prt_q17: { priority: 5, extraction_hints: ["restraining order", "peace bond", "protection order", "court order", "breaching the order", "no order in place", "order being followed"] },
    fam_prt_q31: { priority: 5, extraction_hints: ["children at risk", "children witnessed", "abused children", "kids are afraid", "no children", "children are safe", "using children as leverage"] },
    fam_prt_q32: { priority: 5, extraction_hints: ["photos of injuries", "medical records", "texts as evidence", "emails from abuser", "police report as evidence", "witnesses", "no documentation yet"] },
    fam_prt_q46: { priority: 4, extraction_hints: ["safe housing", "shelter", "women's shelter", "left the home already", "plan to leave", "need help leaving", "nowhere to go"] },
    fam_prt_q47: { priority: 3, extraction_hints: ["immigration status", "sponsored by", "tied to his status", "tied to her status", "permanent resident", "citizen", "work permit", "study permit", "sponsorship"] },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // CRIMINAL LAW SUB-TYPE SLOT SCHEMAS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Criminal — DUI / Impaired Driving ────────────────────────────────────────
  crim_dui: {
    crim_dui_q1:  { priority: 5, extraction_hints: ["impaired driving", "over 80", "DUI", "DWI", "breath test", "blew over", "breathalyzer", "refusal to blow", "drug impaired", "impaired operation"] },
    crim_dui_q2:  { priority: 5, extraction_hints: ["provided a breath sample", "blew into the machine", "refused to provide", "blood sample", "roadside screening", "approved instrument", "station test"] },
    crim_dui_q16: { priority: 5, extraction_hints: ["when it happened", "last night", "last week", "last month", "date of the offence", "the stop was", "pulled over on"] },
    crim_dui_q17: { priority: 5, extraction_hints: ["court date", "first appearance", "next appearance", "set for", "scheduled for", "have to be in court"] },
    crim_dui_q31: { priority: 5, extraction_hints: ["reading was", "mg reading", "borderline", "barely over", "high reading", "refused no reading", "100 mg", "120 mg", "150 mg", "don't know the reading"] },
    crim_dui_q32: { priority: 5, extraction_hints: ["no accident", "traffic stop only", "minor damage", "hit another car", "someone was injured", "fatality", "person was killed"] },
    crim_dui_q46: { priority: 5, extraction_hints: ["no prior record", "first offence", "clean record", "prior DUI", "prior impaired conviction", "second offence", "multiple priors"] },
    crim_dui_q47: { priority: 4, extraction_hints: ["child in the car", "kid in the back", "minor passenger", "no children in the vehicle", "children were not present"] },
  },

  // ── Criminal — Assault ───────────────────────────────────────────────────────
  crim_assault: {
    crim_ass_q1:  { priority: 5, extraction_hints: ["common assault", "assault causing bodily harm", "aggravated assault", "assault with a weapon", "charged with assault", "ABH", "s.266", "s.267", "s.268"] },
    crim_ass_q2:  { priority: 5, extraction_hints: ["stranger", "acquaintance", "my partner", "my wife", "my husband", "my ex", "my parent", "my sibling", "someone I know", "did not know them"] },
    crim_ass_q16: { priority: 5, extraction_hints: ["when the incident happened", "date of the alleged assault", "last week", "last month", "a few months ago"] },
    crim_ass_q17: { priority: 5, extraction_hints: ["court date", "bail conditions", "no contact order", "first appearance", "have to appear", "released on bail"] },
    crim_ass_q31: { priority: 5, extraction_hints: ["self-defence", "defending myself", "he attacked me first", "she attacked me first", "defending someone else", "mutual fight", "I started it"] },
    crim_ass_q32: { priority: 5, extraction_hints: ["no injuries", "bruise", "minor injury", "hospital visit", "broken bone", "serious injuries", "medical records", "no visible injuries"] },
    crim_ass_q46: { priority: 5, extraction_hints: ["no witnesses", "my word against theirs", "surveillance video", "witnesses who support me", "bystanders saw it", "security camera"] },
    crim_ass_q47: { priority: 4, extraction_hints: ["no prior record", "clean record", "first offence", "prior assault", "prior violence conviction", "criminal record for violence"] },
  },

  // ── Criminal — Drug Offences ─────────────────────────────────────────────────
  crim_drug: {
    crim_drg_q1:  { priority: 5, extraction_hints: ["possession", "trafficking", "PPOT", "possession for the purpose", "production", "cultivation", "drug charge", "drug offence", "controlled substance"] },
    crim_drg_q2:  { priority: 5, extraction_hints: ["cannabis", "marijuana", "weed", "cocaine", "crack", "opioids", "fentanyl", "heroin", "meth", "methamphetamine", "MDMA", "ecstasy", "prescription pills"] },
    crim_drg_q16: { priority: 5, extraction_hints: ["when police found it", "date of the arrest", "when I was stopped", "date of the search", "when it happened"] },
    crim_drg_q17: { priority: 5, extraction_hints: ["court date", "first appearance", "scheduled appearance", "have to be in court"] },
    crim_drg_q31: { priority: 5, extraction_hints: ["found on my person", "found in my car", "found in my house", "during a search", "traffic stop", "home search", "residence search"] },
    crim_drg_q32: { priority: 5, extraction_hints: ["search warrant", "warrant was obtained", "I consented", "no warrant", "unlawful search", "warrantless search", "didn't consent"] },
    crim_drg_q46: { priority: 5, extraction_hints: ["small amount", "personal use amount", "large quantity", "commercial quantity", "grams", "kilograms", "ounces", "just for myself"] },
    crim_drg_q47: { priority: 4, extraction_hints: ["no prior record", "clean record", "first offence", "prior drug conviction", "prior trafficking conviction", "criminal record for drugs"] },
  },

  // ── Criminal — Theft / Property Offences ─────────────────────────────────────
  crim_theft: {
    crim_tft_q1:  { priority: 5, extraction_hints: ["shoplifting", "theft", "theft under 5000", "theft over 5000", "fraud", "break and enter", "B&E", "possession of stolen property", "stealing", "took merchandise"] },
    crim_tft_q2:  { priority: 5, extraction_hints: ["value of the property", "how much was taken", "amount involved", "dollar value", "under $5,000", "over $5,000", "under $500", "thousands of dollars"] },
    crim_tft_q16: { priority: 5, extraction_hints: ["when the incident happened", "date of the alleged offence", "when I was caught", "when it occurred"] },
    crim_tft_q17: { priority: 5, extraction_hints: ["court date", "first appearance", "scheduled", "civil demand letter", "received a letter from the store", "appearance notice"] },
    crim_tft_q31: { priority: 5, extraction_hints: ["surveillance video", "they have video", "camera footage", "witness saw me", "circumstantial only", "no direct evidence", "store employee identified me"] },
    crim_tft_q32: { priority: 5, extraction_hints: ["I paid it back", "restitution", "repaid the amount", "offered to pay back", "no repayment made", "can't repay"] },
    crim_tft_q46: { priority: 4, extraction_hints: ["I was an employee", "position of trust", "financial advisor", "accountant", "fiduciary", "had access", "no position of trust"] },
    crim_tft_q47: { priority: 4, extraction_hints: ["no prior record", "clean record", "first offence", "prior theft", "prior fraud conviction", "history of theft"] },
  },

  // ── Criminal — Domestic Violence ─────────────────────────────────────────────
  crim_domestic: {
    crim_dom_q1:  { priority: 5, extraction_hints: ["domestic assault", "assault on partner", "assault on spouse", "uttering threats", "criminal harassment", "domestic charge", "intimate partner violence", "IPV"] },
    crim_dom_q2:  { priority: 5, extraction_hints: ["my partner", "my spouse", "my wife", "my husband", "my girlfriend", "my boyfriend", "my ex", "my ex-wife", "my ex-husband", "family member", "my parent", "my sibling"] },
    crim_dom_q16: { priority: 5, extraction_hints: ["when it happened", "date of the incident", "two weeks ago", "last month", "recently", "the night of"] },
    crim_dom_q17: { priority: 5, extraction_hints: ["no contact order", "bail conditions", "can't go home", "excluded from the residence", "no communication", "stay away order", "no weapons condition"] },
    crim_dom_q31: { priority: 5, extraction_hints: ["she wants it dropped", "he wants it dropped", "complainant doesn't want to proceed", "victim supports the charge", "she is cooperating", "he is cooperating", "not sure of their position"] },
    crim_dom_q32: { priority: 5, extraction_hints: ["no injuries", "no 911 call", "bruise documented", "hospital records", "serious injuries", "photos of injuries", "911 recording", "significant injuries"] },
    crim_dom_q46: { priority: 4, extraction_hints: ["children were present", "kids witnessed it", "children in the home", "no children were there", "children were asleep", "didn't witness anything"] },
    crim_dom_q47: { priority: 5, extraction_hints: ["no prior record", "clean record", "first offence", "prior domestic charges", "prior domestic conviction", "history of domestic calls", "prior assault on a partner"] },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // IMMIGRATION LAW SUB-TYPE SLOT SCHEMAS
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Immigration — Express Entry ───────────────────────────────────────────────
  imm_ee: {
    imm_ee_q1:  { priority: 5, extraction_hints: ["Express Entry", "Federal Skilled Worker", "FSW", "Canadian Experience Class", "CEC", "Federal Skilled Trades", "FST", "skilled worker PR", "permanent residence through work"] },
    imm_ee_q2:  { priority: 5, extraction_hints: ["active profile", "Express Entry profile", "in the pool", "received an ITA", "Invitation to Apply", "profile expired", "no profile yet"] },
    imm_ee_q16: { priority: 5, extraction_hints: ["ITA received", "Invitation to Apply", "60 day deadline", "ITA issued", "received invitation", "when the ITA was", "apply within 60 days"] },
    imm_ee_q17: { priority: 5, extraction_hints: ["CRS score", "comprehensive ranking", "my score is", "points", "above 500", "below 400", "draw threshold", "minimum cut-off"] },
    imm_ee_q31: { priority: 5, extraction_hints: ["IELTS", "CELPIP", "TEF", "language test", "CLB", "test scores", "English proficiency", "French proficiency", "language results"] },
    imm_ee_q32: { priority: 4, extraction_hints: ["ECA", "educational credential assessment", "credential evaluation", "foreign degree", "Canadian education", "WES", "ICAS", "recognized degree"] },
    imm_ee_q46: { priority: 5, extraction_hints: ["provincial nomination", "PNP nomination", "+600 points", "nominated by province", "OINP nomination", "nominated for PR"] },
    imm_ee_q47: { priority: 4, extraction_hints: ["prior refusal", "PR application refused", "misrepresentation", "inadmissibility", "clean record", "no prior issues", "refused before"] },
  },

  // ── Immigration — Spousal Sponsorship ────────────────────────────────────────
  imm_spousal: {
    imm_spo_q1:  { priority: 5, extraction_hints: ["spouse", "husband", "wife", "legally married", "common-law partner", "conjugal partner", "sponsoring my partner", "sponsoring my spouse"] },
    imm_spo_q2:  { priority: 5, extraction_hints: ["inland sponsorship", "outland sponsorship", "applying inland", "applying outland", "open work permit while waiting", "applying from outside Canada"] },
    imm_spo_q16: { priority: 4, extraction_hints: ["together for years", "relationship length", "been together since", "married for", "common law for", "length of relationship"] },
    imm_spo_q17: { priority: 5, extraction_hints: ["status expiring", "permit expiring", "urgency", "pregnant", "medical", "family emergency", "need to stay in Canada", "permit expires soon"] },
    imm_spo_q31: { priority: 5, extraction_hints: ["sponsor eligibility", "financial requirements", "income", "no social assistance", "no prior default", "previously sponsored", "undertaking"] },
    imm_spo_q32: { priority: 5, extraction_hints: ["relationship evidence", "photos together", "joint finances", "travel records", "messages", "genuine relationship", "thin evidence", "officer questions genuineness"] },
    imm_spo_q46: { priority: 5, extraction_hints: ["prior refusal", "prior spousal refusal", "misrepresentation", "overstay", "unauthorized work", "no prior issues", "clean immigration history"] },
    imm_spo_q47: { priority: 3, extraction_hints: ["children included", "dependent children", "no children", "custody issue", "children from another relationship", "child of both"] },
  },

  // ── Immigration — Study Permit ────────────────────────────────────────────────
  imm_study: {
    imm_stu_q1:  { priority: 5, extraction_hints: ["study permit", "student visa", "extending my study permit", "PGWP", "post-graduation work permit", "restoration of student status", "initial study permit"] },
    imm_stu_q2:  { priority: 5, extraction_hints: ["DLI", "designated learning institution", "is my school on the list", "university", "college", "private school", "not a DLI"] },
    imm_stu_q16: { priority: 5, extraction_hints: ["permit expires", "permit expired", "within 90 days", "expired more than 90 days", "implied status", "before expiry", "restoration"] },
    imm_stu_q17: { priority: 5, extraction_hints: ["full-time enrollment", "full time student", "dropped to part-time", "authorized leave", "break between programs", "not enrolled full time"] },
    imm_stu_q31: { priority: 5, extraction_hints: ["PGWP eligible", "post-graduation work permit", "8 month program", "program length", "already have PGWP", "not eligible for PGWP"] },
    imm_stu_q32: { priority: 5, extraction_hints: ["off-campus work", "20 hours", "worked more than allowed", "unauthorized work while studying", "complied with work hours", "didn't work at all"] },
    imm_stu_q46: { priority: 4, extraction_hints: ["prior study permit refusal", "refused before", "multiple refusals", "first application", "no prior refusal"] },
    imm_stu_q47: { priority: 3, extraction_hints: ["SDS", "Student Direct Stream", "India", "China", "Philippines", "Vietnam", "Pakistan", "GIC", "IELTS 6.0", "SDS country"] },
  },

  // ── Immigration — Work Permit ─────────────────────────────────────────────────
  imm_work_permit: {
    imm_wp_q1:  { priority: 5, extraction_hints: ["work permit", "worker visa", "extending my work permit", "open work permit", "PGWP", "bridging permit", "restoration of work authorization", "LMIA work permit"] },
    imm_wp_q2:  { priority: 5, extraction_hints: ["LMIA", "labour market impact assessment", "LMIA-exempt", "CUSMA", "ICT", "intracompany transfer", "IEC", "working holiday", "significant benefit", "no LMIA needed"] },
    imm_wp_q16: { priority: 5, extraction_hints: ["work permit expires", "permit expired", "implied status", "applying from abroad", "still valid", "expired 90 days", "restoration"] },
    imm_wp_q17: { priority: 5, extraction_hints: ["need to start immediately", "employer needs me soon", "start within two weeks", "start date", "urgent start", "no deadline"] },
    imm_wp_q31: { priority: 5, extraction_hints: ["CUSMA", "TN visa", "NAFTA", "intracompany transferee", "ICT", "IEC", "working holiday", "significant benefit", "R205", "LMIA required", "not exempt"] },
    imm_wp_q32: { priority: 5, extraction_hints: ["valid status", "no violations", "worked beyond permit", "unauthorized work", "overstayed", "out of status", "applying from outside Canada"] },
    imm_wp_q46: { priority: 4, extraction_hints: ["no prior refusal", "work permit refused before", "multiple refusals", "refused once", "first application"] },
    imm_wp_q47: { priority: 3, extraction_hints: ["path to PR", "building Canadian experience", "Express Entry pathway", "employer sponsoring for PR", "just need the permit", "temporary only"] },
  },

  // ── Immigration — Refugee ─────────────────────────────────────────────────────
  imm_refugee: {
    imm_ref_q1:  { priority: 5, extraction_hints: ["refugee claim", "Convention refugee", "s.96", "s.97", "persecution", "fear of return", "protection from removal", "seeking asylum", "asylum claim"] },
    imm_ref_q2:  { priority: 5, extraction_hints: ["entered at the airport", "crossed the border", "irregular crossing", "already in Canada", "inland claim", "entered through the US", "Roxham Road", "at the port of entry"] },
    imm_ref_q16: { priority: 5, extraction_hints: ["RPD hearing", "hearing scheduled", "hearing date", "30 days", "imminent hearing", "no hearing yet", "claim rejected", "PRRA", "removal scheduled"] },
    imm_ref_q17: { priority: 5, extraction_hints: ["removal order", "deportation", "CBSA enforcement", "removal imminent", "stay of removal", "no removal order", "CBSA contacted me"] },
    imm_ref_q31: { priority: 5, extraction_hints: ["documentary evidence", "police report", "medical records", "country conditions", "news articles", "evidence of persecution", "testimony only", "no documents"] },
    imm_ref_q32: { priority: 5, extraction_hints: ["first claim", "prior claim withdrawn", "prior claim rejected", "claimed refugee before", "claimed in another country", "previous application"] },
    imm_ref_q46: { priority: 4, extraction_hints: ["designated country", "DCO", "my country is designated", "accelerated timeline", "not a DCO country", "standard RPD process"] },
    imm_ref_q47: { priority: 3, extraction_hints: ["H&C", "humanitarian and compassionate", "PRRA", "establishment in Canada", "hardship", "children's best interests", "alternative application"] },
  },

  // ── Immigration — Provincial Nominee Program ──────────────────────────────────
  imm_pnp: {
    imm_pnp_q1:  { priority: 5, extraction_hints: ["OINP", "Ontario Immigrant Nominee", "BC PNP", "Alberta Immigrant Nominee", "AINP", "provincial nominee", "PNP", "which province"] },
    imm_pnp_q2:  { priority: 5, extraction_hints: ["employer job offer stream", "Human Capital Priorities", "international student stream", "French-speaking skilled worker", "in-demand skills", "PNP stream", "which stream"] },
    imm_pnp_q16: { priority: 5, extraction_hints: ["received nomination", "nomination certificate", "applied and waiting", "preparing application", "exploring options", "just starting", "nominated by province"] },
    imm_pnp_q17: { priority: 5, extraction_hints: ["job offer deadline", "permit expiring", "EE profile expiring", "status expiry", "urgency", "no deadline"] },
    imm_pnp_q31: { priority: 5, extraction_hints: ["job offer", "employer job offer", "permanent full-time offer", "qualifying job offer", "meets PNP wage requirement", "no job offer"] },
    imm_pnp_q32: { priority: 5, extraction_hints: ["worked in Ontario", "studied in Ontario", "Canadian experience", "graduated in Canada", "Ontario education", "no connection to province", "no ties"] },
    imm_pnp_q46: { priority: 5, extraction_hints: ["Express Entry profile", "CRS score", "above 400", "below 400", "EE pool", "no Express Entry profile", "+600 points from nomination"] },
    imm_pnp_q47: { priority: 4, extraction_hints: ["prior PNP refusal", "refused by province", "immigration violation", "overstay", "unauthorized work", "no prior issues", "clean history"] },
  },

  // ── Civil — Contract ──────────────────────────────────────────────────────────
  civ_contract: {
    civ_con_q1:  { priority: 5, extraction_hints: ["service contract", "goods contract", "employment contract", "lease contract", "NDA", "purchase agreement", "type of contract", "what was the contract for"] },
    civ_con_q2:  { priority: 5, extraction_hints: ["I am the plaintiff", "I am owed money", "they breached the contract", "I am the defendant", "they are suing me", "claim against me"] },
    civ_con_q16: { priority: 5, extraction_hints: ["breach occurred", "when did they breach", "date of breach", "how long ago", "within two years", "more than two years ago", "Limitations Act"] },
    civ_con_q17: { priority: 5, extraction_hints: ["demand letter sent", "sent a demand letter", "no demand letter", "threatened legal action", "received demand letter", "notice given"] },
    civ_con_q31: { priority: 5, extraction_hints: ["failure to perform", "non-payment", "incomplete work", "defective goods", "misrepresentation in contract", "anticipatory breach", "nature of the breach"] },
    civ_con_q32: { priority: 5, extraction_hints: ["$35,000", "35 thousand", "Small Claims", "Superior Court", "claim amount", "total damages", "how much are you claiming", "value of claim"] },
    civ_con_q46: { priority: 4, extraction_hints: ["defendant owns property", "defendant employed", "defendant has assets", "defendant business", "defendant has bank accounts", "collectible judgment", "ability to pay"] },
    civ_con_q47: { priority: 4, extraction_hints: ["arbitration clause", "dispute resolution clause", "mandatory arbitration", "no arbitration clause", "contract says arbitration", "escalation clause"] },
  },

  // ── Civil — Debt ──────────────────────────────────────────────────────────────
  civ_debt: {
    civ_dbt_q1:  { priority: 5, extraction_hints: ["money lent", "unpaid invoice", "overdue account", "NSF cheque", "unpaid loan", "promissory note", "debt owed to me", "collecting a debt"] },
    civ_dbt_q2:  { priority: 5, extraction_hints: ["written contract", "signed agreement", "promissory note", "invoice", "email agreement", "verbal agreement only", "no written evidence", "documentation"] },
    civ_dbt_q16: { priority: 5, extraction_hints: ["debt became due", "when was payment due", "original due date", "how long overdue", "within two years", "more than two years", "limitation period"] },
    civ_dbt_q17: { priority: 5, extraction_hints: ["total amount owed", "how much is the debt", "original amount", "with interest", "principal balance", "total claim value"] },
    civ_dbt_q31: { priority: 5, extraction_hints: ["debtor acknowledged", "partial payment made", "debtor promised to pay", "no acknowledgment", "denied owing", "last payment date", "reset limitation"] },
    civ_dbt_q32: { priority: 5, extraction_hints: ["debtor owns property", "debtor is employed", "debtor has a business", "garnishment possible", "writ of seizure", "no known assets", "judgment enforcement"] },
    civ_dbt_q46: { priority: 4, extraction_hints: ["prior legal action", "previous lawsuit", "already sued", "sent to collections", "collection agency", "first time taking legal action"] },
    civ_dbt_q47: { priority: 4, extraction_hints: ["individual debtor", "corporation", "sole proprietor", "partnership", "business entity", "personal guarantee", "personal liability"] },
  },

  // ── Civil — Tort ──────────────────────────────────────────────────────────────
  civ_tort: {
    civ_trt_q1:  { priority: 5, extraction_hints: ["defamation", "libel", "slander", "fraud", "deceit", "misrepresentation", "conversion", "property taken", "trespass", "type of wrong", "what they did to me"] },
    civ_trt_q2:  { priority: 5, extraction_hints: ["I am the plaintiff", "they wronged me", "I am being sued", "claim against me", "defendant in a tort claim"] },
    civ_trt_q16: { priority: 5, extraction_hints: ["when did it happen", "occurrence date", "how long ago", "within two years", "more than two years", "when did you discover", "discovery rule"] },
    civ_trt_q17: { priority: 5, extraction_hints: ["published online", "social media post", "spoken statement", "printed publication", "email or text", "broadcast", "how was it communicated"] },
    civ_trt_q31: { priority: 5, extraction_hints: ["financial loss", "lost business", "lost income", "reputational damage", "economic damages", "quantifiable loss", "harm suffered"] },
    civ_trt_q32: { priority: 4, extraction_hints: ["truth defence", "it is true", "qualified privilege", "fair comment", "opinion not fact", "no defence", "retraction offered", "apology issued"] },
    civ_trt_q46: { priority: 4, extraction_hints: ["retraction requested", "takedown request", "no retraction", "apology received", "post still up", "statement still published"] },
    civ_trt_q47: { priority: 3, extraction_hints: ["defendant identified", "anonymous defendant", "unknown poster", "John Doe defendant", "online account", "need to identify defendant"] },
  },

  // ── Civil — Negligence ────────────────────────────────────────────────────────
  civ_negligence: {
    civ_neg_q1:  { priority: 5, extraction_hints: ["professional negligence", "contractor negligence", "product liability", "occupier's liability", "slip and fall", "type of negligence", "who was negligent"] },
    civ_neg_q2:  { priority: 5, extraction_hints: ["lawyer", "accountant", "doctor", "engineer", "licensed professional", "regulated professional", "contractor", "tradesperson", "professional services"] },
    civ_neg_q16: { priority: 5, extraction_hints: ["when did it happen", "date of incident", "date of discovery", "how long ago", "within two years", "more than two years", "discoverability", "Limitations Act"] },
    civ_neg_q17: { priority: 5, extraction_hints: ["regulatory complaint", "filed complaint", "licensing body", "law society complaint", "CPA complaint", "CPSO complaint", "no complaint filed"] },
    civ_neg_q31: { priority: 5, extraction_hints: ["breach is clear", "clear negligence", "debatable", "dispute about standard of care", "expert needed", "standard of care"] },
    civ_neg_q32: { priority: 5, extraction_hints: ["total damages", "financial loss", "property damage", "physical injury", "economic loss", "how much are you claiming", "value of claim"] },
    civ_neg_q46: { priority: 4, extraction_hints: ["contributory negligence", "partly my fault", "shared responsibility", "I also contributed", "my own conduct", "comparative fault", "pure negligence by them"] },
    civ_neg_q47: { priority: 4, extraction_hints: ["professional liability insurance", "E&O insurance", "errors and omissions", "defendant has insurance", "contractor insurance", "no insurance known"] },
  },
};

/**
 * Enrich a question with its slot schema metadata (priority, extraction_hints, requires).
 * Returns the question unchanged if no schema entry exists for this PA + question ID.
 */
export function enrichQuestion<T extends { id: string; priority?: number; extraction_hints?: string[]; requires?: string[] }>(
  practiceAreaId: string,
  question: T
): T {
  const paMeta = SLOT_SCHEMA[practiceAreaId];
  if (!paMeta) return question;
  const meta = paMeta[question.id];
  if (!meta) return question;
  return {
    ...question,
    priority: question.priority ?? meta.priority,
    extraction_hints: question.extraction_hints ?? meta.extraction_hints,
    requires: question.requires ?? meta.requires,
  };
}

/**
 * Get the slot schema for a given practice area.
 * Returns an empty record if no schema is defined.
 */
export function getSlotSchema(practiceAreaId: string): Record<string, SlotMeta> {
  return SLOT_SCHEMA[practiceAreaId] ?? {};
}
