import { sha256GtaProspectResearchQueue, type GtaProspectResearchWorkItem } from "@/lib/gta-prospect-research-work-queue";

import {
  researchGtaProspectWorkItem,
  type GtaProspectResearchCapsule,
  type GtaProspectResearchWorkerOptions,
} from "./index";
export type { GtaProspectResearchCapsule } from "./index";

export type GtaProspectResearchQueueWorkerGateway = Readonly<{
  claim: (input: Readonly<{ workerId: string; limit: number; leaseMinutes: number }>) => Promise<readonly GtaProspectResearchWorkItem[]>;
  defer: (input: Readonly<{ workerId: string; itemId: string; error: string; retryAt: string }>) => Promise<void>;
}>;

/** An append-only durable store under operator control, not browser storage. */
export type GtaProspectResearchCapsuleSink = Readonly<{
  persist: (capsule: GtaProspectResearchCapsule) => Promise<Readonly<{ receipt: string }>>;
}>;

export type GtaProspectResearchWorkerRun = Readonly<{
  claimed: number;
  capturesPersisted: number;
  deferred: number;
  failures: readonly Readonly<{ itemId: string; reason: string }>[];
}>;

export type RunGtaProspectResearchWorkerOptions = GtaProspectResearchWorkerOptions & Readonly<{
  queue: GtaProspectResearchQueueWorkerGateway;
  sink: GtaProspectResearchCapsuleSink;
  claimLimit?: number;
  leaseMinutes?: number;
  /** Research-ready captures remain a governed hold until identity/import review. */
  captureReviewDelayMinutes?: number;
}>;

function retryAt(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return resolved;
}

/**
 * Claim a bounded lease batch, persist each complete evidence capsule first,
 * then defer it into a governed import-review hold. This worker intentionally
 * never resolves/imports a firm: roster count, geography, ownership, and
 * identity must be adjudicated by their own evidence-bearing stages.
 */
export async function runGtaProspectResearchWorker(options: RunGtaProspectResearchWorkerOptions): Promise<GtaProspectResearchWorkerRun> {
  const now = options.now ?? (() => new Date());
  const workerId = options.workerId.trim().toLowerCase();
  if (!/^[-_a-z0-9]{1,120}$/.test(workerId)) throw new Error("workerId must be a lowercase queue worker identifier.");
  const claimLimit = bounded(options.claimLimit, 10, 1, 25, "claimLimit");
  const leaseMinutes = bounded(options.leaseMinutes, 120, 15, 480, "leaseMinutes");
  const captureReviewDelayMinutes = bounded(options.captureReviewDelayMinutes, 7 * 24 * 60, 60, 30 * 24 * 60, "captureReviewDelayMinutes");
  const items = await options.queue.claim({ workerId, limit: claimLimit, leaseMinutes });
  const failures: { itemId: string; reason: string }[] = [];
  let capturesPersisted = 0;
  let deferred = 0;

  for (const item of items) {
    const result = await researchGtaProspectWorkItem(item, options);
    try {
      const { receipt } = await options.sink.persist(result.capsule);
      if (!receipt || receipt.length > 500) throw new Error("Evidence capsule sink returned an invalid receipt.");
      capturesPersisted += 1;
      const reason = result.failure
        ? `research_${result.failure.code}: ${result.failure.message}`
        : `research_capture_pending_governed_import:${sha256GtaProspectResearchQueue({ itemId: item.id, receipt, evidence: result.capsule.evidence.map((entry) => entry.bodySha256) })}`;
      const delay = result.failure?.retryAfterMinutes ?? captureReviewDelayMinutes;
      await options.queue.defer({ workerId, itemId: item.id, error: reason.slice(0, 2_000), retryAt: retryAt(now(), delay) });
      deferred += 1;
    } catch (error) {
      // Do not mark a leased item complete if its evidence durable-write or
      // queue handoff failed. Lease expiry makes the queue retry safely.
      failures.push({ itemId: item.id, reason: error instanceof Error ? error.message : "Research capsule handoff failed." });
    }
  }

  return Object.freeze({ claimed: items.length, capturesPersisted, deferred, failures: Object.freeze(failures) });
}
