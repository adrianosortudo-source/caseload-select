/**
 * CaseLoad Screen  -  Compliance Flag Registry
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
  text: string;          // fallback question text (used when no PA-specific text matches)
  /** Practice-area-specific overrides. Key is a PA prefix, e.g. "immigration", "employment", "pi". */
  textByPA?: Record<string, string>;
  rationale: string;     // internal  -  why this question exists (not shown to client)
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
  /**
   * S1 flags only. One sentence of warmth shown to the client before gate questions begin.
   * Contextualises why we are asking  -  never generated, always authored.
   * S2 flags leave this undefined (gate questions appear without a preamble).
   */
  preamble?: string;
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
        text: "When did that happen? Do you remember the month and year?",
        textByPA: {
          immigration: "When were you deported from Canada?",
          employment:  "When were you let go?",
          pi:          "When did the accident happen?",
          family:      "When did the separation happen?",
          criminal:    "When did the incident happen?",
          human_rights: "When did the last incident occur?",
          real_estate: "When did the transaction take place?",
        },
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
    triggerPatterns: [], // always triggered when opposing party is named  -  GPT handles
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
      /\b(changed|switched|fired|left)\s+(my\s+)?(lawyer|attorney|counsel)\b/i,
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
    source: "LawPRO  -  scope creep and unrealistic expectations claim category",
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
    source: "LawPRO  -  failure to identify all defendants (top PI intake claim)",
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
    source: "LawPRO  -  inadequate fact investigation at intake",
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
    source: "Insurance Act (Ontario), s.258.3  -  7-day notification for accident benefits",
  },
  {
    id: "mvac_hit_and_run",
    label: "Hit and Run / Unknown Driver",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\bhit\s+and\s+run\b/i,
      /\b(drove|sped|ran|fled)\s+away\b/i,
      /\b(accident|crash|collision|hit\s+(me|my\s+car))\b.{0,60}\b(drove|sped|ran|fled)\s+away\b/i,
      /\b(didn.t\s+stop|left\s+the\s+scene|fled\s+the\s+scene|no\s+plate|no\s+plates?|couldn.t\s+get\s+(their|the)\s+plate)\b/i,
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
  {
    id: "pi_mig_designation",
    label: "MIG Designation  -  Minor Injury Guideline Challenge",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(MIG|minor\s+injury\s+guideline)\b/i,
      /\b(placed\s+in|put\s+(me\s+)?in|designated\s+(under|to|in))\b.{0,30}\b(MIG|minor\s+injury|the\s+guideline)\b/i,
      /\b(MIG|minor\s+injury\s+guideline)\b.{0,40}\b(capped|cap|limit|maximum|\$3[,.]?500)\b/i,
      /(\$3[,.]?500\s+(cap|limit|maximum)).{0,40}\b(treatment|therapy|benefits?|SABS)\b/i,
      /\b(treatment|therapy|benefits?)\b.{0,40}(\$3[,.]?500\s+(cap|limit|maximum))/i,
      /\b(dispute|challenge|contest|disagree)\b.{0,30}\b(MIG|minor\s+injury|the\s+guideline|designation)\b/i,
    ],
    gateQuestions: [
      {
        id: "pi_mig__q1",
        text: "Has the insurer formally notified you that your injuries have been designated under the Minor Injury Guideline?",
        rationale: "MIG designation limits treatment benefits to $3,500; formal notice triggers the dispute pathway.",
      },
      {
        id: "pi_mig__q2",
        text: "Do you have injuries that go beyond soft tissue  -  such as a psychological or psychiatric condition, a pre-existing condition that was worsened, or a chronic pain disorder?",
        rationale: "Injuries beyond the MIG definition (pre-existing conditions, psychological injury, chronic pain) can be used to dispute the designation and access higher non-MIG benefits.",
      },
      {
        id: "pi_mig__q3",
        text: "Has your treating physician or specialist provided an opinion that your injuries fall outside the MIG?",
        rationale: "A supporting medical opinion from a treating provider is the foundation of a successful MIG dispute at the LAT.",
      },
    ],
    source: "SABS, O. Reg. 34/10 (Minor Injury Guideline); Insurance Act, s.280  -  LAT arbitration pathway for MIG disputes",
  },

  // ── Medical Malpractice ───────────────────────────────────────────────────

  {
    id: "medmal_causation_unclear",
    label: "Medical Malpractice Causation Unclear",
    severity: "S1",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(think|believe|suspect)\s+(something\s+went\s+wrong|there\s+was\s+a\s+mistake|(the|my)\s+(doctor|surgeon|hospital)\s+(made|did\s+something))\b/i,
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
    source: "LawPRO  -  failure to identify all defendants in medical malpractice",
  },

  // ── Slip & Fall ───────────────────────────────────────────────────────────

  {
    id: "slip_ice_snow",
    label: "Slip on Ice/Snow  -  60-Day Notice",
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
        text: "What type of property was it  -  a private home, a business, or a public area?",
        rationale: "Private property triggers the 60-day Occupiers' Liability Act notice obligation.",
      },
      {
        id: "slip_ice__q3",
        text: "Have you given any written notice to the property owner yet?",
        rationale: "Failure to give written notice within 60 days bars the claim under the Act.",
      },
    ],
    source: "Occupiers' Liability Act (Ontario), s.6(1)  -  60-day written notice for snow/ice",
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
      /\bpothole\b.{0,40}\b(road|street|city|municipal)\b/i,
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
    source: "Municipal Act, 2001 (Ontario), s.44(10)  -  notice of claim for municipal property injury",
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
        rationale: "The 2-year court limitation period runs from the denial date  -  NOT from the appeal outcome.",
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
    source: "Ontario Limitations Act, 2002, s.4; LawPRO  -  LTD claim bar from missed court limitation",
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
    source: "LawPRO  -  failure to analyze policy language (LTD claim category)",
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
        text: "Are there significant assets to divide  -  home, pension, investments?",
        rationale: "High-value estates make the deadline more consequential.",
      },
    ],
    source: "Family Law Act (Ontario), s.7(3)  -  6-year limitation for property equalization",
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
      /\b(child|son|daughter|kids?)\b.{0,60}\b(was\s+)?(took|taken|brought|moved)\b.{0,60}\b(country|abroad|overseas|another\s+country|outside\s+canada)\b/i,
      /\bwithout\s+my\s+(consent|permission|knowledge)\b.{0,60}\b(country|abroad|overseas|another\s+country)\b/i,
      /\bher\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
      /\bhis\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
      /\b(son|daughter|child|kids?)\b.{0,40}\b(her|his)\s+home\s+country\b/i,
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
    source: "LawPRO  -  failure to identify DV history impacts custody/safety strategy",
  },
  {
    id: "fam_hidden_assets",
    label: "Hidden or Undisclosed Assets",
    severity: "S2",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(don.t\s+know|not\s+sure|no\s+idea)\b.{0,40}\b(what\s+(he|she|they)\b.{0,20}\b(earns?|owns?|has|hides?)|what\s+my\s+(spouse|husband|wife|partner)\s+(earns?|owns?|has))\b/i,
      /\b(offshore|overseas|foreign)\s+(account|assets?|investment|bank)\b/i,
      /\b(hidden|hiding|concealing)\s+(assets?|money|income|accounts?)\b/i,
      /\b(self[- ]employed|own(s)?\s+a\s+business|runs?\s+a\s+business)\b.{0,40}\b(spouse|husband|wife|partner)\b/i,
      /\b(husband|wife|spouse|partner)\b.{0,60}\bown(s)?\s+a\s+business\b/i,
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
    source: "LawPRO  -  inadequate financial disclosure at family law intake",
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
        rationale: "Child must be brought before court within 5 days of apprehension  -  CYFSA, s.16.",
      },
      {
        id: "child_app__q2",
        text: "Where is the child placed now  -  foster home, relative, or other parent?",
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
    source: "LawPRO  -  inadequate documentation of rehabilitation at child protection intake",
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
    source: "IRPA; Refugee Appeal Division Rules, Rule 3  -  15-day notice, 45-day record",
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
        text: "Do you have a removal order? What type  -  departure, exclusion, or deportation order?",
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
    source: "IRPA; Immigration and Refugee Protection Regulations  -  enforcement timelines",
  },
  {
    id: "imm_inadmissibility",
    label: "Immigration Inadmissibility Signals",
    severity: "S2",
    paFilter: ["imm"],
    triggerPatterns: [
      /\b(criminal\s+(record|history)|prior\s+conviction)\b.{0,60}\b(immigration|visa|Canada|permanent\s+residence)\b/i,
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
    source: "IRPA, ss.36-38  -  criminal, health, and security inadmissibility grounds",
  },

  // ── Criminal ──────────────────────────────────────────────────────────────

  {
    id: "crim_charter_violation",
    label: "Charter Rights Violation Signals",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\bwarrantless\s+search\b/i,
      /\bsearched\b.{0,30}\bwithout\s+a\s+warrant\b/i,
      /\b(didn.t\s+tell\s+me\s+(my\s+)?(rights?|right\s+to\s+a\s+lawyer))\b/i,
      /\b(detained\s+without|stopped\s+without)\s+(reason|cause|warrant)\b/i,
      /\b(breathalyzer|blood\s+test|breath\s+sample)\b.{0,80}\b(lawyer|counsel)\b/i,
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
        rationale: "Warrantless search may be a s.8 Charter violation  -  key to exclusion application.",
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
        rationale: "Dual representation in criminal matters is almost always a conflict  -  must refuse.",
      },
    ],
    source: "LSO Rules of Professional Conduct, Rule 3.4  -  conflicts; criminal co-accused doctrine",
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
    source: "Criminal Code of Canada, s.145  -  failure to comply with bail conditions",
  },

  // ── Employment ────────────────────────────────────────────────────────────

  {
    id: "emp_hrto_clock",
    label: "HRTO 1-Year Deadline",
    severity: "S1",
    paFilter: ["emp", "hr"],
    triggerPatterns: [
      /\b(discrimination|discriminat)\b.{0,40}\b(race|gender|age|disability|religion|pregnancy|sex|colour|ethnic|sexual\s+orientation|creed)\b/i,
      /\b(race|gender|age|disability|religion|pregnancy|sex|colour|ethnic|sexual\s+orientation|creed)\b.{0,80}\bdiscriminat/i,
      /\bHRTO\b/i,
      /\bhuman\s+rights\s+(complaint|violation|issue|application)\b/i,
      /\bdiscriminated\s+against\b/i,
    ],
    gateQuestions: [
      {
        id: "emp_hrto__q1",
        text: "When was the last act of discrimination or harassment?",
        rationale: "HRTO has a 1-year deadline from the last act  -  stricter than the general 2-year limitation.",
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
    source: "Ontario Human Rights Code, s.34  -  1-year limitation for HRTO applications",
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
    source: "LawPRO  -  release signed without independent legal advice (top employment intake risk)",
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
    source: "LawPRO  -  failure to identify constructive dismissal (client resigned, has valid claim)",
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
        text: "Who is your direct employer  -  the specific company name and any parent company?",
        rationale: "HRTO application against wrong entity is rejected; respondent identification is critical.",
      },
      {
        id: "hrto_resp__q2",
        text: "If you work at a franchise, do you know who the actual employer is?",
        rationale: "Franchisee vs. franchisor liability differs; wrong respondent voids application.",
      },
    ],
    source: "LawPRO  -  misidentification of respondent entity (HRTO intake failure)",
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
    source: "LSO Rules of Professional Conduct, Rule 3.4; LawPRO  -  dual rep real estate claims",
  },
  {
    id: "real_estate_undisclosed_defects",
    label: "Post-Closing Defect Discovery",
    severity: "S1",
    paFilter: ["real"],
    triggerPatterns: [
      /\b(didn.t\s+(tell\s+me|disclose|mention)|not\s+disclosed|hid|concealed|never\s+(told|mentioned|disclosed))\b.{0,60}\b(defect|damage|problem|issue|mold|flood|water|foundation|roof)\b/i,
      /\b(found|discovered)\b.{0,80}\bafter\s+(buying|closing|moving\s+in|purchasing)\b/i,
      /\bafter\s+(moving\s+in|I\s+moved\s+in|buying|closing|purchasing)\b.{0,80}\b(found|discovered|noticed)\b/i,
      /\b(defect|mold|water\s+damage|foundation\s+(crack|issue))\b.{0,60}\b(after\s+(closing|I\s+moved))\b/i,
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
    source: "LawPRO  -  non-disclosure of material defects (top real estate claim category)",
  },

  // ── Wills & Estates ───────────────────────────────────────────────────────

  {
    id: "estates_capacity",
    label: "Testamentary Capacity Concern",
    severity: "S1",
    paFilter: ["est"],
    triggerPatterns: [
      /\b(dementia|alzheimer|cognitive\s+decline|memory\s+(loss|issues?))\b.{0,80}\b(will|estate|signing)\b/i,
      /\b(doesn.t\s+really\s+understand|confused|not\s+mentally\s+sharp)\b.{0,80}\b(will|estate|signing)\b/i,
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
    source: "LawPRO  -  testamentary capacity (top wills claim category)",
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
        rationale: "This pattern is the primary indicator of undue influence  -  requires independent interview.",
      },
    ],
    source: "LawPRO  -  undue influence (estates claim category); Vout v. Hay [1995] SCR",
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
        text: "When was probate granted  -  that is, when was the estate trustee officially appointed by the court?",
        rationale: "6-month dependant relief deadline runs from the grant of probate.",
      },
      {
        id: "est_dep__q2",
        text: "Is the person challenging the will a spouse, child, or dependant of the deceased?",
        rationale: "Only dependants within the SLRA definition have standing for a dependant relief claim.",
      },
    ],
    source: "Succession Law Reform Act (Ontario), s.61  -  6-month deadline for dependant relief",
  },

  // ── Construction ──────────────────────────────────────────────────────────

  {
    id: "construction_lien_deadline",
    label: "Construction Lien 60-Day Preservation",
    severity: "S1",
    paFilter: ["const"],
    triggerPatterns: [
      /\b(contractor|subcontractor|supplier)\b.{0,40}\b(not\s+paid|unpaid|won.t\s+pay|hasn.t\s+paid)\b/i,
      /\b(owner|client|customer|general\s+contractor)\b.{0,40}\b(hasn.t\s+paid|won.t\s+pay|not\s+paid|owes?\s+(me|us))\b/i,
      /\b(finished|completed)\b.{0,60}\b(project|job|work)\b.{0,80}\b(not\s+paid|unpaid|hasn.t\s+paid|haven.t\s+paid)\b/i,
      /\b(holdback|construction\s+lien|lien\s+rights?)\b/i,
      /\b(work\s+(is\s+)?done|project\s+(is\s+)?complete|substantial\s+performance)\b.{0,40}\b(not\s+paid|unpaid|money\s+owing)\b/i,
    ],
    gateQuestions: [
      {
        id: "const_lien__q1",
        text: "When was substantial performance of your work achieved  -  roughly when was the project substantially complete?",
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
        rationale: "Urgency calculation  -  if past 45 days, immediate action required.",
      },
    ],
    source: "Construction Act (Ontario), s.31  -  60-day lien preservation from substantial performance",
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
    source: "Judicial Review Procedure Act (Ontario), s.5 (as amended July 8, 2020  -  30-day deadline)",
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
    source: "Workplace Safety and Insurance Act, 1997 (Ontario), s.22  -  6-month claim deadline",
  },

  // ── Defamation ────────────────────────────────────────────────────────────

  {
    id: "defamation_media_notice",
    label: "Defamation  -  6-Week Media Notice",
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
        rationale: "Libel and Slander Act applies  -  6-week written notice required before lawsuit.",
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
    source: "Libel and Slander Act (Ontario), s.5  -  6-week notice to newspaper/broadcaster",
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
    source: "Income Tax Act (Canada), s.165  -  90-day objection deadline from NOA",
  },

  // ── Labour ────────────────────────────────────────────────────────────────

  {
    id: "labour_ulp_complaint",
    label: "Unfair Labour Practice  -  90 Days",
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
        rationale: "90-day OLRB deadline runs from the date of the ULP  -  hard bar.",
      },
      {
        id: "labour_ulp__q3",
        text: "Is there an active union organizing drive or a certified bargaining unit at this workplace?",
        rationale: "ULP context (organizing vs. post-certification) changes available remedies.",
      },
    ],
    source: "Ontario Labour Relations Act, 1995, s.96(4)  -  90-day ULP complaint deadline",
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
        text: "Which program was denied or cut  -  Ontario Works (OW) or ODSP?",
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
    source: "Ontario Works Act, 1997; ODSP Act, 1997  -  30-day internal review deadline",
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
      /\b(city|municipal|municipality|town)\s+(street|road|sidewalk)\b/i,
      /\bpothole\b.{0,30}\b(city|municipal|road|street)\b/i,
    ],
    gateQuestions: [
      {
        id: "muni_injury__q1",
        text: "Was the injury on a city sidewalk, road, public park, or other municipal property?",
        rationale: "Municipal Act notice requirement applies  -  different from Occupiers' Liability.",
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
    source: "Municipal Act, 2001 (Ontario), s.44(10)  -  notice of claim requirement for municipal property",
  },

  // ── Insurance ─────────────────────────────────────────────────────────────

  {
    id: "ins_claim_denial",
    label: "Insurance Claim Denial / Internal Appeal",
    severity: "S1",
    paFilter: ["ins"],
    triggerPatterns: [
      /\b(insurance\s+claim)\b.{0,30}\b(denied|rejected|refused)\b/i,
      /\b(insurance\s+company|insurer)\b.{0,40}\b(denied|rejected|refused)\b/i,
      /\b(denied|rejected|refused)\s+(my\s+)?(insurance\s+claim|claim\s+for)\b/i,
      /\b(internal\s+appeal|appealing\s+(to\s+the\s+)?insurer)\b/i,
    ],
    gateQuestions: [
      {
        id: "ins_denial__q1",
        text: "When did you receive the written denial?",
        rationale: "2-year limitation runs from denial date  -  internal appeal does NOT pause it.",
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
    source: "Ontario Limitations Act, 2002, s.4; LawPRO  -  internal appeal / court clock trap",
  },

  // ── Securities ────────────────────────────────────────────────────────────

  {
    id: "sec_misrepresentation",
    label: "Securities Misrepresentation",
    severity: "S1",
    paFilter: ["sec"],
    triggerPatterns: [
      /\b(investment\s+fraud|mis[- ]sold|unauthorized\s+trad(ing|e|es)|unsuitable\s+investment|Ponzi)\b/i,
      /\b(financial\s+advisor|investment\s+advisor|broker)\b.{0,80}\b(fraud|fraudulent|misled|lied|wrong|lost\s+money|unauthorized)\b/i,
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
    source: "Securities Act (Ontario), s.138.14  -  3-year/6-year civil liability for misrepresentation",
  },

  // ── Elder Law ─────────────────────────────────────────────────────────────

  {
    id: "elder_poa_abuse",
    label: "Financial Elder Abuse / PoA Misuse",
    severity: "S1",
    paFilter: ["elder", "est"],
    triggerPatterns: [
      /\b(power\s+of\s+attorney|POA)\b.{0,40}\b(misused|abused|stole|stolen|took\s+money|taking\s+money|unauthorized)\b/i,
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
    source: "Substitute Decisions Act, 1992 (Ontario); LawPRO  -  financial elder abuse at intake",
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

  // ── Corporate ─────────────────────────────────────────────────────────────

  {
    id: "corp_oppression",
    label: "Corporate Oppression Remedy",
    severity: "S1",
    paFilter: ["corp"],
    triggerPatterns: [
      /\b(oppression|oppressive\s+conduct)\b.{0,30}\b(shareholder|director|company)\b/i,
      /\b(shareholder|minority\s+shareholder)\b.{0,40}\b(squeeze\s+out|excluded|frozen\s+out|removed|shut\s+out)\b/i,
      /\boppression\s+remedy\b/i,
    ],
    gateQuestions: [
      {
        id: "corp_opp__q1",
        text: "Are you a shareholder, director, or officer of the corporation involved?",
        rationale: "Only shareholders, directors, or officers have standing for an oppression remedy.",
      },
      {
        id: "corp_opp__q2",
        text: "What specific conduct by the corporation or majority shareholders do you consider unfair?",
        rationale: "Particulars of oppressive conduct define the remedy scope under OBCA s.248.",
      },
      {
        id: "corp_opp__q3",
        text: "Is there a unanimous shareholder agreement in place?",
        rationale: "USA terms may restrict oppression remedies or provide alternative dispute resolution.",
      },
    ],
    source: "Ontario Business Corporations Act, s.248  -  oppression remedy",
  },
  {
    id: "corp_personal_liability",
    label: "Director/Officer Personal Liability",
    severity: "S2",
    paFilter: ["corp"],
    triggerPatterns: [
      /\b(director|officer)\b.{0,40}\b(personally\s+liable|personal\s+liability|sued\s+personally)\b/i,
      /\b(piercing\s+the\s+corporate\s+veil|alter\s+ego|sham\s+corporation)\b/i,
      /\bunpaid\s+(wages?|source\s+deductions?|HST|payroll)\b.{0,30}\b(director|officer)\b/i,
    ],
    gateQuestions: [
      {
        id: "corp_pers__q1",
        text: "Are you being named personally in a claim against the corporation?",
        rationale: "Director liability under OBCA s.131 and CRA director liability are distinct claims.",
      },
      {
        id: "corp_pers__q2",
        text: "Did you resign as director before the liability arose? When?",
        rationale: "Resignation timing is critical for CRA director liability  -  s.323 ITA defence.",
      },
    ],
    source: "Ontario Business Corporations Act, s.131; Income Tax Act, s.323  -  director liability",
  },

  // ── Construction (supplemental) ───────────────────────────────────────────

  {
    id: "construction_contract_dispute",
    label: "Construction Contract Dispute",
    severity: "S2",
    paFilter: ["const"],
    triggerPatterns: [
      /\b(change\s+order|scope\s+creep|extras?)\b.{0,40}\b(dispute|refused|not\s+paid)\b/i,
      /\b(deficiency|deficiencies|defective\s+work)\b.{0,30}\b(contractor|builder|subcontractor)\b/i,
      /\b(construction\s+contract|general\s+contract)\b.{0,40}\b(breach|dispute|terminated)\b/i,
    ],
    gateQuestions: [
      {
        id: "const_cont__q1",
        text: "Is there a written contract? Who are the parties?",
        rationale: "Written contract terms define obligations, dispute resolution, and termination rights.",
      },
      {
        id: "const_cont__q2",
        text: "What is the dollar value of the dispute?",
        rationale: "Claim value determines whether Small Claims Court or Superior Court is appropriate.",
      },
    ],
    source: "Construction Act (Ontario); common law contract principles",
  },

  // ── Landlord & Tenant ─────────────────────────────────────────────────────

  {
    id: "llt_notice_validity",
    label: "Invalid Eviction Notice",
    severity: "S1",
    paFilter: ["llt"],
    triggerPatterns: [
      /\b(eviction\s+notice|notice\s+to\s+vacate|N\d\s+notice)\b/i,
      /\b(landlord\s+(gave|served|sent)\b.{0,30}\b(notice|N4|N12|N13))\b/i,
      /\b(evicted|eviction)\b.{0,30}\b(notice|improperly|wrong|invalid)\b/i,
    ],
    gateQuestions: [
      {
        id: "llt_notice__q1",
        text: "What type of notice did you receive  -  N4 (non-payment), N12 (personal use), or another?",
        rationale: "Notice type determines grounds, required notice period, and available defences.",
      },
      {
        id: "llt_notice__q2",
        text: "When was the notice served and when must you vacate?",
        rationale: "Improper service or insufficient notice period voids the notice entirely.",
      },
      {
        id: "llt_notice__q3",
        text: "Has an LTB hearing date been scheduled?",
        rationale: "LTB response deadlines are strict; missing them may result in default order.",
      },
    ],
    source: "Residential Tenancies Act, 2006 (Ontario)  -  eviction notice requirements",
  },
  {
    id: "llt_non_payment",
    label: "Non-Payment Arrears / Eviction",
    severity: "S2",
    paFilter: ["llt"],
    triggerPatterns: [
      /\b(rent\s+arrears?|behind\s+on\s+rent|owe\s+rent|unpaid\s+rent)\b/i,
      /\b(N4|non[- ]payment\s+notice)\b/i,
      /\b(eviction\s+for\s+(non[- ]payment|arrears?))\b/i,
    ],
    gateQuestions: [
      {
        id: "llt_nonpay__q1",
        text: "How many months of rent are owed, and what is the monthly amount?",
        rationale: "Arrears amount determines whether repayment plan vs. eviction order is more likely.",
      },
      {
        id: "llt_nonpay__q2",
        text: "Have you applied to the LTB for a hearing, or has the landlord?",
        rationale: "Tenant can request a payment plan; LTB hearing timing affects available options.",
      },
    ],
    source: "Residential Tenancies Act, 2006 (Ontario), s.87  -  non-payment eviction process",
  },

  // ── Intellectual Property ─────────────────────────────────────────────────

  {
    id: "ip_maintenance_lapse",
    label: "IP Maintenance Lapse",
    severity: "S1",
    paFilter: ["ip"],
    triggerPatterns: [
      /\b(patent|trademark|trade\s+mark)\b.{0,40}\b(lapsed|expired|abandoned|maintenance\s+fee)\b/i,
      /\b(missed|failed\s+to\s+pay)\b.{0,30}\b(maintenance\s+fee|renewal\s+fee|annuity)\b/i,
    ],
    gateQuestions: [
      {
        id: "ip_maint__q1",
        text: "What type of IP  -  patent, trademark, or copyright  -  and when did it lapse or expire?",
        rationale: "Reinstatement windows differ: 12 months for patents, varies for trademarks.",
      },
      {
        id: "ip_maint__q2",
        text: "Did you receive any notices from CIPO before the lapse?",
        rationale: "Failure to receive CIPO notice may support a reinstatement application.",
      },
      {
        id: "ip_maint__q3",
        text: "Has any competitor begun using the IP since it lapsed?",
        rationale: "Third-party reliance on lapsed IP complicates reinstatement and damages claims.",
      },
    ],
    source: "Patent Act (Canada), s.46; Trade-marks Act (Canada)  -  maintenance and renewal obligations",
  },
  {
    id: "ip_infringement",
    label: "IP Infringement Claim",
    severity: "S1",
    paFilter: ["ip"],
    triggerPatterns: [
      /\b(copyright\s+infringement|trademark\s+infringement|patent\s+infringement)\b/i,
      /\b(using\s+my\s+(trademark|logo|brand|patent|copyright|design)\s+without)\b/i,
      /\b(stole|copied|knock[- ]off|counterfeit)\b.{0,30}\b(design|brand|logo|product|invention)\b/i,
    ],
    gateQuestions: [
      {
        id: "ip_infring__q1",
        text: "Is the IP registered  -  patent, trademark, or industrial design  -  and where?",
        rationale: "Registered IP provides stronger statutory remedies; unregistered relies on common law.",
      },
      {
        id: "ip_infring__q2",
        text: "When did you first become aware of the infringement?",
        rationale: "3-year limitation period for IP claims under federal Acts runs from knowledge.",
      },
      {
        id: "ip_infring__q3",
        text: "Have you sent a cease and desist letter yet?",
        rationale: "Cease and desist establishes notice and may crystallize damages from that date.",
      },
    ],
    source: "Copyright Act (Canada), s.41; Trade-marks Act, s.55  -  infringement remedies",
  },

  // ── WSIB (supplemental) ───────────────────────────────────────────────────

  {
    id: "wsib_dearos",
    label: "WSIB Appeals / Return-to-Work Dispute",
    severity: "S1",
    paFilter: ["wsib"],
    triggerPatterns: [
      /\b(WSIB\s+appeal|appeal(ing)?\s+(to|the)\s+WSIAT)\b/i,
      /\b(return\s+to\s+work\s+plan|RTW\s+(plan|dispute|obligation))\b/i,
      /\b(WSIB\s+(denied|refused|cut\s+off)\s+(my\s+)?(benefits?|claim))\b/i,
    ],
    gateQuestions: [
      {
        id: "wsib_dearos__q1",
        text: "Have you received a decision letter from WSIB that you disagree with?",
        rationale: "WSIB internal objection must be filed within 30 days of the decision.",
      },
      {
        id: "wsib_dearos__q2",
        text: "Have you already filed an objection with WSIB or an appeal to WSIAT?",
        rationale: "WSIAT appeal must be filed within 6 months of the WSIB appeals branch decision.",
      },
      {
        id: "wsib_dearos__q3",
        text: "Are you in an active return-to-work dispute with your employer?",
        rationale: "RTW obligations are separate from benefit entitlement; different timelines apply.",
      },
    ],
    source: "Workplace Safety and Insurance Act, 1997 (Ontario), s.125  -  appeals and return to work",
  },

  // ── Defamation (supplemental) ─────────────────────────────────────────────

  {
    id: "defamation_online",
    label: "Online Defamation",
    severity: "S2",
    paFilter: ["defam"],
    triggerPatterns: [
      /\b(social\s+media|Facebook|Instagram|Twitter|Reddit|Google\s+review|Yelp)\b.{0,40}\b(defamatory|false|lies|defamation|lied|smear)\b/i,
      /\b(posted|published)\b.{0,30}\b(lies|false\s+(statements?|information|allegations?)|defamatory)\b.{0,30}\b(online|internet|web|social\s+media)\b/i,
    ],
    gateQuestions: [
      {
        id: "defam_online__q1",
        text: "On which platform was the statement published and is it still accessible?",
        rationale: "Online defamation may require injunctive relief; platform identification enables takedown.",
      },
      {
        id: "defam_online__q2",
        text: "Do you know the identity of the person who posted it?",
        rationale: "Anonymous online defamation may require a Norwich order to identify the poster.",
      },
    ],
    source: "Defamation Act (Ontario); common law  -  online defamation (no 6-week notice required)",
  },

  // ── Municipal (supplemental) ──────────────────────────────────────────────

  {
    id: "municipal_bylaw_appeal",
    label: "Municipal By-law / Committee of Adjustment",
    severity: "S2",
    paFilter: ["admin"],
    triggerPatterns: [
      /\b(by[- ]law\s+(violation|offence|ticket|order|infraction))\b/i,
      /\b(committee\s+of\s+adjustment|minor\s+variance|zoning\s+(appeal|variance))\b/i,
      /\b(property\s+standards\s+(order|notice)|heritage\s+(designation|objection))\b/i,
    ],
    gateQuestions: [
      {
        id: "muni_bylaw__q1",
        text: "What type of municipal order or decision is being challenged?",
        rationale: "By-law appeals go to Committee of Adjustment or OMB; different deadlines apply.",
      },
      {
        id: "muni_bylaw__q2",
        text: "When was the order or decision issued and what is the deadline to appeal?",
        rationale: "Committee of Adjustment appeals must be filed within 20 days under the Planning Act.",
      },
    ],
    source: "Planning Act (Ontario), s.45  -  Committee of Adjustment appeals; Municipal Act, s.444",
  },

  // ── Privacy ───────────────────────────────────────────────────────────────

  {
    id: "privacy_data_breach",
    label: "Privacy / Data Breach",
    severity: "S1",
    paFilter: ["priv"],
    triggerPatterns: [
      /\b(data\s+breach|privacy\s+breach|personal\s+information\s+(leaked|exposed|stolen|compromised))\b/i,
      /\b(PIPEDA|Privacy\s+Commissioner|privacy\s+complaint)\b/i,
      /\b(hacked|cyberattack|ransomware)\b.{0,30}\b(personal\s+data|client\s+information|health\s+records?)\b/i,
    ],
    gateQuestions: [
      {
        id: "priv_breach__q1",
        text: "What type of personal information was disclosed  -  financial, health, or identity data?",
        rationale: "PIPEDA breach severity and notification obligations depend on the type of information.",
      },
      {
        id: "priv_breach__q2",
        text: "Have you notified affected individuals and the Privacy Commissioner?",
        rationale: "PIPEDA requires notification to OPC and affected individuals of material breaches.",
      },
      {
        id: "priv_breach__q3",
        text: "When did the breach occur and when was it discovered?",
        rationale: "Limitation period for privacy claims and OPC complaint deadlines run from discovery.",
      },
    ],
    source: "Personal Information Protection and Electronic Documents Act (PIPEDA), s.10.1",
  },

  // ── Animal Injury ─────────────────────────────────────────────────────────

  {
    id: "animal_bite_injury",
    label: "Dog Bite / Animal Injury",
    severity: "S2",
    paFilter: ["pi"],
    triggerPatterns: [
      /\b(dog\s+bite|bitten\s+by\s+a\s+dog|attacked\s+by\s+(a\s+)?dog)\b/i,
      /\b(dog|animal|pet)\b.{0,30}\b(attacked|bit|mauled|jumped\s+on)\b/i,
    ],
    gateQuestions: [
      {
        id: "animal_bite__q1",
        text: "Do you know who owns the dog or animal?",
        rationale: "Under the Dog Owners' Liability Act (Ontario), the owner is strictly liable for bites.",
      },
      {
        id: "animal_bite__q2",
        text: "When did the bite occur and have you sought medical treatment?",
        rationale: "Establishes the start of the 2-year limitation period and documents injury severity.",
      },
      {
        id: "animal_bite__q3",
        text: "Were there witnesses? Was the bite reported to animal control?",
        rationale: "Animal control records document prior incidents and owner's knowledge of aggression.",
      },
    ],
    source: "Dog Owners' Liability Act (Ontario), s.2  -  strict liability for dog bites",
  },

  // ── Class Action ──────────────────────────────────────────────────────────

  {
    id: "class_action_opt_out",
    label: "Class Action Opt-Out Deadline",
    severity: "S1",
    paFilter: ["civil"],
    triggerPatterns: [
      /\b(class\s+action|class\s+proceeding)\b.{0,40}\b(opt[- ]out|deadline|notice)\b/i,
      /\b(received\s+notice\s+of\s+a\s+class\s+action)\b/i,
      /\b(settlement\s+(notice|approval|class\s+action))\b/i,
    ],
    gateQuestions: [
      {
        id: "class_opt__q1",
        text: "Have you received a class action opt-out notice? What is the opt-out deadline?",
        rationale: "Missing the opt-out deadline means the client is bound by any settlement.",
      },
      {
        id: "class_opt__q2",
        text: "Do you have individual damages that may exceed a class action recovery?",
        rationale: "Opting out preserves individual claims; opting in surrenders them on settlement.",
      },
    ],
    source: "Class Proceedings Act, 1992 (Ontario), s.9  -  opt-out rights and deadlines",
  },

  // ── Youth (supplemental) ─────────────────────────────────────────────────

  {
    id: "youth_school_discipline",
    label: "School Discipline / Suspension Appeal",
    severity: "S2",
    paFilter: ["admin"],
    triggerPatterns: [
      /\b(school\s+(suspension|expulsion|discipline))\b/i,
      /\b(expelled|suspended\s+from\s+school)\b/i,
      /\b(safe\s+schools?\s+act|zero\s+tolerance\s+(policy|suspension))\b/i,
    ],
    gateQuestions: [
      {
        id: "youth_school__q1",
        text: "Was the student suspended or expelled, and for how many days?",
        rationale: "Long-term suspension (>5 days) and expulsion have different appeal timelines.",
      },
      {
        id: "youth_school__q2",
        text: "When was the suspension or expulsion decision communicated to the parent?",
        rationale: "Suspension review must be requested promptly; timelines run from notice to parent.",
      },
    ],
    source: "Education Act (Ontario), s.309-311  -  long-term suspension and expulsion appeals",
  },

  // ── Insolvency ────────────────────────────────────────────────────────────

  {
    id: "insolvency_creditor_action",
    label: "Creditor Action / Collection Threat",
    severity: "S1",
    paFilter: ["insol"],
    triggerPatterns: [
      /\b(creditor|collection\s+agency|bailiff)\b.{0,40}\b(seizing|garnish|lawsuit|judgment|writ)\b/i,
      /\b(wage\s+garnishment|bank\s+account\s+(frozen|seized|garnished))\b/i,
      /\b(statement\s+of\s+claim|served\s+(with\s+)?a\s+claim)\b.{0,30}\b(creditor|debt|money\s+owed)\b/i,
    ],
    gateQuestions: [
      {
        id: "insol_cred__q1",
        text: "Has a court judgment been obtained against you, or is a lawsuit pending?",
        rationale: "A judgment creditor has enforcement rights; a pending claim may still be negotiated.",
      },
      {
        id: "insol_cred__q2",
        text: "What are your total debts and do you have assets that could be seized?",
        rationale: "Debt-to-asset ratio determines whether a consumer proposal or bankruptcy is appropriate.",
      },
      {
        id: "insol_cred__q3",
        text: "Is your bank account or wages currently being garnished?",
        rationale: "Immediate insolvency filing stops garnishment automatically via statutory stay.",
      },
    ],
    source: "Bankruptcy and Insolvency Act (Canada), s.69  -  automatic stay on insolvency filing",
  },
  {
    id: "insolvency_asset_disclosure",
    label: "Asset Concealment / Disclosure Risk",
    severity: "S2",
    paFilter: ["insol"],
    triggerPatterns: [
      /\b(transferred\s+(assets?|property|money))\b.{0,30}\b(before\s+(bankruptcy|filing|insolvency))\b/i,
      /\b(preference\s+payment|fraudulent\s+preference|non[- ]arm.s[- ]length\s+transfer)\b/i,
      /\b(exempt\s+assets?|RRSP\s+exempt|RSP\s+(protection|exempt))\b/i,
    ],
    gateQuestions: [
      {
        id: "insol_asset__q1",
        text: "Have you transferred any property, money, or assets to family members in the last 5 years?",
        rationale: "Transfers at undervalue within 5 years of bankruptcy may be reversed as fraudulent preferences.",
      },
      {
        id: "insol_asset__q2",
        text: "Do you have RRSPs or exempt assets that you want to protect?",
        rationale: "Certain assets are exempt from seizure in bankruptcy  -  proper advice protects them.",
      },
    ],
    source: "Bankruptcy and Insolvency Act, ss.91-96  -  fraudulent preference and reviewable transactions",
  },

  // ── Additional Compliance Flags ────────────────────────────────────────────

  {
    id: "real_estate_closing_date",
    label: "Real Estate Closing Date / Extension Risk",
    severity: "S1",
    paFilter: ["real"],
    triggerPatterns: [
      /\b(closing\s+date|closing\s+deadline)\b.{0,40}\b(missed|can.t\s+close|delay|extend|problem)\b/i,
      /\b(can.t\s+(close|get\s+financing)|mortgage\s+(fell\s+through|not\s+approved))\b/i,
      /\b(vendor|seller)\b.{0,40}\b(won.t\s+(close|extend|complete)|breach\s+of\s+(agreement|contract|APS))\b/i,
    ],
    gateQuestions: [
      {
        id: "real_close__q1",
        text: "What is the closing date in the Agreement of Purchase and Sale?",
        rationale: "Time is of the essence in real estate; missing the closing date is a breach.",
      },
      {
        id: "real_close__q2",
        text: "Has either party requested an extension? Was it agreed to in writing?",
        rationale: "Unilateral extension attempts without consent do not bind the other party.",
      },
      {
        id: "real_close__q3",
        text: "What is the deposit amount and who holds it?",
        rationale: "Deposit forfeiture and damages for breach of APS depend on who is at fault.",
      },
    ],
    source: "LawPRO  -  failure to advise on time-of-the-essence in real estate transactions",
  },
  {
    id: "immigration_misrepresentation",
    label: "Immigration Misrepresentation Risk",
    severity: "S1",
    paFilter: ["imm"],
    triggerPatterns: [
      /\b(misrepresentation|material\s+misrepresentation)\b.{0,30}\b(immigration|visa|IRCC|application)\b/i,
      /\b(fraud(ulent)?\s+(immigration|application|document))\b/i,
      /\b(IRCC|immigration\s+officer)\b.{0,40}\b(question(ing)?|suspect(s)?|fraud|misrepresent)\b/i,
    ],
    gateQuestions: [
      {
        id: "imm_misrep__q1",
        text: "Has IRCC indicated that misrepresentation is a concern in your file?",
        rationale: "A misrepresentation finding results in 5-year ban and removal order  -  immediate action required.",
      },
      {
        id: "imm_misrep__q2",
        text: "Was any information on the original application inaccurate or incomplete?",
        rationale: "Even innocent errors can be characterized as misrepresentation  -  must assess and respond.",
      },
    ],
    source: "IRPA, s.40  -  misrepresentation: 5-year ban and finding of inadmissibility",
  },
  {
    id: "wsib_appeal_deadline",
    label: "WSIB Internal Objection / WSIAT Deadline",
    severity: "S1",
    paFilter: ["wsib"],
    triggerPatterns: [
      /\bWSIAT\b.{0,30}\b(appeal|application|deadline)\b/i,
      /\b(internal\s+objection|objecting\s+to\s+(WSIB|the\s+decision))\b/i,
      /\bWSIB\s+(decision|letter)\b.{0,40}\b(disagree|appeal|wrong|unfair)\b/i,
    ],
    gateQuestions: [
      {
        id: "wsib_appeal__q1",
        text: "When did you receive the WSIB decision you want to challenge?",
        rationale: "WSIB internal objection must be filed within 30 days of the decision date.",
      },
      {
        id: "wsib_appeal__q2",
        text: "Have you already filed an objection with WSIB?",
        rationale: "Must exhaust WSIB internal process before a WSIAT appeal is available.",
      },
    ],
    source: "Workplace Safety and Insurance Act, 1997 (Ontario), s.125  -  appeal deadlines",
  },
  {
    id: "llt_illegal_entry",
    label: "Illegal Landlord Entry",
    severity: "S2",
    paFilter: ["llt"],
    triggerPatterns: [
      /\b(landlord\s+(entered|came\s+in|went\s+into)\b.{0,30}\b(without\s+notice|uninvited|illegally))\b/i,
      /\b(right\s+to\s+entry|illegal\s+entry|unauthorized\s+entry)\b.{0,30}\b(landlord|rental|unit)\b/i,
    ],
    gateQuestions: [
      {
        id: "llt_entry__q1",
        text: "Did the landlord provide 24-hour written notice before entering?",
        rationale: "RTA requires 24-hour written notice with valid reason; no notice = illegal entry.",
      },
      {
        id: "llt_entry__q2",
        text: "How many times has this occurred and do you have any documentation?",
        rationale: "Repeated illegal entries support an LTB application for remedy and rent abatement.",
      },
    ],
    source: "Residential Tenancies Act, 2006 (Ontario), s.26  -  landlord's right of entry",
  },
  {
    id: "tax_voluntary_disclosure",
    label: "CRA Voluntary Disclosure (VDP)",
    severity: "S1",
    paFilter: ["tax"],
    triggerPatterns: [
      /\b(voluntary\s+disclosure|VDP\s+(application|program))\b/i,
      /\b(unreported\s+(income|assets?|foreign\s+(account|property)|T1135))\b/i,
      /\b(offshore\s+(account|assets?|bank|income))\b.{0,30}\b(CRA|Canada\s+Revenue|tax)\b/i,
    ],
    gateQuestions: [
      {
        id: "tax_vdp__q1",
        text: "What type of disclosure are you making  -  unreported income, foreign assets, or other?",
        rationale: "VDP program terms depend on disclosure type; general vs. limited program applies.",
      },
      {
        id: "tax_vdp__q2",
        text: "Have you previously received any contact or audit notices from CRA about this issue?",
        rationale: "Prior CRA contact disqualifies the VDP application  -  must use other options.",
      },
      {
        id: "tax_vdp__q3",
        text: "How many years of unreported amounts are involved?",
        rationale: "VDP covers all years; partial disclosure may not protect against prosecution.",
      },
    ],
    source: "CRA Income Tax Information Circular IC00-1R6  -  Voluntary Disclosures Program",
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
        rationale: "Youth must be advised of right to consult parent and counsel before questioning  -  YCJA, s.146.",
      },
    ],
    source: "Youth Criminal Justice Act (Canada), s.146  -  right to consult before questioning",
  },

  // ── Criminal (Ontario Courts  -  procedural) ────────────────────────────────

  {
    id: "crim_summary_ocj",
    label: "Summary Conviction  -  OCJ Routing",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\bsummary\s+conviction\b/i,
      /\bprovincial\s+offence(s)?\b/i,
      /\b(mischief|trespass|causing\s+a\s+disturbance|disorderly\s+conduct)\b.{0,30}\b(charged|charge|ticket|offence)\b/i,
      /\b(fine\s+only|no\s+jail|maximum\s+(6|six)\s+months?)\b.{0,30}\b(offence|charge)\b/i,
      /\bprovincial\s+court\b.{0,40}\b(charged|charge|offence|matter)\b/i,
      /\bOCJ\b.{0,30}\b(charge|charged|matter|offence|hearing|court)\b/i,
      /\b(charge|charged|matter|offence|set\s+down)\b.{0,30}\bOCJ\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_sum__q1",
        text: "Is the charge listed as a summary conviction offence on the information or charging document?",
        rationale: "Summary offences are heard in Ontario Court of Justice, not Superior Court; confirms correct court routing.",
      },
      {
        id: "crim_sum__q2",
        text: "What specific offence are you charged with?",
        rationale: "Offence classification determines whether Superior Court retainer is appropriate.",
      },
    ],
    source: "Criminal Code (Canada), s.785  -  summary conviction proceedings; Ontario Court of Justice Act",
  },
  {
    id: "crim_in_custody_bail",
    label: "In Custody  -  Bail Review Urgent",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(in\s+custody|held\s+in\s+custody|remand(ed)?|detained)\b/i,
      /\b(denied\s+bail|bail\s+was\s+denied|no\s+bail|bail\s+refused)\b/i,
      /\b(arrested\s+(today|this\s+morning|last\s+night|yesterday))\b/i,
      /\b(calling\s+from\s+jail|calling\s+from\s+(a\s+)?(detention|correctional|remand)\s+centre)\b/i,
      /\b(bail\s+hearing|show\s+cause\s+hearing)\b/i,
      /\b(locked\s+up|in\s+jail|at\s+the\s+jail|at\s+(the\s+)?([A-Z][a-z]+\s+)?detention\s+centre)\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_bail_review__q1",
        text: "Is the person currently in custody or was bail already denied at a show cause hearing?",
        rationale: "In-custody status triggers same-day bail review priority; detention review deadlines run from first appearance.",
      },
      {
        id: "crim_bail_review__q2",
        text: "When was the arrest and has a bail hearing been held yet?",
        rationale: "Bail must be heard within 24 hours of arrest (s.503 CC); delay is grounds for bail review.",
      },
      {
        id: "crim_bail_review__q3",
        text: "What is the charge and what grounds for detention were given?",
        rationale: "Crown grounds for detention (primary, secondary, tertiary) determine the bail review strategy.",
      },
    ],
    source: "Criminal Code (Canada), ss.503, 515, 520  -  show cause, bail, and bail review",
  },
  {
    id: "crim_jordan_exposure",
    label: "Jordan s.11(b)  -  Unreasonable Delay Risk",
    severity: "S1",
    paFilter: ["crim"],
    triggerPatterns: [
      /\b(charged|charge\s+laid|arrested)\b.{0,40}\b(more\s+than|over|almost|nearly)\s+(18|19|20|21|22|24|2)\s+(months?|years?)\s+ago\b/i,
      /\b(case|matter|proceeding)\b.{0,30}\b(going\s+on|dragging\s+on|been\s+going)\b.{0,30}\b(18|19|20|21|22|24|2)\s+(months?|years?)\b/i,
      /\b(many|multiple|several|numerous|too\s+many)\s+(adjournments?|delays?|postponements?)\b/i,
      /\b(delayed|delay)\b.{0,40}\b(trial|court\s+date|proceeding)\b.{0,30}\b(months?|years?)\b/i,
      /\b(s\.?\s*11\s*\(?b\)?|section\s+11\s*\(?b\)?|Jordan\s+application|unreasonable\s+delay)\b/i,
    ],
    gateQuestions: [
      {
        id: "crim_jordan__q1",
        text: "When exactly were the charges first laid?",
        rationale: "Jordan clock runs from charge date; >18 months (OCJ) or >30 months (Superior) creates presumptive unreasonable delay.",
      },
      {
        id: "crim_jordan__q2",
        text: "How many court appearances have there been and what caused the delays?",
        rationale: "Defence-caused delays are subtracted from the clock; Crown and institutional delays count toward the Jordan ceiling.",
      },
      {
        id: "crim_jordan__q3",
        text: "Has a trial date been set? If so, when?",
        rationale: "Trial date determines the final elapsed time; Jordan application must be brought at trial or earlier.",
      },
    ],
    source: "R v Jordan [2016] SCC 27  -  s.11(b) Charter; 18-month ceiling (OCJ), 30-month ceiling (Superior Court)",
  },

  // ── Family (Ontario Courts  -  procedural) ──────────────────────────────────

  {
    id: "fam_child_protection",
    label: "CAS / Child Protection Proceeding",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(CAS|Children.s\s+Aid\s+Society|child\s+protection\s+(worker|service|proceeding))\b.{0,40}\b(court|proceeding|application|order)\b/i,
      /\b(protection\s+application|CYFSA|child\s+(is\s+)?in\s+(care|CAS\s+care))\b/i,
      /\b(society\s+has\s+(filed|brought|started)\s+(an?\s+)?(application|proceeding))\b/i,
      /\b(status\s+review|status\s+hearing)\b/i,
      /\bprotection\s+order\b.{0,30}\b(CAS|society|child)\b/i,
      /\b(taken\s+into\s+care|apprehended\s+by\s+(CAS|the\s+society|children.s\s+aid))\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_cp__q1",
        text: "Has the Children's Aid Society filed a court application, or has a hearing date been set?",
        rationale: "CYFSA, s.47 requires a status hearing within 5 days of apprehension  -  a hard deadline that cannot be extended.",
      },
      {
        id: "fam_cp__q2",
        text: "Is the child currently in CAS care or in your home?",
        rationale: "Placement status determines urgency and whether a temporary custody motion is needed immediately.",
      },
      {
        id: "fam_cp__q3",
        text: "Have you been served with any court documents by CAS?",
        rationale: "Served documents may carry response deadlines; identifying them determines the filing urgency.",
      },
    ],
    source: "Child, Youth and Family Services Act, 2017 (Ontario), s.47  -  5-day status hearing requirement",
  },
  {
    id: "fam_safety_concern",
    label: "Safety Concern  -  Urgent Motion / TBST",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(emergency|urgent|immediately)\b.{0,30}\b(custody|access|protection|order|motion|restraining)\b/i,
      /\b(ex\s+parte|without\s+notice\s+motion|urgent\s+motion)\b.{0,30}\b(family|custody|protection)\b/i,
      /\b(TBST|telephone\s+blended\s+settlement|urgent\s+settlement\s+conference)\b/i,
      /\bchild.{0,10}(at\s+risk|in\s+danger|is\s+unsafe|is\s+being\s+abused)\b/i,
      /\b(abduction\s+risk|parental\s+abduction|flee\s+(with\s+the\s+child|the\s+country))\b/i,
      /\b(immediate\s+(danger|threat|harm|risk))\b.{0,40}\b(child|children|family|spouse|partner)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_safety__q1",
        text: "Is there an immediate risk of harm to a child or yourself right now?",
        rationale: "Immediate risk triggers ex parte (without-notice) motion path and may require police involvement before court.",
      },
      {
        id: "fam_safety__q2",
        text: "Is there a risk the other parent may leave the province or country with the child?",
        rationale: "Flight risk requires a travel restriction order and possible passport surrender  -  different urgent motion than safety.",
      },
      {
        id: "fam_safety__q3",
        text: "Are there any existing court orders for custody, access, or protection?",
        rationale: "Existing orders determine whether a motion to vary or an enforcement application is the correct path.",
      },
    ],
    source: "Ontario Superior Court of Justice  -  Family Practice Direction (urgent motions); CYFSA  -  TBST protocol",
  },
  {
    id: "fam_hearing_imminent",
    label: "Hearing / Conference Within 10 Business Days",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(court\s+(date|appearance)|conference|motion\s+date|hearing)\b.{0,30}\b(next\s+week|this\s+week|tomorrow|in\s+a\s+few\s+days|in\s+(1|2|3|4|5|6|7|8|9|10)\s+(days?|business\s+days?))\b/i,
      /\b(hearing|conference|court\s+date)\b.{0,30}\b(very\s+soon|coming\s+up\s+soon|imminent|approaching)\b/i,
      /\b(case\s+conference|settlement\s+conference|trial\s+(management\s+)?conference|motion)\b.{0,20}\b(next|this)\s+(week|monday|tuesday|wednesday|thursday|friday)\b/i,
      /\b(Form\s+14C|confirmation\s+form|confirm\s+the\s+motion)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_hearing__q1",
        text: "What is the exact date of the upcoming hearing or conference?",
        rationale: "Ontario practice direction requires Form 14C (Confirmation of Motion) filed no later than 2 p.m. three business days before the hearing.",
      },
      {
        id: "fam_hearing__q2",
        text: "What type of court event is it  -  case conference, settlement conference, motion, or trial?",
        rationale: "Confirmation requirements and preparation differ by event type; motions require filed materials, conferences do not.",
      },
      {
        id: "fam_hearing__q3",
        text: "Has Form 14C (the confirmation of motion form) been filed yet?",
        rationale: "Unfiled confirmation may result in the motion being removed from the list on the day of the hearing.",
      },
    ],
    source: "Ontario Superior Court of Justice  -  Family Practice Direction; Form 14C, Rule 14(11) Family Law Rules",
  },
  {
    id: "fam_form17f_confirmation",
    label: "Form 17F  -  Settlement Conference Confirmation Required",
    severity: "S1",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(settlement\s+conference)\b.{0,50}\b(next\s+week|this\s+week|tomorrow|in\s+a\s+few\s+days|in\s+(1|2|3|4|5|6|7|8|9|10)\s+(days?|business\s+days?))\b/i,
      /\b(settlement\s+conference|trial\s+management\s+conference|TMC)\b.{0,30}\b(soon|imminent|coming\s+up)\b/i,
      /\b(Form\s+17F|17F\s+confirmation|confirm\s+the\s+settlement\s+conference)\b/i,
      /\b(settlement\s+conference)\b.{0,30}\b(next|this)\s+(week|monday|tuesday|wednesday|thursday|friday)\b/i,
      /\b(trial\s+management\s+conference)\b.{0,30}\b(next|this)\s+(week|monday|tuesday|wednesday|thursday|friday)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_17f__q1",
        text: "What is the exact date of the upcoming settlement conference?",
        rationale: "Form 17F (Confirmation for Settlement Conference) must be filed no later than 2 p.m. two business days before the conference under the Family Law Rules.",
      },
      {
        id: "fam_17f__q2",
        text: "Has Form 17F been filed with the court?",
        rationale: "Failure to file Form 17F by the deadline can result in the conference being removed from the list and a costs order against the defaulting party.",
      },
      {
        id: "fam_17f__q3",
        text: "Is there a settlement offer or without-prejudice proposal the other side should know about before the conference?",
        rationale: "Settlement conferences are most effective when both sides come prepared with realistic offers; courts may draw adverse cost inferences from failure to make or respond to offers.",
      },
    ],
    source: "Family Law Rules, O. Reg. 114/99, Rule 17(14)  -  Form 17F; Ontario Superior Court Family Practice Direction",
  },
  {
    id: "fam_bjdr_eligible",
    label: "BJDR Eligibility  -  Brief Judicial Dispute Resolution",
    severity: "S2",
    paFilter: ["fam"],
    triggerPatterns: [
      /\b(BJDR|brief\s+judicial\s+dispute\s+resolution|binding\s+JDR|judicial\s+dispute\s+resolution)\b/i,
      /\b(want\s+to\s+avoid\s+trial|trying\s+to\s+avoid\s+trial|avoid\s+going\s+to\s+trial)\b.{0,40}\b(family|divorce|custody|support|property)\b/i,
      /\b(focused\s+hearing|early\s+resolution|judge[- ]led\s+settlement)\b/i,
      /\b(trial\s+management\s+conference)\b.{0,60}\b(hope|hoping|want|trying)\b.{0,30}\b(settle|resolution|resolved)\b/i,
    ],
    gateQuestions: [
      {
        id: "fam_bjdr__q1",
        text: "What stage are the proceedings at  -  has a case conference and settlement conference been completed?",
        rationale: "BJDR is only available after prior conference steps under Rule 17 have been completed; parties cannot bypass earlier stages.",
      },
      {
        id: "fam_bjdr__q2",
        text: "Which issues remain unresolved  -  property, custody, support, or all?",
        rationale: "BJDR is most effective for disputes with a small number of well-defined issues; judges will want to know the scope before agreeing to a BJDR.",
      },
      {
        id: "fam_bjdr__q3",
        text: "Are both parties open to a judge hearing submissions and potentially giving an opinion or direction?",
        rationale: "BJDR is consensual  -  both sides must agree; if one party refuses, a different resolution path is needed.",
      },
    ],
    source: "Family Law Rules, O. Reg. 114/99, Rule 17  -  conferences; Ontario Superior Court Early Resolution model",
  },

  // ── Civil Procedure ───────────────────────────────────────────────────────

  {
    id: "civ_small_claims_threshold",
    label: "Small Claims Threshold  -  < $35,000",
    severity: "S1",
    paFilter: ["civil", "const", "real", "llt", "corp", "defam", "insol"],
    triggerPatterns: [
      /\bsmall\s+claims?(\s+court)?\b/i,
      /\b(under|less\s+than|below|only|just)\s+\$\s*(35,000|35k|35\s+thousand)\b/i,
      /\b(claim|owe|owed|lost|damages?)\b.{0,30}\$\s*[1-9]\d{0,3}\b(?!\s*,\d{3})/i,
      /\b(claim|owe|owed|lost|damages?)\b.{0,30}\$\s*[1-2]\d{4}\b/,
      /\$\s*(1|2|3|4|5|6|7|8|9)\s*,\s*000\b/i,
      /\b(a\s+few|couple\s+of)\s+(thousand|hundred)\s+dollars?\b/i,
    ],
    gateQuestions: [
      {
        id: "civ_scc__q1",
        text: "What is the total dollar amount you are claiming or being claimed against for?",
        rationale: "Ontario Small Claims Court maximum is $35,000; amounts at or below that threshold cannot be brought in Superior Court as of right.",
      },
      {
        id: "civ_scc__q2",
        text: "Is this the full amount of the claim, or are there additional amounts like interest, punitive damages, or costs?",
        rationale: "Total claim value including interest and punitive damages determines the correct court; Superior Court may still be appropriate if total exceeds $35,000.",
      },
    ],
    source: "Courts of Justice Act (Ontario), s.23  -  Small Claims Court monetary jurisdiction ($35,000 maximum)",
  },
  {
    id: "civ_statement_of_defence",
    label: "Statement of Defence Clock Running",
    severity: "S1",
    paFilter: ["civil", "const", "real", "corp", "defam", "insol"],
    triggerPatterns: [
      /\b(served\s+(with\s+)?(a\s+)?(statement\s+of\s+claim|lawsuit|court\s+documents?|legal\s+(papers?|documents?)))\b/i,
      /\b(received\s+(a\s+)?(statement\s+of\s+claim|lawsuit|court\s+documents?|legal\s+(papers?|documents?)))\b/i,
      /\b(suing\s+me|being\s+sued|sued\s+by|named\s+(as\s+a\s+)?(defendant|respondent))\b/i,
      /\b(statement\s+of\s+claim|notice\s+of\s+action|originating\s+process)\b.{0,40}\b(served|received|got)\b/i,
      /\b(20\s+days?|twenty\s+days?)\b.{0,30}\b(defend|defence|respond|answer)\b/i,
    ],
    gateQuestions: [
      {
        id: "civ_defence__q1",
        text: "When were you served with the statement of claim or court documents?",
        rationale: "Statement of defence must be delivered within 20 days of service in Ontario; 40 days if served outside Ontario  -  clock runs from service date.",
      },
      {
        id: "civ_defence__q2",
        text: "Have you taken any steps to respond  -  filed anything with the court, or contacted the plaintiff's lawyer?",
        rationale: "Default judgment may be noted if no defence is filed and the defence window expires.",
      },
      {
        id: "civ_defence__q3",
        text: "What is the claim about and what amount is being claimed?",
        rationale: "Claim amount and nature determine available defences and whether a counterclaim is appropriate.",
      },
    ],
    source: "Rules of Civil Procedure (Ontario), Rule 18.01  -  20-day defence period from service",
  },

  // ── Divisional Court ──────────────────────────────────────────────────────

  {
    id: "div_tribunal_30day",
    label: "Divisional Court Appeal  -  30-Day Tribunal Window",
    severity: "S1",
    paFilter: ["admin"],
    triggerPatterns: [
      /\b(Divisional\s+Court|Div\s+Court)\b.{0,30}\b(appeal|application)\b/i,
      /\b(appeal|appealing)\b.{0,40}\b(LTB|tribunal|board)\b.{0,30}\b(decision|order|ruling)\b/i,
      /\b(LTB|Landlord\s+and\s+Tenant\s+Board)\b.{0,60}\b(decision|order|ruling)\b/i,
      /\b(decision|order|ruling)\b.{0,60}\b(LTB|Landlord\s+and\s+Tenant\s+Board)\b/i,
      /\b(Consent\s+and\s+Capacity\s+Board|CCB)\b.{0,30}\b(decision|order|ruling)\b/i,
      /\b(decision|order|ruling)\b.{0,60}\b(tribunal|board)\b/i,
      /\b(tribunal|board)\b.{0,60}\b(decision|order|ruling)\b/i,
    ],
    gateQuestions: [
      {
        id: "div_30day__q1",
        text: "Which tribunal issued the decision and when were the written reasons received?",
        rationale: "Divisional Court appeal period is 30 days from receipt of the tribunal's written reasons  -  hard deadline under the Statutory Powers Procedure Act.",
      },
      {
        id: "div_30day__q2",
        text: "Have you filed a Notice of Appeal or applied for leave to appeal to Divisional Court?",
        rationale: "Some tribunal appeals require leave (permission) from Divisional Court; others are as-of-right  -  the route depends on the enabling statute.",
      },
      {
        id: "div_30day__q3",
        text: "Are you seeking to appeal on the merits, or is there a procedural fairness or jurisdiction argument?",
        rationale: "Divisional Court reviews tribunal decisions on a reasonableness standard for merits, correctness for jurisdiction  -  different thresholds for the same deadline.",
      },
    ],
    source: "Statutory Powers Procedure Act (Ontario); Rules of Civil Procedure, Rule 61  -  Divisional Court appeal within 30 days of reasons",
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
export function getGateQuestions(flagIds: string[], practiceArea?: string): GateQuestion[] {
  const seen = new Set<string>();
  const questions: GateQuestion[] = [];
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
        // Resolve PA-specific text: try exact match, then prefix match, then fallback
        let resolvedText = q.text;
        if (practiceArea && q.textByPA) {
          const paKey = practiceArea.toLowerCase();
          const match = q.textByPA[paKey]
            ?? Object.entries(q.textByPA).find(([k]) => paKey.startsWith(k))?.[1];
          if (match) resolvedText = match;
        }
        questions.push({ ...q, text: resolvedText });
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

// ─────────────────────────────────────────────────────────────────────────────
// S1 Flag Preambles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One contextualising sentence per S1 flag, shown to the client before gate
 * questions begin. Tells the client why we are asking  -  never AI-generated,
 * always authored. S2 flags are omitted; gate questions appear without a preamble.
 *
 * Authoring rule: short, factual, no legal conclusions, no urgency theatre.
 * Bad:  "URGENT  -  you must answer this immediately or your case will be lost."
 * Good: "A timing check  -  this affects whether legal action is still possible."
 */
const S1_PREAMBLES: Record<string, string> = {
  // Universal
  limitation_proximity:             "A quick timing check  -  this affects whether legal action is still possible.",
  conflict_adverse_party:           "One standard check before we go further.",
  // PI
  pi_limitation_window:             "A timing question  -  this helps confirm whether your claim is still within the legal window.",
  pi_unidentified_parties:          "A few details about the other party  -  needed to assess what options are available.",
  pi_evidence_preservation:         "Evidence in injury cases can disappear quickly  -  one urgent question.",
  // MVA
  mvac_insurer_not_notified:        "One insurance question  -  timing here matters for your benefits.",
  mvac_hit_and_run:                 "A few specifics about the other vehicle  -  this affects how your claim proceeds.",
  // Med-mal
  medmal_causation_unclear:         "A question about what happened during your treatment  -  this shapes the whole analysis.",
  // Slip
  slip_ice_snow:                    "A timing note  -  falls on ice or snow trigger a 60-day notice obligation in Ontario.",
  slip_municipality:                "A timing note  -  falls on city property require notice within 10 days in Ontario.",
  // LTD
  ltd_appeal_clock_running:         "A timing check  -  LTD internal appeal windows are often 30 to 90 days.",
  // Family
  fam_property_clock:               "A timing question  -  property equalization claims have a strict 6-year deadline in Ontario.",
  fam_abduction:                    "Given what you've described, I need to confirm a few things urgently  -  time is a factor here.",
  fam_domestic_violence:            "A few questions about your safety situation  -  these help us understand what protection may be available.",
  // Child protection
  child_apprehension_recent:        "Given the recent involvement of authorities, I have a few time-sensitive questions.",
  // Immigration
  imm_rad_deadline:                 "This is time-sensitive  -  a refused refugee claim has only a 15-day appeal window.",
  imm_removal_order:                "A removal order creates urgent timelines  -  a few questions before anything else.",
  imm_inadmissibility:              "A few questions about immigration history  -  this shapes what options are available.",
  immigration_misrepresentation:    "A few questions about your immigration history  -  the details affect your current status.",
  // Criminal
  crim_charter_violation:           "A question about how the police handled the situation  -  this can affect your entire defence.",
  // Employment
  emp_hrto_clock:                   "A timing check  -  discrimination claims have a strict 1-year HRTO deadline.",
  emp_severance_signed:             "An important question given what you've already signed  -  timing matters here.",
  emp_constructive_dismissal:       "A few questions about how the job ended  -  this shapes whether a constructive dismissal claim is viable.",
  hrto_respondent_id:               "A quick question about who was involved  -  needed to properly identify the respondent.",
  // Real estate
  real_estate_dual_representation:  "A quick check on how the transaction is structured  -  this is a regulated area.",
  real_estate_undisclosed_defects:  "A question about what was disclosed before closing  -  this affects your legal options.",
  real_estate_closing_date:         "A timing question  -  closing date obligations are strict and have immediate legal consequences.",
  // Estates
  estates_capacity:                 "A few questions about the circumstances of the signing  -  these are legally significant.",
  estates_undue_influence:          "Some background questions about who was present when the document was signed.",
  estates_dependant_relief:         "A question about your relationship to the deceased  -  this determines what relief may be available.",
  // Corporate
  corp_oppression:                  "A few questions about how the business decisions were made  -  this shapes the available remedy.",
  // Construction
  construction_lien_deadline:       "A critical timing check  -  construction liens in Ontario must be registered within 60 days of completion.",
  // Landlord-tenant
  llt_notice_validity:              "A question about the notice you received  -  its validity determines your options.",
  // IP
  ip_maintenance_lapse:             "A timing check  -  IP rights can lapse permanently without action.",
  ip_infringement:                  "A few questions about the infringement  -  the specifics affect what remedies are available.",
  // Admin
  admin_jr_deadline:                "A timing check  -  judicial review applications in Ontario have strict deadlines.",
  // WSIB
  wsib_six_month_claim:             "A timing check  -  WSIB claims must be filed within 6 months of the injury.",
  wsib_dearos:                      "A question about your employer's WSIB coverage  -  this affects how your claim proceeds.",
  wsib_appeal_deadline:             "A timing check  -  WSIB appeal windows are strict and cannot be extended.",
  // Defamation
  defamation_media_notice:          "A timing question  -  defamation claims against media outlets require early notice.",
  // Tax
  tax_objection_deadline:           "A timing check  -  CRA objections must be filed within 90 days of the assessment.",
  tax_voluntary_disclosure:         "A timing question  -  voluntary disclosure programs have specific windows and conditions.",
  // Elder
  elder_poa_abuse:                  "A few questions about who has authority over financial decisions  -  this affects what action is available.",
  // Privacy
  privacy_data_breach:              "A few questions about what was exposed and when  -  this shapes what remedies apply.",
  // Securities
  sec_misrepresentation:            "A few questions about the investment and what you were told  -  the specifics matter here.",
  // Class action
  class_action_opt_out:             "A timing check  -  class action opt-out windows are often short and strictly enforced.",
  // Insolvency
  insolvency_creditor_action:       "A question about the creditor proceedings  -  timing here affects your options significantly.",
  // Municipal
  municipal_injury_notice:          "A timing check  -  injuries on city property require written notice within 10 days in Ontario.",
  // Criminal  -  Ontario Courts procedural
  crim_summary_ocj:                 "A quick question about the charge  -  this confirms which court the matter will proceed in.",
  crim_in_custody_bail:             "Given that someone is in custody, I have a few urgent questions before anything else.",
  crim_jordan_exposure:             "A timing question about when the charges were laid  -  this has direct bearing on a possible Charter argument.",
  // Family  -  Ontario Courts procedural
  fam_child_protection:             "Given CAS involvement, there are specific court timelines I need to confirm before anything else.",
  fam_safety_concern:               "Given the safety signals in what you've described, I have a few urgent questions about next steps.",
  fam_hearing_imminent:             "Because you have a court date coming up, I need to ask a few procedural questions quickly.",
  // Civil procedure
  civ_small_claims_threshold:       "A quick question about the dollar amount  -  this determines which court applies to your matter.",
  civ_statement_of_defence:         "A timing question  -  the deadline to respond to a court claim in Ontario is strictly enforced.",
  // Divisional Court
  div_tribunal_30day:               "A timing check  -  Divisional Court appeal windows from tribunal decisions are strictly enforced.",
  // KB-17 additions
  fam_form17f_confirmation:         "A quick check on your upcoming settlement conference  -  there is a required confirmation form with a filing deadline.",
  pi_mig_designation:               "A question about your injury classification  -  this determines the benefit limits that apply to your SABS claim.",
};

/**
 * Returns the preamble for the highest-priority S1 flag in the active set.
 * S1 flags without an authored preamble return undefined.
 * Used by the gate injection block to warm the client before compliance questions.
 *
 * @param flagIds  Active flag IDs (S1 ordered first from mergeFlags).
 */
export function getFlagPreamble(flagIds: string[]): string | undefined {
  for (const id of flagIds) {
    const def = FLAG_REGISTRY.get(id);
    if (def?.severity === "S1" && S1_PREAMBLES[id]) {
      return S1_PREAMBLES[id];
    }
  }
  return undefined;
}
