/**
 * Context-aware question auto-skip — extracted from route.ts for reuse.
 *
 * After the AI classifies a practice area and extracts entities from free-text,
 * this module checks whether structured questions can be confidently answered
 * from what the person already told us. Slots matched here are never shown.
 *
 * Rule: only auto-answer when the signal is unambiguous. If there's any doubt,
 * let the question render and let the person confirm.
 *
 * This is the regex fast-path. GPT-based extraction (filled_slots, S10.2) is the
 * primary path and runs in parallel — results are merged into updatedConfirmed.
 *
 * Sub-type routing: AUTO_RULES_BY_PA is keyed by question-set key, which may be
 * a sub-type ID (e.g. "pi_slip_fall") rather than just the umbrella PA ("pi").
 * autoConfirmFromContext() accepts a questionSetKey parameter for this purpose.
 * The umbrella "pi" key still exists as a fallback for legacy sessions without sub-type.
 */

type AutoConfirmRule = {
  questionId: string;
  patterns: RegExp;
  value: string;
};

// ─── PI MVA sub-type rules ────────────────────────────────────────────────────
const PI_MVA_AUTO_RULES: AutoConfirmRule[] = [
  // Role detection — pi_mva_q1
  { questionId: "pi_mva_q1", patterns: /\b(car accident|car crash|my car|i was driving|driving my|drove into|rear[- ]?ended|vehicle collision|hit my car|hit my truck|my truck|my suv|my van|fender bender)\b/i, value: "driver" },
  { questionId: "pi_mva_q1", patterns: /\b(i was a passenger|passenger seat|riding with|riding in)\b/i, value: "passenger" },
  { questionId: "pi_mva_q1", patterns: /\b(pedestrian|walking|crosswalk|hit while walking|struck while crossing|hit me while i was walking)\b/i, value: "pedestrian" },
  { questionId: "pi_mva_q1", patterns: /\b(cycling|bicycle|bike|cyclist|hit while cycling|hit my bike)\b/i, value: "cyclist" },

  // Timing detection — pi_mva_q16
  { questionId: "pi_mva_q16", patterns: /\b(today|just now|just happened|this morning|this afternoon|this evening|tonight|last night|yesterday|few hours ago|earlier today)\b/i, value: "today_week" },

  // Collision type detection — pi_mva_q31
  { questionId: "pi_mva_q31", patterns: /\b(rear[- ]?ended|hit from behind|bumped from behind)\b/i, value: "rear_end" },
  { questionId: "pi_mva_q31", patterns: /\b(head[- ]?on|head on collision|frontal)\b/i, value: "head_on" },
  { questionId: "pi_mva_q31", patterns: /\b(t[- ]?bone|side[- ]?impact|intersection collision|ran a red|ran the light)\b/i, value: "side_impact" },
];

// ─── PI Slip-and-Fall sub-type rules ─────────────────────────────────────────
const PI_SF_AUTO_RULES: AutoConfirmRule[] = [
  // Location — pi_sf_q1
  { questionId: "pi_sf_q1", patterns: /\b(walmart|costco|supermarket|grocery\s+store|pharmacy|restaurant|mall|shopping\s+centre|shopping\s+center|office\s+building|convenience\s+store)\b/i, value: "commercial" },
  { questionId: "pi_sf_q1", patterns: /\b(sidewalk|city\s+sidewalk|municipal|TTC|subway|bus\s+stop|park|public\s+property)\b/i, value: "public" },
  { questionId: "pi_sf_q1", patterns: /\b(at\s+work|job\s+site|workplace|office\s+at\s+work)\b/i, value: "workplace" },

  // Hazard type — pi_sf_q31
  { questionId: "pi_sf_q31", patterns: /\b(wet\s+floor|spill|mopping|slippery\s+floor|no\s+wet\s+floor\s+sign)\b/i, value: "wet_floor" },
  { questionId: "pi_sf_q31", patterns: /\b(ice|icy|snow|slippery\s+(sidewalk|driveway|steps|walkway))\b/i, value: "ice_snow" },
  { questionId: "pi_sf_q31", patterns: /\b(uneven|pothole|cracked\s+(pavement|sidewalk)|broken\s+(step|pavement))\b/i, value: "uneven" },

  // Timing — pi_sf_q16
  { questionId: "pi_sf_q16", patterns: /\b(today|just now|just happened|this morning|last night|yesterday|few hours ago)\b/i, value: "within_week" },
];

// ─── PI Dog Bite sub-type rules ───────────────────────────────────────────────
const PI_DB_AUTO_RULES: AutoConfirmRule[] = [
  // Timing — pi_db_q16
  { questionId: "pi_db_q16", patterns: /\b(today|just now|just happened|this morning|last night|yesterday|few hours ago)\b/i, value: "within_week" },
];

