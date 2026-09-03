import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sent: Array<{ to: string; html: string }> = [];
let recipientRole: "lawyer" | "operator" = "lawyer";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn((to: string, _subject: string, html: string) => {
    sent.push({ to, html });
    return Promise.resolve({ id: "message-1" });
  }),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let queriedRole = "";
      let single = false;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: string) => {
        if (column === "role") queriedRole = value;
        return builder;
      };
      builder.maybeSingle = () => {
        single = true;
        return builder;
      };
      builder.returns = () => Promise.resolve({
        data: single
          ? table === "intake_firms"
            ? { id: "firm-1", name: "Sample Firm", branding: null }
            : null
          : table === "firm_lawyers" && queriedRole === recipientRole
            ? [{ id: `${recipientRole}-1`, email: `${recipientRole}@example.com`, name: "Recipient" }]
            : [],
      });
      return builder;
    },
  },
}));

import { notifyOnFirmFileUpload } from "@/lib/file-notify";
import { buildOperatorNotificationEmail } from "@/lib/firm-onboarding-notification";

const file = {
  id: "file-1",
  firm_id: "firm-1",
  kind: "file" as const,
  section: "reports" as const,
  display_name: "Report.pdf",
  storage_path: "firm-1/report.pdf",
  external_url: null,
  mime_type: "application/pdf",
  size_bytes: 100,
  description: null,
  uploaded_by_role: "lawyer" as const,
  uploaded_by_id: null,
  created_at: new Date().toISOString(),
  archived_at: null,
};

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "caseloadselect.ca");
  vi.stubEnv("VERCEL_ENV", "production");
});

describe("operator notification origin routing", () => {
  it("sends lawyer-uploaded file notifications to the operator origin", async () => {
    recipientRole = "operator";
    await notifyOnFirmFileUpload({
      firmId: "firm-1",
      file: file as never,
      actor: { role: "lawyer", lawyer_id: null },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("https://admin.caseloadselect.ca/portal/firm-1/files");
    expect(sent[0].html).toContain("Open in the operator console");
  });

  it("keeps operator-uploaded file notifications on the lawyer app origin", async () => {
    recipientRole = "lawyer";
    await notifyOnFirmFileUpload({
      firmId: "firm-1",
      file: { ...file, uploaded_by_role: "operator" } as never,
      actor: { role: "operator", lawyer_id: null },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain("https://app.caseloadselect.ca/portal/firm-1/files");
    expect(sent[0].html).toContain("Open in the portal");
  });

  it("places onboarding-review notifications on the operator origin", () => {
    const { html } = buildOperatorNotificationEmail({
      id: "submission-1",
      submission_token: "SAMPLE",
      submitted_at: "2026-09-02T12:00:00.000Z",
      legal_name: "Sample Firm",
    } as never);

    expect(html).toContain(
      "https://admin.caseloadselect.ca/admin/onboarding-submissions/submission-1",
    );
  });
});
