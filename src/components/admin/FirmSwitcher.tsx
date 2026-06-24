"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

type Firm = { id: string; name: string };

const FIRM_SCOPED_RE = /^\/admin\/firms\/([^/]+)\/(.*)/;

const NAV_LINKS = [
  {
    label: "Triage",
    href: (_: string) => "/admin/triage",
    active: (p: string, _: string) => p === "/admin/triage" || p.startsWith("/admin/triage/"),
  },
  {
    label: "Routing",
    href: (id: string) => `/admin/firms/${id}/routing`,
    active: (p: string, id: string) => p.startsWith(`/admin/firms/${id}/routing`),
  },
  {
    label: "Portal access",
    href: (id: string) => `/admin/firms/${id}/access`,
    active: (p: string, id: string) => p.startsWith(`/admin/firms/${id}/access`),
  },
  {
    label: "Content",
    href: (id: string) => `/admin/firms/${id}/content-studio`,
    active: (p: string, id: string) => p.startsWith(`/admin/firms/${id}/content-studio`),
  },
  {
    label: "Metrics",
    href: (id: string) => `/admin/firms/${id}/metrics`,
    active: (p: string, id: string) => p.startsWith(`/admin/firms/${id}/metrics`),
  },
  {
    label: "Webhook outbox",
    href: (_: string) => "/admin/webhook-outbox",
    active: (p: string, _: string) => p.startsWith("/admin/webhook-outbox"),
  },
];

const SYSTEM_LINKS = [
  { label: "Onboarding", href: "/admin/onboarding-submissions" },
  { label: "Explainers", href: "/admin/explainers" },
  { label: "SEO check", href: "/admin/seo-check" },
  { label: "Diagnostics", href: "/admin/diagnostic-builder" },
  { label: "Health", href: "/admin/health" },
];

const NAV_LINK_CLASS =
  "flex items-center px-2 py-1.5 text-xs font-display font-semibold transition border-l-2 pl-[calc(0.5rem-2px)]";
const NAV_ACTIVE = "border-gold bg-white/6 text-white";
const NAV_IDLE = "border-transparent text-white/60 hover:text-white/90 hover:bg-white/4";

export default function FirmSwitcher({ firms }: { firms: Firm[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // New-firm inline creator state.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const match = FIRM_SCOPED_RE.exec(pathname);
  const currentFirmId = match ? match[1] : (firms[0]?.id ?? "");
  const currentSegment = match ? match[2] : null;
  const currentFirm = firms.find((f) => f.id === currentFirmId) ?? firms[0];

  function handleFirmSelect(firmId: string) {
    setOpen(false);
    if (currentSegment) {
      router.push(`/admin/firms/${firmId}/${currentSegment}`);
    } else {
      router.push(`/admin/firms/${firmId}/access`);
    }
  }

  async function handleCreateFirm(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError("Enter a firm name.");
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/intake-firms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError((body as { error?: string }).error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      const id = (body as { firm?: { id?: string } }).firm?.id;
      setNewName("");
      setCreating(false);
      if (id) {
        router.push(`/admin/firms/${id}/access`);
      }
      router.refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Firm switcher header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between px-2 mb-1.5">
          <span className="label text-white/30">Firm</span>
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setCreateError(null);
            }}
            title="Create a new firm"
            className="text-[10px] uppercase tracking-wider font-semibold text-white/40 hover:text-gold transition"
          >
            {creating ? "Cancel" : "+ New"}
          </button>
        </div>
        {firms.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-white/40">No firms</div>
        ) : firms.length === 1 ? (
          <div className="px-2 py-1.5 text-xs font-display font-semibold text-gold truncate">
            {currentFirm?.name ?? "Unknown"}
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-display font-semibold text-white/90 hover:text-white hover:bg-white/6 transition"
            >
              <span className="truncate">{currentFirm?.name ?? "Select firm"}</span>
              <span className="text-white/40 shrink-0 text-[10px]">▾</span>
            </button>
            {open && (
              <div className="absolute top-full left-0 right-0 z-50 bg-deep-black border border-white/10 py-1 mt-1">
                {firms.map((firm) => (
                  <button
                    key={firm.id}
                    onClick={() => handleFirmSelect(firm.id)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-white/6 transition ${
                      firm.id === currentFirmId ? "text-gold" : "text-white/70"
                    }`}
                  >
                    {firm.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {creating && (
          <form onSubmit={handleCreateFirm} className="mt-2 px-2 space-y-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
              autoFocus
              placeholder="New firm name"
              className="w-full text-xs px-2 py-1.5 bg-white/5 border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-gold"
            />
            <button
              type="submit"
              disabled={busy || newName.trim().length === 0}
              className="w-full text-[10px] uppercase tracking-wider font-semibold px-2 py-1.5 bg-gold text-deep-black hover:bg-gold/90 disabled:opacity-40 transition"
            >
              {busy ? "Creating…" : "Create firm"}
            </button>
            {createError && <p className="text-[10px] text-red-fail">{createError}</p>}
          </form>
        )}
      </div>

      {/* Firm nav */}
      <nav className="px-3 space-y-0.5 pb-4">
        {NAV_LINKS.map((item) => {
          const href = item.href(currentFirmId);
          const isActive = item.active(pathname, currentFirmId);
          return (
            <Link key={href} href={href} className={`${NAV_LINK_CLASS} ${isActive ? NAV_ACTIVE : NAV_IDLE}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* System nav */}
      <div className="mt-2 px-3 border-t border-white/5 pt-4">
        <div className="label px-2 mb-1.5 text-white/30">System</div>
        <nav className="space-y-0.5">
          {SYSTEM_LINKS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} className={`${NAV_LINK_CLASS} ${isActive ? NAV_ACTIVE : NAV_IDLE}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
