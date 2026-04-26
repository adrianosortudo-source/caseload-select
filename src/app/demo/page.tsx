/**
 * /demo  -  CaseLoad Select sales demonstration page.
 *
 * Auto-provisions a fictional law firm ("Hartwell Law PC") on first load.
 * Subsequent loads reuse the same firm ID.
 *
 * Shows every intake touchpoint: AI widget, GHL-style chat bubble,
 * click-to-call, WhatsApp, contact form.
 *
 * All leads created here flow into the main pipeline and client portal.
 */

import { provisionDemoFirm, ALL_PRACTICE_AREAS } from "./provision-demo-firm";
import DemoLandingPage from "./DemoLandingPage";

export const dynamic = "force-dynamic";
export const metadata = { robots: "noindex" };

export default async function DemoPage() {
  const result = await provisionDemoFirm();

  if ("error" in result) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-500">Demo setup failed: {result.error}</p>
      </div>
    );
  }

  return (
    <DemoLandingPage
      firmId={result.firmId}
      practiceAreaLabels={ALL_PRACTICE_AREAS.map((a) => a.label)}
      branding={result.branding}
    />
  );
}
