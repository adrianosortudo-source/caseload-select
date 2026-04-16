/**
 * Demo portal layout — /demo/portal
 *
 * No auth required. Always shows the Hartwell Law PC [DEMO] firm.
 * Gold banner makes it clear this is a demo view.
 */

import Link from "next/link";
import DemoPortalTabNav from "@/components/portal/DemoPortalTabNav";

const NAVY = "#1E2F58";
const GOLD = "#C4B49A";

export default function DemoPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-parchment min-h-screen flex flex-col">
      {/* Demo context banner */}
      <div
        className="w-full text-center py-2 px-4 text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
        style={{ backgroundColor: GOLD, color: "#1a1a2e" }}
      >
        <span>
          🎯 <strong>Demo Partner Dashboard</strong> — Hartwell Law PC is a fictional firm.
          Data updates live as demo intakes are submitted.
        </span>
        <span className="hidden sm:inline text-black/30">·</span>
        <Link href="/demo" className="underline underline-offset-2 hover:opacity-70 transition">
          ← Back to Demo
        </Link>
      </div>

      {/* Header */}
      <header
        className="px-6 py-4 flex items-center justify-between border-b border-black/5 shrink-0"
        style={{ backgroundColor: NAVY }}
      >
        <div>
          <div className="text-white font-semibold text-sm">Hartwell Law PC</div>
          <div className="text-white/50 text-xs">Partner Dashboard · Demo</div>
        </div>
        <Link
          href="/demo"
          className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 rounded border border-white/20 hover:border-white/40"
        >
          ← Demo home
        </Link>
      </header>

      <DemoPortalTabNav />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">{children}</main>

      <footer className="text-center text-xs text-black/30 py-6 shrink-0">
        Powered by CaseLoad Select · Demo environment
      </footer>
    </div>
  );
}
