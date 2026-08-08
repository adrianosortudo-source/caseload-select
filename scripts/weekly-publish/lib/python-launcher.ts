/**
 * F10: shells to the drg-asset-placement skill runtime's Python utilities
 * via its own launcher (runtime/scripts/run.py). The launcher resolves a
 * working interpreter itself (this package's own venv, then the shared
 * installed runtime at ~/.aiox-drg-runtime) and never installs anything;
 * if none is found with the required dependencies, it prints its own exact
 * bootstrap command and exits 1 -- surfaced here verbatim by gate, never a
 * silent skip.
 *
 * This wrapper's own candidate-interpreter list exists only to reach the
 * launcher itself (a pure-stdlib script runnable by any Python 3.8+, per
 * its own header) -- the launcher does the real interpreter resolution.
 * Matches the working interpreter path recorded in memory
 * drg-weekly-orchestrator-run-recipe (Python is not on PATH on this
 * machine; %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe is).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const CANDIDATE_INTERPRETERS = [
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "python.exe") : null,
  "python",
  "python3",
].filter((p): p is string => Boolean(p));

export interface PythonRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runPythonScript(skillRoot: string, scriptRelPath: string, args: string[]): PythonRunResult {
  const launcher = path.join(skillRoot, "runtime", "scripts", "run.py");
  const target = path.join(skillRoot, "runtime", "scripts", scriptRelPath);

  for (const interpreter of CANDIDATE_INTERPRETERS) {
    const result = spawnSync(interpreter, [launcher, target, ...args], { encoding: "utf8" });
    if (result.error) continue; // this candidate interpreter isn't present on this machine, try the next
    return { ok: result.status === 0, exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }

  throw new Error(
    `--skill-root "${skillRoot}": no Python interpreter at all could be spawned to reach the launcher ` +
      `(${launcher}). Bootstrap one, or set AIOX_DRG_RUNTIME to an existing environment, then re-run. Never a silent skip (F10).`,
  );
}
