import { describe, expect, it } from "vitest";
import type { PublicProspectContact } from "@/lib/gta-prospect-records";
import {
  prospectContactEvidence,
  publicContactEmailKindLabel,
  publicContactRelationshipLabel,
  selectOperationalContact,
} from "../prospect-contact-evidence";

const contacts: PublicProspectContact[] = [
  {
    name: "Avery Founder",
    relationship: "founder",
    email: "avery@example.test",
    emailKind: "owner",
    sourceUrl: "https://example.test/about",
    observedAt: "2026-09-09",
  },
  {
    name: "Priya Principal",
    relationship: "principal",
    email: null,
    emailKind: "named_person",
    sourceUrl: "https://example.test/team",
    observedAt: "2026-09-09",
  },
  {
    name: "Sam Lawyer",
    relationship: "named_lawyer",
    email: "sam@example.test",
    emailKind: "named_person",
    sourceUrl: "https://example.test/sam",
    observedAt: "2026-09-08",
  },
  {
    name: null,
    relationship: "firm_inbox",
    email: "hello@example.test",
    emailKind: "general_firm",
    sourceUrl: "https://example.test/contact",
    observedAt: "2026-09-07",
  },
];

describe("prospect public-contact evidence", () => {
  it("separates leadership evidence from other named lawyers without inferring ownership", () => {
    const evidence = prospectContactEvidence(contacts);
    expect(evidence.leadership.map((contact) => contact.name)).toEqual(["Avery Founder", "Priya Principal"]);
    expect(evidence.namedLawyers.map((contact) => contact.name)).toEqual(["Sam Lawyer"]);
    expect(evidence.emails.map((contact) => contact.email)).toEqual([
      "avery@example.test",
      "sam@example.test",
      "hello@example.test",
    ]);
  });

  it("uses the exact controlled relationship and email-kind labels", () => {
    expect(publicContactRelationshipLabel("owner")).toBe("Owner");
    expect(publicContactRelationshipLabel("founder")).toBe("Founder");
    expect(publicContactRelationshipLabel("principal")).toBe("Principal");
    expect(publicContactRelationshipLabel("named_lawyer")).toBe("Named lawyer");
    expect(publicContactEmailKindLabel("owner")).toBe("Owner email");
    expect(publicContactEmailKindLabel("named_person")).toBe("Named-person email");
    expect(publicContactEmailKindLabel("general_firm")).toBe("General firm email");
  });

  it("keeps the selected leader paired only with the email on the same evidence record", () => {
    expect(selectOperationalContact(contacts)).toEqual(contacts[0]);

    const leaderWithoutEmail = selectOperationalContact(contacts.slice(1));
    expect(leaderWithoutEmail?.name).toBe("Priya Principal");
    expect(leaderWithoutEmail?.email).toBeNull();
    expect(leaderWithoutEmail?.email).not.toBe("sam@example.test");
    expect(leaderWithoutEmail?.email).not.toBe("hello@example.test");
  });
});
