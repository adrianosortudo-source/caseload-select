/**
 * LLM Rewrite Guardrail Tests
 *
 * Covers the three post-GPT appliers and the LSO denylist validator. These
 * are the deterministic guardrails that keep the feature safe when the
 * rewrite mode is flipped on. GPT-produced text never reaches the widget
 * without passing through these checks.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type OpenAI from "openai";
import {
  validateRewrite,
  applyResolvedQuestions,
  applySuppressedQuestions,
  buildRewriteMap,
  candidatesFromQuestionSet,
  getRewriteMode,
  CONFIDENCE_THRESHOLD,
  callRewriteModel,
  buildRewriteSystemPrompt,
  buildRewriteUserMessage,
  parseRewriteResponse,
  REWRITE_PAYLOAD_SCHEMA,
} from "../llm-rewrite";
import type { Question } from "../screen-prompt";

const MOCK_CANDIDATES: Question[] = [
  {
    id: "emp_dis_q1",
    text: "Were you an employee?",
    options: [
      { label: "Yes", value: "yes", complexity_delta: 3 },
      { label: "No", value: "no", complexity_delta: -2 },
    ],
  },
  {
    id: "emp_dis_q16",
    text: "When were you terminated?",
    options: [
      { label: "Within 3 months", value: "under_3mo", complexity_delta: 4 },
      { label: "Over 1 year ago", value: "over_1yr", complexity_delta: 0 },
    ],
  },
  {
    id: "emp_dis_q_free",
    text: "Anything else?",
    options: [],
    allow_free_text: true,
  },
];

describe("validateRewrite", () => {
  it("accepts safe rewrites", () => {
    expect(validateRewrite("You said you were fired. What reason did they give?")).toEqual({ ok: true });
  });

  it("rejects outcome guarantees", () => {
    const result = validateRewrite("We can guarantee you win this case.");
    expect(result.ok).toBe(false);
  });

  it("rejects specialist language", () => {
    const result = validateRewrite("Our specialists will review your claim.");
    expect(result.ok).toBe(false);
  });

  it("rejects expert claims", () => {
    const result = validateRewrite("Our legal experts can help.");
    expect(result.ok).toBe(false);
  });

  it("rejects superlatives about lawyers", () => {
    const result = validateRewrite("You deserve the best lawyer in town.");
    expect(result.ok).toBe(false);
  });

  it("rejects result predictions", () => {
    const result = validateRewrite("The judge will side with you on this.");
    expect(result.ok).toBe(false);
  });

  it("rejects case-strength claims", () => {
    const result = validateRewrite("You have a strong case here.");
    expect(result.ok).toBe(false);
  });

  it("rejects risk-free claims", () => {
    const result = validateRewrite("This is a risk-free consultation.");
    expect(result.ok).toBe(false);
  });

  it("rejects em dashes", () => {
    const result = validateRewrite("You said you were fired — what was the reason?");
    expect(result.ok).toBe(false);
  });

  it("rejects empty text", () => {
    expect(validateRewrite("").ok).toBe(false);
    expect(validateRewrite("   ").ok).toBe(false);
  });

  it("rejects overlong text", () => {
    const longText = "You said you were fired. ".repeat(30);
    expect(validateRewrite(longText).ok).toBe(false);
  });
});

describe("applyResolvedQuestions", () => {
  it("applies a valid high-confidence resolution", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "yes", confidence: 0.95, evidence: "client said 'my boss'" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(1);
    expect(confirmed["emp_dis_q1"]).toBe("yes");
  });

  it("skips low-confidence resolutions", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "yes", confidence: 0.5, evidence: "maybe" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(confirmed["emp_dis_q1"]).toBeUndefined();
    expect(result.log[0].reason).toBe("low confidence");
  });

  it("enforces the 0.8 threshold boundary", () => {
    const confirmed: Record<string, unknown> = {};
    applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "yes", confidence: CONFIDENCE_THRESHOLD, evidence: "borderline" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(confirmed["emp_dis_q1"]).toBe("yes");

    const below: Record<string, unknown> = {};
    applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "yes", confidence: CONFIDENCE_THRESHOLD - 0.01, evidence: "borderline" }],
      MOCK_CANDIDATES,
      below,
    );
    expect(below["emp_dis_q1"]).toBeUndefined();
  });

  it("rejects values not in the option set", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "maybe", confidence: 0.95 }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(result.log[0].reason).toBe("value not in option set");
  });

  it("allows free-text values for questions without options", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      [{ id: "emp_dis_q_free", inferred_value: "custom answer", confidence: 0.95 }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(1);
    expect(confirmed["emp_dis_q_free"]).toBe("custom answer");
  });

  it("rejects unknown ids", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applyResolvedQuestions(
      [{ id: "made_up_id", inferred_value: "yes", confidence: 0.95 }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(result.log[0].reason).toBe("unknown id");
  });

  it("does not overwrite already-confirmed entries", () => {
    const confirmed: Record<string, unknown> = { emp_dis_q1: "no" };
    const result = applyResolvedQuestions(
      [{ id: "emp_dis_q1", inferred_value: "yes", confidence: 0.95 }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(confirmed["emp_dis_q1"]).toBe("no");
  });
});

describe("applySuppressedQuestions", () => {
  it("writes __implied__ sentinel for valid suppressions", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applySuppressedQuestions(
      [{ id: "emp_dis_q16", reason: "client was fired, timing established elsewhere" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(1);
    expect(confirmed["emp_dis_q16"]).toBe("__implied__");
  });

  it("rejects unknown ids", () => {
    const confirmed: Record<string, unknown> = {};
    const result = applySuppressedQuestions(
      [{ id: "ghost_id", reason: "n/a" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
  });

  it("does not overwrite existing entries", () => {
    const confirmed: Record<string, unknown> = { emp_dis_q1: "yes" };
    const result = applySuppressedQuestions(
      [{ id: "emp_dis_q1", reason: "already answered" }],
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(result.applied).toBe(0);
    expect(confirmed["emp_dis_q1"]).toBe("yes");
  });
});

describe("buildRewriteMap", () => {
  const candidateIds = new Set(MOCK_CANDIDATES.map(q => q.id));

  it("includes safe rewrites", () => {
    const { map } = buildRewriteMap(
      [{ id: "emp_dis_q1", rewritten_text: "Were you hired as an employee, not a contractor?" }],
      candidateIds,
    );
    expect(map.get("emp_dis_q1")).toBe("Were you hired as an employee, not a contractor?");
  });

  it("rejects unsafe rewrites", () => {
    const { map, log } = buildRewriteMap(
      [{ id: "emp_dis_q1", rewritten_text: "You have a strong case. Were you an employee?" }],
      candidateIds,
    );
    expect(map.has("emp_dis_q1")).toBe(false);
    expect(log[0].status).toBe("rejected");
  });

  it("rejects unknown ids", () => {
    const { map, log } = buildRewriteMap(
      [{ id: "ghost_id", rewritten_text: "fine text" }],
      candidateIds,
    );
    expect(map.size).toBe(0);
    expect(log[0].reason).toBe("unknown id");
  });
});

describe("candidatesFromQuestionSet", () => {
  it("filters out confirmed ids", () => {
    const confirmed = { emp_dis_q1: "yes" };
    const candidates = candidatesFromQuestionSet(MOCK_CANDIDATES, confirmed);
    expect(candidates.length).toBe(2);
    expect(candidates.map(q => q.id)).not.toContain("emp_dis_q1");
  });

  it("returns all questions when nothing confirmed", () => {
    const candidates = candidatesFromQuestionSet(MOCK_CANDIDATES, {});
    expect(candidates.length).toBe(3);
  });
});

describe("getRewriteMode", () => {
  const prior = process.env.LLM_QUESTION_REWRITE;

  afterEach(() => {
    if (prior === undefined) delete process.env.LLM_QUESTION_REWRITE;
    else process.env.LLM_QUESTION_REWRITE = prior;
  });

  it("defaults to off when unset", () => {
    delete process.env.LLM_QUESTION_REWRITE;
    expect(getRewriteMode()).toBe("off");
  });

  it("returns shadow when set to shadow", () => {
    process.env.LLM_QUESTION_REWRITE = "shadow";
    expect(getRewriteMode()).toBe("shadow");
  });

  it("returns on for on/true/1", () => {
    process.env.LLM_QUESTION_REWRITE = "on";
    expect(getRewriteMode()).toBe("on");
    process.env.LLM_QUESTION_REWRITE = "true";
    expect(getRewriteMode()).toBe("on");
    process.env.LLM_QUESTION_REWRITE = "1";
    expect(getRewriteMode()).toBe("on");
  });

  it("returns off for unrecognised values", () => {
    process.env.LLM_QUESTION_REWRITE = "maybe";
    expect(getRewriteMode()).toBe("off");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// callRewriteModel  -  dedicated rewrite call with structured outputs
// ─────────────────────────────────────────────────────────────────────────────

type ChatClient = Pick<OpenAI, "chat">;

function mockRewriteClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  const client = {
    chat: {
      completions: { create },
    },
  } as unknown as ChatClient;
  return { client, create };
}

function failingRewriteClient(err: Error) {
  const create = vi.fn().mockRejectedValue(err);
  const client = {
    chat: {
      completions: { create },
    },
  } as unknown as ChatClient;
  return { client, create };
}

const VALID_PAYLOAD_JSON = JSON.stringify({
  resolved_questions: [
    {
      id: "emp_dis_q1",
      inferred_value: "yes",
      evidence: "client said 'my boss fired me'",
      confidence: 0.95,
    },
  ],
  questions_to_ask: [
    {
      id: "emp_dis_q16",
      rewritten_text: "When did they let you go?",
      rationale: "past tense to match fired-state",
    },
  ],
  suppressed_questions: [
    {
      id: "emp_dis_q_free",
      reason: "already covered in free text",
    },
  ],
});

describe("buildRewriteSystemPrompt", () => {
  it("includes the preamble + candidate block", () => {
    const prompt = buildRewriteSystemPrompt(MOCK_CANDIDATES, "emp_dismissal");
    expect(prompt).toContain("question-rewrite module");
    expect(prompt).toContain("CANDIDATE QUESTIONS");
    expect(prompt).toContain("emp_dismissal");
    expect(prompt).toContain("[emp_dis_q1]");
    expect(prompt).toContain("[emp_dis_q16]");
  });

  it("calls out LSO 4.2-1 and the no-em-dash rule", () => {
    const prompt = buildRewriteSystemPrompt(MOCK_CANDIDATES, null);
    expect(prompt).toMatch(/LSO Rule 4\.2-1/);
    expect(prompt).toMatch(/em or en dash/i);
  });
});

describe("buildRewriteUserMessage", () => {
  it("includes the situation and recent history", () => {
    const msg = buildRewriteUserMessage("my boss fired me after I complained", [
      { role: "user", content: "he was really awful to me for months" },
      { role: "assistant", content: "thanks for sharing. anything else?" },
    ]);
    expect(msg).toContain("CLIENT SITUATION");
    expect(msg).toContain("my boss fired me");
    expect(msg).toContain("RECENT CONVERSATION");
    expect(msg).toContain("[user] he was really awful");
    expect(msg).toContain("[assistant] thanks for sharing");
    expect(msg).toMatch(/Classify every candidate id/);
  });

  it("handles empty situation + empty history", () => {
    const msg = buildRewriteUserMessage("", []);
    expect(msg).toContain("no prior conversation captured yet");
    expect(msg).toMatch(/Classify every candidate id/);
  });

  it("skips empty-content turns", () => {
    const msg = buildRewriteUserMessage("something happened", [
      { role: "user", content: "" },
      { role: "user", content: "actually, last week" },
    ]);
    expect(msg).toContain("[user] actually, last week");
    // The empty-content line should not appear as a bare "[user]" entry.
    expect(msg).not.toMatch(/\[user\]\s*$/m);
  });
});

describe("parseRewriteResponse", () => {
  it("parses a valid payload", () => {
    const payload = parseRewriteResponse(VALID_PAYLOAD_JSON);
    expect(payload).not.toBeNull();
    expect(payload!.resolved_questions!.length).toBe(1);
    expect(payload!.questions_to_ask!.length).toBe(1);
    expect(payload!.suppressed_questions!.length).toBe(1);
    expect(payload!.resolved_questions![0].id).toBe("emp_dis_q1");
  });

  it("returns empty arrays when fields are missing", () => {
    const payload = parseRewriteResponse("{}");
    expect(payload).not.toBeNull();
    expect(payload!.resolved_questions).toEqual([]);
    expect(payload!.questions_to_ask).toEqual([]);
    expect(payload!.suppressed_questions).toEqual([]);
  });

  it("returns null for invalid JSON", () => {
    expect(parseRewriteResponse("not json at all")).toBeNull();
  });

  it("returns null for empty strings", () => {
    expect(parseRewriteResponse("")).toBeNull();
    expect(parseRewriteResponse("   ")).toBeNull();
  });

  it("returns null for non-object JSON (array, number, string)", () => {
    expect(parseRewriteResponse("[1,2,3]")).toBeNull();
    expect(parseRewriteResponse("42")).toBeNull();
    // NOTE: JSON strings parse to strings (objects), which is why typeof "object" matters.
    expect(parseRewriteResponse("null")).toBeNull();
  });

  it("coerces non-array fields into empty arrays (defensive parsing)", () => {
    const payload = parseRewriteResponse(
      JSON.stringify({
        resolved_questions: "not an array",
        questions_to_ask: 42,
        suppressed_questions: null,
      }),
    );
    expect(payload).not.toBeNull();
    expect(payload!.resolved_questions).toEqual([]);
    expect(payload!.questions_to_ask).toEqual([]);
    expect(payload!.suppressed_questions).toEqual([]);
  });
});

describe("REWRITE_PAYLOAD_SCHEMA", () => {
  it("requires all three top-level arrays and rejects extras", () => {
    expect(REWRITE_PAYLOAD_SCHEMA.type).toBe("object");
    expect(REWRITE_PAYLOAD_SCHEMA.additionalProperties).toBe(false);
    expect(REWRITE_PAYLOAD_SCHEMA.required).toEqual([
      "resolved_questions",
      "questions_to_ask",
      "suppressed_questions",
    ]);
  });

  it("pins every array-item object to the expected fields", () => {
    expect(REWRITE_PAYLOAD_SCHEMA.properties.resolved_questions.items.required).toEqual([
      "id",
      "inferred_value",
      "evidence",
      "confidence",
    ]);
    expect(REWRITE_PAYLOAD_SCHEMA.properties.questions_to_ask.items.required).toEqual([
      "id",
      "rewritten_text",
      "rationale",
    ]);
    expect(REWRITE_PAYLOAD_SCHEMA.properties.suppressed_questions.items.required).toEqual([
      "id",
      "reason",
    ]);
  });
});

describe("callRewriteModel", () => {
  it("returns null immediately when candidates is empty", async () => {
    const { client, create } = mockRewriteClient(VALID_PAYLOAD_JSON);
    const result = await callRewriteModel({
      candidates: [],
      subType: "emp_dismissal",
      situation: "something",
      client,
    });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("calls the model with structured outputs and returns the parsed payload", async () => {
    const { client, create } = mockRewriteClient(VALID_PAYLOAD_JSON);
    const result = await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: "emp_dismissal",
      situation: "my boss fired me after I complained",
      history: [{ role: "user", content: "he was really bad" }],
      client,
      model: "gpt-4o-mini",
    });

    expect(result).not.toBeNull();
    expect(result!.payload.resolved_questions!.length).toBe(1);
    expect(result!.payload.questions_to_ask!.length).toBe(1);
    expect(result!.payload.suppressed_questions!.length).toBe(1);
    expect(result!.model).toBe("gpt-4o-mini");

    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("gpt-4o-mini");
    // Gemini's OpenAI-compatible endpoint uses json_object mode; the shape
    // contract lives in the system prompt (see buildRewritePromptChunk).
    expect(args.response_format.type).toBe("json_object");

    // Messages must be [system, user] in that order.
    expect(args.messages.length).toBe(2);
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[1].role).toBe("user");
    expect(args.messages[0].content).toContain("CANDIDATE QUESTIONS");
    expect(args.messages[0].content).toContain("emp_dismissal");
    expect(args.messages[1].content).toContain("my boss fired me");
  });

  it("returns null when the API call throws (non-fatal)", async () => {
    const { client, create } = failingRewriteClient(new Error("network down"));
    const result = await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: "emp_dismissal",
      situation: "something happened",
      client,
    });
    expect(result).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns null when the model returns empty content", async () => {
    const { client } = mockRewriteClient("");
    const result = await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: "emp_dismissal",
      situation: "something happened",
      client,
    });
    expect(result).toBeNull();
  });

  it("returns null when the model returns invalid JSON", async () => {
    const { client } = mockRewriteClient("{this is not json");
    const result = await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: "emp_dismissal",
      situation: "something happened",
      client,
    });
    expect(result).toBeNull();
  });

  it("passes the abort signal from the timeout", async () => {
    const { client, create } = mockRewriteClient(VALID_PAYLOAD_JSON);
    await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: null,
      situation: "something",
      client,
      timeoutMs: 500,
    });
    const opts = create.mock.calls[0][1];
    expect(opts).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("feeds the payload through the existing appliers end-to-end", async () => {
    // Proves the dedicated call result is shape-compatible with the
    // downstream applyResolvedQuestions + buildRewriteMap pipeline.
    const { client } = mockRewriteClient(VALID_PAYLOAD_JSON);
    const result = await callRewriteModel({
      candidates: MOCK_CANDIDATES,
      subType: "emp_dismissal",
      situation: "my boss fired me",
      client,
    });
    expect(result).not.toBeNull();

    const confirmed: Record<string, unknown> = {};
    const applyResolved = applyResolvedQuestions(
      result!.payload.resolved_questions,
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(applyResolved.applied).toBe(1);
    expect(confirmed["emp_dis_q1"]).toBe("yes");

    const applySuppressed = applySuppressedQuestions(
      result!.payload.suppressed_questions,
      MOCK_CANDIDATES,
      confirmed,
    );
    expect(applySuppressed.applied).toBe(1);
    expect(confirmed["emp_dis_q_free"]).toBe("__implied__");

    const { map, log } = buildRewriteMap(
      result!.payload.questions_to_ask,
      new Set(MOCK_CANDIDATES.map(q => q.id)),
    );
    expect(map.size).toBe(1);
    expect(map.get("emp_dis_q16")).toBe("When did they let you go?");
    expect(log[0].status).toBe("applied");
  });
});
