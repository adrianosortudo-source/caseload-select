"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Lead Pipeline" },
  { href: "/leads/new", label: "New Lead" },
  { href: "/firms", label: "Law Firm Clients" },
  { href: "/sequences", label: "Email Sequences" },
  { href: "/reviews", label: "Review Requests" },
  { href: "/settings", label: "Settings" },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-60 shrink-0 bg-navy text-white min-h-screen flex flex-col">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="text-gold font-semibold tracking-wide">CaseLoad Select</div>
        <div className="text-xs text-white/50 mt-0.5">Sign Better Cases</div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map((l) => {
          const active = path === l.href || (l.href !== "/" && path?.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-gold text-white" : "text-white/80 hover:bg-white/5"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 text-xs text-white/40 border-t border-white/10">
        caseloadselect.ca
      </div>
    </aside>
  );
}
