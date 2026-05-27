"use client";

import { useEffect } from "react";

/**
 * RevealOnScroll
 *
 * Wraps the page in a client component that attaches a single
 * IntersectionObserver to every `.reveal` element and toggles `.visible`
 * when the element scrolls into view.
 *
 * One observer for the whole page, not one per element. Performant.
 * Respects prefers-reduced-motion (CSS handles the no-animation case).
 *
 * Use as a sibling/wrapper at the top of the marketing layout. Add the
 * `.reveal` class (and optional `.reveal-delay-1|2|3|4`) to any element
 * that should fade in on scroll.
 */
export default function RevealOnScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("IntersectionObserver" in window)) {
      // Fallback: just mark everything visible immediately.
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    const elements = document.querySelectorAll(".reveal");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return null;
}
