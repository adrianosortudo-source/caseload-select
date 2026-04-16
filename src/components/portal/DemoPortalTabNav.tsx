"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { href: "/demo/portal/dashboard", label: "Dashboard" },
  { href: "/demo/portal/pipeline",  label: "Pipeline"  },
  { href: "/demo/portal/phases",    label: "Phases"    },
];

export default function DemoPortalTabNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-black/8 bg-white/60 backdrop-blur-sm shrink-0">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex gap-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-navy text-navy"
                    : "border-transparent text-black/50 hover:text-black/80 hover:border-black/20"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
