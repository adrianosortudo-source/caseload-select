"use client";

/**
 * Operator lifecycle controls for a share_with_us client-list submission.
 *
 * Two actions, in strict order: mark the CRM import as verified, then delete
 * the uploaded working copy from storage. The delete action stays disabled
 * until verification has run, matching the server-side 409 guard on
 * POST .../client-list/delete-working-copy.
 *
 * Used by the admin detail page at /admin/onboarding-submissions/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  submissionId: string;
  importVerifiedAt: string | null;
  workingCopyDeletedAt: string | null;
}

export function ClientListOpsPanel({ submissionId, importVerifiedAt, workingCopyDeletedAt }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(importVerifiedAt);
  const [deletedAt, setDeletedAt] = useState<string | null>(workingCopyDeletedAt);

  async function onVerify() {
    // Cancel in the prompt dialog aborts the action entirely. Only an
    // explicit OK (with or without text) proceeds to verify.
    const promptResult = window.prompt("Optional note for this import (max 2000 characters):", "");
    if (promptResult === null) return;
    const note = promptResult;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/onboarding-submissions/${encodeURIComponent(submissionId)}/client-list/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error ?? "verify failed");
      setVerifiedAt(json.verified_at);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "verify failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    const confirmed = window.confirm(
      "Delete the uploaded client files from storage? The metadata stays as the audit record.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/onboarding-submissions/${encodeURIComponent(submissionId)}/client-list/delete-working-copy`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error ?? "delete failed");
      setDeletedAt(json.deleted_at);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={onVerify}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-navy text-white text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {verifiedAt ? "Update verification note" : "Mark import verified"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || !verifiedAt || !!deletedAt}
        className="inline-flex items-center gap-2 bg-transparent text-navy border border-navy/40 text-xs font-semibold uppercase tracking-wider px-4 py-2 hover:bg-navy/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {deletedAt ? "Working copy deleted" : "Delete working copy"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
