import type { Metadata } from "next";
import { ProspectDemoClient } from "@/components/prospect-demo/ProspectDemoClient";

export const metadata: Metadata = {
  title: "Family Law SCREEN Preview · CaseLoad Select",
  description: "Explore a private family law intake demonstration using fictional inquiries.",
  robots: { index: false, follow: false },
};

export default function GeneColmanScreenPage() {
  return <ProspectDemoClient profileId="gene-colman" sampleOnly />;
}
