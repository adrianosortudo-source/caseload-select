import type { PublicProspectContact, ProspectOwnerContactPresentation } from "@/lib/gta-prospect-records";

export type OperationalProspectContact = PublicProspectContact;

const LEADERSHIP_RELATIONSHIPS = new Set<PublicProspectContact["relationship"]>(["owner", "founder", "principal"]);

export function selectOperationalProspectContact(
  contacts: readonly PublicProspectContact[] | undefined,
): OperationalProspectContact | null {
  return contacts?.find((contact) => LEADERSHIP_RELATIONSHIPS.has(contact.relationship) && Boolean(contact.name)) ?? null;
}

function roleLabel(contact: PublicProspectContact): string {
  return ({ owner: "Owner", founder: "Founder", principal: "Principal", named_lawyer: "Named lawyer", firm_inbox: "Firm inbox" })[contact.relationship];
}

function emailKindLabel(contact: PublicProspectContact): string {
  return ({ owner: "Owner email", named_person: "Named-person email", general_firm: "Firm email" })[contact.emailKind];
}

function PublicContactObservation({ contact }: { contact: PublicProspectContact }) {
  return (
    <div className="rounded border border-border-brand/60 px-2 py-1.5">
      <span className="block font-medium text-black/75">{contact.name ?? roleLabel(contact)}</span>
      <span className="block text-black/55">{roleLabel(contact)} · observed {contact.observedAt}</span>
      {contact.email && <span className="mt-1 block break-all">
        <a href={`mailto:${contact.email}`} className="text-navy underline underline-offset-2">{contact.email}</a>
        <span className="ml-1 text-black/55">{emailKindLabel(contact)}</span>
      </span>}
      {contact.sourceUrl && <a href={contact.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-navy underline underline-offset-2">View source</a>}
    </div>
  );
}

export function ProspectContactEvidence({
  publicContacts,
  ownerContact,
}: {
  publicContacts: readonly PublicProspectContact[] | undefined;
  ownerContact: ProspectOwnerContactPresentation | null | undefined;
}) {
  const contacts = publicContacts ?? [];
  const leadership = contacts.filter((contact) => LEADERSHIP_RELATIONSHIPS.has(contact.relationship));
  const namedLawyers = contacts.filter((contact) => contact.relationship === "named_lawyer");
  const firmInboxes = contacts.filter((contact) => contact.relationship === "firm_inbox");

  return <div className="space-y-2">
    {ownerContact && <div className="rounded border border-navy/20 bg-navy/5 px-2 py-1.5">
      <span className="block font-semibold text-navy">{ownerContact.ownerName}</span>
      <span className="block text-black/55">Operator-reviewed {ownerContact.ownerRole.replaceAll("_", " ")}{ownerContact.ownershipConfidence === "leadership_only" ? " (leadership only)" : ""}</span>
      {ownerContact.emailAvailability === "direct_owner_email" && ownerContact.emailAddress
        ? <a href={`mailto:${ownerContact.emailAddress}`} className="mt-1 block break-all text-navy underline underline-offset-2">{ownerContact.emailAddress}</a>
        : <span className="mt-1 block text-black/55">{ownerContact.emailAvailability === "firm_general_email" ? "Firm general email only" : "Direct email not available"}</span>}
    </div>}
    {leadership.length > 0 ? <div className="space-y-1.5" aria-label="Public leadership observations">
      {leadership.map((contact, index) => <PublicContactObservation key={`${contact.relationship}-${contact.name}-${contact.email}-${index}`} contact={contact} />)}
    </div> : !ownerContact && <span className="block text-black/55">Owner not identified</span>}
    {namedLawyers.length > 0 && <div className="space-y-1.5" aria-label="Other named lawyers">
      {namedLawyers.map((contact, index) => <PublicContactObservation key={`${contact.name}-${contact.email}-${index}`} contact={contact} />)}
    </div>}
    {firmInboxes.length > 0 && <div className="space-y-1.5" aria-label="Firm inboxes">
      {firmInboxes.map((contact, index) => <PublicContactObservation key={`${contact.email}-${index}`} contact={contact} />)}
    </div>}
    {contacts.length === 0 && <span className="block text-black/55">No public contact observations</span>}
  </div>;
}
