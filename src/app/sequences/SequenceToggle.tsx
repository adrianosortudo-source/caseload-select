"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SequenceToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    const next = !active;
    setActive(next);
    await fetch(`/api/sequences/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        active ? "bg-emerald-500" : "bg-black/20"
      }`}
      title={active ? "Active — click to deactivate" : "Inactive — click to activate"}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          active ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </button>
  );
}
