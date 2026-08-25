/**
 * Why Your Firm · Runtime configuration
 *
 * One flag: how step 5 presents the gate. Both modes are fully built and
 * QA'd; this constant is the only thing that changes between them. Flip it,
 * redeploy, nothing else in the code needs to change.
 *
 * gate_before_brief   The email gate renders before any result content.
 *                      Firm name, first name and email are collected first;
 *                      the profile, statement and full brief unlock together
 *                      once the report call returns.
 *
 * teaser_then_gate     The profile name and positioning statement render
 *                      ungated in the first viewport, already earned by the
 *                      five steps behind them. The gate then unlocks the full
 *                      brief (proof mapping, dropped claims, surfaces, the
 *                      PDF by email).
 *
 * Built and developed against teaser_then_gate. Adriano picks the shipping
 * mode at the ship gate from side-by-side screenshots of both.
 */
export type GateMode = "gate_before_brief" | "teaser_then_gate";

export const GATE_MODE: GateMode = "teaser_then_gate";
