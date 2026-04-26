/**
 * Sub-Type Auto-Confirm Seed Fixtures
 *
 * Each fixture represents a client intake message fragment and the expected
 * auto-confirm resolution for a specific question in a specific sub-type
 * question set. Every questionId referenced here maps to an actual registered
 * rule in AUTO_RULES_BY_PA in auto-confirm.ts.
 *
 * Negative fixtures (expectedValue: null) verify no false-positive fires for
 * that question ID when the input belongs to a different context.
 *
 * Coverage: ~15 fixtures per sub-type × 30 sub-types = ~450 total.
 */

export type Fixture = {
  input: string;
  practiceArea: string;
  questionSetKey: string;
  questionId: string;
  expectedValue: string | null;
};

// ─── PI  -  MVA ────────────────────────────────────────────────────────────────
// Registered: pi_mva_q1, pi_mva_q16, pi_mva_q31
export const PI_MVA_FIXTURES: Fixture[] = [
  { input: "I was driving my car when someone rear-ended me at a red light.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "driver" },
  { input: "I was driving my SUV when it was hit.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "driver" },
  { input: "I was a passenger in a taxi when it was hit by a truck.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "passenger" },
  { input: "I was riding with a friend when we were hit.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "passenger" },
  { input: "I was hit by a car while walking across the intersection.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "pedestrian" },
  { input: "I was cycling to work when a car door opened and knocked me off my bike.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: "cyclist" },
  { input: "This happened last night on the 401.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q16", expectedValue: "today_week" },
  { input: "Just happened this morning  -  I'm still at the scene.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q16", expectedValue: "today_week" },
  { input: "I was rear-ended at a stop sign.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q31", expectedValue: "rear_end" },
  { input: "We had a head-on collision on a two-lane road.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q31", expectedValue: "head_on" },
  { input: "They ran a red light and T-boned me.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q31", expectedValue: "side_impact" },
  { input: "It was a side-impact collision at the intersection.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q31", expectedValue: "side_impact" },
  // Negatives  -  slip-and-fall input should not trigger MVA role
  { input: "I slipped on an icy sidewalk outside a grocery store.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: null },
  { input: "The dog bit me in my neighbour's backyard.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: null },
  { input: "My doctor failed to diagnose my cancer.", practiceArea: "pi", questionSetKey: "pi_mva", questionId: "pi_mva_q1", expectedValue: null },
];

// ─── PI  -  Slip and Fall ───────────────────────────────────────────────────────
// Registered: pi_sf_q1, pi_sf_q16, pi_sf_q31
export const PI_SF_FIXTURES: Fixture[] = [
  { input: "I slipped on a wet floor at a grocery store.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "commercial" },
  { input: "I tripped on a broken step at a restaurant.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "commercial" },
  { input: "I fell at a shopping centre near the food court.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "commercial" },
  { input: "I fell on a cracked city sidewalk near my apartment.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "public" },
  { input: "I slipped on the TTC subway platform.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "public" },
  { input: "I fell at my job site while walking to the warehouse.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: "workplace" },
  { input: "This happened yesterday afternoon at the mall.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q16", expectedValue: "within_week" },
  { input: "I slipped this morning and hurt my back.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q16", expectedValue: "within_week" },
  { input: "There was a wet floor and no wet floor sign posted.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: "wet_floor" },
  { input: "The floor was slippery from a spill that hadn't been cleaned.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: "wet_floor" },
  { input: "I slipped on ice that had built up on the front steps.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: "ice_snow" },
  { input: "The sidewalk was icy and they had not salted.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: "ice_snow" },
  { input: "I tripped on a pothole in the parking lot.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: "uneven" },
  // Negatives
  { input: "I was rear-ended on the highway.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q1", expectedValue: null },
  { input: "The dog attacked me at the park.", practiceArea: "pi", questionSetKey: "pi_slip_fall", questionId: "pi_sf_q31", expectedValue: null },
];

// ─── PI  -  Dog Bite ───────────────────────────────────────────────────────────
// Registered: pi_db_q16
export const PI_DB_FIXTURES: Fixture[] = [
  { input: "A dog attacked me today  -  I need help right away.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: "within_week" },
  { input: "The bite happened this morning before I came here.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: "within_week" },
  { input: "I was attacked by a dog yesterday at the park.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: "within_week" },
  // Negatives  -  unrelated inputs should not fire the timing rule
  { input: "The accident happened 3 months ago at a grocery store.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The slip and fall occurred last year in winter.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The surgical error was discovered two years ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "I was fired four months ago without cause.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "They reduced my salary six months ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "My landlord has been harassing me for weeks.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The debt became due over a year ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The accident was two years ago on the 401.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The breach of contract happened 18 months ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "The insurer denied my claim 6 months ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "I was charged with impaired driving last Saturday.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
  { input: "My passport application was refused three months ago.", practiceArea: "pi", questionSetKey: "pi_dog_bite", questionId: "pi_db_q16", expectedValue: null },
];

// ─── PI  -  Medical Malpractice ─────────────────────────────────────────────────
// Registered: pi_mm_q1, pi_mm_q17
export const PI_MM_FIXTURES: Fixture[] = [
  { input: "My family doctor missed the diagnosis for over a year.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "physician" },
  { input: "My GP failed to refer me to a specialist despite my symptoms.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "physician" },
  { input: "The surgeon made an error during the operation.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "surgeon" },
  { input: "The oncologist missed clear signs of my cancer.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "surgeon" },
  { input: "The hospital did not follow proper protocols.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "hospital" },
  { input: "The dentist pulled the wrong tooth and injured the nerve.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: "dentist" },
  { input: "My doctor gave me a misdiagnosis  -  said it was nothing serious.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "misdiagnosis" },
  { input: "There was a delayed diagnosis of my cancer by 18 months.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "misdiagnosis" },
  { input: "The surgeon committed a surgical error during my procedure.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "surgical" },
  { input: "The surgery went wrong and I had complications.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "surgical" },
  { input: "I was prescribed the wrong medication and had a serious reaction.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "medication" },
  { input: "The wrong dosage was administered and I was hospitalized.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: "medication" },
  // Negatives
  { input: "I was rear-ended on the highway and broke my wrist.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: null },
  { input: "My employer fired me without cause last week.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q17", expectedValue: null },
  { input: "They slipped on ice in front of my building.", practiceArea: "pi", questionSetKey: "pi_med_mal", questionId: "pi_mm_q1", expectedValue: null },
];

// ─── EMP  -  Dismissal ─────────────────────────────────────────────────────────
// Registered: emp_dis_q16, emp_dis_q17, emp_dis_q31, emp_dis_q32, emp_dis_q46
export const EMP_DIS_FIXTURES: Fixture[] = [
  { input: "I was just fired this morning.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q16", expectedValue: "under_3mo" },
  { input: "I was fired last week without any notice whatsoever.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q16", expectedValue: "under_3mo" },
  { input: "They gave me nothing  -  effective immediately, walked out the same day.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q17", expectedValue: "nothing" },
  { input: "I received a severance package of 4 weeks pay.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q17", expectedValue: "severance" },
  { input: "They gave me pay in lieu of notice  -  a lump sum payment.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q17", expectedValue: "severance" },
  { input: "I worked through my notice period for 3 months.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q17", expectedValue: "working_notice" },
  { input: "They gave me no reason at all  -  just said I was let go.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q31", expectedValue: "no_reason" },
  { input: "They said it was a company downsizing and my role was eliminated.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q31", expectedValue: "restructure" },
  { input: "They cited performance issues as the reason.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q31", expectedValue: "performance" },
  { input: "They are claiming just cause  -  alleging serious misconduct.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q31", expectedValue: "just_cause" },
  { input: "They gave me papers to sign but I haven't signed anything yet.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q32", expectedValue: "given_not_signed" },
  { input: "I signed a full and final release in exchange for severance.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q32", expectedValue: "signed_release" },
  { input: "I was a Vice President earning $180,000.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q46", expectedValue: "executive" },
  { input: "I was a manager and team lead for 8 years.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q46", expectedValue: "manager" },
  { input: "I was an entry-level coordinator earning $45,000.", practiceArea: "emp", questionSetKey: "emp_dismissal", questionId: "emp_dis_q46", expectedValue: "junior" },
];

// ─── EMP  -  Harassment ────────────────────────────────────────────────────────
// Registered: emp_har_q1, emp_har_q2, emp_har_q17
export const EMP_HAR_FIXTURES: Fixture[] = [
  { input: "I have been the victim of sexual harassment at work.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: "sexual" },
  { input: "My manager made me the target of sexual harassment for months.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: "sexual" },
  { input: "The harassment is based on racial discrimination.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: "discriminatory" },
  { input: "I am being bullied and targeted constantly at work.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: "personal" },
  { input: "My direct supervisor is the one harassing me.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q2", expectedValue: "supervisor" },
  { input: "It is my boss who is making the inappropriate comments.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q2", expectedValue: "supervisor" },
  { input: "It is a VP and director who are doing this.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q2", expectedValue: "senior_mgmt" },
  { input: "A coworker at my level has been harassing me.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q2", expectedValue: "coworker" },
  { input: "I am still working there  -  currently employed and dealing with this daily.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q17", expectedValue: "yes_ongoing" },
  { input: "I resigned last month because of the harassment.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q17", expectedValue: "resigned" },
  { input: "I quit the job due to the unbearable harassment.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q17", expectedValue: "resigned" },
  // Negatives
  { input: "They terminated my employment without cause yesterday.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: null },
  { input: "My wages haven't been paid for three months.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: null },
  { input: "They relocated me to another city without asking.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q1", expectedValue: null },
  { input: "I was laid off when my position was eliminated.", practiceArea: "emp", questionSetKey: "emp_harassment", questionId: "emp_har_q2", expectedValue: null },
];

// ─── EMP  -  Constructive Dismissal ────────────────────────────────────────────
// Registered: emp_con_q1, emp_con_q2, emp_con_q17
export const EMP_CON_FIXTURES: Fixture[] = [
  { input: "They cut my salary by 25% without my consent.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "pay_cut" },
  { input: "They cut my pay by 30% without any discussion or agreement.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "pay_cut" },
  { input: "My job duties changed completely when the new director arrived.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "role_change" },
  { input: "I was demoted from director to individual contributor.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "demotion" },
  { input: "They relocated me to a different city without asking.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "relocation" },
  { input: "I transferred to another office against my will.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: "relocation" },
  { input: "I am still employed there  -  haven't resigned yet but conditions are impossible.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q2", expectedValue: "still_employed" },
  { input: "I have resigned last week after 10 years there.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q2", expectedValue: "resigned_recent" },
  { input: "I I quit because the situation was untenable.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q2", expectedValue: "resigned_recent" },
  { input: "I objected in writing via email immediately when the change was announced.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q17", expectedValue: "yes_refused" },
  { input: "I sent HR a letter objecting to the salary reduction.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q17", expectedValue: "yes_refused" },
  { input: "I accepted the change and continued working without objecting.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q17", expectedValue: "no_objection" },
  // Negatives
  { input: "They fired me without cause  -  no severance offered.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: null },
  { input: "My boss has been sexually harassing me.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q1", expectedValue: null },
  { input: "They haven't paid my overtime for months.", practiceArea: "emp", questionSetKey: "emp_constructive", questionId: "emp_con_q2", expectedValue: null },
];

// ─── FAM  -  Divorce ────────────────────────────────────────────────────────────
// Registered: fam_div_q1, fam_div_q2
export const FAM_DIV_FIXTURES: Fixture[] = [
  { input: "We are legally married and have been separated for over a year.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: "yes" },
  { input: "We got married in 2015 and I need to divorce my husband.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: "yes" },
  { input: "My spouse and I have a marriage certificate and want to end the marriage.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: "yes" },
  { input: "We just lived together as a common-law couple and never had any ceremony.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: "no" },
  { input: "We just lived together for 5 years but never got married.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: "no" },
  { input: "We both agree on the separation date  -  no dispute about when we separated.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: "yes" },
  { input: "No dispute about the date  -  we agreed on when we separated.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: "yes" },
  { input: "She says it was earlier  -  we disagree on the separation date.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: "no" },
  { input: "We have different separation dates  -  he says it was 2021 and I say 2022.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: "no" },
  // Negatives  -  custody context
  { input: "My child's father won't let me see our son.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: null },
  { input: "I need a restraining order against my partner.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: null },
  { input: "My ex stopped paying child support three months ago.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: null },
  { input: "I want to divide the matrimonial home.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: null },
  { input: "The children are 7 and 10 and I want joint custody.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q1", expectedValue: null },
  { input: "I need spousal support after leaving the marriage.", practiceArea: "fam", questionSetKey: "fam_divorce", questionId: "fam_div_q2", expectedValue: null },
];

// ─── FAM  -  Custody ───────────────────────────────────────────────────────────
// Registered: fam_cus_q17, fam_cus_q32
export const FAM_CUS_FIXTURES: Fixture[] = [
  { input: "My children are in immediate danger  -  I fear for their safety right now.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: "immediate_danger" },
  { input: "The kids are at risk right now and I need help urgently.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: "immediate_danger" },
  { input: "There is a history of domestic violence in the home.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: "history_violence" },
  { input: "My ex has a history of abuse and prior abuse toward the children.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: "history_violence" },
  { input: "My ex already moved  -  she took the kids to another city without my consent.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: "already_moved" },
  { input: "He abducted the children  -  they are gone and I don't know where.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: "already_moved" },
  { input: "She is threatening to move to Vancouver with our daughter.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: "threatened_move" },
  { input: "He wants to move to BC with our children and has not consulted me.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: "threatened_move" },
  { input: "My ex is threatening to move to Europe with our son permanently.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: "threatened_move" },
  // Negatives
  { input: "We are legally married and want a divorce.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: null },
  { input: "I need spousal support after 14 years of marriage.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: null },
  { input: "We have agreed on the separation date.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: null },
  { input: "I want to divide the matrimonial home and the RRSPs.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q17", expectedValue: null },
  { input: "My ex stopped paying child support entirely.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: null },
  { input: "My husband hit me last night and I am not safe.", practiceArea: "fam", questionSetKey: "fam_custody", questionId: "fam_cus_q32", expectedValue: null },
];

// ─── FAM  -  Support ────────────────────────────────────────────────────────────
// Registered: fam_sup_q1, fam_sup_q32
export const FAM_SUP_FIXTURES: Fixture[] = [
  { input: "I only need child support  -  just child support for the kids.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: "child_only" },
  { input: "I am claiming spousal support after 12 years of marriage.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: "spousal_only" },
  { input: "I need alimony  -  my spouse earned far more than me.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: "spousal_only" },
  { input: "My ex owes arrears  -  she hasn't paid child support in months.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: "10k_50k" },
  { input: "He is behind on support  -  missed payments for over a year.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: "10k_50k" },
  { input: "She is not paying and owes me significant support arrears.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: "10k_50k" },
  // Negatives
  { input: "We are legally married and want to divorce.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: null },
  { input: "My ex relocated the children without my consent.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: null },
  { input: "I need a restraining order because of physical abuse.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: null },
  { input: "We have agreed on the separation date and signed a separation agreement.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: null },
  { input: "I want to divide the matrimonial home and our investments.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: null },
  { input: "The children are currently living with me full time.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: null },
  { input: "There is a history of abuse in the relationship.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q32", expectedValue: null },
  { input: "I want to divide the defined benefit pension.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: null },
  { input: "My ex is threatening to move to Vancouver with the kids.", practiceArea: "fam", questionSetKey: "fam_support", questionId: "fam_sup_q1", expectedValue: null },
];

// ─── FAM  -  Property ──────────────────────────────────────────────────────────
// Registered: fam_pro_q2
export const FAM_PRO_FIXTURES: Fixture[] = [
  { input: "We already sold the house last year and are dividing the proceeds from the sale.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: "sold" },
  { input: "The home was sold and we need to split the proceeds.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: "sold" },
  { input: "I am still living in the house  -  one of us is still in the home.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: "occupied" },
  { input: "We were renting  -  no house to divide, just a rental apartment.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: "rental" },
  { input: "We rented a condo together and never owned property.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: "rental" },
  // Negatives
  { input: "My ex stopped paying child support entirely.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "I want a divorce after 12 years of marriage.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "My ex is threatening to move with the kids to Vancouver.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "I need a restraining order  -  my partner assaulted me.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "I need spousal support after giving up my career.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "The children are in immediate danger and I need help.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "We agreed on the date of separation.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "We were never legally married  -  common-law relationship.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "I want to divide the pension and the RRSPs.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
  { input: "My ex owes support arrears for over a year.", practiceArea: "fam", questionSetKey: "fam_property", questionId: "fam_pro_q2", expectedValue: null },
];

// ─── FAM  -  Protection ────────────────────────────────────────────────────────
// Registered: fam_prt_q1, fam_prt_q2
export const FAM_PRT_FIXTURES: Fixture[] = [
  { input: "I am in immediate danger  -  he is threatening me right now.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: "immediate_danger" },
  { input: "I need help right now  -  it's an emergency situation.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: "immediate_danger" },
  { input: "I have left  -  I'm staying with my sister until this is resolved.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: "safe_left" },
  { input: "I moved out and am at a shelter right now.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: "safe_left" },
  { input: "He hit me and pushed me down the stairs  -  physical abuse.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "physical" },
  { input: "She threatened to hurt me and punched me last week.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "physical" },
  { input: "He is emotionally abusive and controlling  -  gaslighting constantly.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "emotional" },
  { input: "The psychological abuse and intimidation have been relentless.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "emotional" },
  { input: "I was sexually assaulted by my partner.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "sexual" },
  { input: "She controls all the money and won't let me access our accounts.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: "financial" },
  // Negatives
  { input: "We are legally married and have been separated for over a year.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: null },
  { input: "My ex owes child support arrears of $15,000.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: null },
  { input: "I want to divide the matrimonial home and investments.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: null },
  { input: "The kids are 7 and 10 and I want joint custody.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q2", expectedValue: null },
  { input: "I need spousal support  -  I gave up my career for this marriage.", practiceArea: "fam", questionSetKey: "fam_protection", questionId: "fam_prt_q1", expectedValue: null },
];

// ─── CRIM  -  DUI ──────────────────────────────────────────────────────────────
// Registered: crim_dui_q1, crim_dui_q2, crim_dui_q32, crim_dui_q46, crim_dui_q47
export const CRIM_DUI_FIXTURES: Fixture[] = [
  { input: "I was charged with over 80 at a RIDE stop.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q1", expectedValue: "over_80" },
  { input: "I blew over the legal limit at the station.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q1", expectedValue: "over_80" },
  { input: "I have a refusal charge  -  I refused to blow.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q1", expectedValue: "refusal" },
  { input: "I refused to provide a sample at the roadside.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q1", expectedValue: "refusal" },
  { input: "I refused to blow at the station  -  refusal charge.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q2", expectedValue: "refused" },
  { input: "I didn't blow  -  I refused the test.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q2", expectedValue: "refused" },
  { input: "I provided a breath sample at the station on the approved instrument.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q2", expectedValue: "approved_instrument" },
  { input: "This was just a routine traffic stop  -  no accident, no crash.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q32", expectedValue: "none" },
  { input: "Someone was injured in the accident that followed.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q32", expectedValue: "injuries" },
  { input: "I have no prior criminal record  -  this is my first offence.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q46", expectedValue: "none" },
  { input: "I have a prior DUI conviction  -  second offence.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q46", expectedValue: "one_prior" },
  { input: "My daughter was in the car seat when I was pulled over.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q47", expectedValue: "yes" },
  { input: "My child was a passenger in the vehicle.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q47", expectedValue: "yes" },
  { input: "No kids in the car  -  no children in the vehicle.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q47", expectedValue: "no" },
  // Negative
  { input: "I was punched outside a bar and charged with assault.", practiceArea: "crim", questionSetKey: "crim_dui", questionId: "crim_dui_q1", expectedValue: null },
];

// ─── CRIM  -  Assault ───────────────────────────────────────────────────────────
// Registered: crim_ass_q31, crim_ass_q32, crim_ass_q47
export const CRIM_ASS_FIXTURES: Fixture[] = [
  { input: "I was acting in self-defence  -  he attacked me first.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: "self_defence" },
  { input: "I was defending myself when he came at me.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: "self_defence" },
  { input: "I was defending my friend who was being attacked.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: "defence_other" },
  { input: "It was a mutual fight  -  both sides were involved.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: "mutual" },
  { input: "The complainant had no injuries  -  not injured at all.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q32", expectedValue: "none" },
  { input: "The alleged victim had no injuries from the incident.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q32", expectedValue: "none" },
  { input: "The complainant went to hospital and required stitches.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q32", expectedValue: "medical_required" },
  { input: "She had a fracture and needed medical attention.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q32", expectedValue: "medical_required" },
  { input: "I have no prior criminal record  -  clean record.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q47", expectedValue: "none" },
  { input: "I have a prior assault conviction from 4 years ago.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q47", expectedValue: "prior_assault" },
  { input: "I have a history of violence that they will raise.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q47", expectedValue: "prior_assault" },
  // Negatives
  { input: "I blew over 80 and was charged with impaired driving.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: null },
  { input: "They found cocaine in my car during a search.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q31", expectedValue: null },
  { input: "I was caught shoplifting  -  the amount was under $200.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q32", expectedValue: null },
  { input: "My partner wants the charges dropped against me.", practiceArea: "crim", questionSetKey: "crim_assault", questionId: "crim_ass_q47", expectedValue: null },
];

// ─── CRIM  -  Drug ──────────────────────────────────────────────────────────────
// Registered: crim_drg_q2, crim_drg_q32, crim_drg_q47
export const CRIM_DRG_FIXTURES: Fixture[] = [
  { input: "They found cannabis in my car during the stop.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: "cannabis" },
  { input: "I was charged for possession of marijuana.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: "cannabis" },
  { input: "The substance found was cocaine.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: "cocaine" },
  { input: "I was charged with possession of fentanyl.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: "opioids" },
  { input: "They found MDMA and meth at the scene.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: "meth_mdma" },
  { input: "They searched my home without a warrant  -  no warrant was obtained.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q32", expectedValue: "no_warrant_no_consent" },
  { input: "The police had no warrant and I did not consent to the search.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q32", expectedValue: "no_warrant_no_consent" },
  { input: "They had a proper search warrant when they came to my house.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q32", expectedValue: "warrant" },
  { input: "I have no prior criminal record  -  first offence ever.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q47", expectedValue: "none" },
  { input: "I have a prior drug conviction from three years ago.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q47", expectedValue: "prior_trafficking" },
  { input: "I was previously convicted for trafficking cocaine.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q47", expectedValue: "prior_trafficking" },
  // Negatives
  { input: "I was charged with assault outside a bar.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: null },
  { input: "I blew over 80 at a RIDE check.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q32", expectedValue: null },
  { input: "I was caught shoplifting at a grocery store.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q47", expectedValue: null },
  { input: "My partner and I had a domestic dispute last night.", practiceArea: "crim", questionSetKey: "crim_drug", questionId: "crim_drg_q2", expectedValue: null },
];

// ─── CRIM  -  Theft ─────────────────────────────────────────────────────────────
// Registered: crim_tft_q2, crim_tft_q32, crim_tft_q47
export const CRIM_TFT_FIXTURES: Fixture[] = [
  { input: "The alleged stolen items were under $5,000 in value  -  theft under.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: "500_5k" },
  { input: "It was shoplifting  -  a small amount worth about $150.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: "500_5k" },
  { input: "The theft involved over $5,000 in equipment  -  theft over.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: "5k_50k" },
  { input: "It was a significant amount  -  over $10,000 total.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: "5k_50k" },
  { input: "I already paid it back in full  -  full repayment made.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q32", expectedValue: "full_repayment" },
  { input: "I paid it back fully  -  full repayment was made and I have receipts.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q32", expectedValue: "full_repayment" },
  { input: "I made partial payment  -  offered to pay the rest over time.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q32", expectedValue: "partial_repayment" },
  { input: "I have no prior criminal record at all  -  first time.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q47", expectedValue: "none" },
  { input: "I have a prior theft conviction from 2 years ago.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q47", expectedValue: "prior_theft" },
  { input: "I have a prior shoplifting conviction from a few years back.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q47", expectedValue: "prior_theft" },
  // Negatives
  { input: "I blew over the legal limit and was charged with impaired driving.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: null },
  { input: "I was caught with cocaine during a warrantless search.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q32", expectedValue: null },
  { input: "I was charged with domestic assault against my spouse.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q47", expectedValue: null },
  { input: "I was acting in self-defence when the fight started.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q2", expectedValue: null },
  { input: "She wants to drop the charges  -  not cooperating with Crown.", practiceArea: "crim", questionSetKey: "crim_theft", questionId: "crim_tft_q32", expectedValue: null },
];

// ─── CRIM  -  Domestic ─────────────────────────────────────────────────────────
// Registered: crim_dom_q2, crim_dom_q31, crim_dom_q46, crim_dom_q47
export const CRIM_DOM_FIXTURES: Fixture[] = [
  { input: "The alleged victim is my wife.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: "current_partner" },
  { input: "The complainant is my girlfriend  -  my current partner.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: "current_partner" },
  { input: "It involves my ex-wife  -  we have been separated for two years.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: "former_partner" },
  { input: "The complainant is my ex-boyfriend.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: "former_partner" },
  { input: "It was a dispute with my brother  -  a family member.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: "family" },
  { input: "The complainant doesn't want to proceed with the charge at all.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q31", expectedValue: "complainant_no_support" },
  { input: "He wants it withdrawn and is not supporting the charge.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q31", expectedValue: "complainant_no_support" },
  { input: "She is cooperating fully and pressing charges.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q31", expectedValue: "supports_charge" },
  { input: "No children were present  -  no kids were home at the time.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q46", expectedValue: "no_children" },
  { input: "The children witnessed the incident  -  they were in the room.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q46", expectedValue: "witnessed" },
  { input: "The kids saw and heard everything that happened.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q46", expectedValue: "witnessed" },
  { input: "I have no prior criminal record  -  this is a first offence.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q47", expectedValue: "none" },
  { input: "I have a prior domestic conviction from three years ago.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q47", expectedValue: "prior_conviction" },
  { input: "There is a history of domestic violence calls at this address.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q47", expectedValue: "prior_conviction" },
  // Negative
  { input: "I blew 0.09 on the breathalyzer at a RIDE stop.", practiceArea: "crim", questionSetKey: "crim_domestic", questionId: "crim_dom_q2", expectedValue: null },
];

// ─── IMM  -  Express Entry ──────────────────────────────────────────────────────
// Registered: imm_ee_q1, imm_ee_q2, imm_ee_q31, imm_ee_q46
export const IMM_EE_FIXTURES: Fixture[] = [
  { input: "I applied under the Canadian Experience Class  -  CEC.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q1", expectedValue: "cec" },
  { input: "I have Canadian work experience and want PR through CEC.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q1", expectedValue: "cec" },
  { input: "I am applying under the Federal Skilled Worker program.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q1", expectedValue: "fsw" },
  { input: "I received an Invitation to Apply from IRCC.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q2", expectedValue: "ita_received" },
  { input: "I got an invitation to apply through Express Entry.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q2", expectedValue: "ita_received" },
  { input: "I have an active Express Entry profile and am waiting for a draw.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q2", expectedValue: "profile_active" },
  { input: "My profile expired and I need to renew it.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q2", expectedValue: "expired" },
  { input: "I have IELTS scores  -  8.0 in all bands.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q31", expectedValue: "clb7_8" },
  { input: "My CELPIP test results are CLB 10.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q31", expectedValue: "clb7_8" },
  { input: "No test has been booked  -  I have not started any language assessment.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q31", expectedValue: "no_test" },
  { input: "I have a provincial nomination from Ontario.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q46", expectedValue: "has_nomination" },
  { input: "I received a PNP nomination from the province.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q46", expectedValue: "has_nomination" },
  { input: "I applied to a PNP stream and am waiting to hear back from the province.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q46", expectedValue: "pnp_applied" },
  // Negatives
  { input: "I want to sponsor my spouse from Jamaica.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q1", expectedValue: null },
  { input: "My study permit expired 60 days ago.", practiceArea: "imm", questionSetKey: "imm_ee", questionId: "imm_ee_q2", expectedValue: null },
];

// ─── IMM  -  Spousal Sponsorship ────────────────────────────────────────────────
// Registered: imm_spo_q1, imm_spo_q2, imm_spo_q17
export const IMM_SPO_FIXTURES: Fixture[] = [
  { input: "I am legally married  -  we have a marriage certificate.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: "married" },
  { input: "We got married last year in the Philippines.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: "married" },
  { input: "We are common-law  -  we have cohabited for 12 years continuously.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: "common_law" },
  { input: "We are applying inland  -  my spouse is already in Canada.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q2", expectedValue: "inland" },
  { input: "I am already in Canada and want to apply inland.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q2", expectedValue: "inland" },
  { input: "We are applying outland  -  applying from overseas.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q2", expectedValue: "outland" },
  { input: "My spouse's visa is expiring next month  -  status expiring soon.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q17", expectedValue: "status_expiring" },
  { input: "Her permit expires in 30 days  -  urgent.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q17", expectedValue: "status_expiring" },
  // Negatives
  { input: "I want to apply through the Express Entry CEC stream.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: null },
  { input: "I fear return to my country  -  Convention refugee claim.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: null },
  { input: "My daughter wants to study at the University of Toronto.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q2", expectedValue: null },
  { input: "My work permit expires in 2 months.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q17", expectedValue: null },
  { input: "I received an ITA from IRCC.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: null },
  { input: "I am applying through the OINP employer job offer stream.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q1", expectedValue: null },
  { input: "CBSA scheduled my removal for next week.", practiceArea: "imm", questionSetKey: "imm_spousal", questionId: "imm_spo_q17", expectedValue: null },
];

// ─── IMM  -  Study Permit ──────────────────────────────────────────────────────
// Registered: imm_stu_q1, imm_stu_q16, imm_stu_q32
export const IMM_STU_FIXTURES: Fixture[] = [
  { input: "I am applying for my PGWP after graduating from Ryerson.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: "pgwp" },
  { input: "I need my post-graduation work permit  -  finished my degree last spring.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: "pgwp" },
  { input: "I am extending my study permit  -  it expires in 3 months.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: "extension" },
  { input: "I need a study permit extension before it expires.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: "extension" },
  { input: "I need to restore my student status  -  my study permit has expired within 90 days.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: "restoration" },
  { input: "My study permit has expired  -  it just ran out.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q16", expectedValue: "expired_90_days" },
  { input: "My student permit expired last month.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q16", expectedValue: "expired_90_days" },
  { input: "I am still valid  -  applying before it expires.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q16", expectedValue: "not_expired" },
  { input: "I worked more than 20 hours during the semester.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q32", expectedValue: "unauthorized_work" },
  { input: "I exceeded the work limit  -  worked far too many hours each week.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q32", expectedValue: "unauthorized_work" },
  { input: "I complied with the 20-hour limit and never worked beyond what was allowed.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q32", expectedValue: "compliant_work" },
  // Negatives
  { input: "I want to sponsor my spouse who lives in Brazil.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: null },
  { input: "I received an Invitation to Apply through Express Entry.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q16", expectedValue: null },
  { input: "I crossed the US border and filed a refugee claim.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q32", expectedValue: null },
  { input: "My employer has a positive LMIA for my work permit.", practiceArea: "imm", questionSetKey: "imm_study", questionId: "imm_stu_q1", expectedValue: null },
];

// ─── IMM  -  Work Permit ────────────────────────────────────────────────────────
// Registered: imm_wp_q2, imm_wp_q17, imm_wp_q32, imm_wp_q47
export const IMM_WP_FIXTURES: Fixture[] = [
  { input: "My employer obtained a positive LMIA for my position.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_obtained" },
  { input: "The employer has a positive LMIA  -  already obtained.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_obtained" },
  { input: "I am LMIA-exempt  -  applying as an intracompany transferee.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_exempt" },
  { input: "I qualify under CUSMA  -  TN work permit.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_exempt" },
  { input: "I have an IEC working holiday visa  -  LMIA-exempt.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_exempt" },
  { input: "My employer needs to get a LMIA  -  LMIA is required.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: "lmia_needed" },
  { input: "The employer needs me to start immediately  -  very urgent.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q17", expectedValue: "urgent_start" },
  { input: "They need me to start right away within a week.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q17", expectedValue: "urgent_start" },
  { input: "I am in valid status  -  fully authorized and compliant.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q32", expectedValue: "valid_status" },
  { input: "I overstayed my permit and worked without authorization.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q32", expectedValue: "unauthorized" },
  { input: "I am building Canadian experience toward PR  -  Express Entry pathway.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q47", expectedValue: "pr_pathway" },
  { input: "My employer is sponsoring me for permanent residence.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q47", expectedValue: "employer_pr" },
  // Negatives
  { input: "I fear return to my country due to political persecution.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: null },
  { input: "I want to sponsor my wife who lives in the Philippines.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q47", expectedValue: null },
  { input: "My daughter wants to study at the University of Toronto.", practiceArea: "imm", questionSetKey: "imm_work_permit", questionId: "imm_wp_q2", expectedValue: null },
];

// ─── IMM  -  Refugee ────────────────────────────────────────────────────────────
// Registered: imm_ref_q2, imm_ref_q16, imm_ref_q17
export const IMM_REF_FIXTURES: Fixture[] = [
  { input: "I entered at the airport  -  flew into Pearson and filed there.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "official_port" },
  { input: "I arrived at the airport and filed my claim at the port of entry.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "official_port" },
  { input: "I made an irregular crossing  -  crossed between ports of entry.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "irregular" },
  { input: "I was already in Canada when I filed  -  inland claim.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "inland" },
  { input: "I crossed through the US at a land port  -  Roxham Road.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "us_land_port" },
  { input: "I crossed the US-Canada border at a US land crossing.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: "us_land_port" },
  { input: "My RPD hearing is imminent  -  within 14 days.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q16", expectedValue: "hearing_imminent" },
  { input: "My hearing is very soon  -  RPD hearing scheduled within 30 days.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q16", expectedValue: "hearing_imminent" },
  { input: "My RPD hearing date is confirmed.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q16", expectedValue: "hearing_scheduled" },
  { input: "The RPD denied my claim  -  I need to appeal.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q16", expectedValue: "post_rejection" },
  { input: "My refugee claim was rejected  -  facing removal.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q16", expectedValue: "post_rejection" },
  { input: "CBSA has scheduled my removal  -  deportation is imminent.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q17", expectedValue: "removal_imminent" },
  { input: "There is a removal order in place.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q17", expectedValue: "removal_order" },
  { input: "I have a stay of removal  -  removal has been stayed.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q17", expectedValue: "stay_of_removal" },
  // Negative
  { input: "I want to apply to the OINP provincial nominee program.", practiceArea: "imm", questionSetKey: "imm_refugee", questionId: "imm_ref_q2", expectedValue: null },
];

// ─── IMM  -  PNP ────────────────────────────────────────────────────────────────
// Registered: imm_pnp_q1, imm_pnp_q16, imm_pnp_q31, imm_pnp_q32
export const IMM_PNP_FIXTURES: Fixture[] = [
  { input: "I want to apply through the OINP  -  Ontario's provincial nominee program.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q1", expectedValue: "ontario" },
  { input: "Ontario Immigrant Nominee Program  -  that is what I am interested in.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q1", expectedValue: "ontario" },
  { input: "I am interested in the BC PNP  -  British Columbia nominee.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q1", expectedValue: "bc" },
  { input: "I want to apply through the Alberta Immigrant Nominee Program.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q1", expectedValue: "alberta" },
  { input: "I received my provincial nomination certificate.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q16", expectedValue: "nominated" },
  { input: "I received my nomination from the province last month.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q16", expectedValue: "nominated" },
  { input: "I have a qualifying job offer from a local Ontario employer.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q31", expectedValue: "qualifying_offer" },
  { input: "I have a valid PNP job offer that meets the requirements.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q31", expectedValue: "qualifying_offer" },
  { input: "I have no job offer  -  applying through Human Capital stream.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q31", expectedValue: "no_offer" },
  { input: "I worked in Ontario over 2 years on a valid work permit.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q32", expectedValue: "work_experience" },
  { input: "I graduated from a Canadian university in Ontario.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q32", expectedValue: "education_in_province" },
  { input: "I graduated from a Canadian school in BC.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q32", expectedValue: "education_in_province" },
  // Negatives
  { input: "I want to sponsor my wife who lives in Jamaica.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q1", expectedValue: null },
  { input: "I received an ITA from Express Entry.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q16", expectedValue: null },
  { input: "My RPD hearing is scheduled for next month.", practiceArea: "imm", questionSetKey: "imm_pnp", questionId: "imm_pnp_q31", expectedValue: null },
];

// ─── CIV  -  Contract ──────────────────────────────────────────────────────────
// Registered: civ_con_q2, civ_con_q16, civ_con_q17, civ_con_q32, civ_con_q47
export const CIV_CON_FIXTURES: Fixture[] = [
  { input: "They breached the contract with me  -  I wasn't paid.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q2", expectedValue: "plaintiff" },
  { input: "They owe me money  -  they failed to pay under the contract.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q2", expectedValue: "plaintiff" },
  { input: "They're suing me for breach of contract  -  I'm the defendant.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q2", expectedValue: "defendant" },
  { input: "I'm being sued by a former client for breach of our agreement.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q2", expectedValue: "defendant" },
  { input: "The breach occurred about 8 months ago  -  within the last two years.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q16", expectedValue: "within_2_years" },
  { input: "This happened more than two years ago  -  past the limitation period.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q16", expectedValue: "over_2_years" },
  { input: "I sent a demand letter to them two weeks ago.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q17", expectedValue: "sent" },
  { input: "I received a demand letter from their lawyer yesterday.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q17", expectedValue: "received" },
  { input: "No demand letter has been sent yet  -  nothing formal.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q17", expectedValue: "none" },
  { input: "My claim is $22,000  -  Small Claims Court territory.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q32", expectedValue: "small_claims" },
  { input: "The total damages are $80,000  -  this must go to Superior Court.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q32", expectedValue: "superior_court" },
  { input: "The contract contains a mandatory arbitration clause.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q47", expectedValue: "yes" },
  { input: "We can go straight to court  -  no dispute resolution requirements apply.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q47", expectedValue: "no" },
  // Negatives
  { input: "My insurer denied my disability claim.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q2", expectedValue: null },
  { input: "Someone posted a defamatory review about me online.", practiceArea: "civ", questionSetKey: "civ_contract", questionId: "civ_con_q47", expectedValue: null },
];

// ─── CIV  -  Debt ──────────────────────────────────────────────────────────────
// Registered: civ_dbt_q2, civ_dbt_q16, civ_dbt_q31, civ_dbt_q47
export const CIV_DBT_FIXTURES: Fixture[] = [
  { input: "I have a signed promissory note as evidence of the loan.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q2", expectedValue: "written" },
  { input: "There is a formal written contract  -  signed agreement documenting the debt.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q2", expectedValue: "written" },
  { input: "It was a verbal agreement  -  nothing was put in writing.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q2", expectedValue: "verbal_only" },
  { input: "We had an oral agreement only  -  nothing was ever put in writing.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q2", expectedValue: "verbal_only" },
  { input: "The debt became due about 10 months ago  -  within 2 years.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q16", expectedValue: "within_2_years" },
  { input: "The debt was due more than two years ago  -  long overdue.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q16", expectedValue: "over_2_years" },
  { input: "They made a partial payment last month and acknowledged the debt.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q31", expectedValue: "acknowledged" },
  { input: "They promised to pay by the end of the month.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q31", expectedValue: "acknowledged" },
  { input: "They denied the debt  -  refuse to acknowledge owing me anything.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q31", expectedValue: "denied" },
  { input: "The debtor is a private individual  -  not a company.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q47", expectedValue: "individual" },
  { input: "The debtor is an incorporated company  -  a corporation.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q47", expectedValue: "corporation" },
  { input: "The company is a Ltd. that owes me money.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q47", expectedValue: "corporation" },
  // Negatives
  { input: "They breached the service contract and I want damages.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q2", expectedValue: null },
  { input: "Someone defamed me on social media.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q31", expectedValue: null },
  { input: "My lawyer committed malpractice and I lost my case.", practiceArea: "civ", questionSetKey: "civ_debt", questionId: "civ_dbt_q47", expectedValue: null },
];

// ─── CIV  -  Tort ──────────────────────────────────────────────────────────────
// Registered: civ_trt_q1, civ_trt_q2, civ_trt_q16, civ_trt_q17, civ_trt_q32, civ_trt_q46
export const CIV_TRT_FIXTURES: Fixture[] = [
  { input: "They posted a defamatory statement about me online.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q1", expectedValue: "defamation" },
  { input: "The libel has damaged my professional reputation.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q1", expectedValue: "defamation" },
  { input: "I was deceived through a fraudulent misrepresentation.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q1", expectedValue: "fraud" },
  { input: "They wrongfully took my property  -  conversion.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q1", expectedValue: "conversion" },
  { input: "They came onto my land without permission and refused to leave.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q1", expectedValue: "trespass" },
  { input: "They wronged me  -  I am the plaintiff bringing the claim.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q2", expectedValue: "plaintiff" },
  { input: "They're suing me for defamation  -  I'm the defendant.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q2", expectedValue: "defendant" },
  { input: "This happened about 14 months ago  -  within 2 years.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q16", expectedValue: "within_2_years" },
  { input: "The defamatory post was on their Facebook page.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q17", expectedValue: "social_media" },
  { input: "It was posted on Instagram  -  a social media post.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q17", expectedValue: "social_media" },
  { input: "The fake review is on Google Reviews.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q17", expectedValue: "online_review" },
  { input: "They verbally said it at a community meeting in front of witnesses.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q17", expectedValue: "verbal" },
  { input: "The statement is completely false  -  truth is no defence here.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q32", expectedValue: "none" },
  { input: "The post is still online  -  still published and visible.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q46", expectedValue: "still_published" },
  { input: "They retracted the post and apologized publicly after I complained.", practiceArea: "civ", questionSetKey: "civ_tort", questionId: "civ_trt_q46", expectedValue: "retracted" },
];

// ─── CIV  -  Negligence ────────────────────────────────────────────────────────
// Registered: civ_neg_q1, civ_neg_q2, civ_neg_q16, civ_neg_q46, civ_neg_q47
export const CIV_NEG_FIXTURES: Fixture[] = [
  { input: "My lawyer committed professional negligence and I lost my case.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: "professional" },
  { input: "Accountant negligence  -  errors on my returns triggered a CRA audit.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: "professional" },
  { input: "The contractor did bad renovation work that caused water damage.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: "contractor" },
  { input: "A defective product I purchased caused a fire.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: "product" },
  { input: "I slipped on the occupier's icy steps  -  occupier's liability.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: "occupier" },
  { input: "The negligent party is a licensed lawyer.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q2", expectedValue: "licensed_professional" },
  { input: "It was a licensed CPA who made the error on my tax return.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q2", expectedValue: "licensed_professional" },
  { input: "It was a general contractor who did the work.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q2", expectedValue: "contractor_tradesperson" },
  { input: "I discovered the problem about 6 months ago  -  within 2 years.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q16", expectedValue: "within_2_years" },
  { input: "I found out about this more than two years ago.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q16", expectedValue: "over_2_years" },
  { input: "The negligence is completely their fault  -  pure negligence by them.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q46", expectedValue: "none" },
  { input: "I may have contributed to the problem  -  contributory negligence.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q46", expectedValue: "contributory" },
  { input: "The lawyer has E&O insurance  -  professional liability coverage is mandatory.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q47", expectedValue: "yes" },
  { input: "The contractor has no insurance that I know of  -  don't think they're insured.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q47", expectedValue: "unknown" },
  // Negative
  { input: "They defrauded me by making false representations.", practiceArea: "civ", questionSetKey: "civ_negligence", questionId: "civ_neg_q1", expectedValue: null },
];

// ─── INS  -  SABS ──────────────────────────────────────────────────────────────
// Registered: ins_sab_q1, ins_sab_q2, ins_sab_q17, ins_sab_q47
export const INS_SABS_FIXTURES: Fixture[] = [
  { input: "My insurer cut off my income replacement benefit  -  IRB stopped.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q1", expectedValue: "irb" },
  { input: "They denied my OCF-18 for medical and rehabilitation benefits.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q1", expectedValue: "med_rehab" },
  { input: "My attendant care benefit was cut off without explanation.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q1", expectedValue: "attendant_care" },
  { input: "I received a formal denial letter from Intact.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q2", expectedValue: "yes_formal" },
  { input: "I received a formal denial letter from the insurer last week.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q2", expectedValue: "yes_formal" },
  { input: "Benefits just stopped being paid  -  no letter, no notice, no explanation.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q2", expectedValue: "stopped_no_notice" },
  { input: "I filed a DAR application with FSRA three months ago.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q17", expectedValue: "dar_pending" },
  { input: "Applied to FSRA for mediation  -  dispute resolution pending.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q17", expectedValue: "dar_pending" },
  { input: "No dispute resolution started yet  -  nothing filed.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q17", expectedValue: "none" },
  { input: "The mediation failed and I need to proceed to FSRA arbitration.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q17", expectedValue: "post_mediation" },
  { input: "I am also suing the at-fault driver in a separate tort action.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q47", expectedValue: "yes_tort" },
  { input: "This is a SABS dispute only  -  no tort claim against the driver.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q47", expectedValue: "sabs_only" },
  { input: "SABS only  -  just dealing with my own insurer, not suing the driver.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q47", expectedValue: "sabs_only" },
  // Negatives
  { input: "My LTD claim was denied because of a pre-existing condition.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q1", expectedValue: null },
  { input: "They denied my home insurance claim for water damage.", practiceArea: "ins", questionSetKey: "ins_sabs", questionId: "ins_sab_q2", expectedValue: null },
];

// ─── INS  -  Benefit Denial ─────────────────────────────────────────────────────
// Registered: ins_den_q1, ins_den_q2, ins_den_q16, ins_den_q32
export const INS_DEN_FIXTURES: Fixture[] = [
  { input: "My long-term disability claim was denied  -  I cannot work due to depression.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "disability" },
  { input: "They cut off my long-term disability after two years with no warning.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "disability" },
  { input: "My spouse died and I filed a life insurance claim that was denied.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "life" },
  { input: "My home insurance denied my fire damage claim entirely.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "property" },
  { input: "The travel insurance denied my medical emergency claim abroad.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "travel" },
  { input: "My critical illness benefit claim was denied.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: "health_ci" },
  { input: "I received a formal denial letter giving their reason.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q2", expectedValue: "formal_denial" },
  { input: "They verbally denied the claim  -  nothing in writing.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q2", expectedValue: "verbal_denial" },
  { input: "They just stopped paying with no written explanation.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q2", expectedValue: "stopped_paying" },
  { input: "The internal appeal was denied  -  I have tried their internal process.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q16", expectedValue: "appeals_exhausted" },
  { input: "I have not yet appealed  -  haven't tried any internal process.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q16", expectedValue: "not_appealed" },
  { input: "The policy was active and all premiums were fully paid up.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q32", expectedValue: "policy_active" },
  { input: "Coverage was in force at the time  -  policy was current.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q32", expectedValue: "policy_active" },
  // Negatives
  { input: "My insurer cut off my SABS income replacement benefit.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q1", expectedValue: null },
  { input: "The insurer acted in bad faith  -  18 months of unexplained delay.", practiceArea: "ins", questionSetKey: "ins_denial", questionId: "ins_den_q2", expectedValue: null },
];

// ─── INS  -  Bad Faith ─────────────────────────────────────────────────────────
// Registered: ins_bf_q2, ins_bf_q17, ins_bf_q32
export const INS_BF_FIXTURES: Fixture[] = [
  { input: "The insurer delayed my claim for 18 months with no reasonable justification.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "delay" },
  { input: "They took forever  -  unreasonable delay in paying my valid claim.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "delay" },
  { input: "They wrongfully denied my claim despite knowing it was covered.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "wrongful_denial" },
  { input: "They offered me $12,000 on a $200,000 claim  -  a lowball offer.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "lowball_offer" },
  { input: "The settlement offer was too low  -  inadequate given the actual losses.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "lowball_offer" },
  { input: "They refused to defend me in the liability claim  -  failure to defend.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: "failure_to_defend" },
  { input: "The insurer still hasn't paid  -  still refusing to this day.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q17", expectedValue: "unpaid" },
  { input: "They finally paid after a long delay  -  seeking damages for that delay.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q17", expectedValue: "paid_late" },
  { input: "They paid part of the claim only  -  seeking the balance plus bad faith damages.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q17", expectedValue: "partial_payment" },
  { input: "I lost my home because they withheld the insurance payout.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q32", expectedValue: "consequential_losses" },
  { input: "I defaulted on the mortgage because the insurer withheld payment.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q32", expectedValue: "consequential_losses" },
  { input: "The loss is primarily the benefit itself  -  no other consequential damages.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q32", expectedValue: "benefit_only" },
  // Negatives
  { input: "My LTD claim was denied because of a pre-existing condition exclusion.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q2", expectedValue: null },
  { input: "My SABS income replacement benefit was cut off after 2 years.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q17", expectedValue: null },
  { input: "My travel insurance claim was denied for a pre-existing condition.", practiceArea: "ins", questionSetKey: "ins_bad_faith", questionId: "ins_bf_q32", expectedValue: null },
];

// ─── Flat export ─────────────────────────────────────────────────────────────
export const ALL_FIXTURES: Fixture[] = [
  ...PI_MVA_FIXTURES,
  ...PI_SF_FIXTURES,
  ...PI_DB_FIXTURES,
  ...PI_MM_FIXTURES,
  ...EMP_DIS_FIXTURES,
  ...EMP_HAR_FIXTURES,
  ...EMP_CON_FIXTURES,
  ...FAM_DIV_FIXTURES,
  ...FAM_CUS_FIXTURES,
  ...FAM_SUP_FIXTURES,
  ...FAM_PRO_FIXTURES,
  ...FAM_PRT_FIXTURES,
  ...CRIM_DUI_FIXTURES,
  ...CRIM_ASS_FIXTURES,
  ...CRIM_DRG_FIXTURES,
  ...CRIM_TFT_FIXTURES,
  ...CRIM_DOM_FIXTURES,
  ...IMM_EE_FIXTURES,
  ...IMM_SPO_FIXTURES,
  ...IMM_STU_FIXTURES,
  ...IMM_WP_FIXTURES,
  ...IMM_REF_FIXTURES,
  ...IMM_PNP_FIXTURES,
  ...CIV_CON_FIXTURES,
  ...CIV_DBT_FIXTURES,
  ...CIV_TRT_FIXTURES,
  ...CIV_NEG_FIXTURES,
  ...INS_SABS_FIXTURES,
  ...INS_DEN_FIXTURES,
  ...INS_BF_FIXTURES,
];
