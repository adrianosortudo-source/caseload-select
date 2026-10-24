import {
  AGENCY_FOLLOWUP_RESEND_IDEMPOTENCY_WINDOW_EXPIRED,
  runAgencyFollowupAttempt,
  type AgencyFollowupProvider,
  type AgencyFollowupProviderHandoffGate,
} from "./agency-followup-provider";
import { agencyFollowupRecipientEmailHash, type AgencyFollowupSendContext } from "./agency-followup-domain";
import {
  isWithinAgencyFollowupWindow,
  scheduleAgencyFollowupStep,
} from "./agency-followup-schedule";

export interface AgencyFollowupClaim {
  id: string;
  enrollmentId: string;
  attemptCount: number;
  leaseOwner: string;
}

export type AgencyFollowupWorkerDisposition =
  | { state: "blocked"; blockers: string[]; at: string }
  | { state: "accepted"; providerMessageId: string; recipientEmailHash: string; acceptedAt: string; at: string }
  | { state: "scheduled"; retryAt: string; errorCode: string; at: string }
  | { state: "failed"; errorCode: string; at: string }
  | { state: "unknown"; detail: string; at: string };

export interface AgencyFollowupWorkerRepository {
  claimDueMessages(input: { workerId: string; now: string; leaseSeconds: number; limit: number }): Promise<AgencyFollowupClaim[]>;
  loadCurrentSendContext(claim: AgencyFollowupClaim, now: string): Promise<AgencyFollowupSendContext>;
  persistDisposition(claim: AgencyFollowupClaim, disposition: AgencyFollowupWorkerDisposition): Promise<void>;
  /** Rechecks current authorization and atomically reserves the stable provider key. */
  prepareProviderAttempt?(claim: AgencyFollowupClaim, leaseSeconds: number): Promise<AgencyFollowupProviderHandoffGate>;
}

export interface AgencyFollowupDispatchResult {
  claimed: number;
  accepted: number;
  retryScheduled: number;
  failed: number;
  unknown: number;
  blocked: number;
}

export function retryDelayMs(attemptCount: number): number {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount));
  return Math.min(60 * 60_000, 30_000 * (2 ** (safeAttempt - 1)));
}

function scheduleNextAllowed(context: AgencyFollowupSendContext, earliestAt: string): string {
  if (!context.schedulePolicy) return earliestAt;
  if (isWithinAgencyFollowupWindow(earliestAt, context.schedulePolicy)) return earliestAt;
  return scheduleAgencyFollowupStep({
    anchorAt: earliestAt,
    timezone: context.schedulePolicy.timezone,
    businessDays: context.schedulePolicy.businessDays,
    delayBusinessDays: 0,
    localWindowStart: context.schedulePolicy.localWindowStart,
  });
}

/**
 * Runs a claimed batch against an injected provider. Production-facing callers
 * must supply the fake adapter until an separately approved provider exists.
 * UNKNOWN is terminal and never enters the retry queue.
 */
