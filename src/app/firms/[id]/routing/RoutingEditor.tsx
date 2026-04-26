"use client";
import { useState } from "react";

interface RoutingRow {
  id: string;
  sub_type: string;
  ghl_pipeline_id: string | null;
  ghl_stage: string | null;
  assigned_staff_id: string | null;
  assigned_staff_email: string | null;
}

interface NewRowDraft {
  sub_type: string;
  ghl_pipeline_id: string;
  ghl_stage: string;
  assigned_staff_id: string;
  assigned_staff_email: string;
}

function emptyDraft(): NewRowDraft {
  return { sub_type: "", ghl_pipeline_id: "", ghl_stage: "", assigned_staff_id: "", assigned_staff_email: "" };
}

export default function RoutingEditor({ firmId, initial }: { firmId: string; initial: RoutingRow[] }) {
  const [rows, setRows]         = useState<RoutingRow[]>(initial);
  const [editId, setEditId]     = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<RoutingRow>>({});
  const [newDraft, setNewDraft] = useState<NewRowDraft>(emptyDraft());
  const [saving, setSaving]     = useState(false);
  const [flash, setFlash]       = useState<string | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  async function addRow() {
    if (!newDraft.sub_type.trim()) return;
    setSaving(true);
    const res  = await fetch(`/api/admin/routing/${firmId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sub_type:             newDraft.sub_type.trim(),
        ghl_pipeline_id:      newDraft.ghl_pipeline_id || null,
        ghl_stage:            newDraft.ghl_stage || null,
        assigned_staff_id:    newDraft.assigned_staff_id || null,
        assigned_staff_email: newDraft.assigned_staff_email || null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (json.row) {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === json.row.id);
        return idx >= 0
          ? prev.map((r) => r.id === json.row.id ? json.row : r)
          : [...prev, json.row];
      });
      setNewDraft(emptyDraft());
      showFlash("Rule saved.");
    }
  }

  async function saveEdit(rowId: string) {
    setSaving(true);
    const res  = await fetch(`/api/admin/routing/${firmId}/${rowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ghl_pipeline_id:      editDraft.ghl_pipeline_id ?? null,
        ghl_stage:            editDraft.ghl_stage ?? null,
        assigned_staff_id:    editDraft.assigned_staff_id ?? null,
        assigned_staff_email: editDraft.assigned_staff_email ?? null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (json.row) {
      setRows((prev) => prev.map((r) => r.id === rowId ? json.row : r));
      setEditId(null);
      showFlash("Rule updated.");
    }
  }

  async function deleteRow(rowId: string) {
    if (!confirm("Delete this routing rule?")) return;
    await fetch(`/api/admin/routing/${firmId}/${rowId}`, { method: "DELETE" });
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    showFlash("Rule deleted.");
  }

  return (
    <div>
      {flash && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {flash}
        </div>
      )}

      {/* Add row form */}
      <div className="card p-4 mb-4">
        <div className="text-xs font-medium text-black/60 mb-3">Add routing rule</div>
        <div className="grid grid-cols-5 gap-2 items-end">
          <div>
            <label className="label">Sub-type</label>
            <input
              className="input text-xs"
              placeholder="e.g. emp_dismissal"
              value={newDraft.sub_type}
              onChange={(e) => setNewDraft((d) => ({ ...d, sub_type: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">GHL Pipeline ID</label>
            <input
              className="input text-xs"
              placeholder="Pipeline ID"
              value={newDraft.ghl_pipeline_id}
              onChange={(e) => setNewDraft((d) => ({ ...d, ghl_pipeline_id: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">GHL Stage</label>
            <input
              className="input text-xs"
              placeholder="Stage name"
              value={newDraft.ghl_stage}
              onChange={(e) => setNewDraft((d) => ({ ...d, ghl_stage: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Staff email</label>
            <input
              className="input text-xs"
              placeholder="staff@firm.com"
              value={newDraft.assigned_staff_email}
              onChange={(e) => setNewDraft((d) => ({ ...d, assigned_staff_email: e.target.value }))}
            />
          </div>
          <div>
            <button
              className="btn-gold text-xs py-2 px-4 w-full"
              disabled={saving || !newDraft.sub_type.trim()}
              onClick={addRow}
            >
              {saving ? "Saving…" : "Add rule"}
            </button>
          </div>
        </div>
      </div>

      {/* Rules table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
            <tr>
              <th className="text-left px-4 py-3">Sub-type</th>
              <th className="text-left py-3">GHL Pipeline ID</th>
              <th className="text-left py-3">GHL Stage</th>
              <th className="text-left py-3">Staff email</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-black/40 text-xs">
                  No routing rules yet. Add one above.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isEditing = editId === row.id;
              return (
                <tr key={row.id} className="border-b border-black/5 last:border-0">
                  {isEditing ? (
                    <>
                      <td className="px-4 py-2">
                        <span className="text-xs font-mono bg-black/5 rounded px-2 py-0.5">{row.sub_type}</span>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          className="input text-xs"
                          value={editDraft.ghl_pipeline_id ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, ghl_pipeline_id: e.target.value || null }))}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          className="input text-xs"
                          value={editDraft.ghl_stage ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, ghl_stage: e.target.value || null }))}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          className="input text-xs"
                          value={editDraft.assigned_staff_email ?? ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, assigned_staff_email: e.target.value || null }))}
                        />
                      </td>
                      <td className="text-right px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => saveEdit(row.id)}
                            disabled={saving}
                            className="text-xs font-medium text-navy hover:underline"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="text-xs text-black/40 hover:text-black/70"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono bg-black/5 rounded px-2 py-0.5">{row.sub_type}</span>
                      </td>
                      <td className="py-3 text-black/60 text-xs">{row.ghl_pipeline_id ?? " - "}</td>
                      <td className="py-3 text-black/60 text-xs">{row.ghl_stage ?? " - "}</td>
                      <td className="py-3 text-black/60 text-xs">{row.assigned_staff_email ?? " - "}</td>
                      <td className="text-right px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditId(row.id);
                              setEditDraft({
                                ghl_pipeline_id:      row.ghl_pipeline_id,
                                ghl_stage:            row.ghl_stage,
                                assigned_staff_id:    row.assigned_staff_id,
                                assigned_staff_email: row.assigned_staff_email,
                              });
                            }}
                            className="text-xs font-medium text-navy hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteRow(row.id)}
                            className="text-xs text-rose-400 hover:text-rose-600"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
