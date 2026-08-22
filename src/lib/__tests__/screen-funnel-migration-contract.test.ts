import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("screen funnel migration privacy contract", () => {
  it("keeps browser roles denied and the telemetry columns content-free", () => {
    const directory = join(process.cwd(), "supabase", "migrations");
    const filename = readdirSync(directory).find((entry) => entry.endsWith("_screen_funnel_events.sql"));
    expect(filename).toBeTruthy();
    const sql = readFileSync(join(directory, filename!), "utf8").toLowerCase();
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on table public.screen_funnel_events from anon, authenticated, public");
    expect(sql).toContain("grant select, insert on table public.screen_funnel_events to service_role");
    for (const forbidden of ["description", "question_id", "slot_id", "matter_type", "practice_area", "report", "email", "phone", "ip_address", "user_agent", "engine_state", "lead_id", "utm_"]) {
      expect(sql).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
