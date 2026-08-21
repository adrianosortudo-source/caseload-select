import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("/widget-public/demo route contract", () => {
  it("uses only the no-write Screen demo, not the production public widget", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/widget-public/demo/page.tsx"),
      "utf8",
    );

    expect(route).toContain("import { ScreenDemoWidget }");
    expect(route).toContain("<ScreenDemoWidget />");
    expect(route).not.toContain("ScreenEnginePublicWidget");
    expect(route).not.toMatch(/fetch\s*\(/);
    expect(route).not.toMatch(/supabase/i);
  });
});
