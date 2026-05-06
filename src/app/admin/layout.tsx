/**
 * Admin / operator chrome.
 *
 * Gated by getOperatorSession() — only sessions with role='operator' land
 * here. Lawyer sessions are redirected to /portal/login (which signs them
 * in to their firm-scoped portal). Unauthenticated users hit the same
 * login page.
 *
 * Operators sign in via the same /portal/login form the lawyers use. The
 * role on firm_lawyers determines which surface they get (request-link
 * route assigns role='operator' on the token; the login route routes by
 * role; this layout enforces the gate at render time).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getOperatorSession } from "@/lib/portal-auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOperatorSession();
  if (!session) {
    redirect("/portal/login?error=missing");
  }

  return (
    <div className="bg-parchment min-h-screen flex flex-col">
      <header className="bg-[#0D1520] border-b-2 border-gold px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] font-semibold text-gold">
              CaseLoad Select
            </div>
            <div className="text-white text-sm font-semibold mt-0.5 truncate">Operator console</div>
          </div>
        </div>
        <form action="/api/portal/logout" method="POST" className="shrink-0">
          <button
            type="submit"
            className="text-xs text-white/60 hover:text-white transition px-3 py-1.5 border border-white/20 hover:border-white/40 uppercase tracking-wider"
          >
            Sign out
          </button>
        </form>
      </header>

      <nav className="bg-white border-b border-black/8 px-4 sm:px-6 shrink-0 overflow-x-auto">
        <div className="max-w-6xl mx-auto flex items-center gap-1 min-w-max">
          <AdminTab href="/admin/triage" label="Triage queue" />
          <AdminTab href="/admin/webhook-outbox" label="Webhook outbox" />
        </div>
      </nav>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">{children}</main>

      <footer className="text-center text-xs text-black/30 py-6 shrink-0 flex items-center justify-center gap-4">
        <span>CaseLoad Select operator console</span>
        <span aria-hidden>·</span>
        <a href="/privacy" className="hover:text-navy transition-colors">Privacy</a>
        <span aria-hidden>·</span>
        <a href="/terms" className="hover:text-navy transition-colors">Terms</a>
      </footer>
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-4 py-3 text-xs uppercase tracking-wider font-semibold text-black/60 hover:text-navy border-b-2 border-transparent hover:border-navy transition-colors"
    >
      {label}
    </Link>
  );
}
