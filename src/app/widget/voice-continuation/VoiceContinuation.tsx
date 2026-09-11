"use client";

import { useState } from "react";
import { ContinuationWidget, type ContinuationTransport } from "@/components/voice-screen/ContinuationWidget";

/** SMS transport only. Caller rendering lives in the shared component. */
export function VoiceContinuation() {
  const [transport] = useState<ContinuationTransport>(() => {
    let token = "";
    return {
      async load() {
        token ||= window.location.hash.slice(1);
        window.history.replaceState(null, "", window.location.pathname);
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
          throw new Error("Open the link in the text message from your firm to continue.");
        }
        const response = await fetch("/api/voice-screen/continue", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        if (!response.ok) throw new Error("This link is unavailable right now. Please contact the firm if you need help.");
        return response.json();
      },
      async save(payload) {
        const response = await fetch("/api/voice-screen/continue", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw Object.assign(new Error("Your answer could not be saved. Please try again or contact the firm."), { status: response.status });
        return response.json();
      },
    };
  });
  return <ContinuationWidget transport={transport} />;
}