// ─── PI Med-Mal sub-type rules ────────────────────────────────────────────────
const PI_MM_AUTO_RULES: AutoConfirmRule[] = [
  // Provider type — pi_mm_q1
  { questionId: "pi_mm_q1", patterns: /\b(family\s+doctor|general\s+practitioner|GP|physician)\b/i, value: "physician" },
  { questionId: "pi_mm_q1", patterns: /\b(surgeon|specialist|cardiologist|oncologist|orthopedic|neurosurgeon)\b/i, value: "surgeon" },
  { questionId: "pi_mm_q1", patterns: /\b(hospital|clinic|health\s+centre)\b/i, value: "hospital" },
  { questionId: "pi_mm_q1", patterns: /\b(dentist|dental\s+clinic|dental\s+office)\b/i, value: "dentist" },

  // Error type — pi_mm_q17
  { questionId: "pi_mm_q17", patterns: /\b(misdiagnosis|wrong\s+diagnosis|failed\s+to\s+diagnose|delayed\s+diagnosis)\b/i, value: "misdiagnosis" },
  { questionId: "pi_mm_q17", patterns: /\b(surgical\s+error|wrong[- ]site\s+surgery|surgery\s+went\s+wrong|operated\s+on\s+wrong)\b/i, value: "surgical" },
  { questionId: "pi_mm_q17", patterns: /\b(wrong\s+medication|wrong\s+drug|wrong\s+dosage|medication\s+error)\b/i, value: "medication" },
];

// ─── Legacy umbrella PI rules (backward compat for sessions without sub-type) ─
const PI_AUTO_RULES: AutoConfirmRule[] = [
  // Role detection — pi_q1
  { questionId: "pi_q1", patterns: /\b(car accident|car crash|my car|i was driving|driving my|drove into|rear[- ]?ended|vehicle collision|hit my car|hit my truck|my truck|my suv|my van|fender bender)\b/i, value: "driver" },
  { questionId: "pi_q1", patterns: /\b(i was a passenger|passenger seat|riding with|riding in)\b/i, value: "passenger" },
  { questionId: "pi_q1", patterns: /\b(pedestrian|walking|crosswalk|hit while walking|struck while crossing|hit me while i was walking)\b/i, value: "pedestrian" },
  { questionId: "pi_q1", patterns: /\b(cycling|bicycle|bike|cyclist|hit while cycling|hit my bike)\b/i, value: "cyclist" },

  // Timing detection — pi_q16
  { questionId: "pi_q16", patterns: /\b(today|just now|just happened|this morning|this afternoon|this evening|tonight|last night|yesterday|few hours ago|earlier today)\b/i, value: "today_week" },

  // Accident type detection — pi_q31
  { questionId: "pi_q31", patterns: /\b(rear[- ]?ended|hit from behind|bumped from behind)\b/i, value: "rear_end" },
  { questionId: "pi_q31", patterns: /\b(head[- ]?on|head on collision|frontal)\b/i, value: "head_on" },
  { questionId: "pi_q31", patterns: /\b(t[- ]?bone|side[- ]?impact|intersection collision|ran a red|ran the light)\b/i, value: "side_impact" },
];

const EMP_AUTO_RULES: AutoConfirmRule[] = [
  // Employee status — emp_q1
  { questionId: "emp_q1", patterns: /\b(fired|terminated|let go|laid off|dismissed|lost my job|my employer|my boss)\b/i, value: "yes" },

  // Timing — emp_q16
  { questionId: "emp_q16", patterns: /\b(today|just now|yesterday|this week|last week|just (got |been )?fired|just (got |been )?terminated|just (got |been )?let go)\b/i, value: "under_3mo" },
];

// ─── Emp Dismissal sub-type rules ────────────────────────────────────────────
const EMP_DIS_AUTO_RULES: AutoConfirmRule[] = [
  // Timing — emp_dis_q16
  { questionId: "emp_dis_q16", patterns: /\b(fired today|terminated today|let go today|fired yesterday|fired this week|fired last week|just (got |been )?fired|just (got |been )?terminated|just (got |been )?let go)\b/i, value: "under_3mo" },

  // What they received — emp_dis_q17
  { questionId: "emp_dis_q17", patterns: /\b(no notice|immediate(ly)?|walked out (the same day|same day)|effective immediately|nothing (on (the )?way out|when (I was|they))|no payment)\b/i, value: "nothing" },
  { questionId: "emp_dis_q17", patterns: /\b(severance (pay|package|offer)|pay in lieu|lump sum payment|paid out)\b/i, value: "severance" },
  { questionId: "emp_dis_q17", patterns: /\b(working notice|notice period|continued (to work|working)|worked through the notice)\b/i, value: "working_notice" },

  // Reason — emp_dis_q31
  { questionId: "emp_dis_q31", patterns: /\b(no reason|without cause|without a reason|without explanation|didn.t give a reason)\b/i, value: "no_reason" },
  { questionId: "emp_dis_q31", patterns: /\b(restructur|reorganiz|position (eliminated|abolished)|role (eliminated|no longer exists)|downsizing|layoff)\b/i, value: "restructure" },
  { questionId: "emp_dis_q31", patterns: /\b(performance (issues?|reasons?|concerns?)|based on performance|they said my performance)\b/i, value: "performance" },
  { questionId: "emp_dis_q31", patterns: /\b(just cause|serious misconduct|theft|fraud|fired for cause)\b/i, value: "just_cause" },

  // Signed release — emp_dis_q32
  { questionId: "emp_dis_q32", patterns: /\b(haven.t signed|nothing (has been |is |been )?signed|not signed (yet|anything)|they gave me (papers|documents|an agreement) (to sign|and I haven.t))\b/i, value: "given_not_signed" },
  { questionId: "emp_dis_q32", patterns: /\b(signed (a )?release|signed (a )?severance|signed (the )?agreement|full and final release)\b/i, value: "signed_release" },

  // Seniority — emp_dis_q46
  { questionId: "emp_dis_q46", patterns: /\b(director|vice[- ]?president|VP|C[- ]?suite|CEO|CFO|COO|president)\b/i, value: "executive" },
  { questionId: "emp_dis_q46", patterns: /\b(manager|supervisor|team lead|head of)\b/i, value: "manager" },
  { questionId: "emp_dis_q46", patterns: /\b(junior|entry[- ]?level|intern|assistant|coordinator)\b/i, value: "junior" },
];

