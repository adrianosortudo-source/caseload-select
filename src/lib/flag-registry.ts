/**
 * CaseLoad Screen — Compliance Flag Registry
 *
 * 72 semantic flags derived from LawPRO claims data, LSO Rules of Professional
 * Conduct, and Ontario-specific limitation period statutes.
 *
 * Each flag has:
 *   - severity: S1 (CRITICAL) | S2 (HIGH)
 *   - paFilter: which practice areas can trigger this flag (empty = universal)
 *   - triggerPatterns: regex patterns for deterministic detection from free text
 *   - gateQuestions: mandatory questions the engine MUST ask when flag is active
 *
 * Architecture:
 *   Pass 1 (this file): regex detection → deterministic flags
 *   Pass 2 (classifier.ts): GPT semantic detection → semantic flags
 *   Merge: union of both sets; duplicates collapsed
 *   Gate engine: getGateQuestions() returns ordered mandatory question list
 *
 * Compliance source: docs/research/compliance-matrix-v1.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FlagSeverity = "S1" | "S2";

export interface GateQuestion {
  id: string;            // stable ID, e.g. "flag_mvac_insurer__q1"
  text: string;          // question text shown to client
  rationale: string;     // internal — why this question exists (not shown to client)
}

export interface FlagDefinition {
  id: string;
  label: string;
  severity: FlagSeverity;
  /** Practice area IDs that trigger this flag. Empty array = universal (all PAs). */
  paFilter: string[];
  /** Regex patterns for deterministic detection. Any match activates the flag. */
  triggerPatterns: RegExp[];
  /** Ordered mandatory gate questions for this flag. Asked before GPT-generated questions. */
  gateQuestions: GateQuestion[];
  /** Ontario statute or rule that grounds this flag. */
  source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Flags (PA-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSAL_FLAGS: FlagDefinition[] = [
  {
    id: "limitation_proximity",
    label: "Limitation Period Proximity",
    severity: "S1",
    paFilter: [],
    triggerPatterns: [
      /\b(two|2)\s+years?\s+ago\b/i,
      /\b(almost|nearly|close\s+to)\s+(two|2)\s+years?\b/i,
      /\ba\s+(long|while|good)\s+time\s+ago\b/i,
      /\b(years?\s+ago|years?\s+back)\b/i,
      /\b(18|19|20|21|22|23)\s+months?\s+ago\b/i,
    ],
    gateQuestions: [
      {
        id: "limitation_proximity__q1",
        text: "When exactly did this happen? Please provide the date if you remember it.",
        rationale: "Establishes trigger date for limitation period analysis.",
      },
      {
        id: "limitation_proximity__q2",
        text: "Have you spoken to any other lawyer about this matter before?",
        rationale: "Prior counsel may have taken steps to preserve the limitation period.",
      },
      {
        id: "limitation_proximity__q3",
        text: "Has anything been filed with a court or government tribunal already?",
        rationale: "Filing pauses or restarts limitation in some cases.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.4 (2-year basic limitation from discovery)",
  },
  {
    id: "conflict_adverse_party",
    label: "Adverse Party Identification",
    severity: "S1",
    paFilter: [],
    triggerPatterns: [], // always triggered when opposing party is named — GPT handles
    gateQuestions: [
      {
        id: "conflict_adverse_party__q1",
        text: "Who is the other party? Please give their full name and organization if applicable.",
        rationale: "Required for conflicts check before retainer is opened.",
      },
      {
        id: "conflict_adverse_party__q2",
        text: "Do you know if the other party has a lawyer representing them already?",
        rationale: "Identifies whether ex parte communication rules apply.",
      },
    ],
    source: "LSO Rules of Professional Conduct, Rule 3.4 (conflicts of interest)",
  },
  {
    id: "prior_counsel",
    label: "Prior Legal Counsel",
    severity: "S2",
    paFilter: [],
    triggerPatterns: [
      /\b(my\s+(last|previous|former)\s+lawyer|had\s+a\s+lawyer\s+(before|previously))\b/i,
      /\b(changed|switched|fired|left)\s+(my\s+)?lawyer\b/i,
      /\bmy\s+(last|old)\s+(attorney|counsel|legal\s+rep)\b/i,
    ],
    gateQuestions: [
      {
        id: "prior_counsel__q1",
        text: "Who was your previous lawyer and which firm were they with?",
        rationale: "Needed for conflict check and to understand what steps were already taken.",
      },
      {
        id: "prior_counsel__q2",
        text: "Why did that relationship end?",
        rationale: "Prior counsel dismissal for cause is a credibility and risk signal.",
      },
      {
        id: "prior_counsel__q3",
        text: "Has any court filing, limitation clock extension, or agreement been put in place by your prior lawyer?",
        rationale: "Prior counsel may have preserved limitation or filed proceedings.",
      },
    ],
    source: "LawPRO — scope creep and unrealistic expectations claim category",
  },
  {
    id: "minor_claimant",
    label: "Minor Claimant",
    severity: "S2",
    paFilter: [],
    triggerPatterns: [
      /\b(my\s+)?(child|son|daughter|kid)\s+(who\s+is|aged?|age)\s+\d{1,2}\b/i,
      /\b(minor|under\s+18|under\s+age)\b/i,
      /\b(on\s+behalf\s+of)\s+my\s+(child|son|daughter|kid)\b/i,
    ],
    gateQuestions: [
      {
        id: "minor_claimant__q1",
        text: "How old is the person the claim is on behalf of?",
        rationale: "Limitation period is tolled for minors; different procedural rules apply.",
      },
      {
        id: "minor_claimant__q2",
        text: "Who is the parent or guardian who would act on their behalf?",
        rationale: "Litigation guardian must be identified before proceedings can start.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.6 (limitation tolled for minors)",
  },
  {
    id: "vulnerable_client",
    label: "Vulnerable Client / Capacity",
    severity: "S2",
    paFilter: [],
    triggerPatterns: [
      /\b(dementia|alzheimer|cognitive\s+(impairment|decline))\b/i,
      /\b(my\s+)?(mother|father|parent|spouse|family\s+member)\s+who\s+(has|is).{0,30}(memory|dementia|cognitive)\b/i,
      /\b(doesn.t\s+understand|can.t\s+make\s+decisions)\b/i,
    ],
    gateQuestions: [
      {
        id: "vulnerable_client__q1",
        text: "Can the person give clear instructions independently?",
        rationale: "Legal capacity is required to retain counsel; Power of Attorney may be needed.",
      },
      {
        id: "vulnerable_client__q2",
        text: "Is anyone else helping them understand their options?",
        rationale: "Undue influence risk if third party is also a potential beneficiary.",
      },
    ],
    source: "LSO Rules of Professional Conduct, Rule 3.2 (quality of service, vulnerable clients)",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Practice-Area Flags
// ─────────────────────────────────────────────────────────────────────────────

const PA_FLAGS: FlagDefinition[] = [

  // ── Personal Injury ──────────────────────────────────────────────────────

  {
    id: "pi_limitation_window",
    label: "PI Limitation Window",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [], // Handled by universal limitation_proximity + PA context
    gateQuestions: [
      {
        id: "pi_limitation__q1",
        text: "What was the exact date of the incident?",
        rationale: "Start date for 2-year discovery limitation period.",
      },
      {
        id: "pi_limitation__q2",
        text: "Have you received any medical treatment? When did you first see a doctor?",
        rationale: "Discovery date may be later than incident date if injury developed over time.",
      },
      {
        id: "pi_limitation__q3",
        text: "Have you had any contact with an insurance adjuster or signed any documents?",
        rationale: "Signed releases or settlement discussions may affect limitation clock or bar claim.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.4",
  },
  {
    id: "pi_unidentified_parties",
    label: "Unidentified Defendant (PI)",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(don.t\s+know|didn.t\s+get)\s+(who|their|the\s+(owner|driver|person))\b/i,
      /\b(drove|ran|walked)\s+away\b/i,
      /\b(don.t\s+know\s+who\s+owns|not\s+sure\s+who\s+is\s+responsible)\b/i,
      /\bno\s+(name|contact|information)\s+(from|for|of)\s+(the|them|him|her)\b/i,
    ],
    gateQuestions: [
      {
        id: "pi_parties__q1",
        text: "Do you know the full name of the person or company responsible?",
        rationale: "All defendants must be identified before the limitation period expires.",
      },
      {
        id: "pi_parties__q2",
        text: "Was there a property owner, manager, or employer involved who might share responsibility?",
        rationale: "Multiple defendants may be liable; missing one = uncollectable judgment.",
      },
      {
        id: "pi_parties__q3",
        text: "Are there any witnesses who could identify the responsible party?",
        rationale: "Witness identification may enable discovery of unknown defendant.",
      },
    ],
    source: "LawPRO — failure to identify all defendants (top PI intake claim)",
  },
  {
    id: "pi_evidence_preservation",
    label: "PI Evidence Not Preserved",
    severity: "S2",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(no\s+photos?|didn.t\s+take\s+photos?|haven.t\s+taken\s+photos?)\b/i,
      /\b(no\s+witnesses?|no\s+one\s+saw)\b/i,
      /\bscene\s+(was\s+)?(cleaned|fixed|repaired|changed|altered)\b/i,
    ],
    gateQuestions: [
      {
        id: "pi_evidence__q1",
        text: "Do you have photos of the scene or your injuries?",
        rationale: "Photographic evidence is critical and often unavailable if not captured early.",
      },
      {
        id: "pi_evidence__q2",
        text: "Did anyone witness what happened? Do you have their contact information?",
        rationale: "Witness accounts corroborate liability.",
      },
      {
        id: "pi_evidence__q3",
        text: "Are there surveillance cameras at or near the location?",
        rationale: "Video footage requires urgent preservation request or it is overwritten.",
      },
    ],
    source: "LawPRO — inadequate fact investigation at intake",
  },

  // ── Motor Vehicle Accidents ───────────────────────────────────────────────

  {
    id: "mvac_insurer_not_notified",
    label: "7-Day Insurer Notification (MVA)",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(haven.t|didn.t|not\s+yet)\s+(called|notified|contacted|told)\s+(my\s+)?(insurance|insurer)\b/i,
      /\b(accident|crash|collision)\b.{0,60}\b(today|yesterday|this\s+morning|this\s+week)\b/i,
    ],
    gateQuestions: [
      {
        id: "mvac_notif__q1",
        text: "Have you notified your insurance company about the accident yet?",
        rationale: "Ontario requires insurer notification within 7 days; missing this risks accident benefits.",
      },
      {
        id: "mvac_notif__q2",
        text: "What date did the accident happen?",
        rationale: "Calculates whether 7-day window for accident benefits notification has passed.",
      },
      {
        id: "mvac_notif__q3",
        text: "Do you have your insurance policy number available?",
        rationale: "Needed to file accident benefits claim immediately if window is still open.",
      },
    ],
    source: "Insurance Act (Ontario), s.258.3 — 7-day notification for accident benefits",
  },
  {
    id: "mvac_hit_and_run",
    label: "Hit and Run / Unknown Driver",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\bhit\s+and\s+run\b/i,
      /\b(drove|sped|ran)\s+away\b.{0,30}\b(accident|crash|hit)\b/i,
      /\b(didn.t\s+stop|left\s+the\s+scene|no\s+plate|no\s+plates?|couldn.t\s+get\s+(their\s+)?plate)\b/i,
      /\buninsured\s+(driver|motorist|vehicle)\b/i,
      /\bno\s+(contact\s+info|license\s+plate|insurance\s+info)\s+(from|for)\s+the\s+(other\s+)?(driver|vehicle)\b/i,
    ],
    gateQuestions: [
      {
        id: "mvac_hitrun__q1",
        text: "Did you get the other driver's license plate, name, or insurance information?",
        rationale: "Unknown driver means the claim goes through OPCF 44R uninsured motorist coverage.",
      },
      {
        id: "mvac_hitrun__q2",
        text: "Did any witnesses see the other vehicle? Do you have their contact details?",
        rationale: "Independent witness corroboration is critical for hit-and-run claims.",
      },
      {
        id: "mvac_hitrun__q3",
        text: "Was the accident reported to police? Do you have a report number?",
        rationale: "Police report is typically required for uninsured motorist claims.",
      },
    ],
    source: "OPCF 44R (Family Protection Endorsement); Insurance Act uninsured motorist provisions",
  },
  {
    id: "mvac_accident_benefits",
    label: "Accident Benefits Not Applied For",
    severity: "S2",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(haven.t|not\s+yet|didn.t)\s+(applied|filed|submitted)\s+(for\s+)?(accident\s+benefits?|SABS|no[- ]fault)\b/i,
      /\b(don.t\s+know\s+about|didn.t\s+know\s+(I\s+)?could\s+claim)\b.{0,30}\b(accident\s+benefits?|no[- ]fault)\b/i,
    ],
    gateQuestions: [
      {
        id: "mvac_ab__q1",
        text: "Have you applied for accident benefits (also called no-fault benefits) with your own insurer?",
        rationale: "Accident benefits are separate from the tort claim and have their own application deadlines.",
      },
      {
        id: "mvac_ab__q2",
        text: "Are you currently receiving any income replacement or medical benefits?",
        rationale: "Determines whether benefits are already flowing or if immediate application is needed.",
      },
    ],
    source: "Statutory Accident Benefits Schedule (SABS), O.Reg. 34/10",
  },

  // ── Medical Malpractice ───────────────────────────────────────────────────

  {
    id: "medmal_causation_unclear",
    label: "Medical Malpractice Causation Unclear",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(think|believe|suspect)\s+(something\s+went\s+wrong|there\s+was\s+a\s+mistake|the\s+(doctor|surgeon|hospital)\s+(made|did\s+something))\b/i,
      /\b(surgery|procedure|treatment)\s+(didn.t\s+work|went\s+wrong|caused\s+more\s+problems?)\b/i,
    ],
    gateQuestions: [
      {
        id: "medmal_caus__q1",
        text: "What procedure or treatment did you receive, and who performed it?",
        rationale: "Specific provider and act required to assess negligence and identify defendants.",
      },
      {
        id: "medmal_caus__q2",
        text: "What outcome did you expect, and what actually happened?",
        rationale: "Establishes the gap between standard of care and result.",
      },
      {
        id: "medmal_caus__q3",
        text: "When did you first realize something may have gone wrong?",
        rationale: "Discovery date is the start of the 2-year limitation period for medical malpractice.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.5 (discoverability); LawPRO med-mal claims data",
  },
  {
    id: "medmal_multiple_providers",
    label: "Multiple Medical Providers",
    severity: "S2",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(multiple|several|different|many)\s+(doctors?|hospitals?|specialists?|surgeons?|providers?)\b/i,
      /\b(hospital|specialist|surgeon)\s+and\s+(another\s+)?(hospital|specialist|surgeon|doctor)\b/i,
    ],
    gateQuestions: [
      {
        id: "medmal_prov__q1",
        text: "How many different doctors or hospitals were involved in your care?",
        rationale: "Each provider is a potential defendant; all must be identified before limitation expires.",
      },
      {
        id: "medmal_prov__q2",
        text: "Can you list each provider and what they did?",
        rationale: "Establishes the chain of care and pinpoints where the standard of care was breached.",
      },
    ],
    source: "LawPRO — failure to identify all defendants in medical malpractice",
  },

  // ── Slip & Fall ───────────────────────────────────────────────────────────

  {
    id: "slip_ice_snow",
    label: "Slip on Ice/Snow — 60-Day Notice",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(slip|slipped|fell|fall)\b.{0,40}\b(ice|icy|snow|snowy|slippery|frost|frozen)\b/i,
      /\b(ice|icy|snow|snowy|slippery|frost|frozen)\b.{0,40}\b(slip|slipped|fell|fall)\b/i,
      /\b(unsalted|uncleared|not\s+cleared|no\s+salt|not\s+sanded)\b.{0,30}\b(walkway|path|steps|stairs|driveway|entrance)\b/i,
    ],
    gateQuestions: [
      {
        id: "slip_ice__q1",
        text: "When exactly did you fall, and what were the conditions at the time?",
        rationale: "The 60-day written notice clock starts from the date of the fall.",
      },
      {
        id: "slip_ice__q2",
        text: "What type of property was it — a private home, a business, or a public area?",
        rationale: "Private property triggers the 60-day Occupiers' Liability Act notice obligation.",
      },
      {
        id: "slip_ice__q3",
        text: "Have you given any written notice to the property owner yet?",
        rationale: "Failure to give written notice within 60 days bars the claim under the Act.",
      },
    ],
    source: "Occupiers' Liability Act (Ontario), s.6(1) — 60-day written notice for snow/ice",
  },
  {
    id: "slip_municipality",
    label: "Injury on Municipal Property",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(city|municipal|municipality|town|borough)\s+(sidewalk|road|street|path|park|property|owned)\b/i,
      /\b(sidewalk|road|street|public\s+park)\b.{0,40}\b(city|municipal|municipality|town|borough)\b/i,
      /\bpublic\s+(sidewalk|road|path|park)\b/i,
      /\b(fell|tripped|slipped)\b.{0,30}\b(sidewalk|road|public\s+(path|park))\b/i,
    ],
    gateQuestions: [
      {
        id: "slip_muni__q1",
        text: "Was the injury on a city sidewalk, road, or other public property?",
        rationale: "Municipal Act notice requirement (10 days for injuries; tight deadline).",
      },
      {
        id: "slip_muni__q2",
        text: "When did the injury occur?",
        rationale: "Calculates whether 10-day municipal notice window has passed.",
      },
      {
        id: "slip_muni__q3",
        text: "Have you given written notice to the municipality?",
        rationale: "Failure to give notice within required period bars tort claim against municipality.",
      },
    ],
    source: "Municipal Act, 2001 (Ontario), s.44(10) — notice of claim for municipal property injury",
  },

  // ── Long-Term Disability ──────────────────────────────────────────────────

  {
    id: "ltd_appeal_clock_running",
    label: "LTD Internal Appeal / Court Clock",
    severity: "S1",
    paFilter: ["pi", "ins"],
    triggerPatterns: [
      /\b(denied|denial|rejected|refused)\s+(my\s+)?(LTD|long[- ]term\s+disability|disability)\s+(claim|benefits?|application)\b/i,
      /\b(LTD|long[- ]term\s+disability)\s+(claim|benefits?)\b.{0,30}\b(denied|rejected|refused)\b/i,
      /\b(internal\s+appeal|appealing\s+to\s+(the\s+)?(insurer|insurance\s+company))\b.{0,30}\b(LTD|disability)\b/i,
    ],
    gateQuestions: [
      {
        id: "ltd_appeal__q1",
        text: "When did you receive the written denial from the insurer?",
        rationale: "The 2-year court limitation period runs from the denial date — NOT from the appeal outcome.",
      },
      {
        id: "ltd_appeal__q2",
        text: "Are you currently in an internal appeal process with the insurer?",
        rationale: "Critical: internal appeal does NOT pause the court limitation period.",
      },
      {
        id: "ltd_appeal__q3",
        text: "Do you have a copy of the denial letter?",
        rationale: "Denial date on the letter is the limitation trigger; client must produce it immediately.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.4; LawPRO — LTD claim bar from missed court limitation",
  },
  {
    id: "ltd_policy_definition",
    label: "LTD Policy Definition of Disability",
    severity: "S2",
    paFilter: ["pi", "ins"],
    triggerPatterns: [
      /\b(any[- ]occupation|any\s+occ|able\s+to\s+work\s+(some|other|different)\s+job)\b/i,
      /\b(can\s+do\s+other\s+work|said\s+I\s+can\s+work|insurer\s+says\s+I.m\s+not\s+disabled)\b/i,
    ],
    gateQuestions: [
      {
        id: "ltd_policy__q1",
        text: "Is your policy through your employer or did you purchase it individually?",
        rationale: "Group vs. individual policies differ substantially on definition of disability.",
      },
      {
        id: "ltd_policy__q2",
        text: "What reason did the insurer give for the denial or termination?",
        rationale: "Own-occupation vs. any-occupation definition change at 2-year mark is a common trap.",
      },
    ],
    source: "LawPRO — failure to analyze policy language (LTD claim category)",
  },

  // ── Family Law ────────────────────────────────────────────────────────────

  {
    id: "fam_property_clock",
    label: "Family Property Equalization Deadline",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(separated|split\s+up|broke\s+up)\b.{0,60}\b(4|5|6|seven|eight|nine|ten|\d+)\s+years?\s+ago\b/i,
      /\b(long\s+time|years\s+ago|long\s+separation)\b.{0,40}\b(property|assets?|house|home|pension|RRSP)\b/i,
      /\b(property|assets?|house)\b.{0,40}\b(long\s+time|years\s+ago|long\s+separation)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_prop__q1",
        text: "What is the exact date of separation?",
        rationale: "The 6-year Family Law Act equalization deadline runs from the date of separation.",
      },
      {
        id: "fam_prop__q2",
        text: "Have any court proceedings been started yet?",
        rationale: "Court filing preserves the equalization claim; no filing = clock keeps running.",
      },
      {
        id: "fam_prop__q3",
        text: "Are there significant assets to divide — home, pension, investments?",
        rationale: "High-value estates make the deadline more consequential.",
      },
    ],
    source: "Family Law Act (Ontario), s.7(3) — 6-year limitation for property equalization",
  },
  {
    id: "fam_abduction",
    label: "International Child Abduction",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\bhague\s+(convention|application|petition)\b/i,
      /\b(parental|international|cross[- ]?border)\s+abduction\b/i,
      /\b(took|taken|brought|moved)\b.{0,40}\b(child|son|daughter|kids?)\b.{0,60}\b(country|abroad|overseas|home\s+country|another\s+country|outside\s+canada)\b/i,
      /\bwithout\s+my\s+(consent|permission|knowledge)\b.{0,60}\b(country|abroad|overseas|another\s+country)\b/i,
      /\bher\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
      /\bhis\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_abduct__q1",
        text: "What country is the child currently in?",
        rationale: "Hague Convention application depends on destination country being a signatory.",
      },
      {
        id: "fam_abduct__q2",
        text: "When did the child leave Canada, and did you know in advance?",
        rationale: "Departure date and consent status determines abduction vs. wrongful retention.",
      },
      {
        id: "fam_abduct__q3",
        text: "Is there a current custody order in place, and from which court?",
        rationale: "Existing court order strengthens the Hague application; no order changes the strategy.",
      },
      {
        id: "fam_abduct__q4",
        text: "Is the destination country a signatory to the Hague Convention on Child Abduction?",
        rationale: "Non-signatory countries require a different enforcement strategy entirely.",
      },
      {
        id: "fam_abduct__q5",
        text: "Have you contacted police or a lawyer in the destination country?",
        rationale: "Parallel proceedings in the destination country may be required immediately.",
      },
    ],
    source: "Hague Convention on Civil Aspects of International Child Abduction; Children's Law Reform Act (Ontario)",
  },
  {
    id: "fam_domestic_violence",
    label: "Domestic Violence History",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(domestic\s+violence|DV|spousal\s+abuse|physical\s+abuse)\b/i,
      /\b(afraid|fear\s+of|scared\s+of)\s+(my\s+)?(husband|wife|spouse|partner|ex)\b/i,
      /\b(restraining|protection)\s+order\b/i,
      /\b(hit|beat|struck|threatened|choked|assaulted)\s+(me|by\s+my\s+(husband|wife|spouse|partner|ex))\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_dv__q1",
        text: "Is there a history of physical, emotional, or financial abuse in the relationship?",
        rationale: "DV history is relevant to custody decisions, property division, and client safety planning.",
      },
      {
        id: "fam_dv__q2",
        text: "Are there any existing restraining orders or recent police involvement?",
        rationale: "Outstanding protection orders affect service, communication, and court procedure.",
      },
      {
        id: "fam_dv__q3",
        text: "Are you and your children currently safe?",
        rationale: "Immediate safety takes priority over legal strategy; may require crisis referral.",
      },
    ],
    source: "LawPRO — failure to identify DV history impacts custody/safety strategy",
  },
  {
    id: "fam_hidden_assets",
    label: "Hidden or Undisclosed Assets",
    severity: "S2",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(don.t\s+know|not\s+sure)\s+what\s+(he|she|they|my\s+(spouse|husband|wife|partner))\s+(earns?|owns?|has|hides?)\b/i,
      /\b(offshore|overseas|foreign)\s+(account|assets?|investment|bank)\b/i,
      /\b(hidden|hiding|concealing)\s+(assets?|money|income|accounts?)\b/i,
      /\b(self[- ]employed|own(s)?\s+a\s+business|runs?\s+a\s+business)\b.{0,40}\b(spouse|husband|wife|partner)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_assets__q1",
        text: "Does your spouse own a business or have self-employment income?",
        rationale: "Business owners have more opportunity to conceal income and assets.",
      },
      {
        id: "fam_assets__q2",
        text: "Are you aware of all financial accounts, investments, and real estate your spouse holds?",
        rationale: "Full financial disclosure is mandatory; gaps require discovery steps.",
      },
    ],
    source: "LawPRO — inadequate financial disclosure at family law intake",
  },

  // ── Child Protection ──────────────────────────────────────────────────────

  {
    id: "child_apprehension_recent",
    label: "Child Apprehension (Recent)",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(CAS|Children.s\s+Aid|FCRSS)\b.{0,40}\b(took|removed|apprehended|placed|taken)\b/i,
      /\b(took|removed|apprehended|placed)\b.{0,40}\b(child|son|daughter|kids?)\b.{0,40}\b(CAS|Children.s\s+Aid|foster|protection)\b/i,
    ],
    gateQuestions: [
      {
        id: "child_app__q1",
        text: "When was the child removed or apprehended by CAS?",
        rationale: "Child must be brought before court within 5 days of apprehension — CYFSA, s.16.",
      },
      {
        id: "child_app__q2",
        text: "Where is the child placed now — foster home, relative, or other parent?",
        rationale: "Placement affects access rights and urgency of interim order application.",
      },
      {
        id: "child_app__q3",
        text: "Has a court date been scheduled? When is the first hearing?",
        rationale: "Counsel must attend the 5-day hearing; immediate action may be required.",
      },
    ],
    source: "Child, Youth and Family Services Act, 2017 (Ontario), s.16",
  },
  {
    id: "child_protection_allegations",
    label: "Child Protection Allegations",
    severity: "S2",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(CAS|Children.s\s+Aid)\b.{0,40}\b(allege|allegation|investigation|claim)\b/i,
      /\b(accused|allegation)\b.{0,40}\b(abuse|neglect|domestic\s+violence)\b.{0,30}\b(CAS|Children.s\s+Aid|protection)\b/i,
    ],
    gateQuestions: [
      {
        id: "child_prot__q1",
        text: "What specific allegations has CAS made against you?",
        rationale: "Specific allegations determine which services, rehabilitation steps, and defences apply.",
      },
      {
        id: "child_prot__q2",
        text: "Have you completed or been offered any parenting programs or counselling?",
        rationale: "Demonstrating proactive rehabilitation strengthens return-home applications.",
      },
    ],
    source: "LawPRO — inadequate documentation of rehabilitation at child protection intake",
  },

  // ── Immigration ───────────────────────────────────────────────────────────

  {
    id: "imm_rad_deadline",
    label: "RAD Appeal Deadline (15 Days)",
    severity: "S1",
    paFilter: ["imm"],
    triggerPatterns: [
      /\b(RPD|refugee\s+protection\s+division)\b.{0,40}\b(refused|denied|rejected|negative)\b/i,
      /\bmy\s+refugee\s+claim\s+(was\s+)?(refused|denied|rejected|unsuccessful)\b/i,
      /\b(appeal|appealing)\b.{0,30}\b(refugee|RPD)\b.{0,30}\b(decision|denial|refusal)\b/i,
    ],
    gateQuestions: [
      {
        id: "imm_rad__q1",
        text: "When did you receive the written RPD decision?",
        rationale: "15-day RAD notice deadline runs from receipt of the decision.",
      },
      {
        id: "imm_rad__q2",
        text: "Have you already filed a Notice of Appeal to the RAD?",
        rationale: "If not filed, calculates days remaining before the hard deadline.",
      },
      {
        id: "imm_rad__q3",
        text: "Do you have a copy of the RPD decision?",
        rationale: "Grounds for appeal are found in the decision reasons.",
      },
    ],
    source: "IRPA; Refugee Appeal Division Rules, Rule 3 — 15-day notice, 45-day record",
  },
  {
    id: "imm_removal_order",
    label: "Removal Order / Deportation",
    severity: "S1",
    paFilter: ["imm"],
    triggerPatterns: [
      /\b(removal\s+order|deportation|deported|CBSA\s+(enforcement|notice)|told\s+to\s+leave\s+Canada)\b/i,
      /\bI\s+(have\s+to|must|need\s+to)\s+leave\s+Canada\b/i,
    ],
    gateQuestions: [
      {
        id: "imm_removal__q1",
        text: "Do you have a removal order? What type — departure, exclusion, or deportation order?",
        rationale: "Order type determines enforcement timeline and available remedies.",
      },
      {
        id: "imm_removal__q2",
        text: "What date have you been told to leave Canada by?",
        rationale: "Establishes urgency for stay application; stay must be filed before removal.",
      },
      {
        id: "imm_removal__q3",
        text: "Have you applied for a PRRA (Pre-Removal Risk Assessment)?",
        rationale: "PRRA eligibility is time-limited and may stay removal automatically.",
      },
    ],
    source: "IRPA; Immigration and Refugee Protection Regulations — enforcement timelines",
  },
  {
    id: "imm_inadmissibility",
    label: "Immigration Inadmissibility Signals",
    severity: "S2",
    paFilter: ["imm"],
    triggerPatterns: [
      /\b(criminal\s+(record|history)|prior\s+conviction)\b.{0,30}\b(immigration|visa|Canada)\b/i,
      /\b(refused\s+entry|denied\s+(entry|admission)|prior\s+deportation)\b/i,
      /\b(security\s+concern|security\s+check)\b.{0,30}\b(immigration|visa|IRCC)\b/i,
    ],
    gateQuestions: [
      {
        id: "imm_inad__q1",
        text: "Do you have a criminal record in Canada or any other country?",
        rationale: "Criminal inadmissibility can bar applications entirely; rehabilitation or TRP may be needed.",
      },
      {
        id: "imm_inad__q2",
        text: "Have you ever been deported or refused entry to Canada or another country?",
        rationale: "Prior refusals and deportations must be disclosed and may trigger enhanced scrutiny.",
      },
    ],
    source: "IRPA, ss.36-38 — criminal, health, and security inadmissibility grounds",
  },

  // ── Criminal ──────────────────────────────────────────────────────────────

  {
    id: "crim_charter_violation",
    label: "Charter Rights Violation Signals",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(searched\s+without\s+a\s+warrant|warrantless\s+search)\b/i,
      /\b(didn.t\s+tell\s+me\s+(my\s+)?(rights?|right\s+to\s+a\s+lawyer))\b/i,
      /\b(detained\s+without|stopped\s+without)\s+(reason|cause|warrant)\b/i,
      /\b(breathalyzer|blood\s+test|breath\s+sample)\b.{0,30}\b(without\s+a\s+lawyer|before\s+(calling|reaching)\s+a\s+lawyer)\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_charter__q1",
        text: "Were you told you had the right to a lawyer when police first detained or arrested you?",
        rationale: "Section 10(b) Charter violation may lead to exclusion of evidence.",
      },
      {
        id: "crim_charter__q2",
        text: "Did police search your home, car, or phone? Did they have a warrant?",
        rationale: "Warrantless search may be a s.8 Charter violation — key to exclusion application.",
      },
      {
        id: "crim_charter__q3",
        text: "Were you given time to speak with a lawyer before any tests or questioning?",
        rationale: "Denial of right to counsel can bar breathalyzer results or statements.",
      },
    ],
    source: "Canadian Charter of Rights and Freedoms, ss.8, 9, 10(b)",
  },
  {
    id: "crim_co_accused",
    label: "Co-Accused Conflict",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(my\s+)?(friend|partner|co[- ]accused|co[- ]defendant|accomplice)\s+(was\s+also\s+)?(arrested|charged)\b/i,
      /\b(we\s+were\s+both\s+(there|arrested|charged|caught))\b/i,
      /\b(multiple\s+people\s+charged|all\s+charged|charged\s+together)\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_co__q1",
        text: "Are there other people charged in connection with the same incident?",
        rationale: "Co-accused may have conflicting defences; one lawyer cannot represent both.",
      },
      {
        id: "crim_co__q2",
        text: "Have any of them contacted you or your family about the case?",
        rationale: "Communication between co-accused about defences must stop once counsel retained.",
      },
      {
        id: "crim_co__q3",
        text: "Is the same lawyer being asked to represent more than one person charged?",
        rationale: "Dual representation in criminal matters is almost always a conflict — must refuse.",
      },
    ],
    source: "LSO Rules of Professional Conduct, Rule 3.4 — conflicts; criminal co-accused doctrine",
  },
  {
    id: "crim_bail_conditions",
    label: "Bail Conditions Active",
    severity: "S2",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(house\s+arrest|on\s+bail|bail\s+conditions?|bail\s+order)\b/i,
      /\b(no[- ]contact\s+order|curfew|reporting\s+condition|ankle\s+monitor|electronic\s+monitoring)\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_bail__q1",
        text: "Are you currently out on bail? What are your specific conditions?",
        rationale: "Breach of bail conditions is a separate criminal offence; client must understand restrictions.",
      },
      {
        id: "crim_bail__q2",
        text: "Is there a no-contact order with any specific person?",
        rationale: "No-contact breaches are taken seriously; client must be warned immediately.",
      },
    ],
    source: "Criminal Code of Canada, s.145 — failure to comply with bail conditions",
  },

  // ── Employment ────────────────────────────────────────────────────────────

  {
    id: "emp_hrto_clock",
    label: "HRTO 1-Year Deadline",
    severity: "S1",
    paFilter: ["emp", "hr"],
    triggerPatterns: [
      /\b(discrimination|discriminat)\b.{0,40}\b(race|gender|age|disability|religion|pregnancy|sex|colour|ethnic|sexual\s+orientation|creed)\b/i,
      /\bHRTO\b/i,
      /\bhuman\s+rights\s+(complaint|violation|issue|application)\b/i,
      /\bdiscriminated\s+against\b/i,
    ],
    gateQuestions: [
      {
        id: "emp_hrto__q1",
        text: "When was the last act of discrimination or harassment?",
        rationale: "HRTO has a 1-year deadline from the last act — stricter than the general 2-year limitation.",
      },
      {
        id: "emp_hrto__q2",
        text: "Is the alleged discrimination tied to a protected ground like disability, race, or gender?",
        rationale: "Identifies the Code ground; determines whether HRTO vs. other forum applies.",
      },
      {
        id: "emp_hrto__q3",
        text: "Have you filed a complaint with your employer's HR or any government body already?",
        rationale: "Internal complaints do not pause the HRTO limitation period.",
      },
    ],
    source: "Ontario Human Rights Code, s.34 — 1-year limitation for HRTO applications",
  },
  {
    id: "emp_severance_signed",
    label: "Severance Agreement Already Signed",
    severity: "S1",
    paFilter: ["emp"],
    triggerPatterns: [
      /\b(already\s+signed|I\s+signed)\b.{0,40}\b(severance|release|termination\s+agreement|settlement)\b/i,
      /\b(gave\s+me|they\s+sent)\b.{0,30}\b(papers|documents?)\b.{0,30}\b(sign|signed)\b/i,
      /\bsigned\s+(the\s+)?(release|waiver|severance\s+package)\b/i,
    ],
    gateQuestions: [
      {
        id: "emp_sev__q1",
        text: "Have you signed any documents since your termination?",
        rationale: "Signed release may bar wrongful dismissal claim; legal advice before signing is critical.",
      },
      {
        id: "emp_sev__q2",
        text: "Was there a deadline to sign? What was it?",
        rationale: "Short signing deadlines without ILA are grounds to void the release.",
      },
      {
        id: "emp_sev__q3",
        text: "Do you have a copy of what you signed?",
        rationale: "Release wording determines whether the claim is barred.",
      },
    ],
    source: "LawPRO — release signed without independent legal advice (top employment intake risk)",
  },
  {
    id: "emp_constructive_dismissal",
    label: "Constructive Dismissal Signal",
    severity: "S2",
    paFilter: ["emp"],
    triggerPatterns: [
      /\b(forced\s+(to\s+quit|to\s+resign|out)|no\s+choice\s+but\s+to\s+(quit|resign))\b/i,
      /\b(constructive\s+dismiss)\b/i,
      /\b(made\s+(work|my\s+life)\s+(unbearable|impossible|hostile))\b/i,
      /\b(changed\s+my\s+(role|duties|pay|hours|location)\s+(unilaterally|without\s+my\s+consent))\b/i,
    ],
    gateQuestions: [
      {
        id: "emp_cons__q1",
        text: "Did you resign, or were you terminated by your employer?",
        rationale: "Constructive dismissal is treated as termination in law despite a technical resignation.",
      },
      {
        id: "emp_cons__q2",
        text: "Were there significant changes to your role, pay, or working conditions before you left?",
        rationale: "Unilateral fundamental changes are the basis for a constructive dismissal claim.",
      },
    ],
    source: "LawPRO — failure to identify constructive dismissal (client resigned, has valid claim)",
  },

  // ── Human Rights ──────────────────────────────────────────────────────────

  {
    id: "hrto_respondent_id",
    label: "HRTO Respondent Misidentification",
    severity: "S2",
    paFilter: ["hr", "emp"],
    triggerPatterns: [
      /\b(franchise|franchisee|head\s+office|parent\s+company|staffing\s+agency|contractor)\b.{0,40}\b(employer|work|job)\b/i,
    ],
    gateQuestions: [
      {
        id: "hrto_resp__q1",
        text: "Who is your direct employer — the specific company name and any parent company?",
        rationale: "HRTO application against wrong entity is rejected; respondent identification is critical.",
      },
      {
        id: "hrto_resp__q2",
        text: "If you work at a franchise, do you know who the actual employer is?",
        rationale: "Franchisee vs. franchisor liability differs; wrong respondent voids application.",
      },
    ],
    source: "LawPRO — misidentification of respondent entity (HRTO intake failure)",
  },

  // ── Real Estate ───────────────────────────────────────────────────────────

  {
    id: "real_estate_dual_representation",
    label: "Real Estate Dual Representation",
    severity: "S1",
    paFilter: ["real"],
    triggerPatterns: [
      /\b(same\s+lawyer|one\s+lawyer)\b.{0,40}\b(buyer\s+and\s+seller|both\s+(sides?|parties?))\b/i,
      /\b(both\s+(sides?|parties?))\b.{0,40}\b(same\s+lawyer|one\s+lawyer)\b/i,
      /\b(our\s+lawyer\s+is\s+representing\s+both)\b/i,
    ],
    gateQuestions: [
      {
        id: "real_dual__q1",
        text: "Is the same lawyer representing both the buyer and seller in this transaction?",
        rationale: "Dual representation in real estate is a conflict under LSO Rule 3.4.",
      },
      {
        id: "real_dual__q2",
        text: "Have you been advised about the potential conflict of interest?",
        rationale: "LSO requires informed consent in writing; non-disclosure is a discipline matter.",
      },
    ],
    source: "LSO Rules of Professional Conduct, Rule 3.4; LawPRO — dual rep real estate claims",
  },
  {
    id: "real_estate_undisclosed_defects",
    label: "Post-Closing Defect Discovery",
    severity: "S1",
    paFilter: ["real"],
    triggerPatterns: [
      /\b(didn.t\s+tell\s+me|not\s+disclosed|hid|concealed)\b.{0,40}\b(defect|damage|problem|issue|mold|flood|water|foundation|roof)\b/i,
      /\b(found\s+out\s+after\s+(closing|I\s+moved\s+in|buying))\b/i,
      /\b(defect|mold|water\s+damage|foundation\s+(crack|issue))\b.{0,30}\b(after\s+(closing|I\s+moved))\b/i,
    ],
    gateQuestions: [
      {
        id: "real_defect__q1",
        text: "When did you take possession of the property?",
        rationale: "Establishes the start of the 2-year limitation period from possession.",
      },
      {
        id: "real_defect__q2",
        text: "When did you first discover the issue?",
        rationale: "Discovery date may be later than closing if defect was latent.",
      },
      {
        id: "real_defect__q3",
        text: "Did the sellers provide a Seller Property Information Statement (SPIS)?",
        rationale: "SPIS representations that are false are actionable misrepresentation.",
      },
    ],
    source: "LawPRO — non-disclosure of material defects (top real estate claim category)",
  },

  // ── Wills & Estates ───────────────────────────────────────────────────────

  {
    id: "estates_capacity",
    label: "Testamentary Capacity Concern",
    severity: "S1",
    paFilter: ["est"],
    triggerPatterns: [
      /\b(dementia|alzheimer|cognitive\s+decline|memory\s+(loss|issues?))\b.{0,30}\b(will|estate|signing)\b/i,
      /\b(doesn.t\s+really\s+understand|confused|not\s+mentally\s+sharp)\b.{0,30}\b(will|estate|signing)\b/i,
    ],
    gateQuestions: [
      {
        id: "est_cap__q1",
        text: "Is the person making the will able to understand what they own, who their family members are, and what they intend to give?",
        rationale: "Testamentary capacity is a legal standard; cognitive impairment may invalidate the will.",
      },
      {
        id: "est_cap__q2",
        text: "Is there any medical diagnosis related to memory or cognition?",
        rationale: "Medical evidence of incapacity at time of signing is the main basis for will challenges.",
      },
      {
        id: "est_cap__q3",
        text: "Is anyone else present when instructions are being given for the will?",
        rationale: "Third party presence during instructions raises both capacity and undue influence concerns.",
      },
    ],
    source: "LawPRO — testamentary capacity (top wills claim category)",
  },
  {
    id: "estates_undue_influence",
    label: "Undue Influence Signal",
    severity: "S1",
    paFilter: ["est"],
    triggerPatterns: [
      /\b(caregiver|caretaker)\b.{0,40}\b(inheriting|left everything|only\s+beneficiary)\b/i,
      /\b(everything\s+(left|given)\s+to)\b.{0,30}\b(caregiver|son|daughter|family\s+member|girlfriend|boyfriend)\b/i,
      /\b(family\s+member\s+(helping|assisting)\s+with\s+the\s+will)\b/i,
    ],
    gateQuestions: [
      {
        id: "est_ui__q1",
        text: "Who is present when the will instructions are being given?",
        rationale: "Presence of a major beneficiary during instruction-taking is an undue influence red flag.",
      },
      {
        id: "est_ui__q2",
        text: "Is the main beneficiary also the person bringing the testator to the lawyer?",
        rationale: "This pattern is the primary indicator of undue influence — requires independent interview.",
      },
    ],
    source: "LawPRO — undue influence (estates claim category); Vout v. Hay [1995] SCR",
  },
  {
    id: "estates_dependant_relief",
    label: "Dependant Relief Claim Window",
    severity: "S2",
    paFilter: ["est"],
    triggerPatterns: [
      /\b(left\s+out\s+of\s+the\s+will|not\s+(in|included\s+in)\s+the\s+will|cut\s+out\s+of\s+the\s+will)\b/i,
      /\b(left\s+everything\s+to)\b.{0,30}\b(not\s+(my\s+|the\s+)?family|girlfriend|boyfriend|second\s+wife|new\s+partner)\b/i,
    ],
    gateQuestions: [
      {
        id: "est_dep__q1",
        text: "When was probate granted — that is, when was the estate trustee officially appointed by the court?",
        rationale: "6-month dependant relief deadline runs from the grant of probate.",
      },
      {
        id: "est_dep__q2",
        text: "Is the person challenging the will a spouse, child, or dependant of the deceased?",
        rationale: "Only dependants within the SLRA definition have standing for a dependant relief claim.",
      },
    ],
    source: "Succession Law Reform Act (Ontario), s.61 — 6-month deadline for dependant relief",
  },

  // ── Construction ──────────────────────────────────────────────────────────

  {
    id: "construction_lien_deadline",
    label: "Construction Lien 60-Day Preservation",
    severity: "S1",
    paFilter: ["const"],
    triggerPatterns: [
      /\b(contractor|subcontractor|supplier)\b.{0,40}\b(not\s+paid|unpaid|won.t\s+pay|hasn.t\s+paid)\b/i,
      /\b(holdback|construction\s+lien|lien\s+rights?)\b/i,
      /\b(work\s+(is\s+)?done|project\s+(is\s+)?complete|substantial\s+performance)\b.{0,40}\b(not\s+paid|unpaid|money\s+owing)\b/i,
    ],
    gateQuestions: [
      {
        id: "const_lien__q1",
        text: "When was substantial performance of your work achieved — roughly when was the project substantially complete?",
        rationale: "60-day lien preservation clock runs from substantial performance; missing it loses lien rights forever.",
      },
      {
        id: "const_lien__q2",
        text: "Has a certificate of substantial performance been published on the Construction Act registry?",
        rationale: "Published certificate is an alternative trigger for the 60-day clock.",
      },
      {
        id: "const_lien__q3",
        text: "Have you already registered a lien? If not, how many days ago was work substantially completed?",
        rationale: "Urgency calculation — if past 45 days, immediate action required.",
      },
    ],
    source: "Construction Act (Ontario), s.31 — 60-day lien preservation from substantial performance",
  },

  // ── Administrative Law ────────────────────────────────────────────────────

  {
    id: "admin_jr_deadline",
    label: "Judicial Review 30-Day Deadline",
    severity: "S1",
    paFilter: ["admin"],
    triggerPatterns: [
      /\b(judicial\s+review|JR\s+application)\b/i,
      /\b(appeal\s+(the\s+)?(tribunal|board|commission|decision))\b/i,
      /\b(LTB|HRTO|WSIAT|Social\s+Benefits|LAT|SJTO)\b.{0,40}\b(decision|appeal|review)\b/i,
    ],
    gateQuestions: [
      {
        id: "admin_jr__q1",
        text: "Which tribunal issued the decision you want to challenge?",
        rationale: "Different tribunals have different appeal routes; judicial review is the default for Ontario tribunals.",
      },
      {
        id: "admin_jr__q2",
        text: "What date was the decision issued and when were reasons released?",
        rationale: "30-day judicial review deadline runs from the date reasons are received.",
      },
      {
        id: "admin_jr__q3",
        text: "Has any judicial review application been filed yet?",
        rationale: "After 30 days, leave to extend is required and often denied.",
      },
    ],
    source: "Judicial Review Procedure Act (Ontario), s.5 (as amended July 8, 2020 — 30-day deadline)",
  },

  // ── WSIB ──────────────────────────────────────────────────────────────────

  {
    id: "wsib_six_month_claim",
    label: "WSIB 6-Month Filing Deadline",
    severity: "S1",
    paFilter: ["wsib"],
    triggerPatterns: [
      /\b(workplace\s+(accident|injury)|injured\s+at\s+work|work\s+(injury|accident))\b/i,
      /\b(WSIB|workers?\s+compensation|workers?\s+comp)\b/i,
      /\b(occupational\s+disease|work[- ]related\s+(illness|disease|injury))\b/i,
    ],
    gateQuestions: [
      {
        id: "wsib_claim__q1",
        text: "When did the workplace accident or injury occur, or when were you first diagnosed with an occupational condition?",
        rationale: "WSIB claim must be filed within 6 months of the accident or diagnosis date.",
      },
      {
        id: "wsib_claim__q2",
        text: "Have you already filed a WSIB claim?",
        rationale: "If not filed and approaching 6 months, immediate action is required.",
      },
      {
        id: "wsib_claim__q3",
        text: "Has your employer reported the accident to WSIB?",
        rationale: "Employer failure to report is a separate WSIA violation; does not excuse worker's filing obligation.",
      },
    ],
    source: "Workplace Safety and Insurance Act, 1997 (Ontario), s.22 — 6-month claim deadline",
  },

  // ── Defamation ────────────────────────────────────────────────────────────

  {
    id: "defamation_media_notice",
    label: "Defamation — 6-Week Media Notice",
    severity: "S1",
    paFilter: ["defam"],
    triggerPatterns: [
      /\b(newspaper|magazine|broadcast|radio|TV|television|news\s+(outlet|station|article))\b.{0,40}\b(said|wrote|published|aired|reported|article|story)\b/i,
      /\b(defamatory\s+article|libel\s+in\s+(a\s+)?(newspaper|magazine|broadcast))\b/i,
    ],
    gateQuestions: [
      {
        id: "defam_media__q1",
        text: "Was the statement published in a newspaper, magazine, online news outlet, or broadcast?",
        rationale: "Libel and Slander Act applies — 6-week written notice required before lawsuit.",
      },
      {
        id: "defam_media__q2",
        text: "When was the statement first published?",
        rationale: "Calculates whether 6-week notice window has passed.",
      },
      {
        id: "defam_media__q3",
        text: "Has any written notice been given to the publisher or broadcaster?",
        rationale: "Failure to give notice within 6 weeks bars the libel claim entirely.",
      },
    ],
    source: "Libel and Slander Act (Ontario), s.5 — 6-week notice to newspaper/broadcaster",
  },

  // ── Tax ───────────────────────────────────────────────────────────────────

  {
    id: "tax_objection_deadline",
    label: "CRA Objection 90-Day Deadline",
    severity: "S1",
    paFilter: ["tax"],
    triggerPatterns: [
      /\b(CRA|Canada\s+Revenue)\b.{0,40}\b(assessment|reassessment|notice|audit|tax\s+bill)\b/i,
      /\b(notice\s+of\s+assessment|NOA|reassessment)\b/i,
      /\b(owe\s+(money|taxes?)\s+to\s+(CRA|Canada\s+Revenue)|CRA\s+says\s+I\s+owe)\b/i,
    ],
    gateQuestions: [
      {
        id: "tax_obj__q1",
        text: "Have you received a Notice of Assessment or Reassessment from CRA?",
        rationale: "90-day objection clock starts from the date on the NOA.",
      },
      {
        id: "tax_obj__q2",
        text: "What date is shown on that notice?",
        rationale: "Calculates days remaining before the objection deadline expires.",
      },
      {
        id: "tax_obj__q3",
        text: "Have you filed a Notice of Objection yet?",
        rationale: "After 90 days, extension application is required; after 1 year, claim is barred.",
      },
    ],
    source: "Income Tax Act (Canada), s.165 — 90-day objection deadline from NOA",
  },

  // ── Labour ────────────────────────────────────────────────────────────────

  {
    id: "labour_ulp_complaint",
    label: "Unfair Labour Practice — 90 Days",
    severity: "S1",
    paFilter: ["labour"],
    triggerPatterns: [
      /\b(unfair\s+labour\s+practice|ULP|anti[- ]union|union\s+(organizing|campaign|drive))\b/i,
      /\b(fired\s+for|dismissed\s+for|terminated\s+for)\b.{0,30}\b(union|organizing|OLRB)\b/i,
      /\b(retaliated|retaliation)\b.{0,30}\b(union|organized|labour\s+relations)\b/i,
    ],
    gateQuestions: [
      {
        id: "labour_ulp__q1",
        text: "What specific action by the employer is alleged to be an unfair labour practice?",
        rationale: "OLRB requires specific particulars of the ULP at filing.",
      },
      {
        id: "labour_ulp__q2",
        text: "When did this action occur?",
        rationale: "90-day OLRB deadline runs from the date of the ULP — hard bar.",
      },
      {
        id: "labour_ulp__q3",
        text: "Is there an active union organizing drive or a certified bargaining unit at this workplace?",
        rationale: "ULP context (organizing vs. post-certification) changes available remedies.",
      },
    ],
    source: "Ontario Labour Relations Act, 1995, s.96(4) — 90-day ULP complaint deadline",
  },

  // ── Social Benefits ───────────────────────────────────────────────────────

  {
    id: "social_benefits_appeal",
    label: "Social Benefits Appeal Deadline",
    severity: "S1",
    paFilter: ["socben"],
    triggerPatterns: [
      /\b(ODSP|Ontario\s+Disability\s+Support|Ontario\s+Works|OW)\b.{0,40}\b(denied|cut\s+off|terminated|reduced|rejected)\b/i,
      /\b(denied|cut\s+off|terminated|reduced)\b.{0,30}\b(ODSP|Ontario\s+Disability\s+Support|Ontario\s+Works|OW)\b/i,
    ],
    gateQuestions: [
      {
        id: "socben_app__q1",
        text: "Which program was denied or cut — Ontario Works (OW) or ODSP?",
        rationale: "Different appeal bodies apply: internal review then Social Benefits Tribunal.",
      },
      {
        id: "socben_app__q2",
        text: "When did you receive the written decision?",
        rationale: "30-day internal review request deadline runs from the written decision.",
      },
      {
        id: "socben_app__q3",
        text: "Have you already filed an appeal or requested an internal review?",
        rationale: "Must exhaust internal review before Social Benefits Tribunal application.",
      },
    ],
    source: "Ontario Works Act, 1997; ODSP Act, 1997 — 30-day internal review deadline",
  },

  // ── Municipal ────────────────────────────────────────────────────────────

  {
    id: "municipal_injury_notice",
    label: "Municipal Property Injury Notice",
    severity: "S1",
    paFilter: ["pi", "admin"],
    triggerPatterns: [
      /\b(city|municipal|municipality|town)\b.{0,40}\b(sidewalk|road|street|park|property)\b.{0,40}\b(fell|tripped|slipped|injured|hurt)\b/i,
      /\b(fell|tripped|slipped|injured)\b.{0,40}\b(city|municipal|municipality|town)\b.{0,40}\b(sidewalk|road|street|park)\b/i,
      /\bpothole\b.{0,30}\b(city|municipal|road|street)\b/i,
    ],
    gateQuestions: [
      {
        id: "muni_injury__q1",
        text: "Was the injury on a city sidewalk, road, public park, or other municipal property?",
        rationale: "Municipal Act notice requirement applies — different from Occupiers' Liability.",
      },
      {
        id: "muni_injury__q2",
        text: "When did the injury occur?",
        rationale: "Establishes whether the 10-day (personal injury) municipal notice window has passed.",
      },
      {
        id: "muni_injury__q3",
        text: "Have you given written notice to the municipality?",
        rationale: "Failure to give notice may bar the claim; municipality can raise it as a defence.",
      },
    ],
    source: "Municipal Act, 2001 (Ontario), s.44(10) — notice of claim requirement for municipal property",
  },

  // ── Insurance ─────────────────────────────────────────────────────────────

  {
    id: "ins_claim_denial",
    label: "Insurance Claim Denial / Internal Appeal",
    severity: "S1",
    paFilter: ["ins"],
    triggerPatterns: [
      /\b(insurance\s+(claim\s+)?(denied|rejected|refused))\b/i,
      /\b(denied|rejected|refused)\s+(my\s+)?insurance\s+claim\b/i,
      /\b(internal\s+appeal|appealing\s+(to\s+the\s+)?insurer)\b/i,
    ],
    gateQuestions: [
      {
        id: "ins_denial__q1",
        text: "When did you receive the written denial?",
        rationale: "2-year limitation runs from denial date — internal appeal does NOT pause it.",
      },
      {
        id: "ins_denial__q2",
        text: "Are you currently in an internal appeal with the insurer?",
        rationale: "Critical: court clock runs during appeal; must file court action before 2 years from denial.",
      },
      {
        id: "ins_denial__q3",
        text: "Do you have a copy of the denial letter and the policy?",
        rationale: "Denial date and policy wording are the two key documents for analysis.",
      },
    ],
    source: "Ontario Limitations Act, 2002, s.4; LawPRO — internal appeal / court clock trap",
  },

  // ── Securities ────────────────────────────────────────────────────────────

  {
    id: "sec_misrepresentation",
    label: "Securities Misrepresentation",
    severity: "S1",
    paFilter: ["sec"],
    triggerPatterns: [
      /\b(investment\s+fraud|mis[- ]sold|unauthorized\s+trading|unsuitable\s+investment|Ponzi)\b/i,
      /\b(financial\s+advisor|investment\s+advisor|broker)\b.{0,40}\b(fraud|misled|lied|wrong|lost\s+money)\b/i,
      /\b(IIROC|OSC|securities\s+commission)\b.{0,30}\b(complaint|investigation|fraud)\b/i,
    ],
    gateQuestions: [
      {
        id: "sec_mis__q1",
        text: "What type of investment product was involved?",
        rationale: "Securities Act civil liability periods differ by product type and discovery date.",
      },
      {
        id: "sec_mis__q2",
        text: "When did you first realize there was a problem with this investment?",
        rationale: "OSC civil liability: 3 years from discovery with knowledge + 6-year longstop.",
      },
      {
        id: "sec_mis__q3",
        text: "Is the person you are complaining about registered with IIROC, OSC, or another body?",
        rationale: "Regulatory and civil remedies differ; IIROC arbitration has separate deadlines.",
      },
    ],
    source: "Securities Act (Ontario), s.138.14 — 3-year/6-year civil liability for misrepresentation",
  },

  // ── Elder Law ─────────────────────────────────────────────────────────────

  {
    id: "elder_poa_abuse",
    label: "Financial Elder Abuse / PoA Misuse",
    severity: "S1",
    paFilter: ["elder", "est"],
    triggerPatterns: [
      /\b(power\s+of\s+attorney|POA)\b.{0,40}\b(misused|abused|stole|took\s+money|unauthorized)\b/i,
      /\b(financial\s+elder\s+abuse|elder\s+financial\s+abuse)\b/i,
      /\b(my\s+family\s+(took|stole|took\s+over))\b.{0,40}\b(money|account|property|assets?)\b/i,
    ],
    gateQuestions: [
      {
        id: "elder_poa__q1",
        text: "Is there a Power of Attorney for Property in place? Who is the attorney named?",
        rationale: "POA attorney has fiduciary duty; breach is actionable under Substitute Decisions Act.",
      },
      {
        id: "elder_poa__q2",
        text: "What transactions or actions are suspected to be unauthorized?",
        rationale: "Specificity of allegations determines whether civil action or Public Guardian referral is appropriate.",
      },
      {
        id: "elder_poa__q3",
        text: "Does the person granting the POA still have legal capacity to revoke it?",
        rationale: "If capacity is lost, revocation requires court application (Substitute Decisions Act).",
      },
    ],
    source: "Substitute Decisions Act, 1992 (Ontario); LawPRO — financial elder abuse at intake",
  },

  // ── Environmental ─────────────────────────────────────────────────────────

  {
    id: "env_remediation_order",
    label: "Environmental Remediation Order",
    severity: "S1",
    paFilter: ["env"],
    triggerPatterns: [
      /\b(Ministry\s+of\s+Environment|MOE|MECP)\b.{0,40}\b(order|notice|compliance|remediation|cleanup)\b/i,
      /\b(environmental\s+compliance\s+order|ECO|spill\s+cleanup\s+order)\b/i,
      /\b(contamination|spill|toxic|hazardous\s+waste)\b.{0,40}\b(order|notice|government|ministry)\b/i,
    ],
    gateQuestions: [
      {
        id: "env_order__q1",
        text: "Has a government order or notice been issued requiring cleanup or remediation?",
        rationale: "Non-compliance with environmental orders results in daily fines and personal liability.",
      },
      {
        id: "env_order__q2",
        text: "What is the compliance deadline stated in the order?",
        rationale: "Deadlines in ECOs are strict; extension applications must be filed before expiry.",
      },
      {
        id: "env_order__q3",
        text: "What type of contamination is involved?",
        rationale: "Type of contamination determines applicable regulations and remediation standards.",
      },
    ],
    source: "Environmental Protection Act (Ontario), Part XV.1; Ontario Water Resources Act",
  },

  // ── Child & Youth ─────────────────────────────────────────────────────────

  {
    id: "youth_ycja_charges",
    label: "Youth Criminal Justice Act Charges",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(youth\s+court|young\s+offender|YCJA|youth\s+(criminal\s+)?(justice|charge|court))\b/i,
      /\b(my\s+)?(son|daughter|child|teenager|teen)\b.{0,30}\b(charged|arrested|accused)\b/i,
      /\b(charged|arrested)\b.{0,30}\b(12|13|14|15|16|17)\s*(years?\s+old|yo|y\.o\.)\b/i,
    ],
    gateQuestions: [
      {
        id: "youth_ycja__q1",
        text: "How old is the young person?",
        rationale: "YCJA applies to persons 12-17; different sentencing principles and record protections apply.",
      },
      {
        id: "youth_ycja__q2",
        text: "What offence has been alleged and when did it occur?",
        rationale: "Youth records are automatically sealed after set periods; understanding the charge matters.",
      },
      {
        id: "youth_ycja__q3",
        text: "Have police spoken to the youth without a parent or lawyer present?",
        rationale: "Youth must be advised of right to consult parent and counsel before questioning — YCJA, s.146.",
      },
    ],
    source: "Youth Criminal Justice Act (Canada), s.146 — right to consult before questioning",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Combined Registry