export async function dispatchAgencyFollowupBatch(input: {
  repository: AgencyFollowupWorkerRepository;
  provider: AgencyFollowupProvider;
  workerId: string;
  now: string;
  leaseSeconds?: number;
  limit?: number;
  maxAttempts?: number;
  /** Real provider callers must fail closed unless the durable handoff gate exists. */
  requireProviderHandoffGuard?: boolean;
}): Promise<AgencyFollowupDispatchResult> {
  if (input.requireProviderHandoffGuard && !input.repository.prepareProviderAttempt) {
    throw new Error("The real Agency follow-up provider requires a durable pre-handoff guard.");
  }
  const claims = await input.repository.claimDueMessages({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: input.leaseSeconds ?? 120,
    limit: input.limit ?? 10,
  });
  const result: AgencyFollowupDispatchResult = {
    claimed: claims.length,
    accepted: 0,
    retryScheduled: 0,
    failed: 0,
    unknown: 0,
    blocked: 0,
  };

  for (const claim of claims) {
    const context = await input.repository.loadCurrentSendContext(claim, input.now);
    const attempt = await runAgencyFollowupAttempt({
      enrollmentId: claim.enrollmentId,
      messageId: claim.id,
      context,
      provider: input.provider,
      beforeProviderHandoff: input.repository.prepareProviderAttempt
        ? () => input.repository.prepareProviderAttempt!(claim, input.leaseSeconds ?? 120)
        : undefined,
    });
    const at = input.now;

    if (attempt.state === "stale") continue;

    if (attempt.state === "blocked") {
      const schedulingBlockers = new Set(["outside_send_window", "minimum_spacing_not_elapsed", "previous_step_pending", "not_due"]);
      if (attempt.blockers.length > 0 && attempt.blockers.every((reason) => schedulingBlockers.has(reason))) {
        let earliestMs = Date.parse(input.now);
        if (attempt.blockers.includes("minimum_spacing_not_elapsed") && context.previousAcceptedAt) {
          earliestMs = Math.max(earliestMs, Date.parse(context.previousAcceptedAt) + context.minimumSpacingMs);
        }
        if (attempt.retryAt) {
          const retryAtMs = Date.parse(attempt.retryAt);
          if (!Number.isFinite(retryAtMs)) throw new Error("The database handoff gate returned an invalid retry time.");
          earliestMs = Math.max(earliestMs, retryAtMs);
        }
        const earliestAt = new Date(earliestMs).toISOString();
        await input.repository.persistDisposition(claim, {
          state: "scheduled",
          retryAt: scheduleNextAllowed(context, earliestAt),
          errorCode: attempt.blockers.includes("outside_send_window")
            ? "outside_send_window_rescheduled"
            : attempt.blockers.includes("minimum_spacing_not_elapsed")
              ? "minimum_spacing_rescheduled"
              : attempt.blockers.includes("previous_step_pending")
                ? "previous_step_pending_rescheduled"
                : "message_not_due_rescheduled",
          at,
        });
        result.retryScheduled += 1;
        continue;
      }
      await input.repository.persistDisposition(claim, { state: "blocked", blockers: attempt.blockers, at });
      result.blocked += 1;
      continue;
    }

    const outcome = attempt.providerOutcome;
    if (!outcome) throw new Error("The fake provider attempt returned no durable outcome.");
    if (attempt.state === "accepted" && outcome.kind === "accepted") {
      await input.repository.persistDisposition(claim, {
        state: "accepted",
        providerMessageId: outcome.providerMessageId,
        recipientEmailHash: attempt.recipientEmailHash ?? agencyFollowupRecipientEmailHash(context.recipient.contactEmail),
        acceptedAt: outcome.acceptedAt,
        at,
      });
      result.accepted += 1;
    } else if (attempt.state === "retry_same_key" && outcome.kind === "definitive_retryable_failure") {
      if (claim.attemptCount >= (input.maxAttempts ?? 5)) {
        await input.repository.persistDisposition(claim, { state: "failed", errorCode: outcome.code, at });
        result.failed += 1;
      } else {
        await input.repository.persistDisposition(claim, {
          state: "scheduled",
          retryAt: scheduleNextAllowed(context, new Date(Date.parse(at) + retryDelayMs(claim.attemptCount)).toISOString()),
          errorCode: outcome.code,
          at,
        });
        result.retryScheduled += 1;
      }
    } else if (attempt.state === "failed" && outcome.kind === "definitive_permanent_failure") {
      await input.repository.persistDisposition(claim, { state: "failed", errorCode: outcome.code, at });
      result.failed += 1;
    } else if (attempt.state === "quarantine_unknown" && outcome.kind === "unknown") {
      if (outcome.detail === AGENCY_FOLLOWUP_RESEND_IDEMPOTENCY_WINDOW_EXPIRED) {
        // The gate atomically persisted UNKNOWN and its audit event before returning expired.
        result.unknown += 1;
        continue;
      }
      await input.repository.persistDisposition(claim, { state: "unknown", detail: outcome.detail, at });
      result.unknown += 1;
    } else {
      throw new Error("Provider outcome and dispatcher state did not match.");
    }
  }
  return result;
}
