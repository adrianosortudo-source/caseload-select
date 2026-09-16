"use client";

import { useState } from "react";
import type { FormEvent } from "react";

const BOOTSTRAP_PATH = "/api/operator/preview-qa-session";

/** Posts the existing one-time QA credentials without putting either in a URL. */
export default function PreviewQaBootstrapForm() {
  const [accessSecret, setAccessSecret] = useState("");
  const [bootstrapNonce, setBootstrapNonce] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");

    try {
      const response = await fetch(BOOTSTRAP_PATH, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessSecret, bootstrapNonce }),
      });
      setAccessSecret("");
      setBootstrapNonce("");
      if (response.status === 204) {
        window.location.assign("/admin/prospects");
        return;
      }
    } catch {
      // A generic UI result avoids reflecting deployment or credential details.
    }

    setStatus("error");
  }

  return (
    <main className="flex min-h-screen w-full items-center bg-parchment px-4 py-8 sm:px-6 sm:py-12">
      <section
        data-ui-component-content="preview-qa-bootstrap"
        className="card mx-auto w-full max-w-2xl p-5 sm:p-8"
      >
        <div className="w-full space-y-3">
          <p data-ui-copy="supporting" className="w-full text-xs font-semibold uppercase tracking-wider text-gold">
            Preview-only verification
          </p>
          <h1 data-ui-copy="heading" className="w-full font-display text-2xl font-semibold text-navy sm:text-3xl">
            QA access
          </h1>
          <p data-ui-copy="body" className="w-full text-sm leading-6 text-black/70">
            This preview requires two separate values.
          </p>
          <p data-ui-copy="supporting" className="w-full text-sm leading-6 text-black/70">
            The session is read-only for 15 minutes. It cannot change prospect data, send outreach, or access CRM records.
          </p>
        </div>

        <form className="mt-7 w-full space-y-5" onSubmit={submit}>
          <div className="w-full">
            <label className="label" htmlFor="preview-qa-access-secret">Access secret</label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              className="input"
              id="preview-qa-access-secret"
              name="access-secret"
              onChange={(event) => setAccessSecret(event.target.value)}
              required
              spellCheck={false}
              type="password"
              value={accessSecret}
            />
          </div>
          <div className="w-full">
            <label className="label" htmlFor="preview-qa-bootstrap-nonce">One-time nonce</label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              className="input"
              id="preview-qa-bootstrap-nonce"
              name="bootstrap-nonce"
              onChange={(event) => setBootstrapNonce(event.target.value)}
              required
              spellCheck={false}
              type="password"
              value={bootstrapNonce}
            />
          </div>

          {status === "error" ? (
            <p aria-live="polite" data-ui-copy="supporting" className="w-full text-sm leading-6 text-red-700">
              The QA session did not open. Check the two configured values again.
            </p>
          ) : null}

          <button className="btn-gold w-full disabled:cursor-not-allowed disabled:opacity-60" disabled={status === "submitting"} type="submit">
            {status === "submitting" ? "Opening QA session" : "Open QA session"}
          </button>
        </form>
      </section>
    </main>
  );
}
