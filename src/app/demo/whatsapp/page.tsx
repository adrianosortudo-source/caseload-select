/**
 * /demo/whatsapp  -  WhatsApp intake simulation.
 *
 * Renders a mobile-frame WhatsApp UI that runs the real CaseLoad Screen
 * intake in "whatsapp" channel mode (one question at a time, plain text,
 * no button chips from the API). Quick-reply suggestions are shown as
 * WhatsApp Business-style tappable pills.
 *
 * Auto-provisions the Hartwell Law demo firm if it doesn't exist yet.
 */

import { provisionDemoFirm } from "../provision-demo-firm";
import WhatsAppChat from "./WhatsAppChat";

export const dynamic = "force-dynamic";
export const metadata = { robots: "noindex" };

export default async function WhatsAppDemoPage() {
  const result = await provisionDemoFirm();

  if ("error" in result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#ECE5DD] p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
          <p className="text-red-500 text-sm">Demo setup failed: {result.error}</p>
        </div>
      </div>
    );
  }

  return <WhatsAppChat firmId={result.firmId} />;
}
