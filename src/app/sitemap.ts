import type { MetadataRoute } from "next";

/**
 * Sitemap for the public marketing surface at caseloadselect.ca.
 *
 * Deliberately narrow: only the routes a prospect can reach and that
 * should rank in search. Portal, admin, widget, and API routes are never
 * listed here (they are also disallowed in robots.ts). /home is omitted;
 * it 301s to / and should not be indexed as a separate URL.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.caseloadselect.ca";

  return [
    {
      url: `${base}/`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/screen-demo`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/case-studies/drg-law`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/what-we-dont-do`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/tools/seo-check`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/privacy`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${base}/terms`,
      lastModified: new Date("2026-07-02"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
