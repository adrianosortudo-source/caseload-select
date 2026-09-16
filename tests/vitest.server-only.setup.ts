import { vi } from "vitest";

// The real `server-only` package throws outside Next's compiler. This mock is
// loaded by Vitest alone, before route imports. Do not move it into source:
// production builds must keep the real import as their client-boundary guard.
vi.mock("server-only", () => ({}));
