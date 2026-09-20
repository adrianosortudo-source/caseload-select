"use client";

/**
 * The side menu, and the question counter that rides with it.
 *
 * WHY IT NEVER MOVES FORWARD
 * A visited screen is clickable and an unvisited one is not. The lawyer can
 * go back and change an answer, but the only way to reach a screen for the
 * first time is Continue, because the sequence itself is derived from the
 * answers: skipping ahead to a test screen for a claim not yet kept would be
 * navigating to a screen that does not exist.
 *
 * NO FIXED POSITIONING, NO VIEWPORT UNITS, ANYWHERE IN HERE
 * This page is framed by tools.html. Inside an iframe a vh unit resolves
 * against the frame's current height, not the outer page, so a rail sized in
 * vh feeds the embed protocol's ResizeObserver its own height back and the
 * frame freezes at whatever size it already had. The desktop rail sticks with
 * `sticky` inside a full-height flex column, and the mobile drawer is
 * absolutely positioned inside this component's own relative box. Both size
 * to content, standalone or embedded alike.
 */

import { useState } from "react";
import { copy } from "@/lib/why-your-firm/compliance";
import type { WizardScreen } from "@/lib/why-your-firm/screens";

interface Props {
  screens: WizardScreen[];
  activeKey: string;
  visitedKeys: string[];
  counter: { x: number; y: number } | null;
  onSelect: (key: string) => void;
}

interface Group {
  name: string;
  screens: WizardScreen[];
}

/** Consecutive screens sharing a group heading, in sequence order. */
function groupScreens(screens: WizardScreen[]): Group[] {
  const groups: Group[] = [];
  for (const screen of screens) {
    const last = groups[groups.length - 1];
    if (last && last.name === screen.group) last.screens.push(screen);
    else groups.push({ name: screen.group, screens: [screen] });
  }
  return groups;
}

export default function SideMenu({ screens, activeKey, visitedKeys, counter, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const groups = groupScreens(screens);
  const active = screens.find((s) => s.key === activeKey);
  const counterText = counter
    ? `${copy.nav.questionLabel} ${counter.x} ${copy.nav.questionOf} ${counter.y}`
    : null;

  function select(key: string) {
    setOpen(false);
    onSelect(key);
  }

  const list = (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.name}>
          <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-field-label mb-1.5">
            {group.name}
          </p>
          <div className="flex flex-col">
            {group.screens.map((screen) => {
              const current = screen.key === activeKey;
              const visited = visitedKeys.includes(screen.key);
              const clickable = visited && !current;
              return (
                <button
                  key={screen.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => select(screen.key)}
                  aria-current={current ? "step" : undefined}
                  className={[
                    "text-left text-sm leading-snug py-1 transition",
                    current
                      ? "text-gold-on-light font-semibold"
                      : clickable
                        ? "text-navy hover:text-gold-on-light cursor-pointer"
                        : "text-muted cursor-default",
                  ].join(" ")}
                >
                  {screen.menuLabel}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <nav className="wyf-step-chrome mb-5 lg:mb-0 lg:w-56 lg:shrink-0">
      {/* Under lg: one summary line that opens a drawer in the flow of the tool. */}
      <div className="relative lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-baseline justify-between gap-3 border border-border-brand bg-white px-3.5 py-2.5 text-left"
        >
          <span className="min-w-0">
            {counterText && (
              <span className="block text-[10px] font-display font-semibold uppercase tracking-wider text-field-label">
                {counterText}
              </span>
            )}
            <span className="block text-sm text-navy leading-snug truncate">
              {active?.menuLabel}
            </span>
          </span>
          <span className="text-[10px] font-display font-semibold uppercase tracking-wider text-gold-on-light shrink-0">
            {open ? copy.nav.menuClose : copy.nav.menuOpen}
          </span>
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-20 border border-border-brand bg-white px-3.5 py-3.5">
            {list}
          </div>
        )}
      </div>

      {/* lg and up: a rail beside the card, sticky within the column. */}
      <div className="hidden lg:block lg:sticky lg:top-4">
        <div className="border border-border-brand bg-white px-3.5 py-3.5">
          {counterText && (
            <p className="text-[10px] font-display font-semibold uppercase tracking-wider text-field-label mb-1">
              {counterText}
            </p>
          )}
          <p className="text-xs font-display font-semibold uppercase tracking-wider text-navy mb-4">
            {copy.nav.menuHeading}
          </p>
          {list}
        </div>
      </div>
    </nav>
  );
}
