/**
 * /admin/seo-check
 *
 * Operator-facing surface for the SEO & AI Visibility Check. Same engine and
 * components as the public tool at /tools/seo-check, run in the "operator"
 * variant: no prospect email gate, a pages-to-scan selector (up to 10), and
 * no sales CTA on the report.
 *
 * The tool's components are styled with the marketing design tokens, which are
 * scoped to `.cls-marketing` and not loaded by the admin Tailwind app. We
 * import the token sheet here and wrap the tool in a `.cls-marketing` container
 * so the brand variables resolve inside the operator console.
 *
 * Auth: getOperatorSession() in /admin/layout.tsx.
 */

import "@/app/(marketing)/styles/tokens.css";
import SeoCheckTool from "@/app/(marketing)/tools/seo-check/_components/SeoCheckTool";

export const dynamic = "force-dynamic";

export default function AdminSeoCheckPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-navy">SEO &amp; AI visibility check</h1>
        <p className="text-sm text-black/55 mt-1 max-w-2xl">
          Run a multi-page diagnostic on any law firm website. 49 signals per page across SEO,
          AI search visibility, schema, local search, performance, and security. Use it on prospects
          before a pitch or on a client site to find what to fix.
        </p>
      </div>

      <div className="cls-marketing">
        <SeoCheckTool variant="operator" />
      </div>
    </div>
  );
}
