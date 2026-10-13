import { describe, expect, it } from "vitest";
import { FakeAgencyFollowupProvider } from "../agency-followup-provider";
import {
  agencyFollowupContentHash,
  agencyFollowupRecipientHash,
  type AgencyFollowupSendContext,
} from "../agency-followup-domain";
import {
  dispatchAgencyFollowupBatch,
  type AgencyFollowupClaim,
  type AgencyFollowupWorkerDisposition,
  type AgencyFollowupWorkerRepository,
} from "../agency-followup-worker";

const recipient = {
  prospectId: "synthetic-prospect-01",
  firmName: "Synthetic Practice",
  contactName: "Taylor Example",
  contactEmail: "taylor@example.test",
};
const content = { channel: "email" as const, subject: "Synthetic subject", body: "Synthetic body." };
const validContext: AgencyFollowupSendContext = {
  prospectId: recipient.prospectId,
  prospectStage: "contacted",
  recipient,
  contactability: "allowed",
  conversationStatus: "awaiting_reply",
  eligibility: "eligible",
  eligibilityEvidenceRef: "synthetic-evidence",
  sequenceReleased: true,
  messageApproved: true,
  approval: {
    approvedContentHash: agencyFollowupContentHash(content),
    approvedRecipientHash: agencyFollowupRecipientHash(recipient),
    reviewerId: "synthetic-reviewer",
    reviewedAt: "2026-10-12T14:00:00.000Z",
  },
  content,
  dueAt: "2026-10-12T14:30:00.000Z",
  now: "2026-10-12T15:00:00.000Z",
  previousAcceptedAt: null,
  minimumSpacingMs: 0,
  cancelled: false,
};

const claim: AgencyFollowupClaim = {
  id: "synthetic-message-01",
  enrollmentId: "synthetic-enrollment-01",
  attemptCount: 1,
  leaseOwner: "synthetic-worker",
};

class SyntheticRepository implements AgencyFollowupWorkerRepository {
  readonly dispositions: AgencyFollowupWorkerDisposition[] = [];
  claimCalls = 0;
  private available: AgencyFollowupClaim[];

  constructor(private readonly context: AgencyFollowupSendContext, claims = [claim]) {
    this.available = [...claims];
  }

  async claimDueMessages(): Promise<AgencyFollowupClaim[]> {
    this.claimCalls += 1;
    const next = this.available.shift();
    return next ? [next] : [];
  }

  async loadCurrentSendContext(): Promise<AgencyFollowupSendContext> {
    return this.context;
  }

  async persistDisposition(_claim: AgencyFollowupClaim, disposition: AgencyFollowupWorkerDisposition): Promise<void> {
    this.dispositions.push(disposition);
  }
}

describe("Agency follow-up fake dispatcher", () => {
  it.each([
    ["suppression changed after claim", { ...validContext, contactability: "unsubscribed" as const }],
    ["message approval hash changed after claim", {
      ...validContext,
      approval: { ...validContext.approval!, approvedContentHash: "0".repeat(64) },
    }],
    ["eligibility changed after claim", { ...validContext, eligibility: "ineligible" as const }],
  ])("rechecks %s before provider handoff", async (_label, currentContext) => {
    const repository = new SyntheticRepository(currentContext);
    const provider = new FakeAgencyFollowupProvider();
    const result = await dispatchAgencyFollowupBatch({
      repository, provider, workerId: "synthetic-worker", now: validContext.now,
    });
    expect(result).toMatchObject({ claimed: 1, blocked: 1, accepted: 0 });
    expect(provider.uniqueIdempotencyKeysSeen).toBe(0);
    expect(repository.dispositions[0]).toMatchObject({ state: "blocked" });
  });

  it("uses an atomic repository claim so concurrent workers cannot process one row twice", async () => {
    let available = true;
    const repository: AgencyFollowupWorkerRepository = {
      async claimDueMessages() {
        if (!available) return [];
        available = false;
        return [claim];
      },
      async loadCurrentSendContext() { return validContext; },
      async persistDisposition() {},
    };
    const provider = new FakeAgencyFollowupProvider();
    const results = await Promise.all(["worker-a", "worker-b"].map((workerId) => dispatchAgencyFollowupBatch({
      repository, provider, workerId, now: validContext.now,
    })));
    expect(results.reduce((sum, item) => sum + item.claimed, 0)).toBe(1);
    expect(results.reduce((sum, item) => sum + item.accepted, 0)).toBe(1);
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
  });

  it("retries only definitive failures with the same key and bounded backoff", async () => {
    const secondClaim = { ...claim, attemptCount: 2 };
    const repository = new SyntheticRepository(validContext, [claim, secondClaim]);
    const provider = new FakeAgencyFollowupProvider([
      { kind: "definitive_retryable_failure", code: "synthetic_throttle" },
      { kind: "accepted", providerMessageId: "synthetic-accepted", acceptedAt: "2026-10-12T15:01:00.000Z" },
    ]);
    const first = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    const second = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    expect(first.retryScheduled).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "scheduled", retryAt: "2026-10-12T15:00:30.000Z" });
    expect(second.accepted).toBe(1);
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
    expect(repository.dispositions[1]).toMatchObject({ state: "accepted", providerMessageId: "synthetic-accepted" });
  });

  it("re-enqueues a spacing delay at the next configured local send window", async () => {
    const context = {
      ...validContext,
      previousAcceptedAt: "2026-10-12T14:59:00.000Z",
      minimumSpacingMs: 60 * 60_000,
      schedulePolicy: { timezone: "UTC", businessDays: [1, 2, 3, 4, 5, 6, 7], localWindowStart: "16:00" },
    };
    const repository = new SyntheticRepository(context);
    const provider = new FakeAgencyFollowupProvider();
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: context.now });
    expect(result.retryScheduled).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "scheduled", retryAt: "2026-10-12T16:00:00.000Z" });
    expect(provider.uniqueIdempotencyKeysSeen).toBe(0);
  });

  it("persists UNKNOWN quarantine and does not automatically claim it again", async () => {
    const repository = new SyntheticRepository(validContext);
    const provider = new FakeAgencyFollowupProvider([
      { kind: "unknown", detail: "synthetic interruption after handoff" },
    ]);
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    expect(result.unknown).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "unknown", detail: "synthetic interruption after handoff" });
    expect((await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now })).claimed).toBe(0);
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
  });
});
