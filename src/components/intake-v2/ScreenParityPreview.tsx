"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenEnginePublicWidget, ScreenPreviewTransport } from "./ScreenEnginePublicWidget";
import ScreenParityMessaging from "./ScreenParityMessaging";
import type { PreviewPracticeArea, PreviewSubmission, ScreenPreviewBoundary } from "@/lib/screen-preview-boundary";
import type { LawyerReport } from "@/lib/screen-engine/types";

type Props = {
  practiceArea: PreviewPracticeArea;
  channel: "website" | "sms" | "whatsapp" | "instagram" | "facebook";
  comparison: boolean;
  externalReport: boolean;
  operationalPracticeAreas?: readonly PreviewPracticeArea[];
  children?: ReactNode;
};

function reportDocument(fragment: string) {
  const doc = document.implementation.createHTMLDocument("Fictional SCREEN brief");
  for (const style of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
    const copy = style.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    if (style instanceof HTMLLinkElement && copy instanceof HTMLLinkElement) copy.href = style.href;
    doc.head.append(copy);
  }
  const article = doc.createElement("article");
  article.className = "brief-frame";
  article.innerHTML = fragment;
  doc.body.style.margin = "0";
  doc.body.append(article);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

function VisibleBrief({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(300);
  useEffect(() => () => observer.current?.disconnect(), []);
  return <iframe id="parity-brief" title="Full fictional lawyer brief" sandbox="allow-same-origin"
    ref={frame} srcDoc={html} style={{ display: "block", width: "100%", height, border: 0 }}
    onLoad={() => {
      observer.current?.disconnect();
      const doc = frame.current?.contentDocument;
      if (!doc?.body) return;
      const fit = () => setHeight(Math.max(100, Math.ceil(doc.body.getBoundingClientRect().height)));
      observer.current = new ResizeObserver(fit);
      observer.current.observe(doc.body); fit();
    }} />;
}

export default function ScreenParityPreview({ practiceArea, channel, comparison, externalReport, operationalPracticeAreas, children }: Props) {
  const root = useRef<HTMLElement>(null);
  const submittedOpening = useRef(false);
  const [handoff, setHandoff] = useState({ opening: "", phone: "", start: false });
  const [phase, setPhase] = useState({ stage: "kickoff", step: null as string | null, question: null as string | null });
  const [submission, setSubmission] = useState<PreviewSubmission | null>(null);
  const [brief, setBrief] = useState("");
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [messagingReport, setMessagingReport] = useState<LawyerReport | null>(null);

  useEffect(() => {
    if (comparison || window.parent === window) return;
    const parent = window.parent;
    const origin = window.location.origin;
    let lastHeight = 0;
    const resize = () => {
      const height = Math.ceil(root.current?.getBoundingClientRect().height ?? 0);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        parent.postMessage({ type: "caseload-widget-resize", height }, origin);
      }
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== origin || submittedOpening.current || !event.data || typeof event.data !== "object") return;
      const { type, opening, phone } = event.data;
      if (type !== "caseload-demo-start" && type !== "caseload-demo-prefill") return;
      if (typeof opening !== "string" || !opening.trim() || opening.length > 16_000) return;
      const start = type === "caseload-demo-start";
      if (start) submittedOpening.current = true;
      setHandoff({ opening: opening.trim(), start,
        phone: channel === "sms" && typeof phone === "string" && /^[\d() +.-]{7,24}$/.test(phone) ? phone : "" });
    };
    const observer = new ResizeObserver(resize);
    if (root.current) observer.observe(root.current);
    window.addEventListener("message", receive);
    parent.postMessage({ type: "caseload-demo-ready" }, origin); resize();
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [channel, comparison]);

  const showReport = useCallback((html: string) => {
    const documentHtml = reportDocument(html);
    setBrief(documentHtml);
    if (externalReport && !comparison && window.parent !== window) {
      window.parent.postMessage({ type: "caseload-demo-report", html: documentHtml }, window.location.origin);
    }
  }, [externalReport, comparison]);
  const captured = useCallback((payload: PreviewSubmission) => {
    setSubmission(payload);
    showReport(payload.brief_html);
  }, [showReport]);
  const onStage = useCallback((stage: string, step: string | null, question: string | null) => {
    setPhase(previous => previous.stage === stage && previous.step === step && previous.question === question ? previous : { stage, step, question });
  }, []);
  const boundary = useMemo<ScreenPreviewBoundary>(() => ({
    startImmediately: handoff.start, phone: handoff.phone, onExtraction: setModelAvailable, onSubmission: captured, onStage,
  }), [handoff.start, handoff.phone, captured, onStage]);
  const onMessagingReport = useCallback(({ report, html }: { report: LawyerReport; html: string }) => {
    setMessagingReport(report);
    setPhase({ stage: "done", step: "stop", question: null });
    showReport(html);
  }, [showReport]);

  return <main ref={root} data-parity-path={comparison ? "production" : "embedded"}
    data-parity-stage={phase.stage} data-parity-step={phase.step} data-parity-question={phase.question} data-parity-channel={channel}>
    {(comparison || !externalReport) && <p className="px-5 py-3 text-sm">Use fictional details. Screen sends your enquiry and written follow-up answers to its AI provider to prepare the brief.</p>}
    <ScreenPreviewTransport.Provider value={boundary}>
    {children ?? (channel === "website" || channel === "sms"
      ? <ScreenEnginePublicWidget firmId="fictional-screen-preview" firmName="Example Law Firm" runtime="live"
          layout="contained" reportEmbeddedHeight={false} initialDescription={handoff.opening}
          operationalPracticeAreas={operationalPracticeAreas} />
      : <ScreenParityMessaging practiceArea={practiceArea} channel={channel} comparison={comparison}
          opening={handoff.opening} onReport={onMessagingReport} />)}
    </ScreenPreviewTransport.Provider>
    {modelAvailable === false && <p role="status" className="p-4">The AI service was unavailable for this enquiry. Screen used its built-in questions.</p>}
    {messagingReport && <script id="parity-submission" type="application/json">{JSON.stringify({ brief_json: messagingReport }).replace(/</g, "\\u003c")}</script>}
    {submission && <script id="parity-submission" type="application/json">{JSON.stringify(submission).replace(/</g, "\\u003c")}</script>}
    {brief && (!externalReport || comparison) && <section className="mx-auto w-full max-w-6xl p-5">
      <p className="mb-4">When someone completes Screen, your firm receives an email with a link to the full brief.</p>
      <VisibleBrief html={brief} />
    </section>}
  </main>;
}
