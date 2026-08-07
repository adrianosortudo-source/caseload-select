"use client";

/**
 * Operator console panel for the firm asset ownership register (DR-111).
 * Grouped-by-category rows, click to expand for the full field set, a
 * transfer/repair list derived from whatever is not firm controlled, and
 * an onboarding/offboarding phase toggle. No credential field exists here
 * by design; the PATCH route rejects one if a caller tries.
 */

import { useState, useMemo } from "react";
import {
  ASSET_CATEGORIES,
  ASSET_OWNERSHIP_CATALOGUE,
} from "@/lib/asset-ownership-catalogue";
import {
  OWNERSHIP_STATUSES,
  STATUS_LABELS,
  buildTransferList,
  groupRowsByCategory,
  type AssetOwnershipRow,
  type OwnershipStatus,
  type ReviewPhase,
} from "@/lib/asset-ownership-pure";

const LABEL_BY_KEY = new Map(ASSET_OWNERSHIP_CATALOGUE.map((e) => [e.key, e.label]));
const CATEGORY_LABEL_BY_KEY = new Map(ASSET_CATEGORIES.map((c) => [c.key, c.label]));
const CATEGORY_ORDER = ASSET_CATEGORIES.map((c) => c.key);

const STATUS_COLOR: Record<OwnershipStatus, string> = {
  firm_controlled: "#1F7A4D",
  shared_access: "#B7791F",
  provider_controlled: "#B00020",
  unknown: "#6B665E",
};

interface Props {
  firmId: string;
  initialRegister: AssetOwnershipRow[];
  initialPhase: ReviewPhase;
}

