"use client";

/**
 * NewFirmForm: operator control to create a firm (intake_firms row) from the
 * Portal access page. On success it selects the new firm so the operator can
 * add people to it right away.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewFirmForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a firm name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/intake-firms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      const id = (body as { firm?: { id?: string } }).firm?.id;
      setName("");
      if (id) {
        router.push(`/admin/access?firm_id=${id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-black/10 p-4 flex items-end gap-3 flex-wrap">
      <label className="block flex-1 min-w-[220px]">
        <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
          New firm
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder="e.g. DRG Law Professional Corporation"
          className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
        />
      </label>
      <button
        type="submit"
        disabled={busy || name.trim().length === 0}
        className="bg-navy text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create firm"}
      </button>
      {error && <span className="text-xs text-red-700 w-full">{error}</span>}
    </form>
  );
}
