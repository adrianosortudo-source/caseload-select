import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260915003000_gta_prospect_research_queue_reactivation.sql"),
  "utf8",
);

describe("GTA prospect research queue reactivation migration", () => {
  it("reopens only retry-held work through a service-only source-scoped function", () => {
    expect(migration).toContain("requeue_gta_prospect_research_work_items");
    expect(migration).toContain("queue.source_system = p_source_system");
    expect(migration).toContain("queue.state = 'retry'");
    expect(migration).toContain("SET state = 'pending'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.requeue_gta_prospect_research_work_items(text, text)\n  TO service_role");
  });

  it("records reactivation without waiving the terms or robots gates", () => {
    expect(migration).toContain("'requeued'");
    expect(migration).toContain("work_item_id, attempt_number, event_type, worker_id, note");
    expect(migration).toContain("does not waive current terms or robots gates");
    expect(migration).not.toContain("gta_prospect_firms");
  });
});