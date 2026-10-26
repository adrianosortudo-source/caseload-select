import {
  agencyFollowupRecipientEmailHash,
  agencyFollowupLogicalMessageKey,
  evaluateAgencyFollowupSend,
  resolveAgencyProviderOutcome,
  type AgencyFollowupSendContext,
  type AgencyOutboxResolution,
  type AgencyProviderOutcome,
} from "./agency-followup-domain";

export interface AgencyFollowupProviderRequest {
  idempotencyKey: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export interface AgencyFollowupProvider {
  send(request: AgencyFollowupProviderRequest): Promise<AgencyProviderOutcome>;
}

/**
 * A deterministic provider adapter for synthetic tests. No network or email
 * integration exists in this module. Reusing a key returns its original
 * outcome, modeling a provider-side idempotency contract.
 */
export class FakeAgencyFollowupProvider implements AgencyFollowupProvider {
  private readonly outcomes = new Map<string, AgencyProviderOutcome>();
  private readonly seenKeys = new Set<string>();
  private sendCallCount = 0;
  private readonly plan: AgencyProviderOutcome[];
  private readonly providerDelayMs: number;
  private nextAcceptedId = 1;

  constructor(outcomePlan: AgencyProviderOutcome[] = [], providerDelayMs = 0) {
    this.plan = [...outcomePlan];
    this.providerDelayMs = providerDelayMs;
  }

  async send(request: AgencyFollowupProviderRequest): Promise<AgencyProviderOutcome> {
    this.sendCallCount += 1;
    this.seenKeys.add(request.idempotencyKey);
    const prior = this.outcomes.get(request.idempotencyKey);
    if (prior) return prior;
    if (this.providerDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.providerDelayMs));
    }
    const outcome = this.plan.shift() ?? {
      kind: "accepted" as const,
      providerMessageId: `fake-provider-${this.nextAcceptedId++}`,
      acceptedAt: new Date().toISOString(),
    };
    // A definitive retryable failure confirms no acceptance. Keep the same key,
    // but let a later retry consume the next synthetic outcome.
    if (outcome.kind !== "definitive_retryable_failure") this.outcomes.set(request.idempotencyKey, outcome);
    return outcome;
  }

  get sendCalls(): number {
    return this.sendCallCount;
  }

  get uniqueIdempotencyKeysSeen(): number {
    return this.seenKeys.size;
  }
}

export interface AgencyFollowupAttemptResult {
  state: AgencyOutboxResolution | "blocked" | "stale";
  blockers: string[];
  logicalMessageKey: string;
  retryAt?: string;
  recipientEmailHash?: string;
  providerOutcome?: AgencyProviderOutcome;
}

export const AGENCY_FOLLOWUP_RESEND_IDEMPOTENCY_WINDOW_EXPIRED = "resend_idempotency_window_expired";

export type AgencyFollowupProviderHandoffGate =
  | { result: "ready"; request: AgencyFollowupProviderRequest }
  | { result: "blocked"; blockers: string[] }
  | { result: "deferred"; blocker: string; retryAt: string }
  | { result: "expired" }
  | { result: "stale" };

export async function runAgencyFollowupAttempt(
  input: {
    enrollmentId: string;
    messageId: string;
    context: AgencyFollowupSendContext;
    provider: AgencyFollowupProvider;
    beforeProviderHandoff?: () => Promise<AgencyFollowupProviderHandoffGate>;
  },
): Promise<AgencyFollowupAttemptResult> {
  const logicalMessageKey = agencyFollowupLogicalMessageKey(input.enrollmentId, input.messageId);
  const blockers = evaluateAgencyFollowupSend(input.context);
  if (blockers.length > 0) return { state: "blocked", blockers, logicalMessageKey };

  let request: AgencyFollowupProviderRequest = {
    idempotencyKey: logicalMessageKey,
    recipientEmail: input.context.recipient.contactEmail,
    subject: input.context.content.subject,
    body: input.context.content.body,
  };
  if (input.beforeProviderHandoff) {
    const gate = await input.beforeProviderHandoff();
    if (gate.result === "stale") return { state: "stale", blockers: [], logicalMessageKey };
    if (gate.result === "expired") {
      return {
        state: "quarantine_unknown",
        blockers: [],
        logicalMessageKey,
        providerOutcome: { kind: "unknown", detail: AGENCY_FOLLOWUP_RESEND_IDEMPOTENCY_WINDOW_EXPIRED },
      };
    }
    if (gate.result === "blocked") {
      return { state: "blocked", blockers: [...gate.blockers], logicalMessageKey };
    }
    if (gate.result === "deferred") {
      return { state: "blocked", blockers: [gate.blocker], retryAt: gate.retryAt, logicalMessageKey };
    }
    if (gate.request.idempotencyKey !== logicalMessageKey || !gate.request.recipientEmail.trim() ||
        typeof gate.request.subject !== "string" || typeof gate.request.body !== "string") {
      throw new Error("The Agency follow-up handoff authorization returned an invalid message payload.");
    }
    request = gate.request;
  }

  const outcome = await input.provider.send(request);
  return {
    state: resolveAgencyProviderOutcome(outcome),
    blockers: outcome.kind === "blocked" ? outcome.blockers : [],
    logicalMessageKey,
    recipientEmailHash: agencyFollowupRecipientEmailHash(request.recipientEmail),
    providerOutcome: outcome,
  };
}
