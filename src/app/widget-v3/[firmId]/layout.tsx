import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Intake",
  robots: "noindex",
};

export default function WidgetV3Layout({ children }: { children: React.ReactNode }) {
  return children;
}