// ─── Emp Harassment sub-type rules ───────────────────────────────────────────
const EMP_HAR_AUTO_RULES: AutoConfirmRule[] = [
  // Type — emp_har_q1
  { questionId: "emp_har_q1", patterns: /\bsexual harassment\b/i, value: "sexual" },
  { questionId: "emp_har_q1", patterns: /\b(discrimination|discriminatory harassment|harassment based on|racial|gender-based)\b/i, value: "discriminatory" },
  { questionId: "emp_har_q1", patterns: /\b(bullying|personal harassment|bullied|being targeted)\b/i, value: "personal" },

  // Perpetrator — emp_har_q2
  { questionId: "emp_har_q2", patterns: /\b(my (direct )?supervisor|my (direct )?manager|my boss)\b/i, value: "supervisor" },
  { questionId: "emp_har_q2", patterns: /\b(senior management|VP|director|executive (above|over))\b/i, value: "senior_mgmt" },
  { questionId: "emp_har_q2", patterns: /\b(coworker|colleague|peer|someone at my level)\b/i, value: "coworker" },

  // Still employed — emp_har_q17
  { questionId: "emp_har_q17", patterns: /\b(still (working|employed|at (the company|work))|currently employed)\b/i, value: "yes_ongoing" },
  { questionId: "emp_har_q17", patterns: /\b(I resigned|I quit|left the (job|company)|no longer (work|employed) there)\b.{0,30}\b(because of|due to)\b/i, value: "resigned" },
];

// ─── Emp Constructive sub-type rules ─────────────────────────────────────────
const EMP_CON_AUTO_RULES: AutoConfirmRule[] = [
  // Change type — emp_con_q1
  { questionId: "emp_con_q1", patterns: /\b(pay cut|salary (cut|reduced|reduction)|compensation (cut|reduced|reduction)|they cut my (pay|salary))\b/i, value: "pay_cut" },
  { questionId: "emp_con_q1", patterns: /\b(job duties (changed|altered)|my role (changed|was changed)|different (role|job|duties)|new duties)\b/i, value: "role_change" },
  { questionId: "emp_con_q1", patterns: /\b(demoted|demotion|title (stripped|downgraded|removed)|reporting (changed|restructured)|lost (my authority|my team))\b/i, value: "demotion" },
  { questionId: "emp_con_q1", patterns: /\b(relocated|forced to move|transfer(red)? to (another|a different) (city|location|office))\b/i, value: "relocation" },

  // Still employed — emp_con_q2
  { questionId: "emp_con_q2", patterns: /\b(still (employed|working there)|haven.t resigned|deciding (what|whether) to)\b/i, value: "still_employed" },
  { questionId: "emp_con_q2", patterns: /\b(I (have )?resigned|I quit|I left)\b/i, value: "resigned_recent" },

  // Objected — emp_con_q17
  { questionId: "emp_con_q17", patterns: /\b(objected in writing|wrote (a letter|an email|to employer)|sent (them|HR) (a letter|an email) (objecting|about this|protesting))\b/i, value: "yes_refused" },
  { questionId: "emp_con_q17", patterns: /\b(continued (to work|working)|didn.t (formally )?object|accepted (the change|it) (by continuing|and kept working))\b/i, value: "no_objection" },
];

const CRIM_AUTO_RULES: AutoConfirmRule[] = [
  // Driving — crim_q1
  { questionId: "crim_q1", patterns: /\b(i was driving|driving my|pulled over|traffic stop|behind the wheel|dui|dwi|impaired driving)\b/i, value: "yes" },

  // Timing — crim_q19
  { questionId: "crim_q19", patterns: /\b(today|last night|yesterday|this week|just happened|got pulled over)\b/i, value: "under_3mo" },
];

const CRIM_DUI_AUTO_RULES: AutoConfirmRule[] = [
  // Charge type — crim_dui_q1
  { questionId: "crim_dui_q1", patterns: /\b(over 80|blew over|breathalyzer reading|over the limit|80mg)\b/i, value: "over_80" },
  { questionId: "crim_dui_q1", patterns: /\b(refused (to blow|to provide|a sample)|refusal charge)\b/i, value: "refusal" },
  { questionId: "crim_dui_q1", patterns: /\b(drug.impaired|cannabis impaired|high (while|and) driving|marijuana (and |while )?driving)\b/i, value: "drug_impaired" },

  // Sample provided — crim_dui_q2
  { questionId: "crim_dui_q2", patterns: /\b(refused (to blow|to provide|a sample|the test)|I (didn.t|did not) blow|refusal)\b/i, value: "refused" },
  { questionId: "crim_dui_q2", patterns: /\b(blew (into|at) the (station|machine|approved)|provided (a )?breath (samples|sample) at the station)\b/i, value: "approved_instrument" },

  // No accident — crim_dui_q32
  { questionId: "crim_dui_q32", patterns: /\b(no accident|just (a )?traffic stop|routine stop|just (got )?pulled over|no (crash|collision|damage))\b/i, value: "none" },
  { questionId: "crim_dui_q32", patterns: /\b(someone (was )?injured|person (was )?hurt|accident (with|and) injur)\b/i, value: "injuries" },

  // Prior record — crim_dui_q46
  { questionId: "crim_dui_q46", patterns: /\b(no (prior|previous|criminal) record|clean record|never been charged|first (time|offence))\b/i, value: "none" },
  { questionId: "crim_dui_q46", patterns: /\b(prior (impaired|DUI)|second (offence|time)|previous (impaired|DUI) conviction)\b/i, value: "one_prior" },

  // Child passenger — crim_dui_q47
  { questionId: "crim_dui_q47", patterns: /\b(no (kids|children) in (the )?car|no (child|minor) (passenger|in the vehicle))\b/i, value: "no" },
  { questionId: "crim_dui_q47", patterns: /\b(my (kid|child|son|daughter) was in (the )?car|child (was )?a passenger|minor in (the )?vehicle)\b/i, value: "yes" },
];

