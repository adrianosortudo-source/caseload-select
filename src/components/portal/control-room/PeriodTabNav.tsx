"use client";

/**
 * CR-12: shared tab navigation for the Weekly Package Control Room's 5
 * routes (Section 5). Same active-state/styling convention as the
 * top-level PortalTabNav (usePathname + Link, border-bottom active
 * indicator) so the period sub-tabs read as part of the same system, not a
 * bolted-on widget.
 */
import { usePathname } from "next/navigation";
import Link from "next/link";

interface PeriodTabNavProps {
  firmId: string;
  periodId: string;
}

export default function PeriodTabNav({ firmId, periodId }: PeriodTabNavProps) {
  const pathname = usePathname();
  const base = `/portal/${firmId}/deliverables/periods/${periodId}`;

  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/content`, label: "Content" },
    { href: `${base}/assets`, label: "Assets" },
    { href: `${base}/review`, label: "Review" },
    { href: `${base}/release`, label: "Release" },
  ];

  return (
    <nav aria-label="Weekly package sections" className="border-b border-black/8 bg-white/40 -mt-2 mb-6">
      <div className="overflow-x-auto">
        <div className="flex gap-1 whitespace-nowrap" role="tablist">
          {tabs.map((tab) => {
            // Overview's own href IS the base path -- every other tab is a
            // sub-path of it, so an exact match is required for Overview
            // specifically (otherwise it would show "active" on every tab).
            const active = tab.href === base ? pathname === base : pathname === tab.href || pathname.startsWith(tab.href + "/");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                role="tab"
                aria-selected={active}
                className={`
                  px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                  ${active
                    ? "text-navy border-[color:var(--portal-accent,#1E2F58)]"
                    : "border-transparent text-black/50 hover:text-black/80 hover:border-black/20"
                  }
                `}
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
