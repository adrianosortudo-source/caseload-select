import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  buildOfflineAcceptance,
  failedAcceptanceReport,
  parseNormalizedPackagesJsonl,
  validateFrozenFiveCaseSelection,
  type AcceptanceReport,
  type FrozenFiveCaseReport,
} from "./acceptance-evidence";

type Arguments = { manifest: string; packages: string; frozenFive: string; frozenIndex: string; output: string };
function parseArguments(argv: string[]): Arguments {
  if (argv.shift() !== "acceptance") throw Error("usage: acceptance --manifest SOURCE_MANIFEST --packages NORMALIZED_PACKAGES --frozen-five FROZEN_A4_SELECTION --frozen-index FROZEN_A4_CANDIDATE_INDEX --output REPORT");
  const values: Record<string, string> = {};
  while (argv.length) {
    const flag = argv.shift()!;
    if (!["--manifest", "--packages", "--frozen-five", "--frozen-index", "--output"].includes(flag)) throw Error("acceptance_unknown_option");
    const value = argv.shift();
    if (!value || value.startsWith("--") || values[flag]) throw Error("acceptance_option_missing_or_duplicate");
    values[flag] = value;
  }
  for (const flag of ["--manifest", "--packages", "--frozen-five", "--frozen-index", "--output"]) if (!values[flag]) throw Error("acceptance_required_option_missing");
  return { manifest: values["--manifest"], packages: values["--packages"], frozenFive: values["--frozen-five"], frozenIndex: values["--frozen-index"], output: values["--output"] };
}

export async function main(argv = process.argv.slice(2)): Promise<AcceptanceReport> {
  const args = parseArguments([...argv]);
  const [sourceBytes, packageBytes, frozenBytes, frozenIndexBytes] = await Promise.all([
    readFile(args.manifest), readFile(args.packages), readFile(args.frozenFive), readFile(args.frozenIndex),
  ]);
  const frozenFiveCase: FrozenFiveCaseReport = validateFrozenFiveCaseSelection(frozenBytes, frozenIndexBytes);
  let report: AcceptanceReport;
  try {
    const source = JSON.parse(sourceBytes.toString("utf8")) as unknown;
    const packages = parseNormalizedPackagesJsonl(packageBytes.toString("utf8"));
    report = buildOfflineAcceptance(source, sourceBytes, packages, frozenFiveCase);
  } catch (error) {
    report = failedAcceptanceReport(sourceBytes, frozenFiveCase, error);
  }
  await writeFile(args.output, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({
    outputStatus: report.acceptanceStatus,
    frozenFiveCase: report.frozenFiveCase.status,
    tenCasePilot: report.pilot10.status,
    liveGates: "pending",
    syncStatus: report.syncStatus,
    sourceManifestFileSha256: report.sourceManifestFileSha256,
  }) + "\n");
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const code = error instanceof Error ? error.message.split(/[^a-zA-Z0-9_-]/, 1)[0] : "unknown";
    process.stderr.write("acceptance_cli_failed:" + code + "\n");
    process.exitCode = 1;
  });
}
