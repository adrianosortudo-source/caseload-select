import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProspectOwnerContactPresentation, PublicProspectContact } from "@/lib/gta-prospect-records";
import { ProspectContactEvidence, selectOperationalProspectContact } from "../prospect-contact-evidence";

const principal: PublicProspectContact = {
  name: "Alex Principal",
  relationship: "principal",
  email: "alex@example.com",
  emailKind: "owner",
  sourceUrl: "https://example.com/team/alex",
  observedAt: "2026-10-01",
};

const firmInbox: PublicProspectContact = {
  name: null,
  relationship: "firm_inbox",
  email: "info@example.com",
  emailKind: "general_firm",
  sourceUrl: "https://example.com/contact",
  observedAt: "2026-10-01",
};

describe("prospect public contact evidence", () => {
  it("keeps each public email attached to the exact person or firm-inbox observation", () => {
    const selected = selectOperationalProspectContact([firmInbox, principal]);
    expect(selected).toEqual(principal);
    expect(selected?.email).toBe("alex@example.com");
    expect(selected?.email).not.toBe(firmInbox.email);

    const html = renderToStaticMarkup(createElement(ProspectContactEvidence, {
      publicContacts: [firmInbox, principal],
      ownerContact: null,
    }));
    expect(html).toContain("Alex Principal");
    expect(html).toContain("Principal");
    expect(html).toContain("alex@example.com");
    expect(html).toContain("info@example.com");
    expect(html).toContain("https://example.com/team/alex");
    expect(html).toContain("https://example.com/contact");
  });

  it("keeps public evidence visible alongside the operator-reviewed owner summary", () => {
    const ownerContact: ProspectOwnerContactPresentation = {
      ownerName: "Alex Principal",
      ownerRole: "managing_partner",
      ownershipConfidence: "confirmed_owner",
      emailAvailability: "direct_owner_email",
      emailAddress: "alex@example.com",
    };
    const html = renderToStaticMarkup(createElement(ProspectContactEvidence, {
      publicContacts: [{ ...principal, observedAt: "2026-09-28" }],
      ownerContact,
    }));

    expect(html).toContain("Operator-reviewed managing partner");
    expect(html).toContain("View source");
    expect(html).toContain("observed 2026-09-28");
    expect(html).toContain("https://example.com/team/alex");
  });

  it("labels named lawyers separately from leadership and preserves explicit unknowns", () => {
    const namedLawyer: PublicProspectContact = {
      ...principal,
      name: "Jordan Lawyer",
      relationship: "named_lawyer",
      email: null,
    };
    const html = renderToStaticMarkup(createElement(ProspectContactEvidence, {
      publicContacts: [namedLawyer],
      ownerContact: null,
    }));

    expect(html).toContain("Owner not identified");
    expect(html).toContain('aria-label="Other named lawyers"');
    expect(html).toContain("Named lawyer");
    expect(html).toContain("Jordan Lawyer");
    expect(html).not.toContain("No public contact observations");
  });
});
