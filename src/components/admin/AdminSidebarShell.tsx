"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * AdminSidebarShell  -  responsive chrome around the operator-console sidebar.
 *
 * Desktop (md and up): the sidebar is the same sticky 240px column it has always
 * been. Below md: a fixed top bar with a menu button appears, the sidebar becomes
 * an off-canvas drawer (slide-in over a tap-to-close backdrop), and the content
 * column runs full width. Without this, the fixed-width sidebar crushed every
 * /admin page into a narrow strip on phones.
 *
 * The interior (brand link, FirmSwitcher, sign out) is passed as children from the
 * server component so the firm fetch stays server-side.
 */
export default function AdminSidebarShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (tapping any nav link navigates,
  // so this doubles as the per-link close handler).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 h-14 bg-deep-black flex items-center gap-3 px-3 border-b border-white/8 print:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="w-10 h-10 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-white/8 hover:bg-white/12 transition-colors"
        >
          <span className="block w-4 h-0.5 bg-white rounded" />
          <span className="block w-4 h-0.5 bg-white rounded" />
          <span className="block w-4 h-0.5 bg-white rounded" />
        </button>
        <Link href="/admin" className="leading-none">
          <div className="font-display text-[11px] uppercase tracking-[0.2em] font-semibold text-gold">
            CaseLoad Select
          </div>
          <div className="text-white/40 text-[9px] mt-0.5 uppercase tracking-widest font-display">
            Operator console
          </div>
        </Link>
      </div>

      {/* Backdrop (mobile only) */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        className={`md:hidden fixed inset-0 z-40 bg-black/45 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Sidebar / drawer */}
      <aside
        className={`w-60 shrink-0 bg-deep-black flex flex-col overflow-y-auto border-r border-white/5 print:hidden fixed inset-y-0 left-0 z-50 h-screen transition-transform duration-300 ease-out md:sticky md:top-0 md:z-auto md:translate-x-0 md:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="md:hidden absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/15 text-white text-lg leading-none z-10"
        >
          &times;
        </button>
        {children}
      </aside>
    </>
  );
}
