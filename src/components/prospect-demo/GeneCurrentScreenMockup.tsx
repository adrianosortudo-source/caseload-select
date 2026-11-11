"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { geneColmanProspectDemoProfile as profile } from "@/lib/prospect-demo-profiles/gene-colman";
import styles from "./GeneCurrentScreenMockup.module.css";

type View = "website" | "review" | "split";
const VIEWS: ReadonlyArray<readonly [View, string]> = [["website", "Website preview"], ["review", "Lawyer brief"], ["split", "Side by side"]];
const WIDGET = "/screen-demo-app/index.html?embed=1&profile=gene&practice_area=family";
const PRESENTATION = "/prospect-demos/gene-colman/current-screen-frame.css";

/** The shipped Gene screenshot with the same packaged SCREEN used by /tools/screen. */
export function GeneCurrentScreenMockup() {
  const [view, setView] = useState<View>("website");
  const viewRef = useRef<View>("website");
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(560);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== "caseload-widget-resize" || typeof data.height !== "number" ||
          !Number.isFinite(data.height) || data.height < 100 || data.height > 20000) return;
      setHeight(Math.ceil(data.height));
    }
    window.addEventListener("message", onMessage);
    if (frame.current) frame.current.src = WIDGET;
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function configureFrame() {
    const doc = frame.current?.contentDocument;
    if (!doc?.getElementById("public-demo-content")) return;
    doc.documentElement.dataset.geneScreenPreview = "true";
    doc.body.dataset.geneView = viewRef.current;
    const input = doc.getElementById("case-input") as HTMLTextAreaElement | null;
    if (input) input.placeholder = profile.scenarios[1].description;
    const existing = doc.getElementById("gene-screen-presentation") as HTMLLinkElement | null;
    if (existing) return;
    const link = doc.createElement("link");
    link.id = "gene-screen-presentation";
    link.rel = "stylesheet";
    link.href = PRESENTATION;
    link.onload = () => { setReady(true); setFailed(false); };
    link.onerror = () => setFailed(true);
    doc.head.appendChild(link);
  }

  function changeView(next: View) {
    viewRef.current = next;
    setView(next);
    const body = frame.current?.contentDocument?.body;
    if (body) body.dataset.geneView = next;
  }

  function restart() {
    frame.current?.contentDocument?.getElementById("reset-btn")?.click();
    changeView("website");
  }

  const ratio = profile.screenshot.height / profile.screenshot.width;
  const formStart = ratio * profile.placement.y;
  const formHeight = ratio * profile.placement.height;
  const remaining = Math.max(0, ratio - formStart - formHeight);
  const showScreenshot = view !== "review" && !imageFailed;
  const focused = view !== "website" || imageFailed || width * profile.placement.width < 320;
  function slice(start: number, size: number, key: string) {
    return <div key={key} className={styles.slice} style={{ height: width * size }} aria-hidden="true">
      <Image src="/prospect-demos/gene-colman/gene-colman.webp" alt="" width={profile.screenshot.width} height={profile.screenshot.height}
        unoptimized loading="eager" className={styles.screenshot} style={{ top: -width * start }} onError={() => setImageFailed(true)} />
    </div>;
  }

  return <div className={styles.shell} data-gene-current-screen>
    <header className={styles.header}><div className={styles.inner}>
      <a href="https://caseloadselect.ca/" aria-label="CaseLoad Select"><Image src="/screen-demo-app/brand/logos/lockup-horizontal-dark-transparent.png" alt="CaseLoad Select" width={290} height={50} unoptimized className={styles.logo} /></a>
      <span className={styles.eyebrow}>Website demonstration</span>
    </div></header>
    <main className={styles.inner}>
      <section className={styles.introduction} data-ui-component-content="gene-introduction">
        <h1 data-ui-copy="heading">Try SCREEN</h1>
        <p data-ui-copy="body">Enter a fictional family-law inquiry and follow the questions.</p>
        <p data-ui-copy="body">Use Lawyer brief to see the information prepared for your firm.</p>
      </section>
      <div className={styles.toolbar}>
        <div role="group" aria-label="View" className={styles.views}>
          {VIEWS.map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} disabled={!ready} onClick={() => changeView(value)}>{label}</button>)}
        </div>
        <button type="button" disabled={!ready} onClick={restart}>Start over</button>
      </div>
      <p className={styles.disclosure} data-ui-component-content="gene-disclosure" data-ui-copy="supporting">Use fictional details, including contact details. Live AI sends your description to Google Gemini. This demo creates no lead and contacts no law firm.</p>
      <div ref={canvas} className={styles.canvas} aria-label="Gene C. Colman Family Law Centre website mockup" data-gene-view={view}>
        {showScreenshot && slice(0, formStart, "top")}
        <div className={styles.formRegion} style={{ minHeight: focused ? undefined : width * formHeight }}>
          {!focused && showScreenshot && <div className={styles.backdrop} style={{ height: width * formHeight }} aria-hidden="true">
            <Image src="/prospect-demos/gene-colman/gene-colman.webp" alt="" width={profile.screenshot.width} height={profile.screenshot.height}
              unoptimized loading="eager" className={styles.screenshot} style={{ top: -width * formStart }} onError={() => setImageFailed(true)} />
          </div>}
          <section className={styles.intake} style={{ marginLeft: focused ? 0 : `${profile.placement.x * 100}%`, width: focused ? "100%" : `${profile.placement.width * 100}%` }} aria-label="Gene’s SCREEN preview">
            <p role="status" className={styles.loading} hidden={ready && !failed}>{failed ? "The preview could not load. Reload the page to try again." : "Opening SCREEN."}</p>
            <iframe ref={frame} title="Gene family-law SCREEN demonstration" onLoad={configureFrame} onError={() => setFailed(true)}
              style={{ height, visibility: ready ? "visible" : "hidden" }} className={styles.frame} referrerPolicy="same-origin" />
          </section>
        </div>
        {showScreenshot && slice(formStart + formHeight, remaining, "bottom")}
      </div>
    </main>
  </div>;
}
