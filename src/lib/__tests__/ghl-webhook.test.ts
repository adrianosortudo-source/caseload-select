import { describe, it, expect } from "vitest";
import {
  buildTakenPayload,
  buildPassedPayload,
  buildReferredPayload,
  buildDeclinedOosPayload,
  buildDeclinedBackstopPayload,
  buildMatterStageChangedPayload,
  cadenceTargetForBand,
  lawyerActionForBand,
  type LeadFacts,
  type MatterStageCadenceTrigger,
} from "../ghl-webhook-pure";
import type { MatterStage } from "../types";

const NOW = new Date("2026-05-05T14:12:00.000Z");

function facts(overrides: Partial<LeadFacts> = {}): LeadFacts {
  return {
    lead_id: "L-2026-05-05-A1B",
    firm_id: "1f5a2391-85d8-45a2-b427-90441e78a93c",
    band: "B",
    matter_type: "shareholder_dispute",
    practice_area: "corporate",
    submitted_at: "2026-05-05T14:00:00.000Z",
    contact_name: "Jordan Reyes",
    contact_email: "jreyes@example.com",
    contact_phone: "+14165550000",
    ...overrides,
  };
}

describe("cadenceTargetForBand", () => {
  it("maps each band to its cadence_target", () => {
    expect(cadenceTargetForBand("A")).toBe("band_a");
    expect(cadenceTargetForBand("B")).toBe("band_b");
    expect(cadenceTargetForBand("C")).toBe("band_c");
    expect(cadenceTargetForBand("D")).toBe("band_d");
  });
  it("falls through to band_c on null (defensive; should not occur for taken)", () => {
    expect(cadenceTargetForBand(null)).toBe("band_c");
  });
});

describe("lawyerActionForBand", () => {
  it("preserves the locked CRM Bible mapping", () => {
    expect(lawyerActionForBand("A")).toBe("Call same day");
    expect(lawyerActionForBand("B")).toBe("Send a booking link");
    expect(lawyerActionForBand("C")).toMatch(/booking link or pass/i);
    expect(lawyerActionForBand("D")).toMatch(/refer/i);
  });
});

