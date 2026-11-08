import type { Metadata } from "next";
import { ProspectDemoClient } from "@/components/prospect-demo/ProspectDemoClient";

export const metadata: Metadata = {
  title: "SCREEN Demo · CaseLoad Select",
  description: "Try a fictional inquiry with live AI extraction and read the lawyer’s brief. Nothing is submitted to a firm.",
  robots: { index: false, follow: false },
};

export default async function ScreenToolPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const { embed } = await searchParams;
  return <ProspectDemoClient profileId="example-law-firm" sampleOnly embedded={embed === "1"} />;
}

