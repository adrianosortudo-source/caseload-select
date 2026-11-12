import type { Metadata } from "next";
import { GeneCurrentScreenMockup } from "@/components/prospect-demo/GeneCurrentScreenMockup";

export const metadata: Metadata = {
  title: "Family Law SCREEN Preview · CaseLoad Select",
  description: "Explore a family-law intake demonstration on Gene’s website mockup using fictional inquiries.",
  robots: { index: false, follow: false },
};

export default function GeneColmanScreenPage() {
  return <GeneCurrentScreenMockup />;
}
