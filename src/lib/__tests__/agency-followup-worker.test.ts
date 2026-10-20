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
  private available: Array<{ claim: AgencyFollowupClaim; dueAt: number }>;

  constructor(private readonly context: AgencyFollowupSendContext, claims = [claim]) {
    this.available = claims.map((item) => ({ claim: item, dueAt: Date.parse(context.now) }));
  }

  async claimDueMessages(input: { now: string }): Promise<AgencyFollowupClaim[]> {
    this.claimCalls += 1;
    const now = Date.parse(input.now);
    const index = this.available.findIndex((item) => item.dueAt <= now);
    if (index < 0) return [];
    return [this.available.splice(index, 1)[0].claim];
  }

  async loadCurrentSendContext(_claim: AgencyFollowupClaim, now: string): Promise<AgencyFollowupSendContext> {
    return { ...this.context, now };
  }

  async persistDisposition(current: AgencyFollowupClaim, disposition: AgencyFollowupWorkerDisposition): Promise<void> {
    this.dispositions.push(disposition);
    if (disposition.state === "scheduled") {
      this.available.push({
        claim: { ...current, attemptCount: current.attemptCount + 1 },
        dueAt: Date.parse(disposition.retryAt),
      });
    }
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

  it("honors retry backoff, excludes early claims, and accepts once due with the same key", async () => {
    const retryContext: AgencyFollowupSendContext = {
      ...validContext,
      schedulePolicy: { timezone: "UTC", businessDays: [1, 2, 3, 4, 5, 6, 7], localWindowStart: "09:00", localWindowEnd: "17:00" },
    };
    const repository = new SyntheticRepository(retryContext);
    const provider = new FakeAgencyFollowupProvider([
      { kind: "definitive_retryable_failure", code: "synthetic_throttle" },
      { kind: "accepted", providerMessageId: "synthetic-accepted", acceptedAt: "2026-10-12T15:01:00.000Z" },
    ]);
    const first = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    expect(provider.sendCalls).toBe(1);
    const early = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: "2026-10-12T15:00:29.999Z" });
    expect(provider.sendCalls).toBe(1);
    const due = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: "2026-10-12T15:00:30.000Z" });
    expect(first.retryScheduled).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "scheduled", retryAt: "2026-10-12T15:00:30.000Z" });
    expect(early).toMatchObject({ claimed: 0, accepted: 0 });
    expect(due).toMatchObject({ claimed: 1, accepted: 1 });
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
    expect(provider.sendCalls).toBe(2);
    expect(repository.dispositions[1]).toMatchObject({ state: "accepted", providerMessageId: "synthetic-accepted" });
    expect((await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: "2026-10-12T15:00:31.000Z" })).claimed).toBe(0);
    expect(provider.sendCalls).toBe(2);
  });

  it("exhausts the five-attempt limit across due retries", async () => {
    const repository = new SyntheticRepository(validContext);
    const provider = new FakeAgencyFollowupProvider(Array.from({ length: 5 }, () => ({
      kind: "definitive_retryable_failure" as const,
      code: "synthetic_throttle",
    })));
    let now = validContext.now;
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now });
      expect(result.retryScheduled).toBe(1);
      const disposition = repository.dispositions[attempt - 1];
      if (disposition.state !== "scheduled") throw new Error("A retryable failure did not schedule the next attempt.");
      const expectedDelay = 30_000 * (2 ** (attempt - 1));
      expect(disposition.retryAt).toBe(new Date(Date.parse(now) + expectedDelay).toISOString());
      now = disposition.retryAt;
    }
    const exhausted = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now });
    expect(exhausted).toMatchObject({ claimed: 1, failed: 1, retryScheduled: 0 });
    expect(repository.dispositions).toHaveLength(5);
    expect(repository.dispositions[4]).toMatchObject({ state: "failed", errorCode: "synthetic_throttle" });
    expect(provider.sendCalls).toBe(5);
    const later = new Date(Date.parse(now) + 60_000).toISOString();
    expect((await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: later })).claimed).toBe(0);
    expect(provider.sendCalls).toBe(5);
  });

  it("stops permanently failed attempts without scheduling a retry", async () => {
    const repository = new SyntheticRepository(validContext);
    const provider = new FakeAgencyFollowupProvider([
      { kind: "definitive_permanent_failure", code: "synthetic_invalid_recipient" },
    ]);
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    expect(result).toMatchObject({ claimed: 1, failed: 1, retryScheduled: 0 });
    expect(repository.dispositions[0]).toMatchObject({ state: "failed", errorCode: "synthetic_invalid_recipient" });
    expect(provider.sendCalls).toBe(1);
    expect((await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: "2026-10-12T16:00:00.000Z" })).claimed).toBe(0);
    expect(provider.sendCalls).toBe(1);
  });

  it("re-enqueues a spacing delay at the next configured local send window", async () => {
    const context = {
      ...validContext,
      previousAcceptedAt: "2026-10-12T14:59:00.000Z",
      minimumSpacingMs: 60 * 60_000,
      schedulePolicy: { timezone: "UTC", businessDays: [1, 2, 3, 4, 5, 6, 7], localWindowStart: "16:00", localWindowEnd: "18:00" },
    };
    const repository = new SyntheticRepository(context);
    const provider = new FakeAgencyFollowupProvider();
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: context.now });
    expect(result.retryScheduled).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "scheduled", retryAt: "2026-10-12T16:00:00.000Z" });
    expect(provider.uniqueIdempotencyKeysSeen).toBe(0);
  });

  it("reschedules a delayed weekend claim to the next configured business-day window before provider handoff", async () => {
    const context: AgencyFollowupSendContext = {
      ...validContext,
      now: "2026-10-17T16:00:00.000Z", // Saturday at noon in Toronto
      dueAt: "2026-10-13T13:00:00.000Z",
      schedulePolicy: {
        timezone: "America/Toronto",
        businessDays: [1, 2, 3, 4, 5],
        localWindowStart: "09:00",
        localWindowEnd: "17:00",
      },
    };
    const repository = new SyntheticRepository(context);
    const provider = new FakeAgencyFollowupProvider();
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: context.now });
    expect(result).toMatchObject({ claimed: 1, retryScheduled: 1, accepted: 0 });
    expect(repository.dispositions[0]).toMatchObject({
      state: "scheduled",
      retryAt: "2026-10-19T13:00:00.000Z",
      errorCode: "outside_send_window_rescheduled",
    });
    expect(provider.uniqueIdempotencyKeysSeen).toBe(0);
  });

  it("persists UNKNOWN quarantine and does not automatically claim it again", async () => {
    const repository = new SyntheticRepository(validContext);
    const provider = new FakeAgencyFollowupProvider([
      { kind: "unknown", detail: "synthetic interruption after handoff" },
    ]);
    const result = await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now });
    expect(result.unknown).toBe(1);
    expect(provider.sendCalls).toBe(1);
    expect(repository.dispositions[0]).toMatchObject({ state: "unknown", detail: "synthetic interruption after handoff" });
    expect((await dispatchAgencyFollowupBatch({ repository, provider, workerId: "synthetic-worker", now: validContext.now })).claimed).toBe(0);
    expect(provider.uniqueIdempotencyKeysSeen).toBe(1);
    expect(provider.sendCalls).toBe(1);
  });
});