const CRIM_ASS_AUTO_RULES: AutoConfirmRule[] = [
  // Self-defence — crim_ass_q31
  { questionId: "crim_ass_q31", patterns: /\b(self.defence|self defense|defending myself|he attacked (me )?first|she attacked (me )?first|I was attacked|acting in (self|defence))\b/i, value: "self_defence" },
  { questionId: "crim_ass_q31", patterns: /\b(defending (someone else|my friend|my family|another person))\b/i, value: "defence_other" },
  { questionId: "crim_ass_q31", patterns: /\b(mutual (fight|altercation|exchange)|we (both|were) fighting|both sides|it was (mutual|both of us))\b/i, value: "mutual" },

  // No injuries — crim_ass_q32
  { questionId: "crim_ass_q32", patterns: /\b(no injuries|not injured|no (visible |physical )?injury|didn.t hurt (them|him|her)|no marks?)\b/i, value: "none" },
  { questionId: "crim_ass_q32", patterns: /\b(hospital|medical attention|broken|fracture|stitches|serious injur)\b/i, value: "medical_required" },

  // Prior record — crim_ass_q47
  { questionId: "crim_ass_q47", patterns: /\b(no (prior|previous|criminal) record|clean record|never been charged|first (time|offence))\b/i, value: "none" },
  { questionId: "crim_ass_q47", patterns: /\b(prior (assault|violence) conviction|convicted (of assault|of violence)|history of (assault|violence))\b/i, value: "prior_assault" },
];

const CRIM_DRG_AUTO_RULES: AutoConfirmRule[] = [
  // Substance — crim_drg_q2
  { questionId: "crim_drg_q2", patterns: /\b(cannabis|marijuana|weed|pot|hash)\b/i, value: "cannabis" },
  { questionId: "crim_drg_q2", patterns: /\b(cocaine|crack|coke)\b/i, value: "cocaine" },
  { questionId: "crim_drg_q2", patterns: /\b(fentanyl|heroin|opioid|oxycodone|morphine|percocet)\b/i, value: "opioids" },
  { questionId: "crim_drg_q2", patterns: /\b(meth|methamphetamine|crystal meth|MDMA|ecstasy|molly)\b/i, value: "meth_mdma" },

  // No warrant — crim_drg_q32
  { questionId: "crim_drg_q32", patterns: /\b(no warrant|without (a )?warrant|warrantless|didn.t (have|show) a warrant|I (didn.t|did not) consent)\b/i, value: "no_warrant_no_consent" },
  { questionId: "crim_drg_q32", patterns: /\b(search warrant|they had (a )?warrant|warrant was obtained)\b/i, value: "warrant" },

  // Prior record — crim_drg_q47
  { questionId: "crim_drg_q47", patterns: /\b(no (prior|previous|criminal) record|clean record|never been charged|first (time|offence))\b/i, value: "none" },
  { questionId: "crim_drg_q47", patterns: /\b(prior (drug|trafficking) conviction|previously convicted (of drugs|for trafficking))\b/i, value: "prior_trafficking" },
];

const CRIM_TFT_AUTO_RULES: AutoConfirmRule[] = [
  // Value — crim_tft_q2
  { questionId: "crim_tft_q2", patterns: /\b(under \$?5,?000|under five thousand|theft under|shoplifting|small (amount|value))\b/i, value: "500_5k" },
  { questionId: "crim_tft_q2", patterns: /\b(over \$?5,?000|theft over|more than five thousand|significant amount)\b/i, value: "5k_50k" },

  // Restitution — crim_tft_q32
  { questionId: "crim_tft_q32", patterns: /\b(paid (it )?back|repaid (the )?full|full repayment|already (paid|repaid))\b/i, value: "full_repayment" },
  { questionId: "crim_tft_q32", patterns: /\b(partial (repayment|payment)|offered to (pay|repay)|partially (paid|repaid))\b/i, value: "partial_repayment" },

  // Prior record — crim_tft_q47
  { questionId: "crim_tft_q47", patterns: /\b(no (prior|previous|criminal) record|clean record|never been charged|first (time|offence))\b/i, value: "none" },
  { questionId: "crim_tft_q47", patterns: /\b(prior (theft|fraud|shoplifting) conviction|convicted (of theft|of fraud)|history of theft)\b/i, value: "prior_theft" },
];

