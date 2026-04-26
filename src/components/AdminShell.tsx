"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

/**
 * AdminShell  -  conditionally renders the admin sidebar.
 * Portal and widget routes get clean, sidebar-free layouts.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isPortal = path.startsWith("/portal");
  const isWidget = path.startsWith("/widget");
  const isDemo = path.startsWith("/demo");

  if (isPortal || isWidget || isDemo) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
