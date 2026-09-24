"use client";

import type { ReactNode } from "react";

export const researchButton = "inline-flex items-center justify-center rounded-md border border-border-brand bg-white px-3 py-2 text-sm font-semibold text-navy hover:bg-parchment disabled:cursor-not-allowed disabled:opacity-50";
export const researchInput = "w-full rounded-md border border-border-brand bg-white px-3 py-2 text-sm text-navy";

export function researchLabel(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }
export function researchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? value : null; } catch { return null; }
}
export function ResearchPanel({ title, children, name, description }: { title: string; children: ReactNode; name: string; description?: string }) {
  return <section className="min-w-0 rounded-lg border border-border-brand bg-white p-4 sm:p-5" data-ui-component-content={name}>
    <h2 className="w-full text-pretty text-base font-semibold text-navy sm:text-lg" data-ui-copy="heading">{title}</h2>
    {description && <p className="mt-2 w-full text-pretty text-sm text-black/60" data-ui-copy="supporting">{description}</p>}
    <div className="mt-4 min-w-0 space-y-4">{children}</div>
  </section>;
}
export function ResearchError({ message, errorId, retry }: { message: string; errorId?: string | null; retry?: () => void }) {
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3" data-ui-component-content="research-error">
    <p className="w-full text-sm text-red-900" data-ui-copy="body">{message}</p>
    {errorId && <p className="mt-2 break-all font-mono text-xs text-red-800">Reference: {errorId}</p>}
    {retry && <div className="mt-3"><button type="button" className={researchButton} onClick={retry}>Try again</button></div>}
  </div>;
}

/** JSON stays data: HTML is never injected and original null/false/empty values remain explicit. */
export function ResearchJson({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === undefined) return <span className="text-black/50">Not supplied</span>;
  if (value === null) return <span className="text-black/50">Not recorded (null)</span>;
  if (typeof value === "boolean") return <span>{value ? "True" : "False"}</span>;
  if (typeof value === "string" && researchUrl(value)) return <a className="break-all underline underline-offset-2" href={value} target="_blank" rel="noopener noreferrer">{value}</a>;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="space-y-2">{value.map((item, index) => <li key={index} className="border-l-2 border-border-brand pl-3"><ResearchJson value={item} depth={depth + 1} /></li>)}</ol> : <span className="text-black/50">Empty list []</span>;
  const entries = Object.entries(value);
  if (!entries.length) return <span className="text-black/50">Empty object {"{}"}</span>;
  if (depth > 12) return <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(value)}</pre>;
  return <dl className="space-y-3">{entries.map(([key, item]) => <div key={key} className="min-w-0">
    <dt className="mb-1 text-xs font-semibold text-black/60">{researchLabel(key)}</dt>
    <dd className="text-sm text-navy"><ResearchJson value={item} depth={depth + 1} /></dd>
  </div>)}</dl>;
}


export function ResearchSource({ source }: { source: unknown }) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return <ResearchJson value={source} />;
  const value = source as Record<string, unknown>;
  const date = typeof value.observedOn === "string" ? value.observedOn : typeof value.observedAt === "string" ? value.observedAt : null;
  const parsed = date ? new Date(date.length === 10 ? date + "T00:00:00Z" : date) : null;
  const dateLabel = parsed && Number.isFinite(parsed.getTime()) ? "Observed " + new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC", ...(typeof value.observedAt === "string" ? { hour: "2-digit" as const, minute: "2-digit" as const } : {}) }).format(parsed) + (typeof value.observedAt === "string" ? " UTC" : "") : "Observation date not recorded";
  return <div className="min-w-0 space-y-2"><p className="text-sm">{dateLabel}</p>{typeof value.publicationLabel === "string" && <p className="text-sm">Published {value.publicationLabel}</p>}<ResearchJson value={value} /></div>;
}

export function ResearchOriginal({ content, unmappedPaths = [], sourcePath, sourcePointer, sha256 }: { content: unknown; unmappedPaths?: readonly string[]; sourcePath?: string; sourcePointer?: string; sha256?: string }) {
  return <details className="min-w-0 rounded-md border border-border-brand p-3">
    <summary className="cursor-pointer text-sm font-semibold text-navy">Original research and unmapped fields</summary>
    <div className="mt-3 space-y-3">
      {sourcePath && <p className="break-all text-xs text-black/60">Source: {sourcePath}{sourcePointer ? ` ${sourcePointer}` : ""}</p>}
      {sha256 && <p className="break-all font-mono text-xs">Source SHA-256: {sha256}</p>}
      <p className="text-sm text-black/60">{unmappedPaths.length ? `${unmappedPaths.length} original paths remain outside the structured fields.` : "No unmapped paths were reported by this package."}</p>
      {unmappedPaths.length > 0 && <ul className="space-y-1 text-xs">{unmappedPaths.map((path) => <li key={path} className="break-all font-mono">{path}</li>)}</ul>}
      <div className="min-w-0 rounded-md bg-parchment p-3"><ResearchJson value={content} /></div>
    </div>
  </details>;
}

export async function readResearchResponse<T>(response: Response, key?: string): Promise<T> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Research could not be loaded.");
  const result = key ? body[key] : body;
  if (result === null || typeof result !== "object") throw new Error("The research response was incomplete.");
  return result as T;
}
