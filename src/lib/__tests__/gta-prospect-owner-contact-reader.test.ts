import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GtaProspectOwnerContactLedgerUnavailableError,
  listGtaProspectOwnerContactsForOperator,
  type GtaProspectOwnerContactReaderClient,
} from "../gta-prospect-owner-contact-reader";

function row(overrides: Record<string, unknown> = {}) {
  return {
    source_record_key: "example-family-law",
    owner_name: "Avery Example",
    owner_role: "sole_proprietor",
    ownership_confidence: "confirmed_owner",
    ownership_source_url: "https://example.test/about",
    ownership_observed_on: "2026-09-08",
    email_availability: "direct_owner_email",
    email_address: "avery@example.test",
    email_source_url: "https://example.test/contact",
    email_observed_on: "2026-09-08",
    is_primary_contact: true,
    ...overrides,
  };
}

function client(data: unknown, error: { code?: string; message?: string } | null = null): GtaProspectOwnerContactReaderClient {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe("GTA prospect owner-contact operator reader", () => {
  it("maps only the typed current summary", async () => {
    const db = client([row()]);
    await expect(listGtaProspectOwnerContactsForOperator(db)).resolves.toEqual([
      expect.objectContaining({
        sourceRecordKey: "example-family-law",
        ownerName: "Avery Example",
        emailAvailability: "direct_owner_email",
      }),
    ]);
    expect(db.rpc).toHaveBeenCalledWith("list_gta_prospect_owner_contacts_for_operator");
  });

  it("uses fallback only when the new read projection does not exist", async () => {
    await expect(listGtaProspectOwnerContactsForOperator(client(null, {
      code: "PGRST202",
      message: "Could not find the function public.list_gta_prospect_owner_contacts_for_operator in the schema cache",
    }))).rejects.toBeInstanceOf(GtaProspectOwnerContactLedgerUnavailableError);
  });

  it("fails closed when an email is not tied to confirmed ownership", async () => {
    await expect(listGtaProspectOwnerContactsForOperator(client([
      row({ ownership_confidence: "leadership_only" }),
    ]))).rejects.toThrow("direct owner email requires confirmed ownership");
    await expect(listGtaProspectOwnerContactsForOperator(client([
      row({ internal_note: "do not expose" }),
    ]))).rejects.toThrow("unexpected column(s): internal_note");
  });
});
