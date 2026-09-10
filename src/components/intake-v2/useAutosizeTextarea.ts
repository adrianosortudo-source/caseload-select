"use client";

import { useEffect, useRef } from "react";

/** Let the containing page grow with a demo answer, including after a view resize. */
export function useAutosizeTextarea(enabled: boolean, value: string, visible = true) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !visible || !element) return;
    let lastWidth = -1;
    let active = true;
    const resize = () => {
      if (!active || !element.clientWidth) return;
      element.style.height = "auto";
      const style = getComputedStyle(element);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      element.style.height = `${Math.ceil(element.scrollHeight + border)}px`;
    };
    resize();
    void document.fonts?.ready.then(resize);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => { active = false; window.removeEventListener("resize", resize); };
    }
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return;
      lastWidth = element.clientWidth;
      resize();
    });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [enabled, value, visible]);
  return ref;
}
