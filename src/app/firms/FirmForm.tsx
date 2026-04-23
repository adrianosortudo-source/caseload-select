"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FirmForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/firms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        location: fd.get("location") || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Request failed" }));
      alert(data.error ?? "Request failed");
      return;
    }
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-4 flex gap-3 items-end">
      <div className="flex-1">
        <label className="label">Firm name</label>
        <input className="input" name="name" required placeholder="Example Law LLP" />
      </div>
      <div className="flex-1">
        <label className="label">Location</label>
        <input className="input" name="location" placeholder="Toronto, ON" />
      </div>
      <button className="btn-gold" disabled={busy}>
        {busy ? "Adding…" : "Add firm"}
      </button>
    </form>
  );
}
