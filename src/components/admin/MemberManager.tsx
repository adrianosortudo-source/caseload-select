"use client";

/**
 * MemberManager: operator UI to grant and manage portal access for one firm.
 *
 * Add a person (fires the magic-link invite), resend a link, and remove
 * (soft-disable) or re-enable access. After each mutation it calls
 * router.refresh() so the server-rendered list re-reads from firm_lawyers.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  roleLabel,
  memberStatusLabel,
  type AssignableRole,
} from "@/lib/firm-members-pure";

export interface MemberView {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  title: string | null;
  disabled: boolean;
  invitation_sent_at: string | null;
  last_signed_in_at: string | null;
  created_at: string;
}

export default function MemberManager({
  firmId,
  firmName,
  initialMembers,
}: {
  firmId: string;
  firmName: string;
  initialMembers: MemberView[];
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("admin");
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [shortLink, setShortLink] = useState<{ id: string; url: string; copied: boolean } | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, displayName, title }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError((body as { error?: string }).error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      setNotice(`Invite sent to ${email.trim().toLowerCase()}.`);
      setEmail("");
      setDisplayName("");
      setTitle("");
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setAdding(false);
    }
  }

  async function onResend(m: MemberView) {
    setBusyId(m.id);
    setRowError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/members/${m.id}/resend`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: m.id, message: (body as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      const sent = (body as { sent?: boolean }).sent;
      setNotice(sent === false ? `Link generated for ${m.email} (email send not configured).` : `Link sent to ${m.email}.`);
    } catch (err) {
      setRowError({ id: m.id, message: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusyId(null);
    }
  }

  async function onCopyLink(m: MemberView) {
    setBusyId(m.id);
    setRowError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/members/${m.id}/signin-code`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: m.id, message: (body as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      const url = (body as { url?: string }).url ?? "";
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Clipboard blocked (insecure context or permission). The link is still
        // shown below for manual copy.
      }
      setShortLink({ id: m.id, url, copied });
    } catch (err) {
      setRowError({ id: m.id, message: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleDisabled(m: MemberView) {
    if (!m.disabled) {
      const ok = confirm(
        "Remove this person's access? They keep any active session until it expires (up to 30 days) but cannot get a new sign-in link.",
      );
      if (!ok) return;
    }
    setBusyId(m.id);
    setRowError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/members/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !m.disabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowError({ id: m.id, message: (body as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      router.refresh();
    } catch (err) {
      setRowError({ id: m.id, message: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onAdd} className="bg-white border border-black/10 p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy">Add a person</h2>
          <span className="text-[11px] text-black/40 uppercase tracking-wider">
            {firmName}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={adding}
              placeholder="person@firm.com"
              className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
            />
          </label>
          <label className="block min-w-[140px]">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              Role
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AssignableRole)}
              disabled={adding}
              className="w-full text-sm px-3 py-2 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              Name (optional)
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={adding}
              maxLength={120}
              placeholder="Damaris"
              className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
              Title (optional)
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={adding}
              maxLength={120}
              placeholder="Principal"
              className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
            />
          </label>
        </div>

        {addError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2">
            {addError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-black/40">
            Adding emails them a sign-in link automatically. The link is valid for 48 hours.
          </p>
          <button
            type="submit"
            disabled={adding || email.trim().length === 0}
            className="bg-navy text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-navy-deep disabled:opacity-40"
          >
            {adding ? "Adding…" : "Add and invite"}
          </button>
        </div>
      </form>

      {notice && (
        <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-2">
          {notice}
        </div>
      )}

      {initialMembers.length === 0 ? (
        <div className="bg-white border border-black/8 px-6 py-10 text-center">
          <p className="text-sm text-black/60">No one has access to this firm yet. Add the first person above.</p>
        </div>
      ) : (
        <div className="bg-white border border-black/10 overflow-hidden">
          <ul>
            {initialMembers.map((m) => {
              const status = memberStatusLabel(m);
              const isBusy = busyId === m.id;
              return (
                <li
                  key={m.id}
                  className={`px-4 sm:px-5 py-3 border-b border-black/5 last:border-0 ${m.disabled ? "opacity-60" : ""}`}
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-navy break-all">{m.email}</span>
                        <RolePill role={m.role} />
                        <StatusPill status={status} />
                      </div>
                      {(m.display_name || m.title) && (
                        <p className="mt-1 text-xs text-black/60">
                          {[m.display_name, m.title].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {rowError && rowError.id === m.id && (
                        <p className="mt-1 text-[11px] text-red-700">{rowError.message}</p>
                      )}
                      {shortLink && shortLink.id === m.id && (
                        <div className="mt-2 bg-navy/5 border border-navy/15 px-3 py-2 space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-navy">
                            {shortLink.copied ? "Short link copied" : "Short link"}
                          </p>
                          <input
                            readOnly
                            value={shortLink.url}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-full text-xs px-2 py-1.5 border border-navy/20 bg-white text-navy font-mono break-all"
                          />
                          <p className="text-[10px] text-black/45">
                            Hand this out of band (text, WhatsApp) if email is blocked. Valid 48 hours, reusable until then.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      {!m.disabled && (
                        <>
                          <button
                            type="button"
                            onClick={() => onCopyLink(m)}
                            disabled={isBusy}
                            className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40"
                          >
                            {isBusy ? "…" : "Copy link"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onResend(m)}
                            disabled={isBusy}
                            className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40"
                          >
                            {isBusy ? "…" : "Resend link"}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleDisabled(m)}
                        disabled={isBusy}
                        className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 disabled:opacity-40 ${
                          m.disabled
                            ? "border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors"
                            : "text-black/50 hover:text-red-700"
                        }`}
                      >
                        {isBusy ? "…" : m.disabled ? "Enable" : "Remove"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-black/40">
        Removing someone stops new sign-in links immediately. An already-open session lasts up to its 30-day expiry.
      </p>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border bg-navy/5 text-navy border-navy/15">
      {roleLabel(role)}
    </span>
  );
}

function StatusPill({ status }: { status: "Disabled" | "Active" | "Invited" | "Not invited" }) {
  const colour =
    status === "Active" ? "bg-emerald-50 text-emerald-800 border-emerald-300"
    : status === "Invited" ? "bg-gold/15 text-navy border-gold/40"
    : status === "Disabled" ? "bg-stone-100 text-stone-600 border-stone-300"
    : "bg-stone-50 text-stone-500 border-stone-200";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 border ${colour}`}>
      {status}
    </span>
  );
}
