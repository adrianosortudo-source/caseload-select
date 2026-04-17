/**
 * Shared scenario data for the guided demo system.
 * Imported by DemoLandingPage, DemoScenarioPicker, and DemoTour.
 */

export const DEMO_SCENARIOS = [
  {
    id: "pi_strong",
    label: "Strong case",
    pa: "Personal injury",
    band: "A" as const,
    bandStyle: "bg-emerald-100 text-emerald-700",
    outcome: "Band A — priority routing + Case Intake Memo",
    message:
      "I was in a car accident on the 401 three weeks ago. The other driver ran a red light. I'm still getting treatment for a back injury and missed three weeks of work.",
  },
  {
    id: "emp_mid",
    label: "Borderline case",
    pa: "Employment dispute",
    band: "C" as const,
    bandStyle: "bg-amber-100 text-amber-700",
    outcome: "Band C — qualified, nurture sequence",
    message:
      "My employer terminated me last Friday. I was there for 4 years. They gave me 2 weeks severance and said it was restructuring.",
  },
  {
    id: "small_claims",
    label: "Outside scope",
    pa: "Small claims",
    band: "E" as const,
    bandStyle: "bg-gray-100 text-gray-500",
    outcome: "Band E — filtered. Zero lawyer time.",
    message:
      "I want to sue my contractor for $8,000. He didn't finish the job and won't return my calls.",
  },
] as const;

export type ScenarioId = (typeof DEMO_SCENARIOS)[number]["id"];
