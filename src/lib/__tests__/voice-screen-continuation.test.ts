import { describe, expect, it } from "vitest";
import {
  continuationView, seedContinuationState, transitionContinuation,
  type ContinuationCallFacts, type ContinuationSession,
} from "../voice-screen-continuation";

const call: ContinuationCallFacts = {
  callerName: "Alex Morgan", callback: { number: "+14165550142" },
  broadNeed: "A client has not paid my $28,000 invoice for completed design work.",
  deadline: "I need a response by Friday.",
  capturedSlots: { amount_at_stake: "$25,000–$100,000", invoice_exists: "Yes", payment_status: "Nothing paid", dispute_reason: "Not sure" },
};
const initial = (): ContinuationSession => ({ state: seedContinuationState(call), answers: [], revision: 0, status: "open" });
const view = (session: ContinuationSession) => continuationView(session.state, session.revision, session.status, session.answers);

describe("caller continuation review and corrections", () => {
  it("projects only captured, labeled facts with explicit uncertainty and masked contact", () => {
    const session = initial();
    session.state.debug = { secret: "NEVER_RETURN" };
    session.state.slots.internal_contact_id = "NEVER_RETURN";
    const current = view(session);
    expect(current.reviewConfirmed).toBe(false);
    expect(current.summary.fields).toContainEqual({ id: "client_phone", label: "Contact number", value: "••• ••• 0142", editable: true, uncertain: false });
    expect(current.summary.fields.find(field => field.id === "dispute_reason")?.uncertain).toBe(true);
    expect(current.summary.fields.find(field => field.id === "deadline")?.value).toBe(call.deadline);
    expect(JSON.stringify(current)).not.toContain("NEVER_RETURN");
    expect(JSON.stringify(current)).not.toContain(call.callback.number);
    expect(Object.keys(current).sort()).toEqual(["question", "reviewConfirmed", "revision", "status", "summary"]);
    expect(current.summary.fields.every(field => Object.keys(field).sort().join() === "editable,id,label,uncertain,value")).toBe(true);
  });

  it("persists review and corrections through a JSON roundtrip without changing the original call", () => {
    const original = structuredClone(call);
    let session = transitionContinuation(initial(), { revision: 0, correction: { fieldId: "client_name", value: "Taylor Morgan" } });
    session = transitionContinuation(session, { revision: 1, correction: { fieldId: "client_phone", value: "647 555 0198" } });
    session = transitionContinuation(session, { revision: 2, confirmReview: true });
    session = JSON.parse(JSON.stringify(session));
    expect(view(session).reviewConfirmed).toBe(true);
    expect(view(session).summary.fields.find(field => field.id === "client_name")?.value).toBe("Taylor Morgan");
    expect(view(session).summary.fields.find(field => field.id === "client_phone")?.value).toBe("••• ••• 0198");
    expect(session.state.slots.client_phone).toBe("+16475550198");
    expect(call).toEqual(original);
    expect(session.answers).toEqual([]);
    expect(() => transitionContinuation(session, { revision: 2, confirmReview: true })).toThrow("refresh_required");
  });

  it("rejects malformed, mixed, unknown and blank correction actions without mutating state", () => {
    const session = initial();
    const before = structuredClone(session);
    for (const payload of [
      { revision: 0, correction: { fieldId: "band", value: "A" } },
      { revision: 0, correction: { fieldId: "situation", value: " " } },
      { revision: 0, correction: { fieldId: "client_phone", value: "123" } },
      { revision: 0, correction: { fieldId: "client_name", value: "Name", admin: true } },
      { revision: 0, correction: { fieldId: "client_name", value: "Name" }, finish: true },
      { revision: 0, confirmReview: true, slotId: "client_name" },
      { revision: 0, confirmReview: false },
    ]) expect(() => transitionContinuation(session, payload)).toThrow("invalid_answer");
    expect(session).toEqual(before);
  });

  it("accepts an explanation for a choice question, stores readable history and rejects empty other", () => {
    let session = initial();
    const question = view(session).question!;
    expect(question.options.length).toBeGreaterThan(0);
    expect(() => transitionContinuation(session, { revision: 0, slotId: question.id, value: "other:  " })).toThrow("invalid_answer");
    session = transitionContinuation(session, { revision: 0, slotId: question.id, value: "other: We agreed on the delivery by email." });
    expect(session.state.slots[question.id]).toBe("other: We agreed on the delivery by email.");
    expect(session.answers[0].answer).toBe("We agreed on the delivery by email.");
    expect(view(session).summary.answers).toEqual([{ question: question.text, answer: "We agreed on the delivery by email." }]);
    expect(view(session).question?.id).not.toBe(question.id);
    session = transitionContinuation(session, { revision: 1, finish: true });
    expect(view(session).summary.answers).toHaveLength(1);
    expect(view(session).summary.fields.every(field => !field.editable)).toBe(true);
    expect(JSON.stringify(view(session))).not.toContain("other:");
  });

  it("rebuilds a corrected situation without stale invoice evidence or losing inquiry identity", () => {
    const session = initial();
    const next = transitionContinuation(session, { revision: 0, correction: { fieldId: "situation", value: "I was dismissed from my job yesterday and need help reviewing my severance package." } });
    expect(next.state.matter_type).not.toBe(session.state.matter_type);
    expect(next.state.slots.invoice_exists).not.toBe("Yes");
    expect(view(next).summary.fields.some(field => field.id === "invoice_exists")).toBe(false);
    expect(next.state.lead_id).toBe(session.state.lead_id);
    expect(next.state.submitted_at).toBe(session.state.submitted_at);
    expect(view(next).summary.fields.find(field => field.id === "situation")?.value).toContain("dismissed");
  });

  it("hydrates legacy state from the immutable call facts and never reports missing timing as no deadline", () => {
    const session = initial();
    delete (session.state as unknown as Record<string, unknown>).continuationReview;
    const current = continuationView(session.state, 0, "open", [], { ...call, deadline: "" });
    expect(current.summary.fields.find(field => field.id === "deadline")).toMatchObject({ value: "Not captured", uncertain: true });
    expect(current.summary.fields.find(field => field.id === "invoice_exists")?.value).toBe("Yes");
    const next = transitionContinuation({ ...session, call }, { revision: 0, confirmReview: true });
    expect(view(next).summary.fields.find(field => field.id === "deadline")?.value).toBe(call.deadline);
  });

  it("does not consume the discovery budget when correcting facts repeatedly", () => {
    let session = initial();
    const history = [...session.state.questionHistory];
    const question = view(session).question;
    for (let revision = 0; revision < 12; revision++) session = transitionContinuation(session, { revision, correction: { fieldId: "client_name", value: `Alex ${revision}` } });
    expect(session.state.questionHistory).toEqual(history);
    expect(view(session).question).toEqual(question);
  });

  it("retains compatible call facts for a same-matter wording correction", () => {
    const session = initial();
    const next = transitionContinuation(session, { revision: 0, correction: { fieldId: "situation", value: "A client has not paid my invoice for completed website design work." } });
    expect(next.state.matter_type).toBe(session.state.matter_type);
    expect(next.state.slots.invoice_exists).toBe("Yes");
    expect(next.state.slots.amount_at_stake).toBe("$25,000–$100,000");
    expect(view(next).summary.fields.find(field => field.id === "invoice_exists")?.value).toBe("Yes");
  });

  it("lets a corrected deadline override old urgent wording and timing answers", () => {
    const session = { ...initial(), state: seedContinuationState({ ...call,
      broadNeed: "I need a lawyer to review a severance package urgently because the deadline is tomorrow.",
      deadline: "Tomorrow", capturedSlots: { severance_deadline: "In the next few days" },
    }) };
    const next = transitionContinuation(session, { revision: 0, correction: { fieldId: "deadline", value: "No deadline; employer withdrew the date." } });
    expect(next.state.raw.mentions_urgency).toBe(false);
    expect(next.state.slots.severance_deadline).toBe("other:No deadline; employer withdrew the date.");
    expect(view(next).question?.id).not.toBe("severance_deadline");
    expect(next.state.questionHistory).toEqual(session.state.questionHistory);
    const edited = transitionContinuation(next, { revision: 1, correction: { fieldId: "situation", value: "I need a lawyer to review my severance package urgently because the deadline is tomorrow. I worked there for five years." } });
    expect(edited.state.raw.mentions_urgency).toBe(false);
    expect(edited.state.slots.severance_deadline).toBe("other:No deadline; employer withdrew the date.");
    expect(view(edited).summary.fields.find(field => field.id === "deadline")?.value).toBe("No deadline; employer withdrew the date.");
    expect(view(edited).question?.id).not.toBe("severance_deadline");
  });
});
