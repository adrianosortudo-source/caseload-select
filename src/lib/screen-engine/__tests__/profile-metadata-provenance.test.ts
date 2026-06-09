/**
 * Regression guard for the profile-metadata provenance fix (#169, 2026-06-08).
 *
 * Field repro: a WhatsApp intake produced a brief with
 *   - Name: "A D"
 *   - Chip: "Provided in WhatsApp thread"
 * even though "A D" was never typed in the thread, only scraped from
 * the WhatsApp profile metadata. The name was treated as a confirmed
 * user-provided identity when it was at most a weak provisional hint.
 *
 * Two problems closed:
 *  1. Provenance honesty: profile-derived names are recorded with
 *     `source: 'profile_metadata'`, not `'answered'`. The brief
 *     renderer surfaces "From {channel} profile (unconfirmed)",
 *     never "Provided in {channel} thread".
 *  2. Identity vs reachability: phone seeded from WhatsApp wa_id
 *     stays `system_metadata` (carrier-verified reachability); name
 *     is the new `profile_metadata` (profile-system, unverified).
 *     A weak `profile_metadata` name fails `isWeakName` and triggers
 *     a name-capture step in the thread.
 */
import { describe, it, expect } from "vitest";
import {
  isWeakName,
  isUserAnswered,
} from "../selector";
import { getNextStep } from "../control";
import type { EngineState, MatterType, Channel, SupportedLanguage } from "../types";
import { initialiseState } from "../extractor";

function build(overrides: {
  channel: Channel;
  matter_type: MatterType;
  slots: Record<string, string>;
  slot_meta: Record<string, { source: string; confidence?: number }>;
  contactCaptureStarted?: boolean;
  language?: SupportedLanguage;
}): EngineState {
  const base = initialiseState("seed text");
  return {
    ...base,
    channel: overrides.channel,
    matter_type: overrides.matter_type,
    slots: { ...base.slots, ...overrides.slots },
    slot_meta: {
      ...base.slot_meta,
      ...(overrides.slot_meta as unknown as Record<string, { source: string; confidence?: number }>),
    } as EngineState['slot_meta'],
    contactCaptureStarted: overrides.contactCaptureStarted ?? true,
    language: overrides.language ?? "en",
  };
}

describe("isWeakName: weak captures the engine must NOT treat as identity", () => {
  it.each([
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["whitespace only", "   "],
    ["single letter", "A"],
    ["initials with space", "A D"],
    ["initials no space", "AD"],
    ["three single-letter initials", "A B C"],
    ["two-letter token", "Ad"],
    ["numbers only", "12345"],
    ["symbols only", "!@#$%"],
    ["phone-like", "+1 416"],
    ["generic user", "User"],
    ["WhatsApp User", "WhatsApp User"],
    ["Facebook User", "Facebook User"],
    ["Instagram User", "Instagram User"],
    ["Google User", "Google User"],
    ["UNKNOWN uppercase", "UNKNOWN"],
    ["Anonymous", "Anonymous"],
  ])("treats '%s' as weak", (_label, name) => {
    expect(isWeakName(name)).toBe(true);
  });
});

describe("isWeakName: strong captures the engine MAY treat as identity", () => {
  it.each([
    ["full name", "Adriano Domingues"],
    ["single short first name", "Damaris"],
    ["accented name", "Sócrates Aurélio"],
    ["hyphenated", "Jean-Luc Picard"],
    ["three parts", "Maria de Souza"],
    ["uncommon legal-name pattern", "Dr Anastasia Romanov-Wilson"],
  ])("treats '%s' as strong", (_label, name) => {
    expect(isWeakName(name)).toBe(false);
  });
});

