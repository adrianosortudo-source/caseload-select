import type { PublicProspectContact } from "@/lib/gta-prospect-records";

const LEADERSHIP_RELATIONSHIPS = new Set<PublicProspectContact["relationship"]>([
  "owner",
  "founder",
  "principal",
]);

const RELATIONSHIP_LABELS: Record<PublicProspectContact["relationship"], string> = {
  owner: "Owner",
  founder: "Founder",
  principal: "Principal",
  named_lawyer: "Named lawyer",
  firm_inbox: "Firm inbox",
};

const EMAIL_KIND_LABELS: Record<PublicProspectContact["emailKind"], string> = {
  owner: "Owner email",
  named_person: "Named-person email",
  general_firm: "General firm email",
};

export function publicContactRelationshipLabel(
  relationship: PublicProspectContact["relationship"],
): string {
  return RELATIONSHIP_LABELS[relationship];
}

export function publicContactEmailKindLabel(
  emailKind: PublicProspectContact["emailKind"],
): string {
  return EMAIL_KIND_LABELS[emailKind];
}

export function prospectContactEvidence(contacts: readonly PublicProspectContact[]) {
  return {
    leadership: contacts.filter(
      (contact) => contact.name !== null && LEADERSHIP_RELATIONSHIPS.has(contact.relationship),
    ),
    namedLawyers: contacts.filter(
      (contact) => contact.name !== null && contact.relationship === "named_lawyer",
    ),
    emails: contacts.filter((contact) => contact.email !== null),
  };
}

/**
 * Selects the person offered to the operations panel. The email always comes
 * from that same evidence record, so a firm inbox or another lawyer's email
 * cannot be displayed or provisioned as the selected leader's address.
 */
export function selectOperationalContact(contacts: readonly PublicProspectContact[]) {
  return contacts.find(
    (contact) => contact.name !== null && LEADERSHIP_RELATIONSHIPS.has(contact.relationship),
  ) ?? null;
}