// ─────────────────────────────────────────────────────────────────────────────

export const FLAG_REGISTRY: Map<string, FlagDefinition> = new Map([
  ...UNIVERSAL_FLAGS.map(f => [f.id, f] as [string, FlagDefinition]),
  ...PA_FLAGS.map(f => [f.id, f] as [string, FlagDefinition]),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Detection Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run deterministic regex detection over conversation text.
 * Returns flag IDs that matched at least one trigger pattern.
 *
 * @param text         Full conversation text (all turns concatenated).
 * @param practiceArea Resolved practice area ID (e.g. "pi", "fam"). Empty string = universal only.
 */
export function detectFlags(text: string, practiceArea: string): string[] {
  const matched: string[] = [];

  for (const [id, flag] of FLAG_REGISTRY) {
    // PA filter: if flag specifies PAs, skip unless current PA is listed or universal
    if (flag.paFilter.length > 0 && !flag.paFilter.includes(practiceArea)) continue;
    // Run each trigger pattern
    for (const pattern of flag.triggerPatterns) {
      if (pattern.test(text)) {
        matched.push(id);
        break; // one match per flag is enough
      }
    }
  }

  return matched;
}

/**
 * Merge regex-detected flags with GPT-classifier-detected flags.
 * Returns deduplicated union, ordered S1 before S2.
 */
export function mergeFlags(regexFlags: string[], gptFlags: string[]): string[] {
  const all = new Set([...regexFlags, ...gptFlags]);
  // Validate all IDs exist in registry (ignore unknown IDs from GPT hallucination)
  const valid = [...all].filter(id => FLAG_REGISTRY.has(id));
  // Sort S1 before S2
  return valid.sort((a, b) => {
    const sa = FLAG_REGISTRY.get(a)!.severity;
    const sb = FLAG_REGISTRY.get(b)!.severity;
    if (sa === sb) return 0;
    return sa === "S1" ? -1 : 1;
  });
}

/**
 * Get the ordered list of mandatory gate questions for a set of active flags.
 * S1 flag questions precede S2 flag questions.
 * Deduplicates questions that appear in multiple flags.
 */
export function getGateQuestions(flagIds: string[]): GateQuestion[] {
  const seen = new Set<string>();
  const questions: GateQuestion[] = [];
  // Sort flags S1 first to ensure S1 gate questions come first
  const sorted = [...flagIds].sort((a, b) => {
    const sa = FLAG_REGISTRY.get(a)?.severity ?? "S2";
    const sb = FLAG_REGISTRY.get(b)?.severity ?? "S2";
    if (sa === sb) return 0;
    return sa === "S1" ? -1 : 1;
  });
  for (const flagId of sorted) {
    const flag = FLAG_REGISTRY.get(flagId);
    if (!flag) continue;
    for (const q of flag.gateQuestions) {
      if (!seen.has(q.id)) {
        seen.add(q.id);
        questions.push(q);
      }
    }
  }
  return questions;
}

/**
 * Get flag definitions for a set of active flag IDs.
 * Useful for logging, UI rendering, and session state.
 */
export function getFlagDefinitions(flagIds: string[]): FlagDefinition[] {
  return flagIds.map(id => FLAG_REGISTRY.get(id)).filter(Boolean) as FlagDefinition[];
}

/**
 * Returns true if any of the given flags has severity S1.
 * Used to determine whether to prioritize gate questions over standard questions.
 */
export function hasCriticalFlag(flagIds: string[]): boolean {
  return flagIds.some(id => FLAG_REGISTRY.get(id)?.severity === "S1");
}
