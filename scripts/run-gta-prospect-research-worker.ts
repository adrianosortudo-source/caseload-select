import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256GtaProspectResearchQueue } from "@/lib/gta-prospect-research-work-queue";
import {
  runGtaProspectResearchWorker,
  type GtaProspectResearchCapsule,
  type GtaProspectResearchCapsuleSink,
  type GtaProspectResearchQueueWorkerGateway,
} from "@/lib/gta-prospect-research-worker/runner";
import type { HostResearchPolicy } from "@/lib/gta-prospect-research-worker";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function required(value: string | null | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function parsePositive(value: string | null, fallback: number, name: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Queue endpoint returned HTTP ${response.status}.`);
  }
  return payload as Record<string, unknown>;
}

function queueGateway(baseUrl: string, token: string): GtaProspectResearchQueueWorkerGateway {
  const endpoint = new URL("/admin/prospects/research-queue", baseUrl).toString();
  const request = async (payload: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
      method: "PATCH",
      credentials: "omit",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    return jsonResponse(response);
  };
  return {
    async claim({ workerId, limit, leaseMinutes }) {
      const response = await request({ action: "claim", workerId, limit, leaseMinutes });
      if (response.mode !== "claimed" || !Array.isArray(response.items)) throw new Error("Queue claim response is malformed.");
      // The worker library validates queue item fields before crawling.
      return response.items as never;
    },
    async defer({ workerId, itemId, error, retryAt }) {
      const response = await request({ action: "defer", workerId, itemId, error, retryAt });
      if (response.mode !== "deferred") throw new Error("Queue defer response is malformed.");
    },
  };
}

function fileSink(outputDirectory: string): GtaProspectResearchCapsuleSink {
  return {
    async persist(capsule: GtaProspectResearchCapsule) {
      const receipt = sha256GtaProspectResearchQueue(capsule);
      const path = resolve(outputDirectory, capsule.workItemId, `${receipt}.json`);
      await mkdir(dirname(path), { recursive: true });
      const serialized = `${JSON.stringify(capsule, null, 2)}\n`;
      try {
        await writeFile(path, serialized, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        const existing = await readFile(path, "utf8");
        if (sha256GtaProspectResearchQueue(JSON.parse(existing)) !== receipt) throw new Error(`Existing capsule collision at ${path}.`);
      }
      return { receipt };
    },
  };
}

async function main() {
  const policiesPath = required(option("--policies"), "--policies");
  const outputDirectory = required(option("--output"), "--output");
  const baseUrl = required(option("--base-url") ?? process.env.GTA_PROSPECT_RESEARCH_QUEUE_BASE_URL, "--base-url or GTA_PROSPECT_RESEARCH_QUEUE_BASE_URL");
  const token = required(process.env.GTA_PROSPECT_RESEARCH_QUEUE_TOKEN, "GTA_PROSPECT_RESEARCH_QUEUE_TOKEN");
  const workerId = required(option("--worker-id") ?? process.env.GTA_PROSPECT_RESEARCH_WORKER_ID, "--worker-id or GTA_PROSPECT_RESEARCH_WORKER_ID");
  const policies: unknown = JSON.parse(await readFile(resolve(policiesPath), "utf8"));
  if (!Array.isArray(policies)) throw new Error("The policies file must be a JSON array.");
  const run = await runGtaProspectResearchWorker({
    workerId,
    policies: policies as HostResearchPolicy[],
    queue: queueGateway(baseUrl, token),
    sink: fileSink(resolve(outputDirectory)),
    claimLimit: parsePositive(option("--limit"), 10, "--limit"),
    leaseMinutes: parsePositive(option("--lease-minutes"), 120, "--lease-minutes"),
  });
  // Intentionally no URLs, candidate data, tokens, or response bodies in logs.
  console.log(JSON.stringify({ claimed: run.claimed, capturesPersisted: run.capturesPersisted, deferred: run.deferred, failures: run.failures.length }));
  if (run.failures.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "GTA prospect research worker failed.");
  process.exitCode = 1;
});
