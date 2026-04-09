"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { REFERRAL_OPTIONS, URGENCY_OPTIONS } from "@/lib/cpi";
import { INTENT_OPTIONS } from "@/lib/state";

export default function NewLeadForm({ firms }: { firms: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      city: fd.get("city"),
      case_type: fd.get("case_type"),
      estimated_value: Number(fd.get("estimated_value") || 0),
      language: fd.get("language"),
      description: fd.get("description"),
      referral_source: fd.get("referral_source"),
      urgency: fd.get("urgency"),
      timeline: fd.get("timeline"),
      intent: fd.get("intent"),
      law_firm_id: (fd.get("law_firm_id") as string) || null,
    };
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMsg("Error: " + (json.error ?? "unknown"));
      return;
    }
    setMsg(
      `Saved. CPI ${json.cpi.cpi_score} · Band ${json.cpi.band} · State ${json.lead.lead_state}`
    );
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Full name *</label>
          <input className="input" name="name" required />
        </div>
        <div>
          <label className="label">City / Location</label>
          <input className="input" name="city" placeholder="Toronto, ON" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" name="email" type="email" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" name="phone" />
        </div>
        <div>
          <label className="label">Case type</label>
          <select className="input" name="case_type" defaultValue="immigration">
            <option value="immigration">Immigration</option>
            <option value="corporate">Corporate</option>
            <option value="family">Family</option>
            <option value="criminal">Criminal</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="label">Estimated value (CAD)</label>
          <input className="input" name="estimated_value" type="number" min="0" step="100" defaultValue="0" />
        </div>
        <div>
          <label className="label">Referral source</label>
          <select className="input" name="referral_source" defaultValue="cold_organic">
            {REFERRAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Urgency</label>
          <select className="input" name="urgency" defaultValue="medium">
            {URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Timeline</label>
          <input className="input" name="timeline" placeholder="e.g. needs filing by May 15" />
        </div>
        <div>
          <label className="label">Intent</label>
          <select className="input" name="intent" defaultValue="considering">
            {INTENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Language</label>
          <select className="input" name="language" defaultValue="EN">
            <option value="EN">English</option>
            <option value="PT">Portuguese</option>
            <option value="FR">French</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Law firm</label>
          <select className="input" name="law_firm_id" defaultValue="">
            <option value="">— None —</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea className="input min-h-28" name="description" placeholder="Specific matter, relevant facts, desired outcome…" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-black/60">{msg}</div>
        <button className="btn-gold" disabled={busy} type="submit">
          {busy ? "Scoring…" : "Create lead"}
        </button>
      </div>
    </form>
  );
}
