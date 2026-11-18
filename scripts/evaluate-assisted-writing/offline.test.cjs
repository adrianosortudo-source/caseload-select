const assert = require("node:assert/strict");
const test = require("node:test");
const { makeFixture } = require("./fixtures.cjs");
const { assistantOutput, recordRequests, runFixture } = require("./run.cjs");
const { completeAnswers, validBlueprint, providerBlueprint } = require("../../src/lib/desired-client/__tests__/blueprint-helpers.ts");

test("builds 30 valid fictional fixtures with repeatable blinded input hashes", () => {
  const hashes = Array.from({ length: 30 }, (_, index) => {
    const a = makeFixture(index);
    assert.deepEqual(a, makeFixture(index));
    return a.hash;
  });
  assert.equal(new Set(hashes).size, 30);
});

test("records every GPT attempt and the assembled report when a generated card needs repair", async () => {
  process.env.CASELOAD_OPENAI_API_KEY = "offline-only";
  process.env.DESIRED_CLIENT_PROVIDER = "openai";
  const fixture = makeFixture(0);
  const answers = completeAnswers();
  fixture.profile.answers = answers;
  const complete = providerBlueprint(validBlueprint(answers), answers);
  delete complete.brief.why_firm_wants_work;
  const invalid = structuredClone(complete);
  invalid.brief.client_goals_needs.claims[0].text = "The client wants advice within 987 days.";
  const responses = [invalid, complete.brief.client_goals_needs];
  const rows = [];
  const result = await runFixture(fixture, "openai", "profile", row => rows.push(row), async () => {
    assert(responses.length > 0, "unexpected further call");
    const text = JSON.stringify(responses.shift());
    return Response.json({ status: "completed", model: "gpt-6-luna",
      output: [{ type: "reasoning", content: [{ type: "summary", text: "omit" }] },
        { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text }] }],
      usage: { input_tokens: 100, output_tokens: 10 } });
  });
  assert.deepEqual(rows.map(r => r.kind), ["attempt", "attempt", "result"]);
  assert.equal(result.mode, "live");
  assert.equal(result.calls, 2);
  assert.equal(rows[0].output[0].parts[0].text, JSON.stringify(invalid));
  assert.equal(rows[1].output[0].parts[0].text, JSON.stringify(complete.brief.client_goals_needs));
  assert(!JSON.stringify(result.output).includes("987 days"));
  assert.equal(result.output.brief.report_version, "dcm-blueprint-v4");
});

test("captures visible Gemini parts, failed HTTP attempts and omits credentials and internal reasoning", async () => {
  const visible = assistantOutput("gemini", { candidates: [{ finishReason: "STOP", content: { parts: [
    { thought: true, text: "omit" }, { text: "complete fictional output" },
  ] } }] });
  assert.deepEqual(visible[0].parts, [{ text: "complete fictional output" }]);
  const rows = [];
  const fetch = recordRequests("openai", row => rows.push(row), async () => Response.json({ error: { code: "limit", message: "omit" } }, { status: 429 }));
  await fetch("https://api.openai.com/v1/responses", { headers: { authorization: "omit" } });
  assert.equal(rows[0].httpStatus, 429);
  assert.equal(rows[0].errorCode, "limit");
  assert(!JSON.stringify(rows).includes("omit"));
  await assert.rejects(fetch("https://example.com/"), /chosen model provider/);
});
