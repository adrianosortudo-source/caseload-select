import { describe, it, expect } from "vitest";
import { SLOT_REGISTRY } from "../slotRegistry";
import type { MatterType, SlotDefinition } from "../types";

/**
 * Regression guard for the contact-capture doctrine (DR-038, "no contact,
 * no lead"). Every contact slot — name, phone, email, postal — must apply
 * to every matter type in the union, including the routing states
 * (`unknown`, `out_of_scope`).
 *
 * Before 2026-05-26 these slots restricted `applies_to` to seven Corporate
 * matter types, so the post-Phase-A/B real-estate / employment / estates
 * inbound silently fell through the slot machinery and only got rescued
 * by the channel-level multi-turn contact-capture loop. On the web
 * channel that meant non-Corporate leads with missing contact landed in
 * `unconfirmed_inquiries` without ever being asked.
 */

// Single source of truth for the MatterType union, kept manually in sync
// with `MatterType` in types.ts. The compile-time guard in slotRegistry.ts
// catches drift, and this list lets the test exhaustively iterate.
const ALL_MATTER_TYPES: readonly MatterType[] = [
  "business_setup_advisory",
  "shareholder_dispute",
  "unpaid_invoice",
  "contract_dispute",
  "vendor_supplier_dispute",
  "corporate_money_control",
  "corporate_general",
  "general_counsel_advisory",
  "commercial_real_estate",
  "residential_purchase_sale",
  "real_estate_litigation",
  "landlord_tenant",
  "construction_lien",
  "preconstruction_condo",
  "mortgage_dispute",
  "real_estate_general",
  "wrongful_dismissal",
  "severance_review",
  "harassment_complaint",
  "wage_recovery",
  "employment_contract_review",
  "employment_general",
  "will_drafting",
  "power_of_attorney",
  "probate",
  "estate_dispute",
  "estates_general",
  "out_of_scope",
  "unknown",
];

const CONTACT_SLOT_IDS = [
  "client_name",
  "client_phone",
  "client_email",
  "client_postal_code",
] as const;

function findSlot(id: string): SlotDefinition | undefined {
  return SLOT_REGISTRY.find((s) => s.id === id);
}

describe("contact slots — universal applies_to", () => {
  it.each(CONTACT_SLOT_IDS)("%s exists in the registry", (id) => {
    expect(findSlot(id)).toBeDefined();
  });

  it.each(CONTACT_SLOT_IDS)("%s has tier 'contact'", (id) => {
    const slot = findSlot(id)!;
    expect(slot.tier).toBe("contact");
  });

  // The doctrine: every contact slot covers every matter type.
  for (const id of CONTACT_SLOT_IDS) {
    describe(`${id}.applies_to`, () => {
      it.each(ALL_MATTER_TYPES)("includes matter type %s", (matter) => {
        const slot = findSlot(id)!;
        expect(slot.applies_to).toContain(matter);
      });

      it("includes the routing states (unknown, out_of_scope)", () => {
        const slot = findSlot(id)!;
        expect(slot.applies_to).toContain("unknown");
        expect(slot.applies_to).toContain("out_of_scope");
      });

      it("has no surprise entries beyond the canonical MatterType union", () => {
        const slot = findSlot(id)!;
        const allowed = new Set<string>(ALL_MATTER_TYPES);
        const extras = slot.applies_to.filter((m) => !allowed.has(m));
        expect(extras).toEqual([]);
      });
    });
  }
});