const CRIM_DOM_AUTO_RULES: AutoConfirmRule[] = [
  // Relationship — crim_dom_q2
  { questionId: "crim_dom_q2", patterns: /\b(my (wife|husband|spouse|girlfriend|boyfriend|common.law|partner)|current (partner|spouse))\b/i, value: "current_partner" },
  { questionId: "crim_dom_q2", patterns: /\b(my ex|ex.wife|ex.husband|ex.girlfriend|ex.boyfriend|former (partner|spouse))\b/i, value: "former_partner" },
  { questionId: "crim_dom_q2", patterns: /\b(my (parent|mother|father|sibling|brother|sister|son|daughter)|family member)\b/i, value: "family" },

  // Complainant support — crim_dom_q31
  { questionId: "crim_dom_q31", patterns: /\b(she (wants it|the charge) dropped|he (wants it|the charge) dropped|complainant (doesn.t|does not) want to proceed|wants it withdrawn|not supporting (the )?charge)\b/i, value: "complainant_no_support" },
  { questionId: "crim_dom_q31", patterns: /\b(she is (cooperating|supporting)|he is (cooperating|supporting)|victim (supports|is (behind|with)) the charge|pressing charges)\b/i, value: "supports_charge" },

  // Children present — crim_dom_q46
  { questionId: "crim_dom_q46", patterns: /\b(no (kids|children) (were |in the home|present)|children (weren.t|were not) (there|present|home))\b/i, value: "no_children" },
  { questionId: "crim_dom_q46", patterns: /\b(children? (witnessed|saw|heard)|kids? (witnessed|saw|heard)|(kids|children) (were )?in the room)\b/i, value: "witnessed" },

  // Prior record — crim_dom_q47
  { questionId: "crim_dom_q47", patterns: /\b(no (prior|previous|criminal) record|clean record|never been charged|first (time|offence))\b/i, value: "none" },
  { questionId: "crim_dom_q47", patterns: /\b(prior domestic (conviction|charge)|convicted of domestic|history of domestic (violence|calls|charges))\b/i, value: "prior_conviction" },
];

const FAM_AUTO_RULES: AutoConfirmRule[] = [
  // Marriage status — fam_q1
  { questionId: "fam_q1", patterns: /\b(married|legal marriage|my wife|my husband|my spouse)\b/i, value: "yes" },
  { questionId: "fam_q1", patterns: /\b(common.law|common law partner|not legally married|not married)\b/i, value: "no" },

  // Ontario residency — fam_q2
  { questionId: "fam_q2", patterns: /\b(ontario|living in ontario|based in ontario|years in ontario|moved to ontario)\b/i, value: "yes" },
];

const FAM_DIV_AUTO_RULES: AutoConfirmRule[] = [
  // Legally married — fam_div_q1
  { questionId: "fam_div_q1", patterns: /\b(legally married|we got married|marriage certificate|my wife|my husband|my spouse)\b/i, value: "yes" },
  { questionId: "fam_div_q1", patterns: /\b(common.law|common law|not legally married|just lived together)\b/i, value: "no" },

  // Separation date agreed — fam_div_q2
  { questionId: "fam_div_q2", patterns: /\b(we both agree on the separation date|agreed on when we separated|no dispute about the date)\b/i, value: "yes" },
  { questionId: "fam_div_q2", patterns: /\b(disagree on the date|dispute when we separated|different separation dates|she says|he says it was)\b/i, value: "no" },
];

const FAM_CUS_AUTO_RULES: AutoConfirmRule[] = [
  // Immediate safety — fam_cus_q17
  { questionId: "fam_cus_q17", patterns: /\b(immediate danger|children are in danger|fear for my kids|kids are at risk right now|not safe for my children)\b/i, value: "immediate_danger" },
  { questionId: "fam_cus_q17", patterns: /\b(history of domestic violence|abuse history|history of abuse|prior abuse|previously abused)\b/i, value: "history_violence" },

  // Relocation threat — fam_cus_q32
  { questionId: "fam_cus_q32", patterns: /\b(already moved|took the kids|abducted|moved without (my )?consent|left (the province|the country) with)\b/i, value: "already_moved" },
  { questionId: "fam_cus_q32", patterns: /\b(threatening to move|wants to move|plans to relocate|talking about moving away with)\b/i, value: "threatened_move" },
];

const FAM_SUP_AUTO_RULES: AutoConfirmRule[] = [
  // Support type — fam_sup_q1
  { questionId: "fam_sup_q1", patterns: /\b(child support only|just child support|only paying child support)\b/i, value: "child_only" },
  { questionId: "fam_sup_q1", patterns: /\b(spousal support|alimony|maintenance|spouse support)\b/i, value: "spousal_only" },

  // Arrears — fam_sup_q32
  { questionId: "fam_sup_q32", patterns: /\b(arrears|hasn.t paid|not paying|missed payments|owes support|behind on support)\b/i, value: "10k_50k" },
];

const FAM_PRO_AUTO_RULES: AutoConfirmRule[] = [
  // Matrimonial home — fam_pro_q2
  { questionId: "fam_pro_q2", patterns: /\b(home (was |has been )?sold|house (was |has been )?sold|proceeds from (the )?sale|sold the house)\b/i, value: "sold" },
  { questionId: "fam_pro_q2", patterns: /\b(still (living|staying) in (the )?house|still in (the )?home|one of us (is )?in (the )?house)\b/i, value: "occupied" },
  { questionId: "fam_pro_q2", patterns: /\b(we rented|we were renting|no house|no home|apartment|condo we rented)\b/i, value: "rental" },
];

