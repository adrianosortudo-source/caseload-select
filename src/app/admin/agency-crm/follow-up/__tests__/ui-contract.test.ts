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
    expect(source).toContain("Provider delivery:");
    expect(source).toContain("Email opt-in: {prettyState(first.optInState)}");
    expect(source).toContain("Explicit email opt-in evidence is missing");
    expect(source).toContain("Email opt-in was withdrawn");
    expect(source).toContain("agencyFollowupDeliveryStatusLabel({ messageState: item.state, providerDeliveryStatus: item.providerDeliveryStatus })");
    expect(source).toContain("Inbox receipt not confirmed");
    expect(source).toContain("Updated: <time dateTime={item.providerDeliveryStatusAt}>");
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

  it("keeps the consent panel clear of the mobile operator bar and readable until the desktop grid breakpoint", () => {
    const consentStart = source.indexOf('data-ui-component-content="agency-follow-up-opt-in"');
    const consentEnd = source.indexOf("</section>", consentStart);
    const consentPanel = source.slice(consentStart, consentEnd);
    expect(consentStart).toBeGreaterThanOrEqual(0);
    expect(consentPanel).toContain("scroll-mt-16 w-full min-w-0 border");
    expect(consentPanel).toContain("gap-3 lg:grid-cols-2");
    expect(consentPanel).not.toContain("gap-3 sm:grid-cols-2");
  });

  it("records append-only consent evidence against the current prospect without accepting a recipient override", () => {
    expect(source).toContain('data-ui-component-content="agency-follow-up-opt-in"');
    expect(source).toContain("Current recipient: <strong>{first.recipientEmail || 'No current email on file'}</strong>");
    expect(source).toContain("Current opt-in state: <strong>{prettyState(first.optInState)}</strong>");
    expect(source).toContain("Append explicit opt-in grant");
    expect(source).toContain("Append opt-in withdrawal");
    expect(source).toContain("Date and time recorded in evidence");
    expect(source).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(source).toContain("Convert the evidence time first if it was recorded in another timezone.");
    expect(source).toContain("Evidence source");
    expect(source).toContain("Consent text version");
    expect(source).toContain("Consent text SHA-256");
    expect(source).toContain("Evidence reference");
    expect(source).toContain("Evidence SHA-256");
    expect(source).toContain("any grant explicitly permits Agency follow-up email to this address.");
    expect(source).toContain("fetch(`/api/admin/agency-crm/follow-up/opt-in?prospectId=${encodeURIComponent(prospectId)}`");
    expect(source).toContain("View consent history");
    expect(source).toContain("Recorded by operator:");
    expect(source).toContain("Evidence reference:");
    expect(source).toContain("Evidence SHA-256:");

    const requestStart = source.indexOf("fetch('/api/admin/agency-crm/follow-up/opt-in'");
    const requestEnd = source.indexOf("const result = await response.json()", requestStart);
    const optInRequest = source.slice(requestStart, requestEnd);
    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(optInRequest).toContain("prospectId,");
    expect(optInRequest).toContain("eventType: form.eventType");
    expect(optInRequest).toContain("captureSource: form.captureSource");
    expect(optInRequest).toContain("evidenceReviewed: form.evidenceReviewed");
    expect(optInRequest).toContain("idempotencyKey,");
    expect(optInRequest).not.toMatch(/recipientEmail\s*:/);
  });
});
