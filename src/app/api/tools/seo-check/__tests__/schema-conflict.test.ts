/**
 * Regression: the "Schema conflicts" signal must not fire on best-practice
 * law-firm schema. Field case preszlerlaw.com declares Organization +
 * LegalService + 22 LocalBusiness locations inside a single @graph, the
 * pattern Google recommends for a multi-location firm. The old detector
 * (orgLike >= 2, counting distinct business-entity TYPES) flagged it as a
 * conflict and advised "consolidate to a single business entity type", which
 * would have destroyed the per-location markup that ranks the firm in local
 * packs. A genuine conflict is two SEPARATE, unlinked business-entity blocks.
 */

import { describe, it, expect, vi } from "vitest";

// route.ts pulls in save-run -> supabase-admin (server-only) plus portal-auth
// and rate-limit at module load; extractSchemaSummary itself is pure, so we
// stub the server surface just to import the module.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { extractSchemaSummary } from "../route";

const ldjson = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

describe("schema conflict detection", () => {
  it("does NOT flag a single @graph declaring Organization + LegalService + LocalBusiness (preszler pattern)", () => {
    const html = ldjson({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Preszler Injury Lawyers" },
        { "@type": "LegalService", name: "Preszler Injury Lawyers" },
        { "@type": "LocalBusiness", name: "Toronto Office" },
        { "@type": "LocalBusiness", name: "Barrie Office" },
      ],
    });
    const s = extractSchemaSummary(html);
    expect(s.hasOrganization).toBe(true);
    expect(s.hasLocalBusiness).toBe(true);
    expect(s.hasLegalService).toBe(true);
    expect(s.conflictingEntity).toBe(false);
  });

  it("does NOT flag multiple business types inside one non-graph block", () => {
    const html = ldjson({
      "@context": "https://schema.org",
      "@type": ["LegalService", "LocalBusiness"],
      name: "Solo Firm",
    });
    expect(extractSchemaSummary(html).conflictingEntity).toBe(false);
  });

  it("DOES flag two separate, unlinked business-entity blocks (competing cards)", () => {
    const html =
      ldjson({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Card One" }) +
      ldjson({ "@context": "https://schema.org", "@type": "Organization", name: "Card Two" });
    expect(extractSchemaSummary(html).conflictingEntity).toBe(true);
  });

  it("does not flag a single business block plus non-business blocks", () => {
    const html =
      ldjson({ "@context": "https://schema.org", "@type": "LegalService", name: "Firm" }) +
      ldjson({ "@context": "https://schema.org", "@type": "BreadcrumbList" }) +
      ldjson({ "@context": "https://schema.org", "@type": "WebSite" });
    expect(extractSchemaSummary(html).conflictingEntity).toBe(false);
  });
});
