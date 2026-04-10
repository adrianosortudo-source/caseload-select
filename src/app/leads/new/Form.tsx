"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { REFERRAL_OPTIONS } from "@/lib/cpi";
import { URGENCY_OPTIONS, SOURCE_OPTIONS } from "@/lib/scoring";
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
      name:            fd.get("name"),
      email:           fd.get("email"),
      phone:           fd.get("phone"),
      location:        fd.get("location"),
      case_type:       fd.get("case_type"),
      estimated_value: Number(fd.get("estimated_value") || 0),
      language:        fd.get("language"),
      description:     fd.get("description"),
      referral_source: fd.get("referral_source"),
      urgency:         fd.get("urgency"),
      timeline:        fd.get("timeline"),
      intent:          fd.get("intent"),
      source:          fd.get("source"),
      referral:        fd.get("referral") === "on",
      multi_practice:  fd.get("multi_practice") === "on",
      law_firm_id:     (fd.get("law_firm_id") as string) || null,
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
    const s = json.score;
    setMsg(
      `Saved · PI ${s.priority_index} · Band ${s.priority_band} · ` +
      `Fit ${s.fit_score}/30 · Val ${s.value_score}/70 · ` +
      `State ${json.lead.lead_state}`
    );
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">

        {/* ── Contact ──────────────────────────────────────────────── */}
        <div>
          <label className="label">Full name *</label>
          <input className="input" name="name" required />
        </div>
        <div>
          <label className="label">Location (city / region)</label>
          <input className="input" name="location" placeholder="Toronto, ON" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" name="email" type="email" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" name="phone" />
        </div>

        {/* ── Case details ─────────────────────────────────────────── */}
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
          <label className="label">Urgency</label>
          <select className="input" name="urgency" defaultValue="medium">
            {URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Timeline</label>
          <input className="input" name="timeline" placeholder="e.g. court date May 15" />
        </div>

        {/* ── Source & strategic signals ───────────────────────────── */}
        <div>
          <label className="label">How did they find you?</label>
          <select className="input" name="source" defaultValue="organic">
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Referral source (legacy)</label>
          <select className="input" name="referral_source" defaultValue="cold_organic">
            {REFERRAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* ── Flags ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 justify-center">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="referral" className="w-4 h-4 rounded" />
            Referred by existing client
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="multi_practice" className="w-4 h-4 rounded" />
            May need other legal services
          </label>
        </div>

        {/* ── Intent & language ────────────────────────────────────── */}
        <div>
          <label className="label">Intent</label>
          <select className="input" name="intent" defaultValue="considering">
            {INTENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input min-h-28"
            name="description"
            placeholder="Specific matter, relevant facts, desired outcome — more detail = higher legitimacy score"
          />
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
