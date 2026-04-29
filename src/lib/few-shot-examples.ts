/**
 * few-shot-examples.ts  -  KB-23 Lesson 06
 *
 * Per-practice-area labelled examples injected into the system prompt so the
 * model has concrete band/score/reasoning anchors rather than scoring drift
 * across prompts. The corpus identified this as the single biggest accuracy
 * lever for any qualification engine.
 *
 * Authoring rules:
 *  - 2 to 3 examples per practice area minimum
 *  - Cover at least one Band A and one Band E example to span the range
 *  - Anonymize all PII (no real names, no real specifics that could reveal a client)
 *  - Reasoning string follows the same contract as the live prompt: 2-4 sentences,
 *    references the stated facts, never generic
 *  - Update quarterly as model behaviour shifts
 *
 * Wired in at: src/lib/screen-prompt.ts via fewShotExamplesFor(pa).
 */

export interface FewShotExample {
  /** First user message that kicks off the session. */
  message: string;
  /** Expected band the engine should produce for this kickoff. */
  expected_band: "A" | "B" | "C" | "D" | "E";
  /** Expected reasoning sentence  -  the contract for what the model should produce. */
  reasoning: string;
  /** Optional follow-up label so authors remember why this example matters. */
  why_it_matters?: string;
}

export const FEW_SHOT_EXAMPLES: Record<string, FewShotExample[]> = {
  // ── Personal Injury ──
  pi: [
    {
      message:
        "I was rear-ended by a commercial truck on the 401 last Tuesday. I'm still in physiotherapy and haven't been able to return to work. The truck driver was clearly at fault per the police report.",
      expected_band: "A",
      reasoning:
        "Band A. Recent MVA with commercial defendant, clear liability documented in police report, ongoing treatment with documented work loss. Statute of limitations is not a factor. Strong fit, high value, urgent.",
      why_it_matters: "Anchors hot PI: clear liability + commercial defendant + active treatment.",
    },
    {
      message:
        "I slipped and fell at a grocery store about 8 months ago. I had some bruising but it healed on its own. I never saw a doctor.",
      expected_band: "D",
      reasoning:
        "Band D. Slip and fall with no medical record, self-resolved injuries, 8 months elapsed. No documentation of fault, no treatment, no quantifiable loss. Limitations period still open but evidence trail is thin.",
      why_it_matters: "Anchors weak PI: no treatment, no documentation, time elapsed.",
    },
  ],

  // ── Employment Law ──
  emp: [
    {
      message:
        "I was terminated without cause after 12 years. I was making $180,000 a year as a Senior Director. They offered 8 weeks severance and I have not signed anything.",
      expected_band: "A",
      reasoning:
        "Band A. Without-cause termination, 12 years tenure, executive compensation tier, severance offered but unsigned (not yet released). Bardal factors point to substantial entitlement. Active matter, high value, time-sensitive (sign window).",
      why_it_matters: "Anchors hot wrongful dismissal: tenure + comp + unsigned severance.",
    },
    {
      message:
        "I had a disagreement with my manager last week and I'm wondering if I have a case. I'm still employed.",
      expected_band: "D",
      reasoning:
        "Band D. Still employed, single disagreement, no termination, no protected ground stated, no formal complaint filed. No actionable employment claim on the facts as stated.",
      why_it_matters: "Anchors low-fit emp inquiry: still employed + no specific harm.",
    },
  ],

  // ── Family Law ──
  fam: [
    {
      message:
        "My ex-spouse just took our two children out of the country without telling me. I have a custody order. I need help today.",
      expected_band: "A",
      reasoning:
        "Band A. Existing custody order breached by international removal of children. Hague Convention timeline applies (urgent). Active emergency family matter, clear procedural path, high stakes.",
      why_it_matters: "Anchors urgent family: child abduction + existing order + Hague timeline.",
    },
    {
      message:
        "We've been together for 3 years and we're thinking about whether to get a cohabitation agreement. No rush.",
      expected_band: "C",
      reasoning:
        "Band C. Forward-planning cohabitation agreement, no dispute, no urgency. Standard family law work, modest fee, no complexity flags.",
      why_it_matters: "Anchors mid-band planning work: legitimate need, no urgency.",
    },
  ],

  // ── Corporate / Commercial ──
  corp: [
    {
      message:
        "My business partner is using company money without telling me. I'm a 50/50 shareholder. I just got the bank statements and I can see at least $200,000 has gone to personal expenses over the last year.",
      expected_band: "A",
      reasoning:
        "Band A. Equal shareholder, documented misappropriation of $200k, fresh discovery, business operating. Multiple remedies available (oppression, derivative claim, buy-out). Urgency driven by ongoing dissipation.",
      why_it_matters: "Anchors hot shareholder dispute: 50/50 + documented theft + fresh discovery.",
    },
    {
      message: "I'm thinking about starting a side hustle and might need to incorporate eventually.",
      expected_band: "E",
      reasoning:
        "Band E. Aspirational inquiry, no operating business, no urgency, no specific transaction. Insufficient signal for retainer-grade engagement.",
      why_it_matters: "Anchors out-of-scope corp: no entity, no transaction, no clock.",
    },
  ],

  // ── Civil Litigation (defendant or plaintiff) ──
  civ: [
    {
      message:
        "I've been served with a Statement of Claim for $400,000. I have 20 days to respond. The claim is about a contract I signed in 2023.",
      expected_band: "A",
      reasoning:
        "Band A. Active litigation with hard procedural deadline (20 days to defend), substantial quantum, contract dispute. Default judgment risk if not addressed. Time-sensitive defence retainer.",
      why_it_matters: "Anchors urgent civ defence: served + clock + quantum.",
    },
    {
      message: "Someone owes me $800 from a bet two years ago. Can I sue them?",
      expected_band: "D",
      reasoning:
        "Band D. Small Claims jurisdiction at best, two-year limitation period likely engaged or close to it, fee economics do not justify a retainer. Refer to self-help small claims resources.",
      why_it_matters: "Anchors fee-floor reject: tiny quantum, near-limitations, wrong forum.",
    },
  ],

  // ── Immigration ──
  imm: [
    {
      message:
        "I just received a removal order. My RAD appeal deadline is in 5 days. I have a Canadian-citizen child.",
      expected_band: "A",
      reasoning:
        "Band A. RAD appeal with hard 5-day deadline, removal order in force, Canadian-citizen child creates H&C considerations. Maximum urgency, complex matter, H&C/judicial review pathways.",
      why_it_matters: "Anchors urgent immigration: RAD deadline + removal order + H&C facts.",
    },
    {
      message: "I'm thinking about applying for permanent residence under Express Entry next year.",
      expected_band: "C",
      reasoning:
        "Band C. Forward-planning Express Entry inquiry, no application filed, no immediate procedural step. Routine PR work, modest urgency, no risk events stated.",
      why_it_matters: "Anchors planning-stage immigration: legitimate but not urgent.",
    },
  ],
};

/**
 * Render the few-shot block for a given practice area into prompt text.
 * Returns empty string when the PA has no examples authored yet  -  the
 * prompt then runs without anchors for that PA, same as before this module
 * existed (pure additive, never regressive).
 */
export function fewShotExamplesFor(practiceArea: string | null | undefined): string {
  if (!practiceArea) return "";
  const examples = FEW_SHOT_EXAMPLES[practiceArea.toLowerCase()];
  if (!examples || examples.length === 0) return "";
  const blocks = examples.map((ex, i) => {
    return [
      `Example ${i + 1}:`,
      `  client_message: "${ex.message.replace(/"/g, '\\"')}"`,
      `  expected_band: "${ex.expected_band}"`,
      `  reasoning: "${ex.reasoning.replace(/"/g, '\\"')}"`,
    ].join("\n");
  }).join("\n\n");
  return `\n\n<few_shot_examples>\nThese are anchored examples for ${practiceArea.toUpperCase()} matters. Match the form of the reasoning string and the band calibration shown here. Do not copy text verbatim  -  the live session has different facts. Use these only as calibration.\n\n${blocks}\n</few_shot_examples>\n`;
}
