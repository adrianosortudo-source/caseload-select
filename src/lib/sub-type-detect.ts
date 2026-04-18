/**
 * Sub-Type Detection — Deterministic Regex Layer
 *
 * Three-pass detection system:
 *   Pass 1: Regex matchers (this file) — deterministic, instant, offline
 *   Pass 2: GPT classifier output field `practice_sub_type` — semantic
 *   Pass 3: Fallback to `{pa}_other` qualifier questions if both miss
 *
 * Rules:
 *   - First match wins within each umbrella PA.
 *   - All patterns are case-insensitive.
 *   - Patterns must be specific enough to not cross-fire across sub-types.
 *   - Conflicts between regex and GPT are logged to sub_type_conflicts table.
 *   - After one mid-session re-classification, sub-type is locked.
 */

export interface SubTypeMatch {
  subType: string;
  confidence: "high" | "medium";
  matchedPattern: string;
}

type SubTypeRule = {
  subType: string;
  patterns: RegExp[];
  confidence: "high" | "medium";
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAL INJURY sub-types
// ─────────────────────────────────────────────────────────────────────────────
const PI_SUB_TYPE_RULES: SubTypeRule[] = [
  // pi_slip_fall — premises liability, occupier, wet floor
  {
    subType: "pi_slip_fall",
    confidence: "high",
    patterns: [
      /\b(slip|slipped|slipping)\s+(and\s+)?(fall|fell|fallen)/i,
      /\bwet\s+floor\b/i,
      /\bfell\s+(on|at|in|near|down|over|into)\b/i,
      /\btripped\s+(on|over|at)\b/i,
      /\b(ice|icy|snow|slippery)\s+(sidewalk|walkway|parking|steps|stairs|ramp|floor|pavement)\b/i,
      /\b(fell|fall)\s+(on|off)\s+(stairs|steps|escalator|ramp|ladder)\b/i,
      /\boccupier.{0,20}(liabilit|negligence)/i,
      /\bpremises\s+liabilit/i,
      /\bsupermarket|walmart|grocery|mall|store|restaurant\b.{0,40}\bfall|fell|trip|slip\b/i,
      /\bfall|fell|trip|slip\b.{0,40}\bsupermarket|walmart|grocery|mall|store|restaurant\b/i,
    ],
  },
  // pi_dog_bite — dog attack, animal
  {
    subType: "pi_dog_bite",
    confidence: "high",
    patterns: [
      /\bdog\s+(bit|bitten|bite|attack|attacked)\b/i,
      /\banimal\s+attack\b/i,
      /\bbit\s+(by|me)\b.{0,20}\bdog\b/i,
      /\bgot\s+bitten\b/i,
      /\bdog\s+owners?\s+liabilit/i,
    ],
  },
  // pi_med_mal — medical malpractice
  {
    subType: "pi_med_mal",
    confidence: "high",
    patterns: [
      /\bmedical\s+malpractice\b/i,
      /\bsurgical\s+error\b/i,
      /\bwrong\s+diagnosis\b/i,
      /\bmisdiagnosis\b/i,
      /\bdoctor.{0,25}(error|mistake|negligence|failure|wrong)\b/i,
      /\bhospital.{0,25}(negligence|error|mistake)\b/i,
      /\bsurgeon.{0,25}(error|mistake|wrong)\b/i,
      /\bstandard\s+of\s+care\b/i,
      /\bfailed\s+to\s+(diagnose|treat|refer|operate|test)\b/i,
      /\bwrong\s+(medication|drug|dosage|treatment|organ|limb)\b/i,
      /\bsurgery\s+went\s+wrong\b/i,
    ],
  },
  // pi_product — product liability
  {
    subType: "pi_product",
    confidence: "high",
    patterns: [
      /\bdefective\s+product\b/i,
      /\bproduct\s+(defect|recall|liability|failure)\b/i,
      /\b(product|device|equipment|appliance|toy)\s+(exploded|caught\s+fire|burned|malfunctioned|broke|failed)\b/i,
      /\bmanufacturer.{0,30}(defect|negligence|liabilit)/i,
    ],
  },
  // pi_workplace — workplace injury (not WSIB-only)
  {
    subType: "pi_workplace",
    confidence: "high",
    patterns: [
      /\b(injured|hurt|accident)\s+(at|on)\s+(work|the\s+job|the\s+worksite|the\s+job\s+site)\b/i,
      /\bwork(place|site|shop)?\s+(accident|injury|incident)\b/i,
      /\bconstruction\s+(site|accident)\b.{0,30}\b(fall|fell|injured|hurt)\b/i,
      /\bfall\b.{0,30}\bconstruction\s+site\b/i,
      /\b(forklift|scaffolding|machinery|equipment)\s+(accident|injury|struck|hit)\b/i,
      /\bonsite\s+accident\b/i,
      /\binjured\s+at\s+work\b/i,
      /\bon\s+the\s+job\s+(injury|accident)\b/i,
    ],
  },
  // pi_assault_ci — civil assault, intentional tort
  {
    subType: "pi_assault_ci",
    confidence: "high",
    patterns: [
      /\b(assaulted|attacked|beaten|punched|kicked|stabbed|shot)\b.{0,50}\b(sue|civil|claim|damages|compensation)\b/i,
      /\bcivil\s+assault\b/i,
      /\bintentional\s+(tort|harm|injury)\b/i,
      /\bsexual\s+assault\b.{0,30}\b(sue|civil|damages|claim)\b/i,
      /\bbattery\s+claim\b/i,
    ],
  },
  // pi_mva — motor vehicle accident (broad, catches last after specifics)
  {
    subType: "pi_mva",
    confidence: "high",
    patterns: [
      /\b(car|vehicle|truck|motorcycle|bus|van|suv|minivan)\s+(accident|crash|collision)\b/i,
      /\b(motor\s+vehicle|MVA|MVC)\b/i,
      /\brear[- ]?ended\b/i,
      /\bhit\s+(from\s+behind|my\s+car|my\s+vehicle|by\s+a\s+car|by\s+a\s+truck)\b/i,
      /\b(car|vehicle|truck)\s+hit\s+(me|us|my)\b/i,
      /\bhead[- ]?on\s+collision\b/i,
      /\bt[- ]?bone\b/i,
      /\bintersection\s+(crash|collision|accident)\b/i,
      /\bI\s+was\s+(driving|in\s+my\s+car|behind\s+the\s+wheel)\b.{0,30}\baccident\b/i,
      /\bpedestrian.{0,20}(struck|hit|accident)\b/i,
      /\bcyclist.{0,20}(struck|hit|accident)\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYMENT sub-types
// ─────────────────────────────────────────────────────────────────────────────
const EMP_SUB_TYPE_RULES: SubTypeRule[] = [
  // emp_harassment — workplace harassment, bullying
  {
    subType: "emp_harassment",
    confidence: "high",
    patterns: [
      /\b(workplace\s+)?(harassment|bullying|hostile\s+work\s+environment)\b/i,
      /\bsexual\s+harassment\b/i,
      /\bpersonal\s+harassment\b/i,
      /\bbeing\s+(harassed|bullied|targeted|intimidated)\b.{0,30}\bwork\b/i,
      /\bmy\s+(manager|boss|supervisor|coworker).{0,40}\b(harass|bully|intimidat)\b/i,
    ],
  },
  // emp_disc — workplace discrimination
  {
    subType: "emp_disc",
    confidence: "high",
    patterns: [
      /\b(discrimination|discriminat)\b.{0,40}\b(race|gender|age|disability|religion|pregnancy|sex|colour|ethnic)\b/i,
      /\b(race|gender|age|disability|religion|pregnancy|sex|colour|ethnic)\b.{0,40}\b(discrimination|discriminat)\b/i,
      /\bHRTO\b.{0,30}\b(employment|workplace)\b/i,
      /\bhuman\s+rights\s+(complaint|violation|issue)\b.{0,30}\b(work|employer|fired)\b/i,
      /\bdiscriminated\s+against\b/i,
    ],
  },
  // emp_wage — wage theft, unpaid wages, overtime
  {
    subType: "emp_wage",
    confidence: "high",
    patterns: [
      /\b(unpaid\s+wages?|wage\s+theft|stolen\s+wages?)\b/i,
      /\b(haven.t\s+been\s+paid|not\s+paid\s+my\s+wages?|employer\s+(owes|hasn.t\s+paid))\b/i,
      /\b(unpaid\s+overtime|refused\s+overtime|denied\s+overtime)\b/i,
      /\bminimum\s+wage\s+violation\b/i,
      /\bwage\s+dispute\b/i,
      /\bwithholding\s+(my\s+)?wages?\b/i,
    ],
  },
  // emp_constructive — constructive dismissal
  {
    subType: "emp_constructive",
    confidence: "high",
    patterns: [
      /\bconstructive\s+dismiss\b/i,
      /\bforced\s+(to\s+quit|out|resign)\b/i,
      /\bno\s+choice\s+(but\s+to\s+quit|to\s+resign)\b/i,
      /\bunilateral\s+(change|demotion|reduction|cut)\b/i,
      /\bchanged\s+my\s+(role|duties|pay|hours|location)\s+(without|unilateral)\b/i,
      /\bmade\s+(work\s+)?life\s+(unbearable|impossible|hostile)\b/i,
    ],
  },
  // emp_dismissal — wrongful dismissal, termination without cause
  {
    subType: "emp_dismissal",
    confidence: "high",
    patterns: [
      /\b(wrongful|unlawful)\s+dismiss(al)?\b/i,
      /\b(fired|terminated|let\s+go|dismissed|laid\s+off)\b/i,
      /\bwithout\s+(cause|notice|reason)\b/i,
      /\bno\s+reason\s+(given|for\s+(firing|termination))\b/i,
      /\btermination\s+(letter|package|notice)\b/i,
      /\blost\s+my\s+job\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY sub-types
// ─────────────────────────────────────────────────────────────────────────────
const FAM_SUB_TYPE_RULES: SubTypeRule[] = [
  // fam_abduction — cross-border child abduction / Hague Convention
  // Must appear BEFORE fam_protection: shares some signals (ex-partner + child)
  // but fires only when there is a clear international / cross-border indicator.
  {
    subType: "fam_abduction",
    confidence: "high",
    patterns: [
      // Hague Convention keyword (unambiguous)
      /\bhague\s+(convention|application|petition)\b/i,
      // "parental abduction" / "international abduction"
      /\b(parental|international|cross[- ]?border)\s+abduction\b/i,
      // "took/taken/brought" + child + country/abroad signal
      /\b(took|taken|brought|moved)\b.{0,40}\b(child|son|daughter|kids?)\b.{0,60}\b(country|abroad|overseas|back\s+home|home\s+country|another\s+country|different\s+country|foreign\s+country|outside\s+canada)\b/i,
      /\b(child|son|daughter|kids?)\b.{0,40}\b(took|taken|brought|moved)\b.{0,60}\b(country|abroad|overseas|back\s+home|home\s+country|another\s+country|different\s+country|foreign\s+country|outside\s+canada)\b/i,
      // "without my consent" / "without my knowledge" + child + international
      /\bwithout\s+my\s+(consent|permission|knowledge)\b.{0,60}\b(country|abroad|overseas|another\s+country|home\s+country|outside\s+canada)\b/i,
      /\b(country|abroad|overseas|another\s+country|home\s+country|outside\s+canada)\b.{0,60}\bwithout\s+my\s+(consent|permission|knowledge)\b/i,
      // "won't return" / "refusing to return" + child (cross-border implied by country mention nearby)
      /\b(won.t|refusing\s+to|not\s+returning)\s+(return|come\s+back)\b.{0,40}\b(child|son|daughter|kids?)\b/i,
      // Explicit "home country" + child + ex-partner signals
      /\bher\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
      /\bhis\s+home\s+country\b.{0,40}\b(son|daughter|child|kids?)\b/i,
      /\b(son|daughter|child|kids?)\b.{0,40}\b(her|his)\s+home\s+country\b/i,
    ],
  },
  {
    subType: "fam_protection",
    confidence: "high",
    patterns: [
      /\brestraining\s+order\b/i,
      /\bprotection\s+order\b/i,
      /\bdomestic\s+violence\b/i,
      /\b(Children.s\s+Aid|CAS|FCRSS)\b/i,
      /\bemergency\s+custody\b/i,
      /\bfear\s+(for\s+)?(my\s+)?safety\b/i,
    ],
  },
  {
    subType: "fam_custody",
    confidence: "high",
    patterns: [
      /\bcustody\b/i,
      /\bparenting\s+(time|plan|arrangement)\b/i,
      /\baccess\s+(to\s+)?my\s+(child|kids?|son|daughter)\b/i,
      /\bwho\s+(the\s+)?kids?\s+(live\s+with|stay\s+with)\b/i,
      /\bchild\s+(custody|access|arrangement)\b/i,
    ],
  },
  {
    subType: "fam_support",
    confidence: "high",
    patterns: [
      /\b(child|spousal)\s+support\b/i,
      /\balimony\b/i,
      /\bmaintenance\s+(order|payment)\b/i,
      /\bnot\s+paying\s+(child|spousal)\s+support\b/i,
      /\bchange\s+(a\s+)?support\s+order\b/i,
    ],
  },
  {
    subType: "fam_property",
    confidence: "high",
    patterns: [
      /\bproperty\s+(division|split|equalization)\b/i,
      /\bmatrimonial\s+home\b/i,
      /\bnet\s+family\s+property\b/i,
      /\bdivide\s+(our\s+)?(house|condo|property|assets)\b/i,
      /\bequalization\s+payment\b/i,
    ],
  },
  {
    subType: "fam_divorce",
    confidence: "high",
    patterns: [
      /\b(getting\s+a\s+)?divorce\b/i,
      /\bdissolution\s+of\s+marriage\b/i,
      /\bseparated\s+(from\s+)?(my\s+)?(spouse|husband|wife|partner)\b/i,
      /\bseparation\s+(agreement|date|date)\b/i,
      /\bending\s+my\s+marriage\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CRIMINAL sub-types
// ─────────────────────────────────────────────────────────────────────────────
const CRIM_SUB_TYPE_RULES: SubTypeRule[] = [
  {
    subType: "crim_dui",
    confidence: "high",
    patterns: [
      /\b(DUI|DWI|impaired\s+driving|drunk\s+driving|drink\s+driving)\b/i,
      /\bover\s+80\b/i,
      /\bbreathalyzer\b/i,
      /\bbreath\s+(sample|test|reading)\b/i,
      /\brefused\s+to\s+blow\b/i,
      /\bimpaired\s+(operation|charge|driving)\b/i,
      /\bdriving\s+(while|under)\s+(impaired|the\s+influence)\b/i,
    ],
  },
  {
    subType: "crim_domestic",
    confidence: "high",
    patterns: [
      /\bdomestic\s+(assault|violence|charge)\b/i,
      /\bcharged\s+with\b.{0,30}\b(assault|pushing|hitting)\b.{0,30}\b(spouse|wife|husband|partner|girlfriend|boyfriend)\b/i,
      /\bpartner\s+(assault|violence)\b/i,
    ],
  },
  {
    subType: "crim_assault",
    confidence: "high",
    patterns: [
      /\b(assault|aggravated\s+assault|assault\s+causing\s+bodily\s+harm|assault\s+with\s+a\s+weapon)\b/i,
      /\bsexual\s+assault\s+charge\b/i,
      /\bbattery\s+charge\b/i,
    ],
  },
  {
    subType: "crim_drug",
    confidence: "high",
    patterns: [
      /\bdrug\s+(charge|offence|trafficking|possession|distribution)\b/i,
      /\b(possession|trafficking)\s+(of\s+)?(cocaine|heroin|fentanyl|methamphetamine|ecstasy|MDMA|marijuana|cannabis)\b/i,
      /\bCDSA\b/i,
      /\bcontrolled\s+substance\b/i,
    ],
  },
  {
    subType: "crim_theft",
    confidence: "high",
    patterns: [
      /\b(theft|shoplifting|fraud|robbery|break\s+and\s+enter|B&E|embezzlement|extortion)\b\s+(charge|charges)\b/i,
      /\bcharged\s+with\s+(theft|fraud|robbery|shoplifting)\b/i,
      /\bfraud\s+charge\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IMMIGRATION sub-types
// ─────────────────────────────────────────────────────────────────────────────
const IMM_SUB_TYPE_RULES: SubTypeRule[] = [
  {
    subType: "imm_refugee",
    confidence: "high",
    patterns: [
      /\b(refugee|asylum|refugee\s+claim|convention\s+refugee)\b/i,
      /\bIRB\b/i,
      /\bremoval\s+order\b/i,
      /\bdeportation\b/i,
      /\brefugee\s+protection\b/i,
      /\bpersecuted\b/i,
    ],
  },
  {
    subType: "imm_spousal",
    confidence: "high",
    patterns: [
      /\bspousal\s+sponsorship\b/i,
      /\bsponsoring\s+my\s+(spouse|husband|wife|partner|common[- ]law)\b/i,
      /\bfamily\s+(class\s+)?sponsorship\b/i,
      /\bbring\s+my\s+(wife|husband|partner|spouse|children|kids?)\s+(to\s+Canada|here)\b/i,
    ],
  },
  {
    subType: "imm_study",
    confidence: "high",
    patterns: [
      /\bstudy\s+permit\b/i,
      /\bstudent\s+visa\b/i,
      /\binternational\s+student\b/i,
    ],
  },
  {
    subType: "imm_work_permit",
    confidence: "high",
    patterns: [
      /\bwork\s+permit\b/i,
      /\bLMIA\b/i,
      /\bopen\s+work\s+permit\b/i,
      /\btemporary\s+(foreign\s+)?worker\b/i,
      /\bemployer[- ]specific\s+permit\b/i,
    ],
  },
  {
    subType: "imm_pnp",
    confidence: "high",
    patterns: [
      /\b(provincial\s+nominee|PNP)\b/i,
      /\bONTARIO\s+IMMIGRANT\s+NOMINEE\b/i,
      /\bprovincial\s+nomination\b/i,
    ],
  },
  {
    subType: "imm_ee",
    confidence: "high",
    patterns: [
      /\bExpress\s+Entry\b/i,
      /\bCRS\s+(score|points)\b/i,
      /\bFederal\s+Skilled\s+Worker\b/i,
      /\bFSW\b/i,
      /\bFSTW\b/i,
      /\bCanadian\s+Experience\s+Class\b/i,
      /\bCEC\b.{0,20}\bimmigration\b/i,
      /\bpermanent\s+residen(ce|t)\b.{0,30}\bprofile\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CIVIL LITIGATION sub-types
// ─────────────────────────────────────────────────────────────────────────────
const CIV_SUB_TYPE_RULES: SubTypeRule[] = [
  {
    subType: "civ_debt",
    confidence: "high",
    patterns: [
      /\b(debt\s+collection|debt\s+recovery|collect\s+a\s+debt|owed\s+money)\b/i,
      /\b(they|he|she|company)\s+(owes?\s+me|won.t\s+pay\s+me|hasn.t\s+paid\s+me)\b/i,
      /\bunpaid\s+(invoice|loan|debt)\b/i,
    ],
  },
  {
    subType: "civ_negligence",
    confidence: "high",
    patterns: [
      /\bnegligence\b.{0,30}\b(sue|claim|damages)\b/i,
      /\bprofessional\s+negligence\b/i,
      /\baccount(ant|ing)\s+negligence\b/i,
      /\blegal\s+(malpractice|negligence)\b/i,
      /\bduty\s+of\s+care\b/i,
    ],
  },
  {
    subType: "civ_tort",
    confidence: "high",
    patterns: [
      /\b(tort|tortious)\b/i,
      /\bnuisance\s+claim\b/i,
      /\btrespass\s+(claim|action)\b/i,
    ],
  },
  {
    subType: "civ_contract",
    confidence: "high",
    patterns: [
      /\bbreach\s+of\s+contract\b/i,
      /\b(contract|agreement)\s+(dispute|breach|violation|not\s+fulfilled|broken)\b/i,
      /\bthey\s+didn.t\s+(deliver|complete|perform|hold\s+up\s+their\s+end)\b/i,
      /\bfailed\s+to\s+(deliver|complete|perform\s+under)\b.{0,20}\bcontract\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INSURANCE sub-types
// ─────────────────────────────────────────────────────────────────────────────
const INS_SUB_TYPE_RULES: SubTypeRule[] = [
  {
    subType: "ins_bad_faith",
    confidence: "high",
    patterns: [
      /\bbad\s+faith\b/i,
      /\binsurer.{0,30}(acting|acted|behaving)\s+(in\s+)?bad\s+faith\b/i,
      /\binsurance\s+company\s+(unreasonably\s+)?(delayed|denied|refused)\b/i,
    ],
  },
  {
    subType: "ins_denial",
    confidence: "high",
    patterns: [
      /\binsurance\s+(claim\s+)?(denied|rejection|rejected|refused)\b/i,
      /\b(denied|rejected)\s+(my\s+)?insurance\s+claim\b/i,
      /\binsurer\s+(denied|rejected|refused)\b/i,
    ],
  },
  {
    subType: "ins_sabs",
    confidence: "high",
    patterns: [
      /\bSABS\b/i,
      /\bstatutory\s+accident\s+benefits\b/i,
      /\baccident\s+benefits\b/i,
      /\bincome\s+replacement\s+benefit\b/i,
      /\bIRB\b.{0,20}\b(accident|claim|insur)\b/i,
      /\bmedical\s+rehabilitation\s+benefit\b/i,
      /\bcatastrophic\s+(impairment|designation)\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────
const RULES_BY_PA: Record<string, SubTypeRule[]> = {
  pi:   PI_SUB_TYPE_RULES,
  emp:  EMP_SUB_TYPE_RULES,
  fam:  FAM_SUB_TYPE_RULES,
  crim: CRIM_SUB_TYPE_RULES,
  imm:  IMM_SUB_TYPE_RULES,
  civ:  CIV_SUB_TYPE_RULES,
  ins:  INS_SUB_TYPE_RULES,
};

/**
 * Detect the practice sub-type from free text using deterministic regex rules.
 *
 * @param practiceArea  Umbrella PA already classified (e.g. "pi", "emp").
 * @param text          Full situation text from the client (concatenated all turns).
 * @returns             SubTypeMatch with matched sub-type and confidence, or null if no match.
 */
export function detectSubType(
  practiceArea: string,
  text: string,
): SubTypeMatch | null {
  const rules = RULES_BY_PA[practiceArea];
  if (!rules || rules.length === 0) return null;

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return {
          subType: rule.subType,
          confidence: rule.confidence,
          matchedPattern: pattern.toString(),
        };
      }
    }
  }

  return null;
}

/**
 * Resolve the final sub-type from two sources: regex detection and GPT output.
 * Agreement = confident. Disagreement = use GPT, log conflict flag.
 * Neither = null (caller should fall back to `{pa}_other`).
 */
export function resolveSubType(
  practiceArea: string,
  text: string,
  gptSubType: string | null | undefined,
): { subType: string | null; conflict: boolean } {
  const regexResult = detectSubType(practiceArea, text);
  const regexSubType = regexResult?.subType ?? null;

  if (!regexSubType && !gptSubType) {
    return { subType: null, conflict: false };
  }

  if (regexSubType && !gptSubType) {
    return { subType: regexSubType, conflict: false };
  }

  if (!regexSubType && gptSubType) {
    return { subType: gptSubType, conflict: false };
  }

  if (regexSubType === gptSubType) {
    return { subType: regexSubType, conflict: false };
  }

  // Disagreement: trust GPT for semantic edge cases, flag the conflict for monitoring
  return { subType: gptSubType!, conflict: true };
}