const FAM_PRT_AUTO_RULES: AutoConfirmRule[] = [
  // Current safety — fam_prt_q1
  { questionId: "fam_prt_q1", patterns: /\b(immediate danger|in danger right now|not safe|need help (right )?now|emergency situation|he.s threatening me now|she.s threatening me now)\b/i, value: "immediate_danger" },
  { questionId: "fam_prt_q1", patterns: /\b(i left|i have left|i.m out|staying with|at a shelter|left the house|moved out)\b/i, value: "safe_left" },

  // Type of abuse — fam_prt_q2
  { questionId: "fam_prt_q2", patterns: /\b(hit me|struck me|punched|pushed me|physical abuse|physically abusive|physically hurt|threats of physical|threatened to hurt)\b/i, value: "physical" },
  { questionId: "fam_prt_q2", patterns: /\b(emotionally abusive|psychological abuse|controlling|isolation|gaslighting|intimidation|verbal abuse)\b/i, value: "emotional" },
  { questionId: "fam_prt_q2", patterns: /\b(sexual abuse|sexually assaulted|sexual coercion|forced (to have )?sex)\b/i, value: "sexual" },
  { questionId: "fam_prt_q2", patterns: /\b(financial abuse|controlling (my )?money|won.t let me access|coerced (to )?sign)\b/i, value: "financial" },
];

const IMM_EE_AUTO_RULES: AutoConfirmRule[] = [
  // Program — imm_ee_q1
  { questionId: "imm_ee_q1", patterns: /\b(Canadian Experience Class|CEC|I (have|had) Canadian work experience|worked in Canada (for|and want) PR)\b/i, value: "cec" },
  { questionId: "imm_ee_q1", patterns: /\b(Federal Skilled Worker|FSW|foreign work experience|skilled worker (program|PR))\b/i, value: "fsw" },

  // Profile / ITA — imm_ee_q2
  { questionId: "imm_ee_q2", patterns: /\b(received (an |the )?ITA|Invitation to Apply|got an invitation)\b/i, value: "ita_received" },
  { questionId: "imm_ee_q2", patterns: /\b(active (Express Entry )?profile|profile (is )?in the pool|no ITA yet)\b/i, value: "profile_active" },
  { questionId: "imm_ee_q2", patterns: /\b(profile expired|profile (has )?expired|need to (create|renew) (a )?profile)\b/i, value: "expired" },

  // Language — imm_ee_q31
  { questionId: "imm_ee_q31", patterns: /\b(IELTS|CELPIP|TEF|language test|test scores|CLB)\b/i, value: "clb7_8" },
  { questionId: "imm_ee_q31", patterns: /\b(no (language )?test|haven.t (taken|done|completed) (a |the )?language test|test not (yet )?done)\b/i, value: "no_test" },

  // PNP nomination — imm_ee_q46
  { questionId: "imm_ee_q46", patterns: /\b(provincial nomination|PNP nomination|nominated (by|from) (a )?province|OINP nomination|provincial nominee)\b/i, value: "has_nomination" },
  { questionId: "imm_ee_q46", patterns: /\b(applied to (a )?PNP|waiting (for|on) (a )?provincial nomination|PNP application (submitted|pending))\b/i, value: "pnp_applied" },
];

const IMM_SPO_AUTO_RULES: AutoConfirmRule[] = [
  // Relationship type — imm_spo_q1
  { questionId: "imm_spo_q1", patterns: /\b(legally married|my (wife|husband|spouse)|we (are|got|were) married|marriage certificate)\b/i, value: "married" },
  { questionId: "imm_spo_q1", patterns: /\b(common.law|common law partner|lived together (for |continuously )?12|cohabiting for)\b/i, value: "common_law" },

  // Stream — imm_spo_q2
  { questionId: "imm_spo_q2", patterns: /\b(inland (sponsorship|application)|applying (here|inland)|I am (already |currently )?in Canada)\b/i, value: "inland" },
  { questionId: "imm_spo_q2", patterns: /\b(outland|applying from (outside|abroad|my home country)|applying from overseas)\b/i, value: "outland" },

  // Status urgency — imm_spo_q17
  { questionId: "imm_spo_q17", patterns: /\b(status (is )?expiring|permit (is )?expiring|visa (is )?expiring|expires (soon|shortly|next month|in \d+ (days|weeks)))\b/i, value: "status_expiring" },
];

const IMM_STU_AUTO_RULES: AutoConfirmRule[] = [
  // Permit type — imm_stu_q1
  { questionId: "imm_stu_q1", patterns: /\b(PGWP|post.graduation work permit|applying for (my )?PGWP)\b/i, value: "pgwp" },
  { questionId: "imm_stu_q1", patterns: /\b(extending (my )?study permit|renewing (my )?study permit|study permit extension)\b/i, value: "extension" },
  { questionId: "imm_stu_q1", patterns: /\b(restoration|restore (my )?student status|study permit (has )?expired (within|less than) 90)\b/i, value: "restoration" },

  // Expiry — imm_stu_q16
  { questionId: "imm_stu_q16", patterns: /\b(study permit (has )?expired|permit expired|my (study )?permit ran out)\b/i, value: "expired_90_days" },
  { questionId: "imm_stu_q16", patterns: /\b(applying before (it )?expires|still valid|permit (is )?valid|not (yet )?expired)\b/i, value: "not_expired" },

  // Unauthorized work — imm_stu_q32
  { questionId: "imm_stu_q32", patterns: /\b(worked more than (20|twenty) hours|exceeded (the )?work (hours|limit)|worked (without authorization|illegally))\b/i, value: "unauthorized_work" },
  { questionId: "imm_stu_q32", patterns: /\b(within (authorized|allowed) hours|complied with (the )?(20.hour|work) (limit|restriction)|never worked)\b/i, value: "compliant_work" },
];

