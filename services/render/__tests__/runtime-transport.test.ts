import { afterAll, describe, expect, it, vi } from "vitest";

const { agents } = vi.hoisted(() => ({ agents: [] as import("undici").MockAgent[] }));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    // Keep the real installed dispatcher protocol, but intercept requests
    // in memory so this runtime compatibility check needs no public network.
    Agent: class extends actual.MockAgent {
      constructor() {
        super();
        this.disableNetConnect();
        this.get("https://public.example")
          .intercept({ path: "/", method: "GET" })
          .reply(302, "redirect body", { headers: { location: "https://other.example/" } });
        agents.push(this);
      }
    },
  };
});

import { ssrfSafeFetchOneHop } from "../ssrf-fetch";

afterAll(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
});

describe("renderer runtime transport", () => {
  it("uses the installed dispatcher with the real runtime fetch and leaves redirects to the guard", async () => {
    // Do not mock global fetch: Node 26 + undici 6 fails here with
    // UND_ERR_INVALID_ARG / invalid onError method, before any network I/O.
    const response = await ssrfSafeFetchOneHop("https://public.example/", { timeoutMs: 1000 });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://other.example/");
    expect(await response.text()).toBe("redirect body");
    agents.forEach((agent) => agent.assertNoPendingInterceptors());
  });
});