describe("isUserAnswered: profile_metadata + weak name => NOT answered", () => {
  it("WhatsApp profile name 'A D' does NOT count as user-answered", () => {
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: { client_name: "A D" },
      slot_meta: { client_name: { source: "profile_metadata", confidence: 1.0 } },
    });
    expect(isUserAnswered(state, "client_name")).toBe(false);
  });

  it("WhatsApp profile name 'Adriano Domingues' DOES count as user-answered", () => {
    // Strong profile names pass: the engine doesn't ask again, but the
    // brief still surfaces honest "From WhatsApp profile (unconfirmed)"
    // provenance via the renderer (covered in screen-brief-html tests).
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: { client_name: "Adriano Domingues" },
      slot_meta: { client_name: { source: "profile_metadata", confidence: 1.0 } },
    });
    expect(isUserAnswered(state, "client_name")).toBe(true);
  });

  it("user-typed name with source='answered' is always user-answered, regardless of strength", () => {
    // After the engine asks for the name and the lead types "A D",
    // contact-extraction sets source to 'answered'. The lead explicitly
    // chose to identify with those initials; that is identity, not a
    // profile-system leak.
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: { client_name: "A D" },
      slot_meta: { client_name: { source: "answered", confidence: 1.0 } },
    });
    expect(isUserAnswered(state, "client_name")).toBe(true);
  });

  it("system_metadata phone is always user-answered (reachability)", () => {
    // Phone seeded via system_metadata (caller ID, WhatsApp wa_id) is
    // carrier-verified. The isWeakName heuristic does NOT apply here.
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: { client_phone: "+16475492106" },
      slot_meta: { client_phone: { source: "system_metadata", confidence: 1.0 } },
    });
    expect(isUserAnswered(state, "client_phone")).toBe(true);
  });
});

describe("contact-capture branch: weak profile name triggers capture_contact", () => {
  it("WhatsApp lead with profile name 'A D' + verified phone gets capture_contact for name", () => {
    // Reproduces the field bug: the engine MUST ask for the name when
    // the captured profile name is too weak to claim identity.
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: {
        client_name: "A D",
        client_phone: "+16475492106",
      },
      slot_meta: {
        client_name: { source: "profile_metadata", confidence: 1.0 },
        client_phone: { source: "system_metadata", confidence: 1.0 },
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);
    expect(next.type).toBe("capture_contact");
    expect("slot" in next && next.slot?.id).toBe("client_name");
  });

  it("WhatsApp lead with strong profile name + phone does NOT get capture_contact", () => {
    // Counterpart: a strong profile name satisfies identity (provisional
    // but adequate). The engine moves on; the brief still labels the
    // chip honestly.
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: {
        client_name: "Adriano Domingues",
        client_phone: "+16475492106",
      },
      slot_meta: {
        client_name: { source: "profile_metadata", confidence: 1.0 },
        client_phone: { source: "system_metadata", confidence: 1.0 },
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);
    expect(next.type).not.toBe("capture_contact");
  });

  it("lead later types real name => source upgrades, gate does NOT re-ask", () => {
    // After the bot asked and the lead replied, contact-extraction
    // sets source='answered'. The gate must not loop back.
    const state = build({
      channel: "whatsapp",
      matter_type: "contract_dispute",
      slots: {
        client_name: "Adriano Domingues",
        client_phone: "+16475492106",
      },
      slot_meta: {
        client_name: { source: "answered", confidence: 1.0 },
        client_phone: { source: "system_metadata", confidence: 1.0 },
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);
    expect(next.type).not.toBe("capture_contact");
  });

  it("voice lead with weak caller_name also triggers capture_contact for name", () => {
    // Same rule globally: the heuristic applies to voice agent
    // caller_name pre-fills (single letter, initials, generic
    // placeholder) not just WhatsApp/Meta.
    const state = build({
      channel: "voice",
      matter_type: "wrongful_dismissal",
      slots: {
        client_name: "Unknown",
        client_phone: "+16475492106",
      },
      slot_meta: {
        client_name: { source: "profile_metadata", confidence: 1.0 },
        client_phone: { source: "system_metadata", confidence: 1.0 },
      },
      contactCaptureStarted: true,
    });

    const next = getNextStep(state);
    expect(next.type).toBe("capture_contact");
    expect("slot" in next && next.slot?.id).toBe("client_name");
  });
});
