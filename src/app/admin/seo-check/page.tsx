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
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function AdminSeoCheckPage() {
  return (
    <div>
      <PageHeader
        title="SEO and AI visibility check"
        subtitle="Canonical SEO audit for prospects and clients. Run a quick scan to triage a new site fast, or standard/deep for a full technical, content, and AI-visibility diagnostic. Save results here and revisit them for follow-up."
        right={
          <p className="text-xs text-black/40 max-w-[260px] text-right leading-snug">
            Canonical SEO audit. Prospecting Diagnostic consumes SEO results separately.
          </p>
        }
      />

      <div className="cls-marketing">
        <SeoCheckTool variant="operator" />
      </div>
    </div>
  );
}
