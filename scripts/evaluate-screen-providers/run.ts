// From the checkout: node --conditions=react-server --import tsx scripts/evaluate-screen-providers/run.ts
// Uses only the immutable synthetic fixtures. Produces one JSON line per provider per case.
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fixtures } from "./fixtures";
import { captureFixedOpenAICase, evaluate, type Provider } from "./evaluate";

async function main() {
  const selected = process.argv[2];
  const [option, directory, ...extra] = process.argv.slice(3);
  if (option !== undefined && (option !== "--evidence-dir" || selected !== "openai" || !directory || extra.length)) {
    throw new Error("Usage: run.ts openai --evidence-dir NEW_DIRECTORY");
  }
  if (selected && selected !== 'openai' && selected !== 'gemini') throw new Error("Invalid provider");
  const providers: Provider[] = selected === "openai" || selected === "gemini" ? [selected] : ['openai', 'gemini'];
  if ((providers.includes('openai') && !process.env.CASELOAD_OPENAI_API_KEY) ||
      (providers.includes('gemini') && !(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY))) {
    throw new Error("Evaluation provider credentials are required.");
  }
  if (directory) {
    // An exclusive file for each fixture prevents duplicate calls on an accidental rerun.
    await mkdir(directory, { recursive: true });
    for (const fixture of fixtures) {
      const file = await open(join(directory, fixture.id + ".json"), "wx", 0o600);
      try {
        const result = await captureFixedOpenAICase(fixture.id);
        await file.writeFile(JSON.stringify(result, null, 2) + "\n");
        console.log(JSON.stringify({ fixture: fixture.id, mode: result.mode, passed: result.passed }));
      } finally { await file.close(); }
    }
    return;
  }
  for (const fixture of fixtures) {
    // Start both providers together; finish the pair before starting the next.
    const pair = await Promise.all(providers.map(provider => evaluate(fixture, provider)));
    for (const result of pair) console.log(JSON.stringify(result));
  }
}

void main().catch(() => {
  console.error("SCREEN provider evaluation could not complete.");
  process.exitCode = 1;
});
