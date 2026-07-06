import type { MetadataRoute } from "next";

/**
 * Robots policy for caseloadselect.ca. Public marketing routes are fully
 * crawlable; every operator, firm, and API surface is disallowed. This is
 * a courtesy signal to well-behaved crawlers, not the actual access
 * control (auth on those routes is the real gate).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/portal", "/api", "/widget", "/widget-public", "/next-steps"],
    },
    sitemap: "https://www.caseloadselect.ca/sitemap.xml",
  };
}
