"use client";

import { useState } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function RequestLinkForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/portal/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // The endpoint always returns 200 to avoid leaking which emails are
      // valid. We surface the same generic confirmation either way.
      if (res.ok) setStatus("sent");
      else setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="space-y-2">
        <div className="text-sm text-navy font-semibold">Check your inbox</div>
        <p className="text-sm text-black/60">
          If <span className="text-black/80">{email}</span> is registered, a sign-in link has been sent. The link is valid for 48 hours.
        </p>
        <button
          type="button"
          onClick={() => { setStatus("idle"); setEmail(""); }}
          className="text-xs text-black/50 underline underline-offset-2 hover:text-navy"
        >
          Send to a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-xs uppercase tracking-wider font-semibold text-black/60">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@firm.com"
          className="mt-1 w-full bg-parchment border border-black/15 px-3 py-2 text-sm text-black focus:outline-none focus:border-navy"
        />
      </label>
      <button
        type="submit"
        disabled={status === "sending" || !email.trim()}
        className="w-full bg-navy text-white py-2.5 text-sm font-semibold uppercase tracking-wider disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      {status === "error" && (
        <p className="text-xs text-red-700">Something went wrong. Try again, or contact your CaseLoad Select operator.</p>
      )}
    </form>
  );
}
