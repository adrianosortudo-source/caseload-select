import { redirect } from "next/navigation";

/**
 * /home is no longer canonical. Relocated 2026-07-02 to (marketing)/page.tsx
 * at the route-group root per the Website Strategy's canonical-domain
 * decision: / is canonical, /home 301s to /. The next.config.ts redirect
 * handles this at the edge; this page-level redirect is a defense-in-depth
 * fallback for any request that reaches the app without going through the
 * configured redirect (e.g. a stale cache entry). Do not add content here.
 */
export default function HomeRedirectStub() {
  redirect("/");
}
