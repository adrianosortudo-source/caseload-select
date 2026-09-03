import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: vi.fn() }));

import { buildDigest } from "../route";

const FIRM = "11111111-1111-1111-1111-111111111111";
const MATTER = "22222222-2222-2222-2222-222222222222";
const DELIVERABLE = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  vi.stubEnv("VERCEL_ENV", "production");
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    recipient_email: "recipient@example.com",
    firm_id: FIRM,
    matter_id: MATTER,
    event_type: "message_new",
    event_payload: { primary_name: "Sample matter", body: "Update" },
    created_at: new Date().toISOString(),
    attempts: 0,
    ...overrides,
  };
}

describe("notification digest origin routing", () => {
  it("routes operator matter links to the admin origin and operator CTA", () => {
    const { html } = buildDigest("operator@example.com", [row()] as never, "operator");

    expect(html).toContain(
      `https://admin.caseloadselect.ca/portal/${FIRM}/m/${MATTER}`,
    );
    expect(html).toContain("Open in operator console");
  });

  it("routes lawyer and client matter links to the app origin", () => {
    const lawyer = buildDigest("lawyer@example.com", [row()] as never, "lawyer").html;
    const client = buildDigest("client@example.com", [row()] as never, "client").html;

    expect(lawyer).toContain(
      `https://app.caseloadselect.ca/portal/${FIRM}/matters/${MATTER}`,
    );
    expect(client).toContain(
      `https://app.caseloadselect.ca/portal/${FIRM}/m/${MATTER}`,
    );
  });

  it("canonicalizes legacy deliverable payloads for the recipient role", () => {
    const deliverable = row({
      matter_id: null,
      event_type: "deliverable_comment_added",
      event_payload: {
        deliverable_id: DELIVERABLE,
        deliverable_title: "Draft article",
        deliverable_url: `https://app.caseloadselect.ca/portal/${FIRM}/deliverables/${DELIVERABLE}`,
      },
    });

    const { html } = buildDigest("operator@example.com", [deliverable] as never, "operator");
    expect(html).toContain(
      `https://admin.caseloadselect.ca/portal/${FIRM}/deliverables/${DELIVERABLE}`,
    );
    expect(html).not.toContain(
      `https://app.caseloadselect.ca/portal/${FIRM}/deliverables/${DELIVERABLE}`,
    );
  });

  it("routes operator firm-message links to the admin console page", () => {
    const message = row({
      matter_id: null,
      event_type: "firm_message_new",
      event_payload: { body: "New message" },
    });

    const { html } = buildDigest("operator@example.com", [message] as never, "operator");
    expect(html).toContain(
      `https://admin.caseloadselect.ca/admin/firms/${FIRM}/messages`,
    );
  });
});
