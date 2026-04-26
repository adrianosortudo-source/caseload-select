/**
 * Shared scenario data for the guided demo system.
 * Imported by DemoLandingPage, DemoScenarioPicker, and DemoTour.
 *
 * Each scenario exercises a specific event pipeline path so every sub-type
 * routing branch can be tested end-to-end from the demo widget.
 *
 * Event coverage:
 *   pi_strong      mva          → pi_mva bank, time resolved, fault known
 *   slip_fall      slip_fall    → pi_slip_fall bank (the original Walmart routing fix)
 *   emp_dismissal  termination  → emp_dismissal bank, borderline band
 *   emp_wage       unpaid_overtime → emp_wage bank, duration (not trigger)
 *   imm_spousal    marriage_to_citizen → imm_spousal bank, REQUIRES_TIME=false
 *   small_claims   (no event)   → Band E filtered, no event pipeline fires
 */

export const DEMO_SCENARIOS = [
  {
    id: "pi_strong",
    label: "Motor vehicle accident",
    pa: "Personal injury",
    band: "A" as const,
    bandStyle: "bg-emerald-100 text-emerald-700",
    outcome: "Band A  -  priority routing + Case Intake Memo",
    message:
      "I was in a car accident on the 401 three weeks ago. The other driver ran a red light. I'm still getting treatment for a back injury and missed three weeks of work.",
  },
  {
    id: "slip_fall",
    label: "Slip and fall",
    pa: "Personal injury",
    band: "B" as const,
    bandStyle: "bg-blue-100 text-blue-700",
    outcome: "Band B  -  pi_slip_fall routing, not MVA questions",
    message:
      "I slipped at a grocery store two weeks ago and hurt my knee badly. There was a spill on the floor and no warning sign. I went to the ER that same day.",
  },
  {
    id: "emp_dismissal",
    label: "Wrongful dismissal",
    pa: "Employment law",
    band: "C" as const,
    bandStyle: "bg-amber-100 text-amber-700",
    outcome: "Band C  -  emp_dismissal routing, nurture sequence",
    message:
      "My employer terminated me last Friday. I was there for 4 years. They gave me 2 weeks severance and said it was restructuring.",
  },
  {
    id: "emp_wage",
    label: "Unpaid overtime",
    pa: "Employment law",
    band: "B" as const,
    bandStyle: "bg-blue-100 text-blue-700",
    outcome: "Band B  -  emp_wage routing, employment status gap",
    message:
      "My employer hasn't paid me overtime for the past 8 months even though I work 55-hour weeks. I have records of all my hours.",
  },
  {
    id: "imm_spousal",
    label: "Spousal sponsorship",
    pa: "Immigration",
    band: "B" as const,
    bandStyle: "bg-blue-100 text-blue-700",
    outcome: "Band B  -  imm_spousal routing, status gap",
    message:
      "I am marrying a Canadian citizen next month and we want to apply for spousal sponsorship so I can stay in Canada.",
  },
  {
    id: "small_claims",
    label: "Outside scope",
    pa: "Small claims",
    band: "E" as const,
    bandStyle: "bg-gray-100 text-gray-500",
    outcome: "Band E  -  filtered. Zero lawyer time.",
    message:
      "I want to sue my contractor for $8,000. He didn't finish the job and won't return my calls.",
  },
] as const;

export type ScenarioId = (typeof DEMO_SCENARIOS)[number]["id"];
