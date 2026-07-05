"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CadenceShadowImportForm({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("firm_id", firmId);
      const res = await fetch("/api/admin/cadence-shadow/import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setResult(`Failed: ${json.error ?? "unknown error"}`);
      } else {
        setResult(`Imported ${json.inserted} row(s).${json.errors?.length ? ` ${json.errors.length} row(s) skipped.` : ""}`);
        form.reset();
        router.refresh();
      }
    } catch {
      setResult("Failed: network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3 flex-wrap text-xs">
      <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1.5 bg-navy text-white uppercase tracking-wider font-semibold disabled:opacity-50"
      >
        {busy ? "Importing…" : "Import GHL send log"}
      </button>
      {result && <span className="text-black/60">{result}</span>}
    </form>
  );
}