const IMM_WP_AUTO_RULES: AutoConfirmRule[] = [
  // LMIA status — imm_wp_q2
  { questionId: "imm_wp_q2", patterns: /\b(LMIA (has been |was |is )?obtained|positive LMIA|employer (has|got) (a |the )?LMIA)\b/i, value: "lmia_obtained" },
  { questionId: "imm_wp_q2", patterns: /\b(LMIA.exempt|CUSMA|TN (visa|permit)|ICT|intracompany (transfer|transferee)|IEC|working holiday|significant benefit|R204|R205)\b/i, value: "lmia_exempt" },
  { questionId: "imm_wp_q2", patterns: /\b(LMIA (is )?required|need (a |an )?LMIA|employer (is getting|needs to get) (a |the )?LMIA)\b/i, value: "lmia_needed" },

  // Urgency — imm_wp_q17
  { questionId: "imm_wp_q17", patterns: /\b(start (immediately|right away|within (a )?week|within two weeks)|employer needs me (to start )?immediately)\b/i, value: "urgent_start" },

  // Unauthorized work — imm_wp_q32
  { questionId: "imm_wp_q32", patterns: /\b(valid status|no violations|fully (compliant|authorized)|in (good |valid )?standing)\b/i, value: "valid_status" },
  { questionId: "imm_wp_q32", patterns: /\b(worked (without authorization|beyond (my )?permit)|unauthorized work|overstayed)\b/i, value: "unauthorized" },

  // PR pathway — imm_wp_q47
  { questionId: "imm_wp_q47", patterns: /\b(building (Canadian )?experience (for|toward) (PR|permanent residence)|Express Entry (pathway|strategy)|CEC pathway)\b/i, value: "pr_pathway" },
  { questionId: "imm_wp_q47", patterns: /\b(employer (is )?sponsoring (me )?(for PR|for permanent residence)|employer PR sponsorship)\b/i, value: "employer_pr" },
];

const IMM_REF_AUTO_RULES: AutoConfirmRule[] = [
  // Entry method — imm_ref_q2
  { questionId: "imm_ref_q2", patterns: /\b(entered (at the )?airport|flew (into|to) Canada|arrived (at the )?airport|port of entry (by air|arrival))\b/i, value: "official_port" },
  { questionId: "imm_ref_q2", patterns: /\b(irregular (crossing|entry)|crossed (between ports|informally)|not (at|through) (an official|a) (crossing|port))\b/i, value: "irregular" },
  { questionId: "imm_ref_q2", patterns: /\b(already (in|was in) Canada (when|before) (I|we) (claimed|filed)|inland (claim|application))\b/i, value: "inland" },
  { questionId: "imm_ref_q2", patterns: /\b(through the US|at the US.Canada border|Roxham Road|US land (port|crossing))\b/i, value: "us_land_port" },

  // Hearing urgency — imm_ref_q16
  { questionId: "imm_ref_q16", patterns: /\b(RPD hearing (is |scheduled )?(within|in (the next|less than)) (30|14|7|2) (days|weeks)|hearing (is )?imminent|hearing (is )?very soon)\b/i, value: "hearing_imminent" },
  { questionId: "imm_ref_q16", patterns: /\b(RPD hearing (is |has been )?(scheduled|set)|hearing date (is )?confirmed)\b/i, value: "hearing_scheduled" },
  { questionId: "imm_ref_q16", patterns: /\b(claim (was )?rejected|refugee claim (was )?denied|RPD (denied|dismissed) (my )?claim|PRRA)\b/i, value: "post_rejection" },

  // Removal — imm_ref_q17
  { questionId: "imm_ref_q17", patterns: /\b(removal (is )?imminent|deportation (date|is|scheduled)|being deported|removal (is|in) \d+ (days|weeks))\b/i, value: "removal_imminent" },
  { questionId: "imm_ref_q17", patterns: /\b(removal order (exists|in (place|effect)|was issued)|there is a removal order)\b/i, value: "removal_order" },
  { questionId: "imm_ref_q17", patterns: /\b(stay of removal|removal (has been |is) stayed|judicial review (of|on) removal)\b/i, value: "stay_of_removal" },
];

const IMM_PNP_AUTO_RULES: AutoConfirmRule[] = [
  // Province — imm_pnp_q1
  { questionId: "imm_pnp_q1", patterns: /\b(OINP|Ontario (Immigrant Nominee|PNP)|Ontario.s PNP)\b/i, value: "ontario" },
  { questionId: "imm_pnp_q1", patterns: /\b(BC PNP|British Columbia (PNP|nominee)|BCPNP)\b/i, value: "bc" },
  { questionId: "imm_pnp_q1", patterns: /\b(AINP|Alberta (Immigrant Nominee|PNP)|Alberta.s PNP)\b/i, value: "alberta" },

  // Stage — imm_pnp_q16
  { questionId: "imm_pnp_q16", patterns: /\b(received (a |the |my )?nomination (certificate)?|nominated (by|from) (a )?province|provincial nomination (in hand|received|certificate))\b/i, value: "nominated" },

  // Job offer — imm_pnp_q31
  { questionId: "imm_pnp_q31", patterns: /\b(qualifying (job )?offer|permanent full.time (offer|position)|employer (job )?offer (that )?meets|valid PNP job offer)\b/i, value: "qualifying_offer" },
  { questionId: "imm_pnp_q31", patterns: /\b(no (job )?offer|applying (through|via) Human Capital|not (through the )?employer stream)\b/i, value: "no_offer" },

  // Canadian ties — imm_pnp_q32
  { questionId: "imm_pnp_q32", patterns: /\b(worked in (Ontario|BC|Alberta|the province) (for|over) (a year|1 year|\d years)|work experience in (Ontario|BC|Alberta))\b/i, value: "work_experience" },
  { questionId: "imm_pnp_q32", patterns: /\b(graduated (from|in) (Ontario|BC|Alberta|a Canadian)|Canadian (school|university|college) (in Ontario|in BC|in Alberta))\b/i, value: "education_in_province" },
];

