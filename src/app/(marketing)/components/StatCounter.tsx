"use client";

import { useEffect, useRef, useState } from "react";

interface StatCounterProps {
  target: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

/**
 * StatCounter
 *
 * Counts up from 0 to `target` with ease-out-cubic over `duration` ms,
 * triggered when the element scrolls into view. One-shot (no re-trigger).
 *
 * Renders the formatted value as text. Wrap in the brand .stat-number style
 * upstream — this component only owns the numeric animation, not the visual
 * styling of the number.
 */
export default function StatCounter({
  target,
  prefix = "",
  suffix = "",
  duration = 1400,
  className,
}: StatCounterProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    if (typeof window === "undefined") return;

    const node = ref.current;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setValue(target);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !animatedRef.current) {
            animatedRef.current = true;
            const start = performance.now();
            const step = (now: number) => {
              const progress = Math.min((now - start) / duration, 1);
              const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
              setValue(Math.round(ease * target));
              if (progress < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
