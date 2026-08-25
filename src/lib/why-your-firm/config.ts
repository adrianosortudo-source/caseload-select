/**
 * Why Your Firm · Runtime configuration
 *
 * One flag: how step 5 presents the results. Flip it, redeploy, nothing
 * else in the code needs to change.
 *
 * no_gate              No email gate at all. The full brief renders the
 *                      moment step 5 is reached; nothing is collected and
 *                      no server call is made. This is the SHIPPING mode,
 *                      decided by Adriano at the ship gate 2026-08-24: the
 *                      tool serves existing clients as a working input to
 *                      their ACTS build, not the public as a lead magnet.
 *                      If it ever goes public on the website, one of the
 *                      gated modes below comes back on.
 *
 * gate_before_brief    The email gate renders before any result content.
 *                      First name, firm name and email are collected first;
 *                      the profile, statement and full brief unlock together
 *                      once the report call returns.
 *
 * teaser_then_gate     The profile name and positioning statement render
 *                      ungated in the first viewport, already earned by the
 *                      five steps behind them. The gate then unlocks the
 *                      full brief and the emailed copy.
 *
 * Both gated modes are fully built and were QA'd end to end before the
 * no-gate decision; they stay dormant here, not deleted, precisely so the
 * future public launch is a one-line flip plus a copy review.
 */
export type GateMode = "no_gate" | "gate_before_brief" | "teaser_then_gate";

export const GATE_MODE: GateMode = "no_gate";