const LLT_AUTO_RULES: AutoConfirmRule[] = [
  // Landlord role — llt_q1
  { questionId: "llt_q1", patterns: /\b(i am (the )?landlord|i own (the )?property|property owner|my rental|my tenant|my unit|i own (the )?unit)\b/i, value: "landlord" },
];

const REAL_AUTO_RULES: AutoConfirmRule[] = [
  // Transaction type — real_q1
  { questionId: "real_q1", patterns: /\b(buying (a |the )?house|purchasing (a |the )?home|buying (a |the )?condo|i am (a )?buyer)\b/i, value: "buying" },
  { questionId: "real_q1", patterns: /\b(selling (a |the )?house|selling (my )?home|selling (a |the )?condo|i am (a )?seller)\b/i, value: "selling" },
];

export const AUTO_RULES_BY_PA: Record<string, AutoConfirmRule[]> = {
  // Umbrella PA (legacy / backward compat)
  pi:            PI_AUTO_RULES,
  emp:           EMP_AUTO_RULES,
  crim:          CRIM_AUTO_RULES,
  fam:           FAM_AUTO_RULES,
  llt:           LLT_AUTO_RULES,
  real:          REAL_AUTO_RULES,
  // PI sub-types
  pi_mva:        PI_MVA_AUTO_RULES,
  pi_slip_fall:  PI_SF_AUTO_RULES,
  pi_dog_bite:   PI_DB_AUTO_RULES,
  pi_med_mal:    PI_MM_AUTO_RULES,
  pi_product:    [],   // no unambiguous regex patterns; GPT extraction handles
  pi_workplace:  [],   // no unambiguous regex patterns; GPT extraction handles
  pi_assault_ci: [],   // no unambiguous regex patterns; GPT extraction handles
  pi_other:      [],   // qualifier set — no auto-confirm needed
  // Emp sub-types
  emp_dismissal:    EMP_DIS_AUTO_RULES,
  emp_harassment:   EMP_HAR_AUTO_RULES,
  emp_constructive: EMP_CON_AUTO_RULES,
  emp_disc:         [],   // GPT handles — too many protected grounds for safe regex
  emp_wage:         [],   // GPT handles — amount/type too varied for safe regex
  emp_other:        [],   // qualifier set — no auto-confirm needed
  // Fam sub-types
  fam_divorce:     FAM_DIV_AUTO_RULES,
  fam_custody:     FAM_CUS_AUTO_RULES,
  fam_support:     FAM_SUP_AUTO_RULES,
  fam_property:    FAM_PRO_AUTO_RULES,
  fam_protection:  FAM_PRT_AUTO_RULES,
  fam_other:       [],   // qualifier set — no auto-confirm needed
  // Crim sub-types
  crim_dui:        CRIM_DUI_AUTO_RULES,
  crim_assault:    CRIM_ASS_AUTO_RULES,
  crim_drug:       CRIM_DRG_AUTO_RULES,
  crim_theft:      CRIM_TFT_AUTO_RULES,
  crim_domestic:   CRIM_DOM_AUTO_RULES,
  crim_other:      [],   // qualifier set — no auto-confirm needed
  // Imm sub-types
  imm_ee:          IMM_EE_AUTO_RULES,
  imm_spousal:     IMM_SPO_AUTO_RULES,
  imm_study:       IMM_STU_AUTO_RULES,
  imm_work_permit: IMM_WP_AUTO_RULES,
  imm_refugee:     IMM_REF_AUTO_RULES,
  imm_pnp:         IMM_PNP_AUTO_RULES,
  imm_other:       [],   // qualifier set — no auto-confirm needed
};

/**
 * Scan situationText for unambiguous answers to structured questions.
 * Returns a map of { questionId → answerValue } to merge into confirmedAnswers.
 * Never overrides a human-confirmed answer.
 *
 * @param practiceArea    Umbrella PA id (e.g. "pi"). Used as fallback key.
 * @param situationText   Full concatenated client text to scan.
 * @param existingConfirmed  Already-confirmed answers — never overridden.
 * @param questionSetKey  Optional sub-type key (e.g. "pi_slip_fall"). Takes
 *                        precedence over practiceArea when present.
 */
export function autoConfirmFromContext(
  practiceArea: string | null,
  situationText: string,
  existingConfirmed: Record<string, unknown>,
  questionSetKey?: string | null,
): Record<string, string> {
  if (!practiceArea) return {};
  // Prefer sub-type-specific rules when available, fall back to umbrella
  const lookupKey = questionSetKey ?? practiceArea;
  const rules = AUTO_RULES_BY_PA[lookupKey] ?? AUTO_RULES_BY_PA[practiceArea];
  if (!rules) return {};

  const auto: Record<string, string> = {};

  for (const rule of rules) {
    if (rule.questionId in existingConfirmed) continue; // don't override human answer
    if (rule.questionId in auto) continue;              // first match wins

    if (rule.patterns.test(situationText)) {
      auto[rule.questionId] = rule.value;
    }
  }

  return auto;
}
