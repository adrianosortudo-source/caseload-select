/**
 * /demo/sms  -  SMS intake simulation (Option C: Hybrid AI + Structured).
 *
 * iPhone Messages-style UI. Uses /api/screen with channel "sms"
 * (falls through to "chat" behavior: one question at a time, plain text).
 * The AI extracts max data from one free-text reply, then asks only
 * the 1-2 most impactful missing questions as numbered options.
 *
 * Cost model: minimize total messages (each inbound + outbound costs money).
 * Target: 4 outbound + 3 inbound = ~7 messages per intake.
 *
 * Auto-provisions the Hartwell Law demo firm if it doesn't exist yet.
 */

import { provisionDemoFirm } from "../provision-demo-firm";
import SmsChat from "./SmsChat";

export const dynamic = "force-dynamic";
export const metadata = { robots: "noindex" };

export default async function SmsDemoPage() {
  const result = await provisionDemoFirm();

  if ("error" in result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center">
          <p className="text-red-500 text-sm">Demo setup failed: {result.error}</p>
        </div>
      </div>
    );
  }

  return <SmsChat firmId={result.firmId} />;
}
