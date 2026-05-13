"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

/**
 * AdminShell  -  conditionally renders the legacy admin sidebar.
 * Portal, widget, /admin (operator console), demo, compliance, and the
 * public firm-onboarding form get clean, sidebar-free layouts. /admin has
 * its own header + tab nav defined in /admin/layout.tsx; the legacy
 * sidebar would double-render the chrome. /firm-onboarding is sent to
 * client firms' authorised reps, so the operator chrome must not leak.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isPortal = path.startsWith("/portal");
  const isWidget = path.startsWith("/widget");
  const isDemo = path.startsWith("/demo");
  const isOperatorConsole = path.startsWith("/admin");
  const isPrivacy = path === "/privacy";
  const isTerms = path === "/terms";
  const isFirmOnboarding = path.startsWith("/firm-onboarding");

  if (
    isPortal ||
    isWidget ||
    isDemo ||
    isOperatorConsole ||
    isPrivacy ||
    isTerms ||
    isFirmOnboarding
  ) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
