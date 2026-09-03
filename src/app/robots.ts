import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isOperatorHost } from "@/lib/app-origins";

/**
 * Robots policy for caseloadselect.ca. Public marketing routes are fully
 * crawlable; every operator, firm, and API surface is disallowed. This is
 * a courtesy signal to well-behaved crawlers, not the actual access
 * control (auth on those routes is the real gate).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const hostname = (await headers()).get("host") ?? "";
  if (isOperatorHost(hostname)) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/operator",
        "/portal",
        "/api",
        "/widget",
        "/widget-public",
        "/next-steps",
      ],
    },
    sitemap: "https://www.caseloadselect.ca/sitemap.xml",
  };
}