export default function OwnershipRegisterPanel({ firmId, initialRegister, initialPhase }: Props) {
  const [phase, setPhase] = useState<ReviewPhase>(initialPhase);
  const [register, setRegister] = useState<AssetOwnershipRow[]>(initialRegister);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transferList = useMemo(() => buildTransferList(register), [register]);
  const grouped = useMemo(() => groupRowsByCategory(register, CATEGORY_ORDER), [register]);

  async function loadPhase(nextPhase: ReviewPhase) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/ownership?phase=${nextPhase}`);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load register");
      setPhase(nextPhase);
      setRegister(body.register);
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load register");
    } finally {
      setBusy(false);
    }
  }

  async function seedRegister() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to seed register");
      setRegister(body.register);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to seed register");
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(rowId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/ownership/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to save");
      setRegister((prev) => prev.map((r) => (r.id === rowId ? body.row : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(["onboarding", "offboarding"] as ReviewPhase[]).map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy || p === phase}
            onClick={() => loadPhase(p)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border ${
              p === phase ? "bg-navy text-white border-navy" : "bg-white text-navy border-black/15 hover:border-navy/40"
            }`}
          >
            {p === "onboarding" ? "Onboarding review" : "Offboarding review"}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {register.length === 0 ? (
        <div className="bg-white border border-black/10 px-6 py-8 text-center">
          <p className="text-sm text-black/60 mb-4">
            No {phase} register yet for this firm.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={seedRegister}
            className="px-4 py-2 bg-navy text-white text-sm font-semibold"
          >
            Seed register from the asset catalogue
          </button>
        </div>
      ) : (
        <>
          {transferList.length > 0 ? (
            <div className="bg-white border border-black/10">
              <div className="px-4 py-3 border-b border-black/10">
                <h2 className="text-sm font-bold text-navy">Transfer / repair list</h2>
                <p className="text-xs text-black/50 mt-0.5">
                  Ordered by risk: provider controlled, then unknown, then shared access.
                </p>
              </div>
              <ul className="divide-y divide-black/5">
                {transferList.map((row) => (
                  <li key={row.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <StatusDot status={row.status} />
                    <span className="font-medium text-navy">{LABEL_BY_KEY.get(row.asset_key) ?? row.asset_key}</span>
                    {row.action ? <span className="text-black/60">&mdash; {row.action}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-5">
            {grouped.map((group) => (
              <div key={group.category} className="bg-white border border-black/10">
                <div className="px-4 py-2.5 border-b border-black/10 bg-black/[0.02]">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-navy">
                    {CATEGORY_LABEL_BY_KEY.get(group.category) ?? group.category}
                  </h3>
                </div>
                <ul className="divide-y divide-black/5">
                  {group.rows.map((row) => (
                    <OwnershipRow
                      key={row.id}
                      row={row}
                      label={LABEL_BY_KEY.get(row.asset_key) ?? row.asset_key}
                      expanded={expandedId === row.id}
                      onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      onSave={(patch) => saveRow(row.id, patch)}
                      busy={busy}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: OwnershipStatus }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: STATUS_COLOR[status] }}
      aria-hidden="true"
    />
  );
}

function OwnershipRow({
  row,
  label,
  expanded,
  onToggle,
  onSave,
  busy,
}: {
  row: AssetOwnershipRow;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(row);

  function update<K extends keyof AssetOwnershipRow>(key: K, value: AssetOwnershipRow[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-black/[0.02]"
      >
        <StatusDot status={row.status} />
        <span className="text-navy font-medium flex-1">{label}</span>
        <span className="text-xs text-black/50">{STATUS_LABELS[row.status]}</span>
        {row.account_holder ? <span className="text-xs text-black/40 max-w-[160px] truncate">{row.account_holder}</span> : null}
        <span className="text-black/30">{expanded ? "−" : "+"}</span>
      </button>

      {expanded ? (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-black/5 bg-black/[0.01]">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={draft.status}
                onChange={(e) => update("status", e.target.value as OwnershipStatus)}
                className="w-full border border-black/15 px-2 py-1.5 text-sm"
              >
                {OWNERSHIP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Firm has admin access">
              <select
                value={draft.firm_has_admin === null ? "" : String(draft.firm_has_admin)}
                onChange={(e) => update("firm_has_admin", e.target.value === "" ? null : e.target.value === "true")}
                className="w-full border border-black/15 px-2 py-1.5 text-sm"
              >
                <option value="">Not checked yet</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Account holder (name and email)">
              <input
                type="text"
                value={draft.account_holder ?? ""}
                onChange={(e) => update("account_holder", e.target.value || null)}
                className="w-full border border-black/15 px-2 py-1.5 text-sm"
                placeholder="Whose name and login control this"
              />
            </Field>
            <Field label="Billing owner">
              <input
                type="text"
                value={draft.billing_owner ?? ""}
                onChange={(e) => update("billing_owner", e.target.value || null)}
                className="w-full border border-black/15 px-2 py-1.5 text-sm"
                placeholder="Who pays for and can cancel renewal"
              />
            </Field>
          </div>

          <Field label="Evidence (URL, screenshot reference, or record)">
            <input
              type="text"
              value={draft.evidence_url ?? ""}
              onChange={(e) => update("evidence_url", e.target.value || null)}
              className="w-full border border-black/15 px-2 py-1.5 text-sm"
              placeholder="https:// or a short note pointing to the evidence"
            />
          </Field>

          <Field label="Action needed">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft.action ?? ""}
                onChange={(e) => update("action", e.target.value || null)}
                className="flex-1 border border-black/15 px-2 py-1.5 text-sm"
                placeholder="What must be transferred, documented, or repaired"
              />
              <label className="flex items-center gap-1.5 text-xs text-black/60 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={draft.action_done}
                  onChange={(e) => update("action_done", e.target.checked)}
                />
                Done
              </label>
            </div>
          </Field>

          <Field label="Notes">
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || null)}
              className="w-full border border-black/15 px-2 py-1.5 text-sm min-h-[60px]"
            />
          </Field>

          {row.last_reviewed_at ? (
            <p className="text-xs text-black/40">
              Last reviewed {new Date(row.last_reviewed_at).toLocaleDateString()}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSave({
                status: draft.status,
                account_holder: draft.account_holder,
                account_email: draft.account_email,
                billing_owner: draft.billing_owner,
                firm_has_admin: draft.firm_has_admin,
                evidence_url: draft.evidence_url,
                evidence_note: draft.evidence_note,
                action: draft.action,
                action_done: draft.action_done,
                notes: draft.notes,
              })
            }
            className="px-3 py-1.5 bg-navy text-white text-xs font-semibold"
          >
            Save
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-black/60 mb-1">{label}</span>
      {children}
    </label>
  );
}
