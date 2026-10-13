import {
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
  private readonly plan: AgencyProviderOutcome[];
  private nextAcceptedId = 1;

  constructor(outcomePlan: AgencyProviderOutcome[] = []) {
    this.plan = [...outcomePlan];
  }

  async send(request: AgencyFollowupProviderRequest): Promise<AgencyProviderOutcome> {
    this.seenKeys.add(request.idempotencyKey);
    const prior = this.outcomes.get(request.idempotencyKey);
    if (prior) return prior;
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

  get uniqueIdempotencyKeysSeen(): number {
    return this.seenKeys.size;
  }
}

export interface AgencyFollowupAttemptResult {
  state: AgencyOutboxResolution | "blocked";
  blockers: string[];
  logicalMessageKey: string;
  providerOutcome?: AgencyProviderOutcome;
}

export async function runAgencyFollowupAttempt(
  input: {
    enrollmentId: string;
    messageId: string;
    context: AgencyFollowupSendContext;
    provider: AgencyFollowupProvider;
  },
): Promise<AgencyFollowupAttemptResult> {
  const logicalMessageKey = agencyFollowupLogicalMessageKey(input.enrollmentId, input.messageId);
  const blockers = evaluateAgencyFollowupSend(input.context);
  if (blockers.length > 0) return { state: "blocked", blockers, logicalMessageKey };

  const outcome = await input.provider.send({
    idempotencyKey: logicalMessageKey,
    recipientEmail: input.context.recipient.contactEmail,
    subject: input.context.content.subject,
    body: input.context.content.body,
  });
  return {
    state: resolveAgencyProviderOutcome(outcome),
    blockers: [],
    logicalMessageKey,
    providerOutcome: outcome,
  };
}