describe("buildTakenPayload — common envelope shape", () => {
  it("produces all required envelope fields", () => {
    const p = buildTakenPayload({
      facts: facts({ band: "A" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      feeEstimate: "$5,000–$25,000",
      matterSnapshot: "Shareholder dispute with locked-out access",
    });

    expect(p.action).toBe("taken");
    expect(p.lead_id).toBe("L-2026-05-05-A1B");
    expect(p.firm_id).toBe("1f5a2391-85d8-45a2-b427-90441e78a93c");
    expect(p.band).toBe("A");
    expect(p.matter_type).toBe("shareholder_dispute");
    expect(p.practice_area).toBe("corporate");
    expect(p.submitted_at).toBe("2026-05-05T14:00:00.000Z");
    expect(p.status_changed_at).toBe(NOW.toISOString());
    expect(p.status_changed_by).toBe("lawyer");
    expect(p.contact).toEqual({
      name: "Jordan Reyes",
      email: "jreyes@example.com",
      phone: "+14165550000",
    });
    expect(p.idempotency_key).toBe("L-2026-05-05-A1B:taken");
  });

  it("nests the action-specific fields under 'taken'", () => {
    const p = buildTakenPayload({
      facts: facts({ band: "A" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      feeEstimate: "$5,000–$25,000",
      matterSnapshot: "Snapshot",
    });
    expect(p.taken.cadence_target).toBe("band_a");
    expect(p.taken.lawyer_recommended_action).toBe("Call same day");
    expect(p.taken.fee_estimate).toBe("$5,000–$25,000");
    expect(p.taken.matter_snapshot).toBe("Snapshot");
  });

  it("propagates band B and band C correctly", () => {
    expect(buildTakenPayload({
      facts: facts({ band: "B" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      feeEstimate: null, matterSnapshot: null,
    }).taken.cadence_target).toBe("band_b");

    expect(buildTakenPayload({
      facts: facts({ band: "C" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      feeEstimate: null, matterSnapshot: null,
    }).taken.cadence_target).toBe("band_c");
  });
});

describe("buildPassedPayload", () => {
  it("carries the resolved decline copy + source + note flag", () => {
    const p = buildPassedPayload({
      facts: facts({ band: "C" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      declineSubject: "Re: your inquiry to Hartwell Law",
      declineBody: "Resolved decline body.",
      declineSource: "per_lead_override",
      lawyerNotePresent: true,
    });
    expect(p.action).toBe("passed");
    expect(p.passed.decline_subject).toBe("Re: your inquiry to Hartwell Law");
    expect(p.passed.decline_body).toBe("Resolved decline body.");
    expect(p.passed.decline_template_source).toBe("per_lead_override");
    expect(p.passed.lawyer_note_present).toBe(true);
    expect(p.idempotency_key).toBe("L-2026-05-05-A1B:passed");
  });
});

describe("buildReferredPayload", () => {
  it("produces a 'referred' envelope with referred_to + note", () => {
    const p = buildReferredPayload({
      facts: facts({ band: "D", matter_type: "out_of_scope", practice_area: "family" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      referredTo: "Jane Doe at Acme Family Law",
      note: "Long-standing referral partner; she handles these well.",
    });
    expect(p.action).toBe("referred");
    expect(p.band).toBe("D");
    expect(p.referred.referred_to).toBe("Jane Doe at Acme Family Law");
    expect(p.referred.note).toBe("Long-standing referral partner; she handles these well.");
    expect(p.idempotency_key).toBe("L-2026-05-05-A1B:referred");
    expect(p.status_changed_by).toBe("lawyer");
  });

  it("accepts null referred_to and null note (lawyer marks as referred without naming)", () => {
    const p = buildReferredPayload({
      facts: facts({ band: "D" }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      referredTo: null,
      note: null,
    });
    expect(p.referred.referred_to).toBeNull();
    expect(p.referred.note).toBeNull();
  });

  it("preserves the band in the envelope (refer doesn't force band=null)", () => {
    // Unlike declined_oos which forces band=null, refer can fire on any
    // band — the engine misclassification edge case lets the lawyer take
    // a non-Band-D lead and choose to refer instead.
    const p = buildReferredPayload({
      facts: facts({ band: "B" }),
      statusChangedAt: NOW,
      statusChangedBy: "operator",
      referredTo: "Colleague",
      note: null,
    });
    expect(p.band).toBe("B");
    expect(p.status_changed_by).toBe("operator");
  });
});

describe("buildDeclinedOosPayload", () => {
  it("forces band=null and uses system:oos as the changed_by", () => {
    const p = buildDeclinedOosPayload({
      facts: facts({ band: null, matter_type: "out_of_scope", practice_area: "family" }),
      statusChangedAt: NOW,
      declineSubject: "Re: your inquiry",
      declineBody: "Family law sits outside our work.",
      declineSource: "per_pa",
      detectedAreaLabel: "family law",
    });
    expect(p.action).toBe("declined_oos");
    expect(p.band).toBeNull();
    expect(p.status_changed_by).toBe("system:oos");
    expect(p.declined_oos.detected_area_label).toBe("family law");
    expect(p.idempotency_key).toBe("L-2026-05-05-A1B:declined_oos");
  });

  it("forces band=null even if facts.band was non-null (defensive)", () => {
    const p = buildDeclinedOosPayload({
      facts: facts({ band: "A" }),
      statusChangedAt: NOW,
      declineSubject: "x", declineBody: "y",
      declineSource: "system_fallback", detectedAreaLabel: "family law",
    });
    expect(p.band).toBeNull();
  });
});

describe("buildDeclinedBackstopPayload", () => {
  it("carries the missed deadline and computes hours_past correctly", () => {
    const deadline = "2026-05-05T13:00:00.000Z"; // 1h 12min before NOW
    const p = buildDeclinedBackstopPayload({
      facts: facts(),
      statusChangedAt: NOW,
      declineSubject: "Re: your inquiry",
      declineBody: "Sorry we did not circle back.",
      declineSource: "firm_default",
      decisionDeadline: deadline,
    });
    expect(p.action).toBe("declined_backstop");
    expect(p.status_changed_by).toBe("system:backstop");
    expect(p.declined_backstop.missed_deadline).toBe(deadline);
    // 1h 12min = 1.2h, rounded to one decimal
    expect(p.declined_backstop.hours_past_deadline).toBe(1.2);
  });

  it("handles a deadline missed by minutes (rounds to 0.0 or 0.1)", () => {
    const deadline = "2026-05-05T14:09:00.000Z"; // 3 min before NOW
    const p = buildDeclinedBackstopPayload({
      facts: facts(),
      statusChangedAt: NOW,
      declineSubject: "x", declineBody: "y",
      declineSource: "system_fallback", decisionDeadline: deadline,
    });
    expect(p.declined_backstop.hours_past_deadline).toBeGreaterThanOrEqual(0);
    expect(p.declined_backstop.hours_past_deadline).toBeLessThanOrEqual(0.1);
  });
});

describe("envelope fields stay consistent across actions", () => {
  it("idempotency_key always equals lead_id:action", () => {
    const f = facts();
    const taken = buildTakenPayload({
      facts: f, statusChangedAt: NOW, statusChangedBy: "lawyer",
      feeEstimate: null, matterSnapshot: null,
    });
    const passed = buildPassedPayload({
      facts: f, statusChangedAt: NOW, statusChangedBy: "lawyer",
      declineSubject: "x", declineBody: "y",
      declineSource: "system_fallback", lawyerNotePresent: false,
    });
    const referred = buildReferredPayload({
      facts: f, statusChangedAt: NOW, statusChangedBy: "lawyer",
      referredTo: null, note: null,
    });
    const oos = buildDeclinedOosPayload({
      facts: f, statusChangedAt: NOW,
      declineSubject: "x", declineBody: "y",
      declineSource: "system_fallback", detectedAreaLabel: "family law",
    });
    const backstop = buildDeclinedBackstopPayload({
      facts: f, statusChangedAt: NOW,
      declineSubject: "x", declineBody: "y",
      declineSource: "system_fallback",
      decisionDeadline: "2026-05-05T14:00:00.000Z",
    });
    expect(taken.idempotency_key).toBe("L-2026-05-05-A1B:taken");
    expect(passed.idempotency_key).toBe("L-2026-05-05-A1B:passed");
    expect(referred.idempotency_key).toBe("L-2026-05-05-A1B:referred");
    expect(oos.idempotency_key).toBe("L-2026-05-05-A1B:declined_oos");
    expect(backstop.idempotency_key).toBe("L-2026-05-05-A1B:declined_backstop");
  });

  it("contact snapshot is always present, with nulls preserved (not omitted)", () => {
    const p = buildTakenPayload({
      facts: facts({ contact_phone: null, contact_email: null }),
      statusChangedAt: NOW,
      statusChangedBy: "lawyer",
      feeEstimate: null, matterSnapshot: null,
    });
    expect(p.contact).toEqual({
      name: "Jordan Reyes",
      email: null,
      phone: null,
    });
  });
});

describe("buildMatterStageChangedPayload", () => {
  const MATTER_ID = "7c0a4e9b-2f31-4d55-9be2-6f6f1f1d2ab3";
  const SOURCE_UUID = "f37b1d80-9a51-4f3c-8a44-1f9adfe1c001";

  function stageArgs(overrides: Partial<Parameters<typeof buildMatterStageChangedPayload>[0]> = {}) {
    return {
      matterId: MATTER_ID,
      firmId: "1f5a2391-85d8-45a2-b427-90441e78a93c",
      sourceScreenedLeadId: SOURCE_UUID,
      sourceLeadPublicId: "L-2026-05-22-SX4",
      intakeLanguage: "en",
      fromStage: "intake" as MatterStage,
      toStage: "retainer_pending" as MatterStage,
      cadenceTrigger: "retainer_awaiting" as MatterStageCadenceTrigger,
      matterType: "shareholder_dispute",
      practiceArea: "corporate",
      primaryName: "Jordan Reyes",
      primaryEmail: "jreyes@example.com",
      primaryPhone: "+14165550000",
      transitionedAt: NOW,
      actorRole: "admin" as const,
      ...overrides,
    };
  }

  it("produces the reduced envelope plus the full extension", () => {
    const p = buildMatterStageChangedPayload(stageArgs());
    expect(p.action).toBe("matter_stage_changed");
    expect(p.lead_id).toBe("L-2026-05-22-SX4");
    expect(p.firm_id).toBe("1f5a2391-85d8-45a2-b427-90441e78a93c");
    expect(p.intake_language).toBe("en");
    expect(p.matter_stage_changed).toEqual({
      matter_id: MATTER_ID,
      source_screened_lead_id: SOURCE_UUID,
      from_stage: "intake",
      to_stage: "retainer_pending",
      cadence_trigger: "retainer_awaiting",
      matter_type: "shareholder_dispute",
      practice_area: "corporate",
      primary_name: "Jordan Reyes",
      primary_email: "jreyes@example.com",
      primary_phone: "+14165550000",
      transitioned_at: NOW.toISOString(),
      actor_role: "admin",
    });
  });

  it("idempotency key is <matter_id>:stage:<to_stage>", () => {
    const p = buildMatterStageChangedPayload(stageArgs());
    expect(p.idempotency_key).toBe(`${MATTER_ID}:stage:retainer_pending`);
  });

  it("covers all four DR-049 cadence triggers", () => {
    const transitions: Array<{
      from: MatterStage;
      to: MatterStage;
      trigger: MatterStageCadenceTrigger;
    }> = [
      { from: "intake", to: "retainer_pending", trigger: "retainer_awaiting" },
      { from: "retainer_pending", to: "active", trigger: "client_won" },
      { from: "active", to: "closing", trigger: "review_request" },
      { from: "closing", to: "closed", trigger: "relationship_milestone" },
    ];
    for (const t of transitions) {
      const p = buildMatterStageChangedPayload(
        stageArgs({ fromStage: t.from, toStage: t.to, cadenceTrigger: t.trigger }),
      );
      expect(p.matter_stage_changed.cadence_trigger).toBe(t.trigger);
      expect(p.matter_stage_changed.from_stage).toBe(t.from);
      expect(p.matter_stage_changed.to_stage).toBe(t.to);
      expect(p.idempotency_key).toBe(`${MATTER_ID}:stage:${t.to}`);
    }
  });

  it("falls back to the matter UUID for lead_id when no source public id", () => {
    const p = buildMatterStageChangedPayload(
      stageArgs({ sourceLeadPublicId: null, sourceScreenedLeadId: null }),
    );
    expect(p.lead_id).toBe(MATTER_ID);
    expect(p.matter_stage_changed.source_screened_lead_id).toBeNull();
  });

  it("defaults intake_language to en when the source row had none", () => {
    const p = buildMatterStageChangedPayload(stageArgs({ intakeLanguage: null }));
    expect(p.intake_language).toBe("en");
  });

  it("preserves null contact fields in the extension", () => {
    const p = buildMatterStageChangedPayload(
      stageArgs({ primaryEmail: null, primaryPhone: null }),
    );
    expect(p.matter_stage_changed.primary_email).toBeNull();
    expect(p.matter_stage_changed.primary_phone).toBeNull();
  });
});
