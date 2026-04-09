"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function FirmForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("law_firm_clients").insert({
      name: fd.get("name"),
      location: fd.get("location") || null,
      status: "active",
    });
    setBusy(false);
    if (error) {
      alert(error.message);
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
