import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/app/admin/agency-crm/follow-up/AgencyFollowupClient.tsx"), "utf8");

describe("Agency CRM follow-up operator UI contract", () => {
  it("tags the queue and governed copy, gives text tracks the available width, and avoids em dashes", () => {
    expect(source).toContain('data-ui-component-content="agency-follow-up-queue"');
    expect(source).toContain('data-ui-copy="heading"');
    expect(source).toContain('data-ui-copy="body"');
    expect(source).toContain('data-ui-copy="supporting"');
    expect(source).toContain('className="mt-1 w-full text-2xl');
    expect(source).not.toContain("max-w-");
    expect(source).not.toContain("—");
  });

  it("labels the queue, keeps actions per prospect, and states delivery is disabled", () => {
    expect(source).toContain("Prospect review queue");
    expect(source).toContain("Create draft review");
    expect(source).toContain("Approve this message");
    expect(source).toContain("Release this prospect");
    expect(source).toContain("Sending is off. Messages stay queued.");
    expect(source).toContain("Create template draft");
    expect(source).toContain("Create a journey version");
    expect(source).toContain("Minimum spacing between scheduled messages, hours");
    expect(source).toContain("Approve template v");
    expect(source).toContain("Activate version");
    expect(source).toContain("action: 'pause'");
  });
});
