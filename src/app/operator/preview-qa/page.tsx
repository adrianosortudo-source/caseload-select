import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { isPreviewQaEnvironment } from "@/lib/preview-qa-auth";

import PreviewQaBootstrapForm from "./PreviewQaBootstrapForm";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Preview QA access | CaseLoad Select",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * An exact, preview-only entry point for rendering the existing one-time QA
 * bootstrap. Route knowledge is not authorization: the server rejects every
 * production, local, host-mismatched, or unconfigured request before render.
 */
export default async function PreviewQaPage() {
  const hostname = (await headers()).get("host") ?? "";
  if (!isPreviewQaEnvironment(hostname)) notFound();

  return <PreviewQaBootstrapForm />;
}
