import type { DomSnapshot, WebVitalsSample } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";

/**
 * Performance and technical health (framework weight 9). "Fully
 * deterministic, and it gates real user experience." Source: framework
 * doc dimension 10.
 *
 * Measurement honesty: INP requires real user interaction and cannot be
 * measured in a scripted lab load. TBT (total blocking time) is the lab
 * proxy this tool actually measures; it is reported as TBT, never
 * mislabeled as INP. See build plan §5 Phase 1 note and renderer.ts
 * WebVitalsSample.
 */

function checkLcp(lcpMs: number | null): CheckItem {
  if (lcpMs === null) {
    return { label: "Largest Contentful Paint", status: "pass", detail: "Not captured for this load.", scored: false };
  }
  const seconds = (lcpMs / 1000).toFixed(1);
  if (lcpMs <= 2500) return { label: "Largest Contentful Paint", status: "pass", detail: `${seconds}s, in the good range (under 2.5s).` };
  if (lcpMs <= 4000) return { label: "Largest Contentful Paint", status: "warn", detail: `${seconds}s, needs improvement (2.5-4s).`, fix: "Identify the largest above-the-fold element (usually the hero image) and compress it, serve it in a modern format, and preload it." };
  return { label: "Largest Contentful Paint", status: "fail", detail: `${seconds}s, poor (over 4s). Conversions fall roughly 7% for every second past 3s.`, fix: "Compress and preload the largest above-the-fold asset; remove render-blocking resources ahead of it." };
}

function checkCls(cls: number | null): CheckItem {
  if (cls === null) {
    return { label: "Cumulative Layout Shift", status: "pass", detail: "Not captured for this load.", scored: false };
  }
  const rounded = Math.round(cls * 1000) / 1000;
  if (cls <= 0.1) return { label: "Cumulative Layout Shift", status: "pass", detail: `${rounded}, in the good range (under 0.1).` };
  if (cls <= 0.25) return { label: "Cumulative Layout Shift", status: "warn", detail: `${rounded}, needs improvement (0.1-0.25).`, fix: "Set explicit width/height on images and reserve space for late-loading content (ads, embeds, web fonts)." };
  return { label: "Cumulative Layout Shift", status: "fail", detail: `${rounded}, poor (over 0.25). Visible content is jumping around as the page loads.`, fix: "Set explicit width/height on every image and reserve space for anything that loads after initial paint." };
}

function checkTbt(tbtMs: number | null): CheckItem {
  if (tbtMs === null) {
    return { label: "Total Blocking Time", status: "pass", detail: "Not captured for this load.", scored: false };
  }
  const rounded = Math.round(tbtMs);
  if (tbtMs <= 200) {
    return { label: "Total Blocking Time", status: "pass", detail: `${rounded}ms. Lab responsiveness proxy; not the same as INP, which needs real user interaction to measure.` };
  }
  if (tbtMs <= 600) {
    return { label: "Total Blocking Time", status: "warn", detail: `${rounded}ms, elevated main-thread blocking during load.`, fix: "Break up long JavaScript tasks and defer non-critical scripts." };
  }
  return { label: "Total Blocking Time", status: "fail", detail: `${rounded}ms, heavy main-thread blocking during load. The page may feel unresponsive right after it appears loaded.`, fix: "Defer or remove non-critical JavaScript; break remaining long tasks into smaller chunks." };
}

function checkImageFormats(images: DomSnapshot["images"]): CheckItem[] {
  const items: CheckItem[] = [];
  const logos = images.filter((i) => i.isLikelyLogo);
  const rasterLogo = logos.find((i) => !["svg"].includes(i.format));
  items.push(
    logos.length === 0
      ? { label: "Logo format", status: "pass", detail: "No logo image detected to check.", scored: false }
      : rasterLogo
        ? {
            label: "Logo format",
            status: "warn",
            detail: `The site's logo appears to be a raster image (.${rasterLogo.format}) rather than SVG.`,
            fix: "Ship the logo as SVG so it scales losslessly to any size instead of shipping multiple raster exports.",
          }
        : { label: "Logo format", status: "pass", detail: "Logo is served as SVG." }
  );

  const legacyFormats = new Set(["jpg", "jpeg", "png", "gif", "bmp"]);
  const checkable = images.filter((i) => i.format !== "unknown" && i.format !== "svg");
  if (checkable.length > 0) {
    const legacyCount = checkable.filter((i) => legacyFormats.has(i.format)).length;
    const pct = Math.round((legacyCount / checkable.length) * 100);
    items.push(
      pct <= 50
        ? { label: "Modern image formats", status: "pass", detail: `${100 - pct}% of sampled images use a modern format (WebP/AVIF) or are unaffected.` }
        : {
            label: "Modern image formats",
            status: "warn",
            detail: `${pct}% of sampled raster images use a legacy format (JPG/PNG/GIF) rather than WebP or AVIF.`,
            fix: "Serve images in WebP or AVIF where the platform supports it; both are typically smaller than JPG/PNG at equivalent quality.",
          }
    );
  }

  return items;
}

export function scorePerformance(domSnapshot: DomSnapshot, webVitals: WebVitalsSample): DimensionResult {
  const items: CheckItem[] = [
    checkLcp(webVitals.lcpMs),
    checkCls(webVitals.cls),
    checkTbt(webVitals.tbtMs),
    ...checkImageFormats(domSnapshot.images),
  ];
  const { score, maxScore } = scoreItems(items);
  return { name: "Performance and Technical Health", weight: 9, score, maxScore, items };
}
