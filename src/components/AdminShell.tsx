"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

/**
 * AdminShell  -  conditionally renders the legacy admin sidebar.
 * Portal, widget, /admin (operator console) and demo routes get clean,
 * sidebar-free layouts. /admin has its own header + tab nav defined in
 * /admin/layout.tsx; the legacy sidebar would double-render the chrome.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isPortal = path.startsWith("/portal");
  const isWidget = path.startsWith("/widget");
  const isDemo = path.startsWith("/demo");
  const isOperatorConsole = path.startsWith("/admin");
  const isPrivacy = path === "/privacy";
  const isTerms = path === "/terms";

  if (isPortal || isWidget || isDemo || isOperatorConsole || isPrivacy || isTerms) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
