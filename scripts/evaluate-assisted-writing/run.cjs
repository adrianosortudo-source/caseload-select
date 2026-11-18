// Staff CLI for fictional inputs. Run with --conditions=react-server --import tsx.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { makeFixture } = require("./fixtures.cjs");
const { runAssist } = require("../../src/lib/why-your-firm/assist.ts");
const { runDesiredClientAnalysis } = require("../../src/lib/desired-client/analyze.ts");
const { runInterviewClarification } = require("../../src/lib/desired-client/interview-clarification.ts");

function assistantOutput(provider, response) {
  if (provider === "gemini") {
    return (response.candidates ?? []).map(candidate => ({
      finishReason: candidate.finishReason,
      parts: (candidate.content?.parts ?? []).filter(part => !part.thought && typeof part.text === "string")
        .map(part => ({ text: part.text })),
    }));
  }
  return (response.output ?? []).filter(message => message.type === "message" && message.role !== "user")
    .map(message => ({
      phase: message.phase, status: message.status,
      parts: (message.content ?? []).filter(part => part.type === "output_text" || part.type === "refusal")
        .map(part => ({ type: part.type, text: part.text ?? part.refusal })),
    }));
}

function recordRequests(provider, write, transport) {
  let number = 0;
  return async (resource, init) => {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    const permitted = provider === "openai"
      ? url.origin === "https://api.openai.com" && url.pathname === "/v1/responses"
      : url.origin === "https://generativelanguage.googleapis.com" && url.pathname.endsWith(":generateContent");
    assert(permitted, "The staff replay accepts only the chosen model provider.");
    const attempt = ++number;
    const started = performance.now();
    let response;
    try {
      response = await transport(resource, init);
    } catch (error) {
      write({ kind: "attempt", attempt, latencyMs: Math.round(performance.now() - started), networkFailure: true });
      throw error;
    }
    const body = await response.clone().json().catch(() => ({}));
    write({ kind: "attempt", attempt, latencyMs: Math.round(performance.now() - started), httpStatus: response.status,
      model: body.model ?? body.modelVersion, responseStatus: body.status, output: assistantOutput(provider, body),
      usage: provider === "openai" ? body.usage : body.usageMetadata,
      errorCode: typeof body.error?.code === "string" || typeof body.error?.code === "number" ? body.error.code : undefined });
    return response;
  };
}

async function runFixture(fixture, provider, operation, write, transport = globalThis.fetch) {
  // The process runs one operation at a time. Restore its original transport even after a failed repair.
  const previous = globalThis.fetch;
  globalThis.fetch = recordRequests(provider, write, transport);
  const started = performance.now();
  try {
    let outcome;
    if (operation === "why") outcome = await runAssist(fixture.why, provider);
    else if (operation === "clarify") outcome = await runInterviewClarification(fixture.clarify);
    else if (operation === "profile") {
      outcome = await runDesiredClientAnalysis(fixture.profile, [], 3, async used => ({ status: "reserved", callsUsed: used + 1 }));
    } else throw new Error("Unknown operation.");
    const output = outcome.result ?? outcome.response?.prompt ?? null;
    const record = { kind: "result", mode: outcome.mode, elapsedMs: Math.round(performance.now() - started),
      calls: outcome.providerCallsUsed, diagnostic: outcome.diagnostic, output,
      outputHash: output && crypto.createHash("sha256").update(JSON.stringify(output)).digest("hex") };
    write(record);
    return record;
  } finally {
    globalThis.fetch = previous;
  }
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "check")) {
    for (let i = 0; i < 30; i++) makeFixture(i);
    console.log("Validated all 30 synthetic inputs offline.");
    return;
  }
  const [command, provider, tool, destination, first = "1", last = "30"] = args;
  assert(command === "capture" && args.length >= 4 && args.length <= 6, "Expected capture PROVIDER TOOL NEW_DIRECTORY [FIRST LAST].");
  assert(["openai", "gemini"].includes(provider) && ["why", "best", "both"].includes(tool), "Unknown provider or tool.");
  const start = Number(first), end = Number(last);
  assert(Number.isInteger(start) && Number.isInteger(end) && start >= 1 && start <= end && end <= 30, "Use case numbers 1 through 30.");
  const hasKey = provider === "openai" ? process.env.CASELOAD_OPENAI_API_KEY : process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  assert(hasKey?.trim(), "The selected provider has no configured staff credential.");
  process.env.WHY_YOUR_FIRM_ASSIST_PROVIDER = provider;
  process.env.DESIRED_CLIENT_PROVIDER = provider;
  const operations = tool === "why" ? ["why"] : tool === "best" ? ["clarify", "profile"] : ["why", "clarify", "profile"];
  fs.mkdirSync(destination, { mode: 0o700 });
  const inputs = ["scripts/evaluate-assisted-writing/fixtures.cjs", "scripts/evaluate-assisted-writing/run.cjs",
    "src/lib/why-your-firm/assist.ts", "src/lib/why-your-firm/assist-prompt.ts", "src/lib/desired-client/analyze.ts",
    "src/lib/desired-client/provider.ts", "src/lib/desired-client/prompt.ts", "src/lib/desired-client/interview-clarification.ts",
    "src/lib/desired-client/output.ts", "src/lib/ai/openai.ts"];
  const sourceSha256 = Object.fromEntries(inputs.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
  fs.writeFileSync(path.join(destination, "run.json"), JSON.stringify({ provider, tool, start, end,
    syntheticOnly: true, sourceSha256, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA }, null, 2) + "\n",
  { mode: 0o600, flag: "wx" });
  for (let n = start; n <= end; n++) {
    const fixture = makeFixture(n - 1);
    const prefix = path.join(destination, "case-" + String(n).padStart(2, "0"));
    fs.writeFileSync(prefix + "-input.json", JSON.stringify(fixture) + "\n", { mode: 0o600, flag: "wx" });
    for (const operation of operations) {
      const write = row => fs.appendFileSync(prefix + "-" + operation + ".ndjson", JSON.stringify({
        case: n, fixtureHash: fixture.hash, provider, operation, timestamp: new Date().toISOString(), ...row,
      }) + "\n", { mode: 0o600 });
      const result = await runFixture(fixture, provider, operation, write);
      if (result.mode !== "live" || !result.output) throw new Error("Stopped at case " + n + " " + operation + ". Completed attempts are preserved.");
    }
  }
}

module.exports = { assistantOutput, recordRequests, runFixture };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
