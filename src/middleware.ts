/**
 * Next.js edge middleware — host-based routing for white-label custom domains.
 *
 * Delegates to src/proxy.ts which rewrites custom firm domains to the
 * correct widget or portal route. Main app domain passes through untouched.
 *
 * Set NEXT_PUBLIC_APP_DOMAIN in Vercel env vars (default: "caseloadselect.ca").
 */

export { proxy as middleware, config } from "./proxy";
