import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisThrows: false,
  limiterCtorThrows: false,
  limitThrows: false,
  limitResult: { success: true, remaining: 1, reset: 1_900_000_000_000, limit: 20 },
  limitIdentity: "",
  limiterConfigs: [] as unknown[],
  warnings: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      if (mocks.redisThrows) throw new Error("EXCEPTION_SENTINEL");
    }
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(limit: number, window: string) { return { limit, window }; }
    constructor(config: unknown) {
      mocks.limiterConfigs.push(config);
      if (mocks.limiterCtorThrows) throw new Error("EXCEPTION_SENTINEL");
    }
    async limit(identity: string) {
      mocks.limitIdentity = identity;
      if (mocks.limitThrows) throw new Error("EXCEPTION_SENTINEL");
      return mocks.limitResult;
    }
  },
}));

async function freshLimiter() {
  vi.resetModules();
  return import("../rate-limit");
}

const NEW_BUCKETS = [
  ["desiredClientAnalyze", 20],
  ["desiredClientDaily", 100],
  ["desiredClientGlobal", 2000],
] as const;
const NEW_BUCKET_WINDOWS: Record<(typeof NEW_BUCKETS)[number][0], number> = {
  desiredClientAnalyze: 600,
  desiredClientDaily: 86400,
  desiredClientGlobal: 86400,
};
const NEW_BUCKET_FLAG_CASES = NEW_BUCKETS.flatMap(([bucket, limit]) =>
  (["true", "false"] as const).map((flag) => [bucket, limit, flag] as const),
);

describe("Desired Client rate limits fail closed with generic diagnostics", () => {
  const saved = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    legacyFlag: process.env.RATE_LIMIT_FAIL_CLOSED,
  };

  beforeEach(() => {
    mocks.redisThrows = false;
    mocks.limiterCtorThrows = false;
    mocks.limitThrows = false;
    mocks.limitResult = { success: true, remaining: 1, reset: 1_900_000_000_000, limit: 20 };
    mocks.limitIdentity = "";
    mocks.limiterConfigs = [];
    mocks.warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => { mocks.warnings.push(args); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = saved.url;
    if (saved.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = saved.token;
    if (saved.legacyFlag === undefined) delete process.env.RATE_LIMIT_FAIL_CLOSED;
    else process.env.RATE_LIMIT_FAIL_CLOSED = saved.legacyFlag;
  });

  it.each(["true", "false"]) ("denies every new bucket with missing Redis when legacy flag is %s", async (flag) => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.RATE_LIMIT_FAIL_CLOSED = flag;
    const limiter = await freshLimiter();
    for (const [bucket, limit] of NEW_BUCKETS) {
      const result = await limiter.checkRateLimit(bucket, "IDENTITY_SENTINEL");
      expect(result).toMatchObject({ ok: false, active: false, remaining: 0, limit });
    }
    const messages = mocks.warnings.flat().join(" ");
    expect(messages).not.toContain("IDENTITY_SENTINEL");
    expect(messages).not.toContain("EXCEPTION_SENTINEL");
  });

  it.each(NEW_BUCKET_FLAG_CASES)("denies %s (limit %s) on Redis client initialization failure with legacy flag %s", async (bucket, limit, flag) => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "TOKEN_SENTINEL";
    process.env.RATE_LIMIT_FAIL_CLOSED = flag;
    mocks.redisThrows = true;
    const limiter = await freshLimiter();
    const result = await limiter.checkRateLimit(bucket, "IDENTITY_SENTINEL");
    expect(result).toMatchObject({ ok: false, active: false, limit });
    const messages = mocks.warnings.flat().join(" ");
    expect(messages).not.toContain("IDENTITY_SENTINEL");
    expect(messages).not.toContain("EXCEPTION_SENTINEL");
    expect(messages).not.toContain("TOKEN_SENTINEL");
  });

  it.each(NEW_BUCKET_FLAG_CASES)("denies %s (limit %s) on limiter construction failure with legacy flag %s", async (bucket, limit, flag) => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "TOKEN_SENTINEL";
    process.env.RATE_LIMIT_FAIL_CLOSED = flag;
    mocks.limiterCtorThrows = true;
    const limiter = await freshLimiter();
    const result = await limiter.checkRateLimit(bucket, "IDENTITY_SENTINEL");
    expect(result).toMatchObject({ ok: false, active: false, limit });
    const messages = mocks.warnings.flat().join(" ");
    expect(messages).not.toContain("IDENTITY_SENTINEL");
    expect(messages).not.toContain("EXCEPTION_SENTINEL");
    expect(messages).not.toContain("TOKEN_SENTINEL");
  });

  it.each(NEW_BUCKET_FLAG_CASES)("denies %s (limit %s) when Redis limiter call throws with legacy flag %s", async (bucket, limit, flag) => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "TOKEN_SENTINEL";
    process.env.RATE_LIMIT_FAIL_CLOSED = flag;
    mocks.limitThrows = true;
    const limiter = await freshLimiter();
    const result = await limiter.checkRateLimit(bucket, "IDENTITY_SENTINEL");
    expect(result).toMatchObject({ ok: false, active: false, limit });
    const messages = mocks.warnings.flat().join(" ");
    expect(messages).not.toContain("IDENTITY_SENTINEL");
    expect(messages).not.toContain("EXCEPTION_SENTINEL");
    expect(messages).not.toContain("TOKEN_SENTINEL");
  });

  it.each(NEW_BUCKETS)("uses exact success limits and quota headers for %s", async (bucket, limit) => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    mocks.limitResult = { success: true, remaining: limit - 1, reset: Date.now() + 60_000, limit };
    const limiter = await freshLimiter();
    const ok = await limiter.checkRateLimit(bucket, "203.0.113.8");
    expect(ok).toMatchObject({ ok: true, active: true, remaining: limit - 1, limit });
    expect(mocks.limiterConfigs).toContainEqual(expect.objectContaining({
      limiter: { limit, window: `${NEW_BUCKET_WINDOWS[bucket]} s` },
      prefix: `rl:${bucket}`,
      analytics: false,
    }));

    const reset = Date.now() + 60_000;
    mocks.limitResult = { success: false, remaining: 0, reset, limit };
    const denied = await limiter.checkRateLimit(bucket, "203.0.113.8");
    expect(denied).toMatchObject({ ok: false, active: true, remaining: 0, limit });
    expect(limiter.rateLimitHeaders(denied)).toMatchObject({
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.floor(reset / 1000)),
    });
    expect(limiter.rateLimitHeaders(denied)["Retry-After"]).toBeDefined();
  });

  it("preserves legacy fail-open and flag-gated behavior and whyYourFirmAssist protection", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.RATE_LIMIT_FAIL_CLOSED = "false";
    const limiter = await freshLimiter();
    expect((await limiter.checkRateLimit("startConversation", "ip")).ok).toBe(true);
    expect((await limiter.checkRateLimit("whyYourFirmAssist", "ip")).ok).toBe(false);
    expect((await limiter.checkRateLimit("intake", "ip")).ok).toBe(true);
    process.env.RATE_LIMIT_FAIL_CLOSED = "true";
    expect((await limiter.checkRateLimit("startConversation", "ip")).ok).toBe(false);
    expect((await limiter.checkRateLimit("intake", "ip")).ok).toBe(true);
  });
});
