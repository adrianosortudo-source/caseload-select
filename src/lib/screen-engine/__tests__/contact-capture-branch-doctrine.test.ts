/**
 * Regression guard for the contact-capture branch in `getNextStep`
 * (control.ts), locked 2026-06-08.
 *
 * The branch must mirror the contact-doctrine gate (DR-038, `evaluateContactGate`):
 * a complete lead is `client_name` AND (`client_phone` OR `client_email`).
 *
 * The pre-fix version of this block demanded ALL THREE of name/phone/email
 * and returned `type: 'capture_contact'` whenever any was missing. On
 * non-web channels that pre-fill a subset of contact from sender metadata
 * (WhatsApp = name+phone; Messenger/IG = name only; voice = phone only),
 * the resume turn dropped into `capture_contact`. The channel processor's
 * Phase C does not treat `capture_contact` as ask-another, so the engine
 * fell through to finalize after a single discovery question, producing
 * thin 1-question briefs on what should be multi-turn intake.
 *
 * Field-detected 2026-06-08 on Adriano's DRG WhatsApp smoke test:
 * "I have a contract dispute" resulted in ONE qualifying question
 * (`written_terms`), the lead replied, and the bot immediately closed
 * with "a lawyer is reviewing your matter."
 */
import { describe, it, expect } from "vitest";
import { initialiseState } from "../extractor";
import { getNextStep } from "../control";
import type { EngineState, MatterType, Channel } from "../types";

function buildState(opts: {
  matter_type: MatterType;
  channel: Channel;
  slots: Record<string, string>;
  contactCaptureStarted: boolean;
  insightShown?: boolean;
}): EngineState {
  const base = initialiseState("seed text");
  return {
    ...base,
    matter_type: opts.matter_type,
    channel: opts.channel,
    slots: { ...base.slots, ...opts.slots },
    slot_meta: {
      ...base.slot_meta,
      ...Object.fromEntries(
        Object.keys(opts.slots).map((k) => [
          k,
          { source: "answered", confidence: 1.0 },
        ]),
      ),
    },
    contactCaptureStarted: opts.contactCaptureStarted,
    insightShown: opts.insightShown ?? false,
  };
}

describe("getNextStep contact-capture branch matches DR-038 doctrine", () => {
  it("WhatsApp resume with name + phone (no email) does NOT capture_contact", () => {
    // Reproduces the field bug: Adriano's "I have a contract dispute"
    // WhatsApp test. After turn 1 the processor persists
    // contactCaptureStarted=true; on turn 2, the engine must keep asking
    // discovery questions, not bail to capture_contact for email.
    const state = buildState({
      matter_type: "contract_dispute" as MatterType,
      channel: "whatsapp" as Channel,
      slots: {
        client_name: "Adriano",
        client_phone: "+16475492106",
        // client_email intentionally absent: WhatsApp does not seed it.
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);

    expect(next.type).not.toBe("capture_contact");
    expect(next.type).not.toBe("stop");
    expect(["continue", "deepen", "recover"]).toContain(next.type);
    expect("slot" in next && next.slot).toBeDefined();
  });

  it("Voice resume with phone only (no name, no email) DOES capture_contact for name", () => {
    // Voice pre-fills caller-ID phone but not name. The doctrine demands
    // name; the branch must surface that.
    const state = buildState({
      matter_type: "wrongful_dismissal" as MatterType,
      channel: "voice" as Channel,
      slots: {
        client_phone: "+16475492106",
        // no name, no email
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);

    expect(next.type).toBe("capture_contact");
    expect("slot" in next && next.slot?.id).toBe("client_name");
  });

  it("Messenger resume with name only (no phone, no email) DOES capture_contact for reachable", () => {
    // Messenger/IG seed name from sender profile but NOT phone or email.
    // The doctrine demands a reachable channel; surface that.
    const state = buildState({
      matter_type: "wrongful_dismissal" as MatterType,
      channel: "facebook" as Channel,
      slots: {
        client_name: "Sarah Patel",
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);

    expect(next.type).toBe("capture_contact");
    // The branch surfaces the email slot when reachable is missing.
    // Phone is also acceptable; either fills the doctrine gate.
    expect("slot" in next && next.slot?.id).toBe("client_email");
  });

  it("Web at terminal state (all three filled) returns stop", () => {
    // Locks in the original web behavior: the SPA's contact form was the
    // terminal step; getNextStep returns stop so the done page renders.
    const state = buildState({
      matter_type: "wrongful_dismissal" as MatterType,
      channel: "web" as Channel,
      slots: {
        client_name: "Adriano",
        client_phone: "+16475492106",
        client_email: "adriano@example.com",
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);

    expect(next.type).toBe("stop");
  });

  it("WhatsApp at name+phone (no email) does NOT stop, falls through to discovery", () => {
    // Counterpart to the web stop case: on non-web channels, name +
    // reachable is doctrine-satisfied AND we want to keep asking
    // discovery questions while the channel budget allows. The branch
    // must fall through, not stop.
    const state = buildState({
      matter_type: "wrongful_dismissal" as MatterType,
      channel: "whatsapp" as Channel,
      slots: {
        client_name: "Adriano",
        client_phone: "+16475492106",
        // no email
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);

    expect(next.type).not.toBe("stop");
    expect(next.type).not.toBe("capture_contact");
  });
});
